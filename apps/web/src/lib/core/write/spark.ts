import 'server-only';
import type PocketBase from 'pocketbase';
import {
  SPARK_MATCH_ACTIVE_STATUSES,
  SPARK_MATCH_STATUS_LABELS,
  SPARK_NEED_STATUSES,
  SPARK_SOLUTION_STATUSES,
  SPARK_TESTBED_STATUSES,
  SPARK_WORK_PACKAGES,
  cleanSparkText,
  deriveSparkRecords,
  isSparkAcceleratorCategory,
  isSparkConsent,
  isSparkId,
  isSparkMatchStatus,
  isSparkTrl,
  normalizeSparkInterview,
  scoreNeedSolution,
  type SparkActorDraft,
  type SparkInterviewAnswers,
  type SparkInterviewSource,
  type SparkInterviewStatus,
  type SparkMatchStatus
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { notify } from '@/lib/notifications-server';
import {
  SPARK_ACTORS,
  SPARK_INTERVIEWS,
  SPARK_MATCHES,
  SPARK_MIGRATION_HINT,
  SPARK_NEEDS,
  SPARK_SOLUTIONS,
  SPARK_TESTBEDS,
  normalizeSparkActor,
  normalizeSparkInterviewRow,
  normalizeSparkMatch,
  normalizeSparkNeed,
  normalizeSparkSolution,
  normalizeSparkTestbed,
  type SparkActorRow,
  type SparkInterviewRow
} from '@/lib/spark/data';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * SPARK – energimatchning (CLAUDE.md § 61) — det delade skrivlagret.
 *
 * - Movexum (admin/incubator_lead/coach) gör allt: intervjuar, för in svar i
 *   registret, matchar, följer upp och bedömer TRL inför acceleratorn.
 * - En PARTNER (Högskolan, en kommun) skapar och redigerar sina EGNA
 *   intervjuer och skickar in dem. Partnern skriver aldrig i registret —
 *   Movexum för in svaret (`applySparkInterview`). Allt går via Movexum.
 * - Företagets egen anmälan på den publika sidan går via
 *   `lib/spark/public.server.ts` (ingen Actor) och landar som inskickad.
 * - Tenant verifieras i koden på varje post; superuser bara som reserv vid
 *   PB v0.23.4:s tysta regel-nekande (§ 21.3), efter rollkontrollen.
 * - Audit i `agent_actions` bär företagsnamn, antal och status — aldrig
 *   kontaktpersoner eller fritext. Agenten har inga verktyg här.
 */

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;
const LEAD_ROLES = ['admin', 'incubator_lead'] as const;

export function canManageSpark(roles: readonly string[]): boolean {
  return roles.some((r) => (MANAGE_ROLES as readonly string[]).includes(r));
}
export function isSparkPartner(roles: readonly string[]): boolean {
  return roles.includes('partner') && !canManageSpark(roles);
}
function isLead(actor: Actor): boolean {
  return actor.roles.some((r) => (LEAD_ROLES as readonly string[]).includes(r));
}
function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}
function dbFail<T>(err: unknown, what: string): WriteResult<T> {
  if (statusOf(err) === 404) return fail('DB_ERROR', SPARK_MIGRATION_HINT);
  console.error('[spark] write failed', { what, status: statusOf(err) });
  return fail('DB_ERROR', `Kunde inte ${what}.`);
}
function denied<T>(actor: Actor, reason: string): WriteResult<T> {
  return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', reason);
}
const nowIso = () => new Date().toISOString();
type Raw = Record<string, unknown>;

// ── Intervjuer ──────────────────────────────────────────────────────────────

export interface SparkInterviewInput {
  answers: unknown;
  interviewerOrg?: string;
  interviewedAt?: string;
  submit?: boolean;
}

export interface SparkApplySummary {
  actorId: string;
  actorName: string;
  actorCreated: boolean;
  needs: number;
  solutions: number;
  testbeds: number;
}

export interface SparkInterviewResult {
  interviewId: string;
  status: SparkInterviewStatus;
  applied?: SparkApplySummary;
  warning?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function loadInterview(pb: PocketBase, actor: Actor, id: string): Promise<SparkInterviewRow | null> {
  if (!isSparkId(id)) return null;
  const raw = await getRecordInTenant<{ id: string; tenant: string }>(pb, actor, SPARK_INTERVIEWS, id, '*');
  return raw ? normalizeSparkInterviewRow(raw as unknown as Raw) : null;
}

/** Movexums ledning — mottagare när en partner eller ett företag skickat in något. */
async function leadIds(tenant: string): Promise<string[]> {
  const su = await getSuperuserPb();
  if (!su.ok) return [];
  try {
    const res = await su.pb.collection('users').getList<{ id: string; tenant?: string; roles?: string[] }>(1, 100, {
      filter: su.pb.filter('tenant = {:t} && (roles ~ "admin" || roles ~ "incubator_lead")', { t: tenant }),
      fields: 'id,tenant,roles'
    });
    return res.items.filter((u) => String(u.tenant) === tenant && (u.roles ?? []).some((r) => r === 'admin' || r === 'incubator_lead')).map((u) => u.id);
  } catch {
    return [];
  }
}

export async function notifySparkSubmission(
  pb: PocketBase | null,
  params: { tenant: string; interviewId: string; companyName: string; source: SparkInterviewSource; actorId?: string }
): Promise<void> {
  const recipients = await leadIds(params.tenant);
  if (recipients.length === 0) return;
  const client = pb ?? (await getSuperuserPb().then((su) => (su.ok ? su.pb : null)));
  if (!client) return;
  await notify(client, {
    tenant: params.tenant,
    recipients,
    kind: 'spark_interview_submitted',
    actorId: params.actorId,
    entity: { type: 'spark_interview', id: params.interviewId },
    dedupeKey: `spark_interview_submitted:${params.interviewId}`,
    payload: {
      title: params.source === 'self' ? `Ny anmälan till SPARK: ${params.companyName}` : `Ny intervju i SPARK: ${params.companyName}`,
      snippet: 'Väntar på att föras in i registret.',
      href: `/spark/intervjuer/${params.interviewId}`
    }
  }).catch(() => undefined);
}

/**
 * Sparar ett intervjusvar (utkast eller inskick). Movexums inskick förs in i
 * registret direkt; en partners inskick väntar på Movexum.
 */
export async function saveSparkInterview(
  pb: PocketBase,
  actor: Actor,
  interviewId: string | null,
  input: SparkInterviewInput
): Promise<WriteResult<SparkInterviewResult>> {
  const policy = canCreateRecord(actor, SPARK_INTERVIEWS);
  if (!policy.ok) return denied(actor, policy.reason ?? 'Nekat.');
  const manage = canManageSpark(actor.roles);
  let existing: SparkInterviewRow | null = null;
  if (interviewId) {
    existing = await loadInterview(pb, actor, interviewId);
    if (!existing) return fail('NOT_FOUND', 'Intervjun hittades inte.');
    if (!manage) {
      if (existing.created_by !== actor.id) return fail('FORBIDDEN', 'Du kan bara ändra intervjuer du själv har registrerat.');
      if (existing.status === 'applied') return fail('STATE_TRANSITION', 'Intervjun är införd i registret — be Movexum om ändringar.');
    }
  }
  const norm = normalizeSparkInterview(input.answers, { submit: Boolean(input.submit) });
  if (!norm.ok) return fail('INVALID_VALUE', norm.issue.message);
  const answers = norm.value;
  const status: SparkInterviewStatus = input.submit ? 'submitted' : existing?.status === 'applied' ? 'applied' : existing?.status === 'submitted' ? 'submitted' : 'draft';
  const payload: Raw = {
    company_name: String(answers.company.name ?? ''),
    org_nr: typeof answers.company.org_nr === 'string' ? answers.company.org_nr : '',
    roles: answers.roles,
    answers,
    status,
    interviewer_org: cleanSparkText(input.interviewerOrg, 160),
    interviewed_at: input.interviewedAt && DATE_RE.test(input.interviewedAt) ? `${input.interviewedAt} 00:00:00.000Z` : ''
  };
  if (input.submit && !existing?.submitted_at) payload.submitted_at = nowIso();

  let row: SparkInterviewRow;
  try {
    if (existing) {
      const id = existing.id;
      const updated = await writeWithFallback(pb, (c) => c.collection(SPARK_INTERVIEWS).update<Raw>(id, payload), { fallbackOn404: true });
      row = normalizeSparkInterviewRow(updated);
    } else {
      const created = await writeWithFallback(pb, (c) =>
        c.collection(SPARK_INTERVIEWS).create<Raw>({
          ...payload,
          tenant: actor.tenant,
          source: manage ? 'staff' : 'partner',
          created_by: actor.id
        })
      );
      row = normalizeSparkInterviewRow(created);
    }
  } catch (err) {
    return dbFail(err, 'spara intervjun');
  }
  await logAgentAction(pb, {
    actor,
    action_type: existing ? 'update' : 'create',
    collection: SPARK_INTERVIEWS,
    record_id: row.id,
    after_value: { company_name: row.company_name, status: row.status, source: row.source, roles: row.roles }
  });

  if (!input.submit) return ok({ interviewId: row.id, status: row.status });
  if (!manage) {
    await notifySparkSubmission(pb, { tenant: actor.tenant, interviewId: row.id, companyName: row.company_name, source: row.source, actorId: actor.id });
    return ok({ interviewId: row.id, status: row.status });
  }
  const applied = await applySparkInterview(pb, actor, row.id);
  if (!applied.ok) return ok({ interviewId: row.id, status: row.status, warning: `Intervjun är sparad men kunde inte föras in i registret: ${applied.error}` });
  return ok({ interviewId: row.id, status: 'applied', applied: applied.value });
}

function actorPatch(d: SparkActorDraft, existing: SparkActorRow | null, answered: { contact: boolean; sharing: boolean }): Raw {
  const out: Raw = {};
  const textFields: (keyof SparkActorDraft)[] = [
    'name', 'org_nr', 'actor_type', 'sector', 'business', 'kommun', 'size', 'energy_importance', 'energy_work',
    'development_areas', 'pilot_interest', 'academia_interest', 'need_matching', 'solution_matching', 'program_interest'
  ];
  // Tomma svar skriver aldrig över det som redan finns på aktören.
  for (const f of textFields) {
    const v = d[f];
    if (typeof v === 'string' && v) out[f] = v;
  }
  out.roles = [...new Set([...(existing?.roles ?? []), ...d.roles])];
  if (d.support_needs.length) out.support_needs = d.support_needs;
  if (answered.sharing) out.sharing = d.sharing;
  if (answered.contact) {
    // Ett nej till kontakt tar bort kontaktuppgifterna (företagets besked gäller).
    out.contact_ok = d.contact_ok;
    out.info_ok = d.info_ok;
    out.events_ok = d.events_ok;
    out.contact_name = d.contact_name;
    out.contact_role = d.contact_role;
    out.contact_email = d.contact_email;
    out.contact_phone = d.contact_phone;
  }
  return out;
}

async function findActor(pb: PocketBase, tenant: string, d: SparkActorDraft, linked: string | null): Promise<SparkActorRow | null> {
  const first = async (filter: string): Promise<SparkActorRow | null> => {
    try {
      const res = await pb.collection(SPARK_ACTORS).getList<Raw>(1, 20, { filter });
      const rows = res.items.map(normalizeSparkActor).filter((a) => a.tenant === tenant);
      return rows[0] ?? null;
    } catch {
      return null;
    }
  };
  if (linked) {
    const hit = await first(pb.filter('tenant = {:t} && id = {:id}', { t: tenant, id: linked }));
    if (hit) return hit;
  }
  if (d.org_nr) {
    const hit = await first(pb.filter('tenant = {:t} && org_nr = {:o}', { t: tenant, o: d.org_nr }));
    if (hit) return hit;
  }
  try {
    const res = await pb.collection(SPARK_ACTORS).getList<Raw>(1, 50, { filter: pb.filter('tenant = {:t} && name ~ {:n}', { t: tenant, n: d.name }) });
    const same = res.items
      .map(normalizeSparkActor)
      .filter((a) => a.tenant === tenant && a.name.trim().toLowerCase() === d.name.trim().toLowerCase())
      // Två olika organisationsnummer är två olika företag, även med samma namn.
      .filter((a) => !a.org_nr || !d.org_nr || a.org_nr === d.org_nr);
    return same[0] ?? null;
  } catch {
    return null;
  }
}

/** För in ett inskickat intervjusvar i registret: aktör (befintlig eller ny), behov, lösningar och testmiljöer. */
export async function applySparkInterview(pb: PocketBase, actor: Actor, interviewId: string): Promise<WriteResult<SparkApplySummary>> {
  if (actor.kind === 'agent' || !canManageSpark(actor.roles)) return denied(actor, 'Bara Movexum för in svar i registret.');
  const interview = await loadInterview(pb, actor, interviewId);
  if (!interview) return fail('NOT_FOUND', 'Intervjun hittades inte.');
  if (interview.status === 'draft') return fail('STATE_TRANSITION', 'Intervjun är ett utkast — den måste skickas in först.');
  const norm = normalizeSparkInterview(interview.answers);
  if (!norm.ok) return fail('INVALID_VALUE', norm.issue.message);
  const d = deriveSparkRecords(norm.value);
  const company = norm.value.company;

  const existing = await findActor(pb, actor.tenant, d.actor, interview.actor);
  const patch = actorPatch(d.actor, existing, { contact: typeof company.contact_ok === 'string', sharing: typeof company.sharing === 'string' });
  let actorRow: SparkActorRow;
  try {
    if (existing) {
      const updated = await writeWithFallback(pb, (c) => c.collection(SPARK_ACTORS).update<Raw>(existing.id, patch), { fallbackOn404: true });
      actorRow = normalizeSparkActor(updated);
    } else {
      const created = await writeWithFallback(pb, (c) =>
        c.collection(SPARK_ACTORS).create<Raw>({ ...patch, tenant: actor.tenant, status: 'active', created_by: actor.id })
      );
      actorRow = normalizeSparkActor(created);
    }
  } catch (err) {
    return dbFail(err, 'spara aktören');
  }

  const upsert = async (collection: string, rows: { source_key: string }[], initialStatus: string): Promise<number> => {
    if (rows.length === 0) return 0;
    const existingRows = await pb
      .collection(collection)
      .getFullList<Raw>({ filter: pb.filter('tenant = {:t} && interview = {:i}', { t: actor.tenant, i: interview.id }), fields: 'id,source_key' })
      .catch(() => [] as Raw[]);
    const byKey = new Map(existingRows.map((r) => [String(r.source_key), String(r.id)]));
    let n = 0;
    for (const row of rows) {
      const id = byKey.get(row.source_key);
      if (id) {
        await writeWithFallback(pb, (c) => c.collection(collection).update(id, { ...row, actor: actorRow.id }), { fallbackOn404: true });
      } else {
        await writeWithFallback(pb, (c) =>
          c.collection(collection).create({ ...row, tenant: actor.tenant, actor: actorRow.id, interview: interview.id, status: initialStatus, created_by: actor.id })
        );
      }
      n += 1;
    }
    return n;
  };

  let needs = 0;
  let solutions = 0;
  let testbeds = 0;
  try {
    needs = await upsert(SPARK_NEEDS, d.needs, 'open');
    solutions = await upsert(SPARK_SOLUTIONS, d.solutions, 'active');
    testbeds = await upsert(SPARK_TESTBEDS, d.testbeds, 'available');
    await writeWithFallback(
      pb,
      (c) => c.collection(SPARK_INTERVIEWS).update(interview.id, { status: 'applied', actor: actorRow.id, applied_at: nowIso(), applied_by: actor.id }),
      { fallbackOn404: true }
    );
  } catch (err) {
    return dbFail(err, 'föra in svaret i registret');
  }
  const summary: SparkApplySummary = { actorId: actorRow.id, actorName: actorRow.name, actorCreated: !existing, needs, solutions, testbeds };
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: SPARK_INTERVIEWS,
    record_id: interview.id,
    field: 'applied',
    after_value: { company_name: actorRow.name, actor_created: !existing, needs, solutions, testbeds, source: interview.source }
  });
  return ok(summary);
}

export async function deleteSparkInterview(pb: PocketBase, actor: Actor, interviewId: string): Promise<WriteResult<{ deleted: true }>> {
  if (actor.kind === 'agent') return denied(actor, 'Intervjuer tas bort av en människa.');
  const interview = await loadInterview(pb, actor, interviewId);
  if (!interview) return fail('NOT_FOUND', 'Intervjun hittades inte.');
  const own = interview.created_by === actor.id && interview.status === 'draft';
  if (!isLead(actor) && !own) return fail('FORBIDDEN', 'Bara ledningen kan ta bort en inskickad intervju. Egna utkast kan du ta bort själv.');
  try {
    await writeWithFallback(pb, (c) => c.collection(SPARK_INTERVIEWS).delete(interview.id), { fallbackOn404: true });
  } catch (err) {
    return dbFail(err, 'ta bort intervjun');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: SPARK_INTERVIEWS,
    record_id: interview.id,
    after_value: { company_name: interview.company_name, deleted: true }
  });
  return ok({ deleted: true });
}

export interface SparkImportSummary {
  created: number;
  applied: number;
  failed: number;
  errors: string[];
}

/** Importerade rader blir intervjusvar. Movexums import förs in i registret direkt, en partners väntar på Movexum. */
export async function importSparkInterviews(
  pb: PocketBase,
  actor: Actor,
  rows: readonly { line: number; answers: SparkInterviewAnswers }[],
  meta: { interviewerOrg?: string }
): Promise<WriteResult<SparkImportSummary>> {
  const policy = canCreateRecord(actor, SPARK_INTERVIEWS);
  if (!policy.ok) return denied(actor, policy.reason ?? 'Nekat.');
  const manage = canManageSpark(actor.roles);
  const summary: SparkImportSummary = { created: 0, applied: 0, failed: 0, errors: [] };
  for (const row of rows.slice(0, 2000)) {
    const norm = normalizeSparkInterview(row.answers);
    if (!norm.ok) {
      summary.failed += 1;
      if (summary.errors.length < 10) summary.errors.push(`Rad ${row.line}: ${norm.issue.message}`);
      continue;
    }
    try {
      const created = await writeWithFallback(pb, (c) =>
        c.collection(SPARK_INTERVIEWS).create<Raw>({
          tenant: actor.tenant,
          company_name: String(norm.value.company.name ?? ''),
          org_nr: typeof norm.value.company.org_nr === 'string' ? norm.value.company.org_nr : '',
          roles: norm.value.roles,
          answers: norm.value,
          status: 'submitted',
          source: 'import',
          interviewer_org: cleanSparkText(meta.interviewerOrg, 160),
          submitted_at: nowIso(),
          created_by: actor.id
        })
      );
      summary.created += 1;
      if (manage) {
        const applied = await applySparkInterview(pb, actor, String(created.id));
        if (applied.ok) summary.applied += 1;
        else if (summary.errors.length < 10) summary.errors.push(`Rad ${row.line}: sparad men inte införd — ${applied.error}`);
      }
    } catch (err) {
      if (statusOf(err) === 404) return fail('DB_ERROR', SPARK_MIGRATION_HINT);
      summary.failed += 1;
      if (summary.errors.length < 10) summary.errors.push(`Rad ${row.line}: kunde inte sparas.`);
    }
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: 'spark_import',
    record_id: actor.tenant,
    after_value: { created: summary.created, applied: summary.applied, failed: summary.failed }
  });
  if (!manage && summary.created > 0) {
    const recipients = await leadIds(actor.tenant);
    await notify(pb, {
      tenant: actor.tenant,
      recipients,
      kind: 'spark_interview_submitted',
      actorId: actor.id,
      entity: { type: 'spark_import', id: actor.id },
      payload: { title: `${summary.created} importerade intervjuer i SPARK`, snippet: 'Väntar på att föras in i registret.', href: '/spark/intervjuer?status=submitted' }
    }).catch(() => undefined);
  }
  return ok(summary);
}

// ── Registret ───────────────────────────────────────────────────────────────

function requireManage<T>(actor: Actor): WriteResult<T> | null {
  if (actor.kind === 'agent') return denied(actor, 'SPARK-registret hanteras av en människa.');
  if (!canManageSpark(actor.roles)) return fail('FORBIDDEN', 'Bara Movexum-personal kan ändra i registret.');
  return null;
}

export async function updateSparkActor(
  pb: PocketBase,
  actor: Actor,
  actorId: string,
  input: { notes?: unknown; website?: unknown; startup?: unknown; status?: unknown }
): Promise<WriteResult<{ actorId: string }>> {
  const no = requireManage<{ actorId: string }>(actor);
  if (no) return no;
  if (!isSparkId(actorId)) return fail('NOT_FOUND', 'Ogiltig aktör.');
  const row = await getRecordInTenant<{ id: string; tenant: string; name?: string }>(pb, actor, SPARK_ACTORS, actorId, 'id,tenant,name');
  if (!row) return fail('NOT_FOUND', 'Aktören hittades inte.');
  const patch: Raw = {};
  if (input.notes !== undefined) patch.notes = cleanSparkText(input.notes, 3000);
  if (input.website !== undefined) patch.website = cleanSparkText(input.website, 300);
  if (input.status !== undefined) {
    if (input.status !== 'active' && input.status !== 'archived') return fail('INVALID_VALUE', 'Ogiltig status.');
    patch.status = input.status;
  }
  if (input.startup !== undefined) {
    if (input.startup === '' || input.startup === null) patch.startup = '';
    else {
      if (!isSparkId(input.startup)) return fail('INVALID_VALUE', 'Ogiltigt bolag.');
      const startup = await getRecordInTenant<{ id: string; tenant: string }>(pb, actor, 'startups', input.startup, 'id,tenant');
      if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');
      patch.startup = startup.id;
    }
  }
  try {
    await writeWithFallback(pb, (c) => c.collection(SPARK_ACTORS).update(row.id, patch), { fallbackOn404: true });
  } catch (err) {
    return dbFail(err, 'spara aktören');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: SPARK_ACTORS,
    record_id: row.id,
    after_value: { name: row.name, fields: Object.keys(patch), status: patch.status }
  });
  return ok({ actorId: row.id });
}

const RECORD_KINDS = {
  need: { collection: SPARK_NEEDS, statuses: SPARK_NEED_STATUSES as readonly string[], label: 'title' },
  solution: { collection: SPARK_SOLUTIONS, statuses: SPARK_SOLUTION_STATUSES as readonly string[], label: 'name' },
  testbed: { collection: SPARK_TESTBEDS, statuses: SPARK_TESTBED_STATUSES as readonly string[], label: 'kind' }
} as const;
export type SparkRecordKind = keyof typeof RECORD_KINDS;

export async function setSparkRecordStatus(pb: PocketBase, actor: Actor, kind: SparkRecordKind, id: string, status: string): Promise<WriteResult<{ id: string }>> {
  const no = requireManage<{ id: string }>(actor);
  if (no) return no;
  const def = RECORD_KINDS[kind];
  if (!def || !isSparkId(id)) return fail('NOT_FOUND', 'Posten hittades inte.');
  if (!def.statuses.includes(status)) return fail('INVALID_VALUE', 'Ogiltig status.');
  const row = await getRecordInTenant<{ id: string; tenant: string }>(pb, actor, def.collection, id, `id,tenant,${def.label}`);
  if (!row) return fail('NOT_FOUND', 'Posten hittades inte.');
  try {
    await writeWithFallback(pb, (c) => c.collection(def.collection).update(row.id, { status }), { fallbackOn404: true });
  } catch (err) {
    return dbFail(err, 'ändra status');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: def.collection,
    record_id: row.id,
    field: 'status',
    after_value: { label: String((row as Raw)[def.label] ?? ''), status }
  });
  return ok({ id: row.id });
}

/** Movexums TRL-bedömning och kategorisering av en lösning inför acceleratorprogrammet. */
export async function assessSparkSolution(
  pb: PocketBase,
  actor: Actor,
  solutionId: string,
  input: { trl?: unknown; category?: unknown; note?: unknown }
): Promise<WriteResult<{ id: string }>> {
  const no = requireManage<{ id: string }>(actor);
  if (no) return no;
  if (!isSparkId(solutionId)) return fail('NOT_FOUND', 'Lösningen hittades inte.');
  const row = await getRecordInTenant<{ id: string; tenant: string; name?: string }>(pb, actor, SPARK_SOLUTIONS, solutionId, 'id,tenant,name');
  if (!row) return fail('NOT_FOUND', 'Lösningen hittades inte.');
  const trl = input.trl === '' || input.trl === undefined || input.trl === null ? 0 : Number(input.trl);
  if (trl !== 0 && !isSparkTrl(trl)) return fail('INVALID_VALUE', 'TRL ska vara 1–9.');
  const category = typeof input.category === 'string' ? input.category : '';
  if (category && !isSparkAcceleratorCategory(category)) return fail('INVALID_VALUE', 'Ogiltig kategori.');
  const note = cleanSparkText(input.note, 1000);
  try {
    await writeWithFallback(
      pb,
      (c) =>
        c.collection(SPARK_SOLUTIONS).update(row.id, {
          trl_assessed: trl,
          accelerator_category: category,
          accelerator_note: note,
          assessed_by: actor.id,
          assessed_at: nowIso()
        }),
      { fallbackOn404: true }
    );
  } catch (err) {
    return dbFail(err, 'spara bedömningen');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: SPARK_SOLUTIONS,
    record_id: row.id,
    field: 'accelerator',
    after_value: { label: row.name, trl_assessed: trl || null, category: category || null, note_length: note.length }
  });
  return ok({ id: row.id });
}

// ── Matchningar ─────────────────────────────────────────────────────────────

export async function createSparkMatch(
  pb: PocketBase,
  actor: Actor,
  input: { needId?: string | null; solutionId?: string | null; testbedId?: string | null }
): Promise<WriteResult<{ matchId: string }>> {
  const no = requireManage<{ matchId: string }>(actor);
  if (no) return no;
  const policy = canCreateRecord(actor, SPARK_MATCHES);
  if (!policy.ok) return denied(actor, policy.reason ?? 'Nekat.');
  const load = async (collection: string, id: string | null | undefined): Promise<Raw | null> => {
    if (!id) return null;
    if (!isSparkId(id)) return null;
    return (await getRecordInTenant<{ id: string; tenant: string }>(pb, actor, collection, id, '*')) as unknown as Raw | null;
  };
  const [needRaw, solutionRaw, testbedRaw] = await Promise.all([
    load(SPARK_NEEDS, input.needId),
    load(SPARK_SOLUTIONS, input.solutionId),
    load(SPARK_TESTBEDS, input.testbedId)
  ]);
  if ((input.needId && !needRaw) || (input.solutionId && !solutionRaw) || (input.testbedId && !testbedRaw)) {
    return fail('NOT_FOUND', 'En av posterna hittades inte i din organisation.');
  }
  const need = needRaw ? normalizeSparkNeed(needRaw) : null;
  const solution = solutionRaw ? normalizeSparkSolution(solutionRaw) : null;
  const testbed = testbedRaw ? normalizeSparkTestbed(testbedRaw) : null;
  if ([need, solution, testbed].filter(Boolean).length < 2) return fail('INVALID_VALUE', 'En matchning behöver minst två parter: behov, lösning eller testmiljö.');
  const owners = new Set([need?.actor, solution?.actor, testbed?.actor].filter(Boolean));
  if (owners.size < 2) return fail('INVALID_VALUE', 'Parterna hör till samma aktör.');

  try {
    const dup = await pb.collection(SPARK_MATCHES).getList(1, 1, {
      filter: pb.filter('tenant = {:t} && need = {:n} && solution = {:s} && testbed = {:b}', {
        t: actor.tenant,
        n: need?.id ?? '',
        s: solution?.id ?? '',
        b: testbed?.id ?? ''
      })
    });
    if (dup.totalItems > 0) return fail('STATE_TRANSITION', 'Den här matchningen finns redan.');
  } catch (err) {
    if (statusOf(err) === 404) return fail('DB_ERROR', SPARK_MIGRATION_HINT);
  }

  let score = 0;
  let reasons: string[] = [];
  if (need && solution) {
    const ids = [need.actor, solution.actor];
    const actorRows = await Promise.all(ids.map((id) => getRecordInTenant<{ id: string; tenant: string }>(pb, actor, SPARK_ACTORS, id, '*')));
    const map = new Map(actorRows.filter(Boolean).map((r) => [r!.id, normalizeSparkActor(r as unknown as Raw)]));
    const scored = scoreNeedSolution(need, solution, map);
    if (scored) {
      score = scored.score;
      reasons = scored.reasons;
    }
  }
  let created: Raw;
  try {
    created = await writeWithFallback(pb, (c) =>
      c.collection(SPARK_MATCHES).create<Raw>({
        tenant: actor.tenant,
        need: need?.id ?? '',
        solution: solution?.id ?? '',
        testbed: testbed?.id ?? '',
        status: 'suggested',
        need_consent: 'pending',
        solution_consent: 'pending',
        owner: actor.id,
        score,
        reasons,
        support_kind: 'none',
        status_changed_at: nowIso(),
        created_by: actor.id
      })
    );
  } catch (err) {
    return dbFail(err, 'skapa matchningen');
  }
  const matchId = String(created.id);
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: SPARK_MATCHES,
    record_id: matchId,
    after_value: { need: need?.title, solution: solution?.name, testbed: testbed ? testbed.kind : undefined, status: 'suggested', score }
  });
  return ok({ matchId });
}

export interface SparkMatchPatch {
  status?: unknown;
  need_consent?: unknown;
  solution_consent?: unknown;
  next_step?: unknown;
  next_step_due?: unknown;
  notes?: unknown;
  outcome?: unknown;
  support_kind?: unknown;
  support_confirmed?: unknown;
  support_note?: unknown;
  work_package?: unknown;
}

/**
 * Uppdaterar en matchning. Två spärrar: parterna presenteras först när båda
 * sidor tackat ja, och en pilot med företagsindividuell stödinsats (AP 3/5)
 * kan inte starta förrän stödet är bekräftat registrerat.
 */
export async function updateSparkMatch(pb: PocketBase, actor: Actor, matchId: string, patch: SparkMatchPatch): Promise<WriteResult<{ matchId: string; status: SparkMatchStatus }>> {
  const no = requireManage<{ matchId: string; status: SparkMatchStatus }>(actor);
  if (no) return no;
  if (!isSparkId(matchId)) return fail('NOT_FOUND', 'Matchningen hittades inte.');
  const raw = await getRecordInTenant<{ id: string; tenant: string }>(pb, actor, SPARK_MATCHES, matchId, '*');
  if (!raw) return fail('NOT_FOUND', 'Matchningen hittades inte.');
  const current = normalizeSparkMatch(raw as unknown as Raw);
  const next: Raw = {};
  const merged = { ...current };

  if (patch.need_consent !== undefined) {
    if (!isSparkConsent(patch.need_consent)) return fail('INVALID_VALUE', 'Ogiltigt svar.');
    next.need_consent = merged.need_consent = patch.need_consent;
  }
  if (patch.solution_consent !== undefined) {
    if (!isSparkConsent(patch.solution_consent)) return fail('INVALID_VALUE', 'Ogiltigt svar.');
    next.solution_consent = merged.solution_consent = patch.solution_consent;
  }
  if (patch.support_kind !== undefined) {
    if (patch.support_kind !== 'none' && patch.support_kind !== 'de_minimis') return fail('INVALID_VALUE', 'Ogiltig insatstyp.');
    next.support_kind = merged.support_kind = patch.support_kind;
  }
  if (patch.support_confirmed !== undefined) next.support_confirmed = merged.support_confirmed = patch.support_confirmed === true;
  if (patch.support_note !== undefined) next.support_note = cleanSparkText(patch.support_note, 500);
  if (patch.work_package !== undefined) {
    const wp = typeof patch.work_package === 'string' ? patch.work_package : '';
    if (wp && !(SPARK_WORK_PACKAGES as readonly string[]).includes(wp)) return fail('INVALID_VALUE', 'Ogiltigt arbetspaket.');
    next.work_package = wp;
  }
  if (patch.next_step !== undefined) next.next_step = cleanSparkText(patch.next_step, 300);
  if (patch.next_step_due !== undefined) {
    const d = typeof patch.next_step_due === 'string' ? patch.next_step_due.slice(0, 10) : '';
    if (d && !DATE_RE.test(d)) return fail('INVALID_VALUE', 'Ogiltigt datum.');
    next.next_step_due = d ? `${d} 00:00:00.000Z` : '';
  }
  if (patch.notes !== undefined) next.notes = cleanSparkText(patch.notes, 3000);
  if (patch.outcome !== undefined) next.outcome = cleanSparkText(patch.outcome, 2000);

  let status = current.status;
  if (patch.status !== undefined && patch.status !== current.status) {
    if (!isSparkMatchStatus(patch.status)) return fail('INVALID_VALUE', 'Ogiltig status.');
    status = patch.status;
    if (SPARK_MATCH_ACTIVE_STATUSES.includes(status)) {
      const needSide = current.need || current.testbed;
      if (needSide && merged.need_consent !== 'yes') {
        return fail('STATE_TRANSITION', 'Behovsägaren eller testmiljön måste ha tackat ja innan parterna presenteras för varandra.');
      }
      if (current.solution && merged.solution_consent !== 'yes') {
        return fail('STATE_TRANSITION', 'Innovationsaktören måste ha tackat ja innan parterna presenteras för varandra.');
      }
    }
    if ((status === 'pilot_running' || status === 'completed') && merged.support_kind === 'de_minimis' && !merged.support_confirmed) {
      return fail(
        'STATE_TRANSITION',
        'Piloten innehåller en stödinsats till företaget. Bekräfta först att stödet är registrerat (stöd av mindre betydelse, AP 3 eller AP 5).'
      );
    }
    next.status = status;
    next.status_changed_at = nowIso();
  }
  if (Object.keys(next).length === 0) return ok({ matchId, status });
  try {
    await writeWithFallback(pb, (c) => c.collection(SPARK_MATCHES).update(current.id, next), { fallbackOn404: true });
    // Behovet följer matchningen: i matchning när parterna presenterats.
    if (next.status && current.need && SPARK_MATCH_ACTIVE_STATUSES.includes(status)) {
      const need = await getRecordInTenant<{ id: string; tenant: string; status?: string }>(pb, actor, SPARK_NEEDS, current.need, 'id,tenant,status');
      if (need && need.status === 'open') {
        await writeWithFallback(pb, (c) => c.collection(SPARK_NEEDS).update(need.id, { status: 'matched' }), { fallbackOn404: true }).catch(() => undefined);
      }
    }
  } catch (err) {
    return dbFail(err, 'spara matchningen');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: SPARK_MATCHES,
    record_id: current.id,
    field: next.status ? 'status' : 'details',
    after_value: {
      status,
      status_label: SPARK_MATCH_STATUS_LABELS[status],
      fields: Object.keys(next),
      support_kind: merged.support_kind,
      support_confirmed: merged.support_confirmed
    }
  });
  return ok({ matchId, status });
}

export async function deleteSparkMatch(pb: PocketBase, actor: Actor, matchId: string): Promise<WriteResult<{ deleted: true }>> {
  if (actor.kind === 'agent' || !isLead(actor)) return denied(actor, 'Bara ledningen kan ta bort en matchning. Sätt den som "Inte aktuell" i stället.');
  if (!isSparkId(matchId)) return fail('NOT_FOUND', 'Matchningen hittades inte.');
  const raw = await getRecordInTenant<{ id: string; tenant: string }>(pb, actor, SPARK_MATCHES, matchId, 'id,tenant');
  if (!raw) return fail('NOT_FOUND', 'Matchningen hittades inte.');
  try {
    await writeWithFallback(pb, (c) => c.collection(SPARK_MATCHES).delete(raw.id), { fallbackOn404: true });
  } catch (err) {
    return dbFail(err, 'ta bort matchningen');
  }
  await logAgentAction(pb, { actor, action_type: 'update', collection: SPARK_MATCHES, record_id: raw.id, after_value: { deleted: true } });
  return ok({ deleted: true });
}
