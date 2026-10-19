import 'server-only';
import type PocketBase from 'pocketbase';
import {
  diffScreeningRuns,
  normalizeScreeningRunSummary,
  summarizeScreeningRun,
  type ScreeningRunDiff,
  type ScreeningRunSummary,
  type ScreeningVerdict,
  type StateAidOutcome,
  type VinnovaOutcome
} from '@platform/shared';
import { writeWithFallback } from '@/lib/core/write/helpers';
import { logAgentAction } from '@/lib/core/write/audit';
import type { Actor } from '@/lib/core/write/types';
import { pbStatus } from '@/lib/pb-error';
import type { ExcellenceAssessment } from './types';
import { parseAssessmentContext, serializeAssessmentContext, type AssessmentContext } from './context';

// Historik för Bedömning excellens på bolagskortet (CLAUDE.md § 51.6).
// Varje körning för ett PORTFÖLJBOLAG sparas som en rad i
// `startup_screenings` (staff/observer-RLS): utfall, en kompakt PII-fri
// sammanfattning (`summarizeScreeningRun` — aldrig detail-texter) och
// PDF:en (protected fil, serveras via /api/screenings/<id>/pdf). Två
// körningar i rad jämförs med `diffScreeningRuns` → "vad ändrades sedan
// senast". Reads med användarens token (RLS); skrivning via användartoken
// med superuser-fallback bara vid PB v0.23.4:s tysta regel-nekande (§ 21.3).

export const SCREENINGS = 'startup_screenings';

export interface ScreeningRunRow {
  id: string;
  tenant: string;
  startup: string;
  org_nr?: string;
  subject_name?: string;
  mode: 'register' | 'saved';
  provider?: string;
  state_aid_outcome: StateAidOutcome;
  vinnova_outcome: VinnovaOutcome;
  excellence_verdict: ScreeningVerdict;
  summary: ScreeningRunSummary | null;
  assessed_by?: string;
  assessed_by_name?: string;
  assessed_at: string;
  file?: string;
  filename?: string;
}

interface RawRow {
  id: string;
  tenant?: string;
  startup?: string;
  org_nr?: string;
  subject_name?: string;
  mode?: string;
  provider?: string;
  state_aid_outcome?: string;
  vinnova_outcome?: string;
  excellence_verdict?: string;
  summary?: unknown;
  assessed_by?: string;
  assessed_at?: string;
  created?: string;
  file?: string;
  filename?: string;
  expand?: { assessed_by?: { display_name?: string; email?: string } };
}

const STATE_AID: readonly StateAidOutcome[] = ['art22_possible', 'de_minimis', 'not_eligible', 'undetermined'];
const VINNOVA: readonly VinnovaOutcome[] = ['in_target_possible', 'not_in_target', 'undetermined'];
const VERDICTS: readonly ScreeningVerdict[] = ['yes', 'no', 'unknown'];

function displayNameOf(u: { display_name?: string; email?: string } | undefined): string | undefined {
  const n = (u?.display_name || '').trim();
  // Aldrig e-post som visningsnamn (PII i staff-UI:t räcker med namnet).
  return n && !n.includes('@') ? n : undefined;
}

function mapRow(r: RawRow): ScreeningRunRow | null {
  const stateAid = STATE_AID.find((s) => s === r.state_aid_outcome);
  const vinnova = VINNOVA.find((v) => v === r.vinnova_outcome);
  const excellence = VERDICTS.find((v) => v === r.excellence_verdict);
  if (!stateAid || !vinnova || !excellence || !r.tenant || !r.startup) return null;
  return {
    id: r.id,
    tenant: r.tenant,
    startup: r.startup,
    org_nr: r.org_nr || undefined,
    subject_name: r.subject_name || undefined,
    mode: r.mode === 'saved' ? 'saved' : 'register',
    provider: r.provider || undefined,
    state_aid_outcome: stateAid,
    vinnova_outcome: vinnova,
    excellence_verdict: excellence,
    summary: normalizeScreeningRunSummary(r.summary),
    assessed_by: r.assessed_by || undefined,
    assessed_by_name: displayNameOf(r.expand?.assessed_by),
    assessed_at: r.assessed_at || r.created || '',
    file: r.file || undefined,
    filename: r.filename || undefined
  };
}

const FIELDS =
  'id,tenant,startup,org_nr,subject_name,mode,provider,state_aid_outcome,vinnova_outcome,excellence_verdict,summary,assessed_by,assessed_at,created,file,filename,expand.assessed_by.display_name';

/** Körningarna för ett bolag, nyast först (RLS: staff/observer). Fail-soft. */
export async function listScreeningRuns(
  pb: PocketBase,
  tenantId: string,
  startupId: string,
  limit = 20
): Promise<{ runs: ScreeningRunRow[]; error?: string }> {
  try {
    const res = await pb.collection(SCREENINGS).getList<RawRow>(1, Math.min(Math.max(limit, 1), 100), {
      filter: pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId }),
      sort: '-assessed_at,-created',
      expand: 'assessed_by',
      fields: FIELDS
    });
    return { runs: res.items.map(mapRow).filter((r): r is ScreeningRunRow => !!r && r.tenant === tenantId) };
  } catch (err) {
    const status = pbStatus(err);
    if (status === 404) return { runs: [], error: 'Kollektionen startup_screenings saknas — kör migration 1700000191.' };
    return { runs: [], error: 'Bedömningshistoriken kunde inte läsas just nu.' };
  }
}

/** En körning (RLS), tenant-verifierad i koden. */
export async function getScreeningRun(pb: PocketBase, tenantId: string, id: string): Promise<ScreeningRunRow | null> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return null;
  try {
    const r = await pb.collection(SCREENINGS).getOne<RawRow>(id, { expand: 'assessed_by', fields: FIELDS });
    const row = mapRow(r);
    return row && row.tenant === tenantId ? row : null;
  } catch {
    return null;
  }
}

/**
 * Serialiserat, verifierat underlag (fält för fält) för lagring; null om det
 * inte kan tolkas. Ägarbilden lagras med namn (§ 51.11) — aldrig personnummer.
 */
export function storableContext(json: string): string | null {
  const ctx = parseAssessmentContext(json);
  if (!ctx) return null;
  const out = serializeAssessmentContext(ctx);
  return out.length <= 1_900_000 ? out : null;
}

/**
 * Senaste körningens underlag för ett bolag (§ 51.8) — det som "Räkna om
 * med svaren" utgår från. Null när ingen körning finns, när fältet saknas i
 * schemat (migration 1700000192) eller när underlaget inte kan tolkas.
 */
export async function loadLatestScreeningContext(
  pb: PocketBase,
  tenantId: string,
  startupId: string
): Promise<{ runId: string; assessedAt: string; mode: 'register' | 'saved'; context: AssessmentContext } | null> {
  try {
    const res = await pb.collection(SCREENINGS).getList<{ id: string; tenant?: string; assessed_at?: string; created?: string; mode?: string; context?: unknown }>(1, 1, {
      filter: pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId }),
      sort: '-assessed_at,-created',
      fields: 'id,tenant,assessed_at,created,mode,context'
    });
    const r = res.items[0];
    if (!r || r.tenant !== tenantId || !r.context) return null;
    const ctx = parseAssessmentContext(typeof r.context === 'string' ? r.context : JSON.stringify(r.context));
    if (!ctx) return null;
    return { runId: r.id, assessedAt: r.assessed_at || r.created || '', mode: r.mode === 'saved' ? 'saved' : 'register', context: ctx };
  } catch {
    return null;
  }
}

export interface StoredScreeningRun {
  id: string;
  /** Föregående körning (om någon) och vad som ändrades sedan dess. */
  previous?: { id: string; assessedAt: string; assessedBy?: string };
  diff?: ScreeningRunDiff;
}

/**
 * Sparar en körning på bolagskortet (bara portföljbolag). Returnerar diffen
 * mot den senaste tidigare körningen så vyn kan visa "sedan senast" direkt.
 * Fail-soft: kan raden inte skapas visas bedömningen ändå (anroparen får
 * felet som text). `tenant`/`assessed_by` sätts från den inloggade — aldrig
 * från klienten (createRule pinnar dem dessutom, § 21.8).
 */
export async function storeScreeningRun(
  pb: PocketBase,
  actor: Actor,
  assessment: ExcellenceAssessment,
  pdf: { buffer: Buffer; filename: string } | null
): Promise<{ ok: true; value: StoredScreeningRun } | { ok: false; error: string }> {
  const startupId = assessment.subject.startupId;
  if (!startupId) return { ok: false, error: 'Bolaget finns inte i plattformen — körningen sparas bara som PDF i Filer.' };

  // Föregående körning läses INNAN den nya skrivs (annars är den nya "senast").
  const before = await listScreeningRuns(pb, actor.tenant, startupId, 1);
  const prev = before.runs[0];

  const context = storableContext(assessment.context);
  const summary = summarizeScreeningRun(assessment.result, {
    cost: assessment.cost ? { credits: assessment.cost.credits, sek: assessment.cost.sek, complete: assessment.cost.complete } : undefined
  });
  const buildForm = (): FormData => {
    const fd = new FormData();
    fd.append('tenant', actor.tenant);
    fd.append('startup', startupId);
    if (assessment.subject.orgNr) fd.append('org_nr', assessment.subject.orgNr);
    if (assessment.subject.name) fd.append('subject_name', assessment.subject.name.slice(0, 200));
    fd.append('mode', assessment.mode);
    if (assessment.providerName) fd.append('provider', assessment.providerName.slice(0, 60));
    fd.append('state_aid_outcome', assessment.result.stateAid.outcome);
    fd.append('vinnova_outcome', assessment.result.vinnova.outcome);
    fd.append('excellence_verdict', assessment.result.excellence.verdict);
    fd.append('summary', JSON.stringify(summary));
    fd.append('assessed_by', actor.id);
    fd.append('assessed_at', assessment.assessedAt);
    // Underlaget (utan transienta personnamn) — för omräkning utan nya anrop (§ 51.8).
    if (context) fd.append('context', context);
    if (pdf) {
      fd.append('file', new Blob([new Uint8Array(pdf.buffer)], { type: 'application/pdf' }), pdf.filename);
      fd.append('filename', pdf.filename.slice(0, 200));
    }
    return fd;
  };

  let rec: { id: string; tenant?: string; startup?: string };
  try {
    rec = await writeWithFallback(pb, (client) => client.collection(SCREENINGS).create<{ id: string; tenant?: string; startup?: string }>(buildForm()));
  } catch (err) {
    const status = pbStatus(err);
    // PII-fri logg: status, aldrig bolagsnamn/filnamn.
    console.error('[excellence] screening run store failed', { status, userId: actor.id });
    return {
      ok: false,
      error:
        status === 404
          ? 'Historiken kunde inte sparas på bolagskortet (kollektionen startup_screenings saknas — kör migration 1700000191).'
          : 'Historiken kunde inte sparas på bolagskortet. PDF:en finns ändå i Filer.'
    };
  }
  if (rec.tenant && rec.tenant !== actor.tenant) {
    return { ok: false, error: 'Historikraden fick fel tenant — kontakta Movexum.' };
  }

  // Audit (PII-fritt): utfall + antal punkter, aldrig etiketter/namn.
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: SCREENINGS,
    record_id: rec.id,
    after_value: {
      startup: startupId,
      startup_name: assessment.subject.name,
      mode: assessment.mode,
      state_aid: assessment.result.stateAid.outcome,
      vinnova: assessment.result.vinnova.outcome,
      excellence: assessment.result.excellence.verdict,
      unknown: summary.counts.unknown
    }
  });

  const value: StoredScreeningRun = { id: rec.id };
  if (prev) {
    value.previous = { id: prev.id, assessedAt: prev.assessed_at, assessedBy: prev.assessed_by_name };
    if (prev.summary) value.diff = diffScreeningRuns(prev.summary, summary);
  }
  return { ok: true, value };
}
