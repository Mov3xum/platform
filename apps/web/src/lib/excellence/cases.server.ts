import 'server-only';
import type PocketBase from 'pocketbase';
import {
  type Role,
  normalizeScreeningFacts,
  summarizeScreeningRun,
  type ScreeningManualFacts,
  type ScreeningVerdict,
  type StateAidOutcome,
  type VinnovaOutcome
} from '@platform/shared';
import { writeWithFallback } from '@/lib/core/write/helpers';
import { logAgentAction } from '@/lib/core/write/audit';
import type { Actor } from '@/lib/core/write/types';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { pbStatus } from '@/lib/pb-error';
import { isRuleDenialStatus } from '@/lib/read-scaling';
import { hasRole } from '@/lib/rbac';
import { parseAssessmentContext, type AssessmentContext } from './context';
import { storableContext } from './history.server';
import type { ExcellenceAssessment } from './types';
import {
  isScreeningCaseId,
  normalizeScreeningCaseStatus,
  resolveCaseTarget,
  type CaseCandidate,
  type ScreeningCaseStatus
} from './cases';

// Ärenden i Bedömning excellens (CLAUDE.md § 51.10). Varje körning,
// omräkning och "hämta mer" sparar det senaste underlaget (utan verklig
// huvudmans namn) och de manuella svaren på ärendet → ett påbörjat ärende
// fortsätts utan nya debiterade registeranrop. Reads med användarens token
// (RLS: staff/observer), med superuser-reserv vid PB v0.23.4:s tysta
// regel-nekande och behörigheten prövad i koden (§ 21.3, samma mönster som
// requests.server.ts). Skrivning via användartoken med `writeWithFallback`
// efter verifierad roll + tenant.

export const SCREENING_CASES = 'screening_cases';

const READ_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];
const MISSING_HINT = 'kollektionen screening_cases saknas (kör migration 1700000200)';

export interface ScreeningCaseRow {
  id: string;
  tenant: string;
  startup?: string;
  org_nr: string;
  subject_name?: string;
  status: ScreeningCaseStatus;
  mode?: 'register' | 'saved';
  provider?: string;
  state_aid_outcome?: StateAidOutcome;
  vinnova_outcome?: VinnovaOutcome;
  excellence_verdict?: ScreeningVerdict;
  unknown_count?: number;
  last_assessed_at?: string;
  last_assessed_by?: string;
  last_assessed_by_name?: string;
  created: string;
  created_by_name?: string;
  completed_at?: string;
  completed_by?: string;
  completed_by_name?: string;
  file_id?: string;
  file_name?: string;
}

interface RawRow {
  id: string;
  tenant?: string;
  startup?: string;
  org_nr?: string;
  subject_name?: string;
  status?: string;
  mode?: string;
  provider?: string;
  state_aid_outcome?: string;
  vinnova_outcome?: string;
  excellence_verdict?: string;
  unknown_count?: number;
  last_assessed_at?: string;
  last_assessed_by?: string;
  created?: string;
  completed_at?: string;
  completed_by?: string;
  file_id?: string;
  file_name?: string;
  context?: unknown;
  facts?: unknown;
  expand?: {
    last_assessed_by?: { display_name?: string };
    created_by?: { display_name?: string };
    completed_by?: { display_name?: string };
  };
}

const STATE_AID: readonly StateAidOutcome[] = ['art22_possible', 'de_minimis', 'not_eligible', 'undetermined'];
const VINNOVA: readonly VinnovaOutcome[] = ['in_target_possible', 'not_in_target', 'undetermined'];
const VERDICTS: readonly ScreeningVerdict[] = ['yes', 'no', 'unknown'];

const LIST_FIELDS = [
  'id,tenant,startup,org_nr,subject_name,status,mode,provider,state_aid_outcome,vinnova_outcome,excellence_verdict',
  'unknown_count,last_assessed_at,last_assessed_by,created,completed_at,completed_by,file_id,file_name',
  'expand.last_assessed_by.display_name,expand.created_by.display_name,expand.completed_by.display_name'
].join(',');
const EXPAND = 'last_assessed_by,created_by,completed_by';

function nameOf(u: { display_name?: string } | undefined): string | undefined {
  const n = (u?.display_name || '').trim();
  // Aldrig e-post som visningsnamn.
  return n && !n.includes('@') ? n : undefined;
}

function mapRow(r: RawRow): ScreeningCaseRow | null {
  if (!r.tenant || !r.org_nr) return null;
  return {
    id: r.id,
    tenant: r.tenant,
    startup: r.startup || undefined,
    org_nr: r.org_nr,
    subject_name: r.subject_name || undefined,
    status: normalizeScreeningCaseStatus(r.status),
    mode: r.mode === 'saved' ? 'saved' : r.mode === 'register' ? 'register' : undefined,
    provider: r.provider || undefined,
    state_aid_outcome: STATE_AID.find((s) => s === r.state_aid_outcome),
    vinnova_outcome: VINNOVA.find((s) => s === r.vinnova_outcome),
    excellence_verdict: VERDICTS.find((s) => s === r.excellence_verdict),
    unknown_count: typeof r.unknown_count === 'number' ? r.unknown_count : undefined,
    last_assessed_at: r.last_assessed_at || undefined,
    last_assessed_by: r.last_assessed_by || undefined,
    last_assessed_by_name: nameOf(r.expand?.last_assessed_by),
    created: r.created || '',
    created_by_name: nameOf(r.expand?.created_by),
    completed_at: r.completed_at || undefined,
    completed_by: r.completed_by || undefined,
    completed_by_name: nameOf(r.expand?.completed_by),
    file_id: r.file_id || undefined,
    file_name: r.file_name || undefined
  };
}

export interface CaseViewer {
  tenant: string;
  roles: Role[];
}

/** Superuser-reserven får bara lämna rader läsaren hade fått se via RLS. */
function mayRead(viewer: CaseViewer): boolean {
  return hasRole(viewer.roles, READ_ROLES);
}

/**
 * Kör en läsning med användarens token och faller tillbaka på superusern vid
 * regel-nekande (400/403/404) eller ett tomt svar (en tyst nekad list-regel
 * ger 200 med noll rader, § 21.8). Kastar bara när båda vägarna fallerar.
 */
async function readWithReserve<T>(pb: PocketBase, run: (c: PocketBase) => Promise<T>, isEmpty: (r: T) => boolean): Promise<T> {
  let first: T | undefined;
  try {
    first = await run(pb);
    if (!isEmpty(first)) return first;
  } catch (err) {
    if (!isRuleDenialStatus(pbStatus(err))) throw err;
  }
  const su = await getSuperuserPb();
  if (!su.ok) {
    if (first !== undefined) return first;
    throw new Error('superuser saknas');
  }
  return run(su.pb);
}

/** Ärenden med en viss status, senast sparade först. Fail-soft med synligt fel. */
export async function listScreeningCases(
  pb: PocketBase,
  viewer: CaseViewer,
  status: ScreeningCaseStatus,
  limit = 200
): Promise<{ cases: ScreeningCaseRow[]; total: number; error?: string }> {
  if (!mayRead(viewer)) return { cases: [], total: 0 };
  try {
    const res = await readWithReserve(
      pb,
      (c) =>
        c.collection(SCREENING_CASES).getList<RawRow>(1, Math.min(Math.max(limit, 1), 500), {
          filter: c.filter('tenant = {:t} && status = {:s}', { t: viewer.tenant, s: status }),
          sort: status === 'done' ? '-completed_at,-updated' : '-updated',
          expand: EXPAND,
          fields: LIST_FIELDS
        }),
      (r) => r.items.length === 0
    );
    const cases = res.items.map(mapRow).filter((c): c is ScreeningCaseRow => !!c && c.tenant === viewer.tenant);
    return { cases, total: res.totalItems };
  } catch (err) {
    return {
      cases: [],
      total: 0,
      error: pbStatus(err) === 404 ? `Ärendena kan inte visas — ${MISSING_HINT}.` : 'Ärendena kunde inte läsas just nu.'
    };
  }
}

async function readCase(pb: PocketBase, viewer: CaseViewer, id: string, fields?: string): Promise<RawRow | null> {
  if (!isScreeningCaseId(id) || !mayRead(viewer)) return null;
  try {
    const row = await readWithReserve<RawRow | null>(
      pb,
      (c) => c.collection(SCREENING_CASES).getOne<RawRow>(id, { expand: EXPAND, ...(fields ? { fields } : {}) }),
      (r) => !r
    );
    return row && row.tenant === viewer.tenant ? row : null;
  } catch {
    return null;
  }
}

export interface LoadedScreeningCase {
  row: ScreeningCaseRow;
  /** Underlaget (null när ärendet saknar ett tolkbart underlag — kör bedömningen igen). */
  context: AssessmentContext | null;
  /** Manuella svar sparade på ärendet (för bolag utanför plattformen bor svaren bara här). */
  facts: ScreeningManualFacts;
}

/** Ett ärende med underlag och svar, tenant-verifierat. */
export async function loadScreeningCase(pb: PocketBase, viewer: CaseViewer, id: string): Promise<LoadedScreeningCase | null> {
  const raw = await readCase(pb, viewer, id);
  if (!raw) return null;
  const row = mapRow(raw);
  if (!row) return null;
  const json = typeof raw.context === 'string' ? raw.context : raw.context ? JSON.stringify(raw.context) : '';
  return { row, context: json ? parseAssessmentContext(json) : null, facts: normalizeScreeningFacts(raw.facts ?? null) };
}

/** Pågående ärende för ett bolag (org-nr eller portföljbolag), senast sparat först. */
export async function findOpenScreeningCase(
  pb: PocketBase,
  viewer: CaseViewer,
  by: { orgNr?: string; startupId?: string }
): Promise<ScreeningCaseRow | null> {
  if (!mayRead(viewer) || (!by.orgNr && !by.startupId)) return null;
  try {
    const res = await readWithReserve(
      pb,
      (c) =>
        c.collection(SCREENING_CASES).getList<RawRow>(1, 1, {
          filter: by.orgNr
            ? c.filter('tenant = {:t} && status = "open" && org_nr = {:o}', { t: viewer.tenant, o: by.orgNr })
            : c.filter('tenant = {:t} && status = "open" && startup = {:s}', { t: viewer.tenant, s: by.startupId ?? '' }),
          sort: '-updated',
          expand: EXPAND,
          fields: LIST_FIELDS
        }),
      (r) => r.items.length === 0
    );
    const row = res.items[0] ? mapRow(res.items[0]) : null;
    return row && row.tenant === viewer.tenant ? row : null;
  } catch {
    return null;
  }
}

/** Pågående ärenden per org-nr (för "det finns redan ett ärende"-tipset i skapa-formuläret). */
export async function openCasesByOrgNr(pb: PocketBase, viewer: CaseViewer): Promise<Record<string, { id: string; name?: string }>> {
  const { cases } = await listScreeningCases(pb, viewer, 'open', 500);
  const out: Record<string, { id: string; name?: string }> = {};
  for (const c of cases) if (!out[c.org_nr]) out[c.org_nr] = { id: c.id, name: c.subject_name };
  return out;
}

export type SaveCaseResult =
  | { ok: true; id: string; created: boolean; status: ScreeningCaseStatus }
  | { ok: false; error: string }
  | { ok: 'skip' };

/**
 * Sparar en bedömning i ett ärende (§ 51.10): underlaget (utan transienta
 * personnamn), de manuella svaren och utfallen. Målet väljs
 * av `resolveCaseTarget` (uttryckligt ärende → pågående ärende för samma
 * org-nr → nytt). Fail-soft: anroparen visar felet, bedömningen visas ändå.
 */
export async function saveAssessmentToCase(
  pb: PocketBase,
  actor: Actor,
  assessment: ExcellenceAssessment,
  opts: { caseId?: string; create: boolean }
): Promise<SaveCaseResult> {
  const orgNr = assessment.subject.orgNr;
  if (!orgNr) return { ok: 'skip' };
  const viewer = { tenant: actor.tenant, roles: actor.roles };
  const toCandidate = (r: { id: string; org_nr?: string; status?: string } | null): CaseCandidate | null =>
    r && r.org_nr ? { id: r.id, org_nr: r.org_nr, status: normalizeScreeningCaseStatus(r.status) } : null;
  const requested = opts.caseId ? toCandidate(await readCase(pb, viewer, opts.caseId, 'id,tenant,org_nr,status')) : null;
  const openForOrg = requested ? null : await findOpenScreeningCase(pb, viewer, { orgNr });
  const target = resolveCaseTarget({ orgNr, requested, openForOrg: toCandidate(openForOrg), create: opts.create });
  if (target.kind === 'skip') return { ok: 'skip' };

  const context = storableContext(assessment.context);
  const parsed = context ? parseAssessmentContext(context) : null;
  const summary = summarizeScreeningRun(assessment.result);
  const payload: Record<string, unknown> = {
    org_nr: orgNr,
    subject_name: (assessment.subject.name || '').slice(0, 200),
    startup: assessment.subject.startupId ?? '',
    mode: assessment.mode,
    provider: (parsed?.providerSlug || '').slice(0, 60),
    facts: assessment.facts,
    state_aid_outcome: assessment.result.stateAid.outcome,
    vinnova_outcome: assessment.result.vinnova.outcome,
    excellence_verdict: assessment.result.excellence.verdict,
    unknown_count: summary.counts.unknown,
    last_assessed_at: assessment.assessedAt,
    last_assessed_by: actor.id
  };
  // Ett underlag som inte går att lagra ersätter aldrig det förra med tomt.
  if (context) payload.context = context;
  // `file_id`/`file_name` = slutbedömningens PDF och sätts BARA vid
  // klarmarkering (`setScreeningCaseStatus`) — aldrig av arbetet i ärendet.

  try {
    if (target.kind === 'update') {
      const rec = await writeWithFallback(pb, (c) =>
        c.collection(SCREENING_CASES).update<{ id: string; tenant?: string; status?: string }>(target.id, payload)
      );
      if (rec.tenant && rec.tenant !== actor.tenant) return { ok: false, error: 'Ärendet fick fel tenant — kontakta Movexum.' };
      return { ok: true, id: rec.id, created: false, status: normalizeScreeningCaseStatus(rec.status) };
    }
    const rec = await writeWithFallback(pb, (c) =>
      c.collection(SCREENING_CASES).create<{ id: string; tenant?: string }>({
        ...payload,
        tenant: actor.tenant,
        status: 'open',
        created_by: actor.id
      })
    );
    if (rec.tenant && rec.tenant !== actor.tenant) return { ok: false, error: 'Ärendet fick fel tenant — kontakta Movexum.' };
    // Audit (PII-fritt): bolagsnamn + portföljkoppling, aldrig org-nr eller svar.
    await logAgentAction(pb, {
      actor,
      action_type: 'create',
      collection: SCREENING_CASES,
      record_id: rec.id,
      after_value: { subject_name: assessment.subject.name, startup: assessment.subject.startupId, status: 'open' }
    });
    return { ok: true, id: rec.id, created: true, status: 'open' };
  } catch (err) {
    const status = pbStatus(err);
    console.error('[excellence] case save failed', { status, userId: actor.id });
    return {
      ok: false,
      error: status === 404 ? `Ärendet kunde inte sparas — ${MISSING_HINT}.` : 'Ärendet kunde inte sparas just nu — bedömningen visas ändå.'
    };
  }
}

/** Klarmarkerar eller öppnar igen ett ärende (Movexum-personal, tenant-verifierat). */
export async function setScreeningCaseStatus(
  pb: PocketBase,
  actor: Actor,
  id: string,
  status: ScreeningCaseStatus,
  /** Slutbedömningens PDF (sätts vid klarmarkering). */
  file?: { file_id: string; file_name: string }
): Promise<{ ok: true; name?: string } | { ok: false; error: string }> {
  const viewer = { tenant: actor.tenant, roles: actor.roles };
  const raw = await readCase(pb, viewer, id, 'id,tenant,org_nr,status,subject_name,startup');
  if (!raw) return { ok: false, error: 'Ärendet hittades inte.' };
  const before = normalizeScreeningCaseStatus(raw.status);
  if (before === status && !file) return { ok: true, name: raw.subject_name };
  const patch =
    status === 'done'
      ? { status, completed_at: new Date().toISOString(), completed_by: actor.id, ...(file ?? {}) }
      : { status, completed_at: '', completed_by: '' };
  try {
    await writeWithFallback(pb, (c) => c.collection(SCREENING_CASES).update(id, patch));
  } catch (err) {
    console.error('[excellence] case status failed', { status: pbStatus(err), userId: actor.id });
    return { ok: false, error: 'Ärendet kunde inte uppdateras just nu.' };
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: SCREENING_CASES,
    record_id: id,
    field: 'status',
    before_value: { status: before },
    after_value: { status, subject_name: raw.subject_name, startup: raw.startup || undefined }
  });
  return { ok: true, name: raw.subject_name };
}
