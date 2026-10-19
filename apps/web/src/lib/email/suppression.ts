import 'server-only';
import type PocketBase from 'pocketbase';
import {
  contactEmailStatusForReason,
  maskEmailAddress,
  normalizeEmailAddress,
  type EmailSuppressionReason
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { hashEmail } from './signed-tokens';

/**
 * Spärrlistan (CLAUDE.md § 54.1) — adresser som ALDRIG får mejlas igen:
 * hårda studsar, spamklagomål, avregistreringar utanför kontaktboken,
 * Mailchimps avregistrerade/rensade listor vid bytet och manuella spärrar.
 *
 * Adressen lagras bara som SHA-256-hash (+ maskad visning `a***@domän`);
 * matchningen vid utskick görs på hash. När adressen tillhör en kontakt i
 * kontaktboken sätts dessutom `contacts.email_status` så personalen ser
 * varför kontakten inte får mejl. Skrivningar sker med den cachade
 * superusern (webhooken har ingen session; `email_suppressions.updateRule`
 * är null) EFTER att anroparen verifierat tenant.
 */

export const SUPPRESSIONS = 'email_suppressions';
const CHUNK = 40;

export const SUPPRESSION_MIGRATION_HINT =
  'PocketBase saknar spärrlistan för e-post — kör migration 1700000201 (eller workflowen "Sync PocketBase").';

export interface SuppressionRow {
  id: string;
  email_hash: string;
  email_masked: string;
  reason: EmailSuppressionReason;
  source: string;
  note: string;
  created: string;
}

function anyOf(pb: PocketBase, field: string, values: readonly string[]): string {
  const params: Record<string, string> = {};
  const parts = values.map((v, i) => {
    params[`v${i}`] = v;
    return `${field} = {:v${i}}`;
  });
  return pb.filter(`(${parts.join(' || ')})`, params);
}

/** Vilka av hasharna som är spärrade i tenanten. Kastar vid läsfel (ett utskick får aldrig gå utan kontroll). */
export async function loadSuppressedHashes(pb: PocketBase, tenant: string, hashes: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = [...new Set(hashes.filter(Boolean))];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const part = unique.slice(i, i + CHUNK);
    const rows = await pb.collection(SUPPRESSIONS).getFullList<{ email_hash: string }>({
      filter: `${pb.filter('tenant = {:t}', { t: tenant })} && ${anyOf(pb, 'email_hash', part)}`,
      fields: 'email_hash'
    });
    for (const r of rows) out.add(r.email_hash);
  }
  return out;
}

export async function isSuppressed(pb: PocketBase, tenant: string, email: string): Promise<boolean> {
  const n = normalizeEmailAddress(email);
  if (!n) return true;
  const set = await loadSuppressedHashes(pb, tenant, [hashEmail(n)]);
  return set.has(hashEmail(n));
}

function isUniqueViolation(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status !== 400) return false;
  const data = (err as { response?: { data?: Record<string, { code?: string }> } }).response?.data;
  return Object.values(data ?? {}).some((d) => d?.code === 'validation_not_unique');
}

export interface AddSuppressionParams {
  tenant: string;
  email: string;
  reason: EmailSuppressionReason;
  /** `resend` / `mailchimp` / `staff` / `preference_center` — PII-fri. */
  source: string;
  note?: string;
  createdBy?: string | null;
  /** Också sätt kontaktens synliga status (default true). */
  updateContacts?: boolean;
}

export type AddSuppressionResult = { ok: true; created: boolean; contactsUpdated: number } | { ok: false; error: string };

/**
 * Spärrar en adress. Idempotent: en adress som redan är spärrad lämnas (första
 * orsaken står kvar) och räknas som `created: false`. Kontakter i tenanten
 * med adressen får `email_status`; en avregistrering/klagomål stänger
 * dessutom av alla utskick på kontakten (`email_opt_out = ['all']`).
 */
export async function addSuppression(params: AddSuppressionParams): Promise<AddSuppressionResult> {
  const email = normalizeEmailAddress(params.email);
  if (!email) return { ok: false, error: 'Ogiltig e-postadress.' };
  const su = await getSuperuserPb();
  if (!su.ok) return { ok: false, error: 'Superuser saknas — spärrlistan kan inte skrivas.' };
  const pb = su.pb;
  const hash = hashEmail(email);
  let created = false;
  try {
    await pb.collection(SUPPRESSIONS).create({
      tenant: params.tenant,
      email_hash: hash,
      email_masked: maskEmailAddress(email),
      reason: params.reason,
      source: params.source.slice(0, 60),
      note: (params.note ?? '').slice(0, 200),
      ...(params.createdBy ? { created_by: params.createdBy } : {})
    });
    created = true;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return { ok: false, error: SUPPRESSION_MIGRATION_HINT };
    if (!isUniqueViolation(err)) {
      console.error('[email] suppression create failed', { status });
      return { ok: false, error: 'Kunde inte spara spärren.' };
    }
  }
  let contactsUpdated = 0;
  if (params.updateContacts !== false) {
    contactsUpdated = await markContactsByEmail(pb, params.tenant, email, params.reason);
  }
  return { ok: true, created, contactsUpdated };
}

/** Sätter `email_status` (+ opt-out vid avregistrering/klagomål) på kontakter med adressen. */
export async function markContactsByEmail(
  pb: PocketBase,
  tenant: string,
  email: string,
  reason: EmailSuppressionReason
): Promise<number> {
  let n = 0;
  try {
    const contacts = await pb.collection('contacts').getFullList<{ id: string }>({
      filter: pb.filter('tenant = {:t} && email = {:e}', { t: tenant, e: email }),
      fields: 'id'
    });
    const status = contactEmailStatusForReason(reason);
    const now = new Date().toISOString();
    for (const c of contacts) {
      const patch: Record<string, unknown> = { email_status: status, email_status_at: now };
      if (reason === 'unsubscribe' || reason === 'complaint' || reason === 'import') {
        patch.invite_opt_out = true;
        patch.invite_opt_out_at = now;
        patch.email_opt_out = ['all'];
      }
      await pb.collection('contacts').update(c.id, patch);
      n++;
    }
  } catch (err) {
    console.error('[email] contact status update failed', { status: (err as { status?: number })?.status });
  }
  return n;
}

/**
 * Tar bort en spärr (ledningen, t.ex. en felaktig import). Kontakter med samma
 * hash får statusen rensad; en avregistrering på kontakten själv rörs inte —
 * den är mottagarens eget val.
 */
export async function removeSuppression(pb: PocketBase, tenant: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let row: SuppressionRow;
  try {
    row = await pb.collection(SUPPRESSIONS).getOne<SuppressionRow & { tenant: string }>(id, { fields: 'id,tenant,email_hash,reason' });
    if ((row as unknown as { tenant: string }).tenant !== tenant) return { ok: false, error: 'Spärren hittades inte.' };
  } catch {
    return { ok: false, error: 'Spärren hittades inte.' };
  }
  try {
    await pb.collection(SUPPRESSIONS).delete(id);
  } catch (err) {
    console.error('[email] suppression delete failed', { status: (err as { status?: number })?.status });
    return { ok: false, error: 'Kunde inte ta bort spärren.' };
  }
  try {
    const su = await getSuperuserPb();
    const client = su.ok ? su.pb : pb;
    const contacts = await client.collection('contacts').getFullList<{ id: string; email?: string }>({
      filter: client.filter('tenant = {:t} && email_status != ""', { t: tenant }),
      fields: 'id,email',
      batch: 500
    });
    for (const c of contacts) {
      const n = normalizeEmailAddress(c.email);
      if (n && hashEmail(n) === row.email_hash) {
        await client.collection('contacts').update(c.id, { email_status: '', email_status_at: null });
      }
    }
  } catch {
    /* statusen är en spegel — spärren är borttagen */
  }
  return { ok: true };
}

export interface SuppressionListResult {
  rows: SuppressionRow[];
  total: number;
  byReason: Partial<Record<EmailSuppressionReason, number>>;
  missing?: boolean;
  error?: string;
}

export async function listSuppressions(
  pb: PocketBase,
  tenant: string,
  opts: { reason?: EmailSuppressionReason; page?: number; perPage?: number } = {}
): Promise<SuppressionListResult> {
  const base = pb.filter('tenant = {:t}', { t: tenant });
  try {
    const res = await pb.collection(SUPPRESSIONS).getList<SuppressionRow>(opts.page ?? 1, opts.perPage ?? 100, {
      filter: opts.reason ? `${base} && ${pb.filter('reason = {:r}', { r: opts.reason })}` : base,
      sort: '-created',
      fields: 'id,email_hash,email_masked,reason,source,note,created'
    });
    const byReason: Partial<Record<EmailSuppressionReason, number>> = {};
    for (const r of ['bounce', 'complaint', 'unsubscribe', 'import', 'manual'] as EmailSuppressionReason[]) {
      byReason[r] = (
        await pb.collection(SUPPRESSIONS).getList(1, 1, { filter: `${base} && ${pb.filter('reason = {:r}', { r })}`, fields: 'id' })
      ).totalItems;
    }
    return { rows: res.items, total: res.totalItems, byReason };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return { rows: [], total: 0, byReason: {}, missing: true };
    return { rows: [], total: 0, byReason: {}, error: 'Kunde inte läsa spärrlistan.' };
  }
}
