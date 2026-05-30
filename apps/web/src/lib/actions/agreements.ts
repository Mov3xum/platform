'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import PocketBase from 'pocketbase';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { recordActivity } from '@/lib/actions/record-activity';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  AGREEMENT_PARTY_LABELS,
  SIGNATURE_INTENT_TEXT,
  type Agreement,
  type AgreementParty,
  type AgreementStatus,
  type Role
} from '@platform/shared';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const PB_URL = getServerPbUrl();

export interface AgreementActionState {
  ok?: boolean;
  error?: string;
  status?: AgreementStatus;
}

type PbErrorLike = { status?: number };

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as PbErrorLike).status;
  }
  return undefined;
}

// Superuser-fallback (samma mönster som education_documents / workshops) —
// bolagsmedlemmens signaturskrivning sker bara efter att vi verifierat
// behörigheten i koden; PB v0.23:s rule-eval kan annars fela.
async function getSuperuserPb(): Promise<PocketBase | null> {
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
  if (!email || !password) {
    console.error('[agreements] superuser credentials missing');
    return null;
  }
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    return pb;
  } catch {
    console.error('[agreements] superuser auth failed');
    return null;
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Hämtar avtals-PDF:ens bytes server-side (kortlivad fil-token) för att
 * RÄKNA OM hashen och jämföra mot den lagrade — tamper-evidens (eIDAS art. 26 d). */
async function fetchAgreementBytes(
  pb: PocketBase,
  record: { id: string; file?: string }
): Promise<Buffer | null> {
  if (!record.file) return null;
  try {
    const token = await pb.files.getToken();
    const base = PB_URL.replace(/\/$/, '');
    const url = `${base}/api/files/agreements/${record.id}/${encodeURIComponent(
      record.file
    )}?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Signera ett tilldelat avtal in-app (avancerad elektronisk signatur,
 * eIDAS art. 25–26). Bolaget signerar party='company' (länkad medlem),
 * Movexum signerar party='movexum' (staff). När alla obligatoriska parter
 * signerat blir avtalet 'signed'. Det rättsliga beviset (identitet, avsikt,
 * dokument-hash, tid, ip-hash) lagras oföränderligt i agreement_signatures.
 */
export async function signAgreementAction(
  agreementId: string,
  input: { party: AgreementParty; fullName: string; intentConfirmed: boolean }
): Promise<AgreementActionState> {
  const user = await requireUser();
  if (!agreementId) return { error: 'Avtal saknas.' };

  const fullName = (input.fullName || '').trim().slice(0, 200);
  if (!fullName) return { error: 'Ange ditt fullständiga namn för att signera.' };
  if (!input.intentConfirmed) {
    return { error: 'Du måste bekräfta avsikten att signera.' };
  }
  const party = input.party;
  if (party !== 'company' && party !== 'movexum') return { error: 'Ogiltig part.' };

  const pb = await getServerPb();

  let agreement: Agreement & Record<string, unknown>;
  try {
    agreement = await pb
      .collection(PB_COLLECTIONS.agreements)
      .getOne<Agreement & Record<string, unknown>>(agreementId, { expand: 'startup' });
  } catch {
    return { error: 'Avtalet hittades inte.' };
  }
  if (String(agreement.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };

  const startupId = String(agreement.startup);
  const isStaff = hasRole(user.roles, STAFF_ROLES);
  const isLinkedMember = user.linkedStartups.includes(startupId);

  // Behörighet per part (juridisk korrekthet — rätt part fyller rätt slot).
  if (party === 'movexum' && !isStaff) {
    return { error: 'Endast Movexum-personal kan signera för Movexum.' };
  }
  if (party === 'company' && !isLinkedMember && !isStaff) {
    return { error: 'Endast bolagets medlemmar kan signera för bolaget.' };
  }

  // Parten måste vara obligatorisk i detta avtal. Defaults speglar UI:t:
  // bolaget krävs bara om flaggan uttryckligen är true (legacy-avtal saknar
  // den), Movexum krävs om inte uttryckligen avstängd.
  const needCompany = agreement.requires_company_signature === true;
  const needMovexum = agreement.requires_movexum_signature !== false;
  const required = party === 'company' ? needCompany : needMovexum;
  if (!required) return { error: 'Denna part behöver inte signera detta avtal.' };

  if (agreement.status === 'expired' || agreement.status === 'terminated') {
    return { error: 'Avtalet kan inte signeras i nuvarande status.' };
  }

  // Idempotens: redan signerad av denna part?
  const alreadySigned =
    party === 'company' ? Boolean(agreement.company_signed_at) : Boolean(agreement.movexum_signed_at);
  if (alreadySigned) return { ok: true, status: agreement.status as AgreementStatus };

  // ── Tamper-evidens: räkna om dokument-hashen och jämför mot den lagrade ──
  const bytes = await fetchAgreementBytes(pb, { id: agreement.id, file: agreement.file });
  if (!bytes) return { error: 'Kunde inte läsa avtalsfilen för signering.' };
  const currentHash = createHash('sha256').update(bytes).digest('hex');
  const storedHash = String(agreement.document_hash || '');
  if (storedHash && storedHash !== currentHash) {
    return {
      error:
        'Dokumentet har ändrats sedan det laddades upp och kan inte signeras. Be Movexum ladda upp avtalet på nytt.'
    };
  }

  // Audit-metadata (dataminimerad: ip lagras bara som SHA-256-hash).
  const h = await headers();
  const xff = h.get('x-forwarded-for');
  const ip = (xff ? xff.split(',')[0]!.trim() : h.get('x-real-ip')) || 'unknown';
  const userAgent = (h.get('user-agent') || '').slice(0, 300);
  const now = new Date().toISOString();

  const signaturePayload: Record<string, unknown> = {
    tenant: user.tenant,
    agreement: agreement.id,
    startup: startupId,
    signer: user.id,
    party,
    signer_name: fullName,
    signer_email: user.email || '',
    document_hash: currentHash,
    signed_at: now,
    ip_hash: sha256Hex(ip),
    user_agent: userAgent,
    intent_text: SIGNATURE_INTENT_TEXT,
    method: 'aes'
  };

  // Skapa det oföränderliga signeringsbeviset (staff via egen klient, bolags-
  // medlem via superuser-fallback). Unikt index (agreement, party) blockerar
  // dubbletter på DB-nivå.
  try {
    try {
      await pb.collection(PB_COLLECTIONS.agreementSignatures).create(signaturePayload);
    } catch (err) {
      const code = statusOf(err);
      if (code === 400 || code === 403) {
        const su = await getSuperuserPb();
        if (!su) throw err;
        await su.collection(PB_COLLECTIONS.agreementSignatures).create(signaturePayload);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('[agreements] signature create failed', {
      tenant: user.tenant,
      agreementId,
      party,
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte registrera signaturen.' };
  }

  // ── Uppdatera denormaliserad signeringsstatus på avtalet ────────────────
  const companySigned = party === 'company' || Boolean(agreement.company_signed_at);
  const movexumSigned = party === 'movexum' || Boolean(agreement.movexum_signed_at);
  const fullySigned = (!needCompany || companySigned) && (!needMovexum || movexumSigned);
  const nextStatus: AgreementStatus = fullySigned ? 'signed' : 'partially_signed';

  const update: Record<string, unknown> = { status: nextStatus };
  if (party === 'company') {
    update.company_signed_at = now;
    update.company_signed_by = user.id;
  } else {
    update.movexum_signed_at = now;
    update.movexum_signed_by = user.id;
  }
  if (fullySigned) update.signed_at = now;

  try {
    try {
      await pb.collection(PB_COLLECTIONS.agreements).update(agreementId, update);
    } catch (err) {
      const code = statusOf(err);
      if (code === 400 || code === 403) {
        const su = await getSuperuserPb();
        if (!su) throw err;
        await su.collection(PB_COLLECTIONS.agreements).update(agreementId, update);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('[agreements] status update failed', {
      tenant: user.tenant,
      agreementId,
      error: err instanceof Error ? err.message : err
    });
    // Signaturen är redan sparad (källan av sanning) — degradera mjukt.
  }

  const startupName =
    (agreement.expand as { startup?: { name?: string } } | undefined)?.startup?.name || 'Bolaget';
  await recordActivity(pb, {
    tenant: user.tenant,
    startup: startupId,
    kind: 'agreement',
    actor: user.id,
    title: `${AGREEMENT_PARTY_LABELS[party]} signerade avtal: ${agreement.title}`,
    meta: fullySigned ? 'fullt signerat' : 'väntar på motpart'
  });

  revalidatePath(`/startups/${startupId}`);
  revalidatePath('/aktivitet');
  revalidatePath('/inkorg');
  return { ok: true, status: nextStatus };
}

/** Radera ett avtal (admin/incubator_lead). Signeringsbevisen cascade-raderas. */
export async function deleteAgreementAction(
  agreementId: string
): Promise<AgreementActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Endast personal kan radera avtal.' };
  }
  if (!agreementId) return { error: 'Avtal saknas.' };

  const pb = await getServerPb();

  let agreement: Agreement & { tenant?: string; startup: string };
  try {
    agreement = await pb
      .collection(PB_COLLECTIONS.agreements)
      .getOne<Agreement & { tenant?: string; startup: string }>(agreementId);
  } catch {
    return { error: 'Avtalet hittades inte.' };
  }
  if (String(agreement.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    try {
      await pb.collection(PB_COLLECTIONS.agreements).delete(agreementId);
    } catch (err) {
      const code = statusOf(err);
      if (code === 400 || code === 403) {
        const su = await getSuperuserPb();
        if (!su) throw err;
        await su.collection(PB_COLLECTIONS.agreements).delete(agreementId);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('[agreements] delete failed', {
      tenant: user.tenant,
      agreementId,
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte radera avtalet.' };
  }

  revalidatePath(`/startups/${String(agreement.startup)}`);
  revalidatePath('/aktivitet');
  return { ok: true };
}
