import 'server-only';
import type { RegisterSource, RegisterVia } from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { registerRecord, type RegisterInput } from '@/lib/core/write/register';

/**
 * Diariets källor (CLAUDE.md § 60): hur en post i plattformen blir en
 * registrering. Samma byggare används av inkopplingarna i flödena OCH av
 * efterregistreringen, så händelsenycklarna (`source.event`) alltid stämmer
 * och en handling aldrig registreras två gånger.
 *
 * Dataminimering: titel och motpart bär bolags-/organisationsnamn och
 * handlingens rubrik — aldrig e-post, telefon eller en enskild persons namn
 * (en lead från en privatperson får motparten "Enskild person"; namnet finns
 * i leadet, dit ärendet länkar). `snapshot` bär bara id:n, status och belopp.
 */

const day = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 10) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export const PREVIEW_SOURCE = 'preview';

export function leadRegistration(
  lead: { id: string; tenant: string; organization?: unknown; landing_module?: unknown; created?: unknown; source_key?: unknown },
  via: RegisterVia
): RegisterInput {
  const moduleName = str(lead.landing_module) || 'publik modul';
  const org = str(lead.organization).trim();
  return {
    tenant: lead.tenant,
    typeKey: 'lead_incoming',
    source: { collection: 'compass_leads', id: lead.id, event: 'completed' },
    title: `Idébeskrivning via ${moduleName}`,
    caseTitle: `Inflöde: ${org || 'enskild person'} via ${moduleName}`,
    counterpart: org || 'Enskild person',
    documentDate: str(lead.created) || null,
    snapshot: { module: moduleName, source_key: str(lead.source_key) },
    via
  };
}

export function supportCheckSubmission(
  app: { id: string; tenant: string; startup?: unknown; title?: unknown; submitted_at?: unknown; requested_amount_sek?: unknown },
  ctx: { startupName: string; typeTitle: string; revision: number; documentHash?: string | null; actorId?: string | null },
  via: RegisterVia
): RegisterInput {
  const revision = Math.max(1, ctx.revision || 1);
  const type = ctx.typeTitle || 'stödcheck';
  return {
    tenant: app.tenant,
    actorId: ctx.actorId,
    // Efterregistrering känner bara den senaste revisionen → registreras som ansökan.
    typeKey: revision > 1 && via === 'auto' ? 'support_check_completion' : 'support_check_application',
    source: { collection: 'support_check_applications', id: app.id, event: `submitted:r${revision}` },
    title: `${revision > 1 && via === 'auto' ? 'Komplettering av ansökan' : 'Ansökan'} om ${type}: ${str(app.title) || 'utan rubrik'}`,
    caseTitle: `${type} — ${ctx.startupName}`,
    counterpart: ctx.startupName,
    startupId: str(app.startup) || null,
    documentDate: str(app.submitted_at) || null,
    documentHash: ctx.documentHash || null,
    snapshot: { revision, requested_amount_sek: num(app.requested_amount_sek) },
    via
  };
}

export function supportCheckDecision(
  app: { id: string; tenant: string; startup?: unknown; title?: unknown },
  ctx: { startupName: string; typeTitle: string; outcome: 'approved' | 'rejected'; decidedAt: string; approvedAmountSek?: number | null; stateAidBasis?: string | null; actorId?: string | null },
  via: RegisterVia
): RegisterInput {
  const type = ctx.typeTitle || 'stödcheck';
  return {
    tenant: app.tenant,
    actorId: ctx.actorId,
    typeKey: 'support_check_decision',
    source: { collection: 'support_check_applications', id: app.id, event: `decision:${day(ctx.decidedAt)}` },
    title: `Beslut om ${type}: ${ctx.outcome === 'approved' ? 'beviljad' : 'avslag'} — ${str(app.title) || 'utan rubrik'}`,
    caseTitle: `${type} — ${ctx.startupName}`,
    counterpart: ctx.startupName,
    startupId: str(app.startup) || null,
    documentDate: ctx.decidedAt || null,
    snapshot: { outcome: ctx.outcome, approved_amount_sek: ctx.approvedAmountSek ?? null, state_aid_basis: ctx.stateAidBasis ?? null },
    via
  };
}

export function agreementRegistration(
  agreement: { id: string; startup?: unknown; title?: unknown; signed_at?: unknown; document_hash?: unknown; kind?: unknown },
  ctx: { tenant: string; startupName: string; actorId?: string | null },
  via: RegisterVia
): RegisterInput {
  return {
    tenant: ctx.tenant,
    actorId: ctx.actorId,
    typeKey: 'agreement_signed',
    source: { collection: 'agreements', id: agreement.id, event: 'signed' },
    title: `Signerat avtal: ${str(agreement.title) || 'utan rubrik'}`,
    caseTitle: `Avtal — ${ctx.startupName}: ${str(agreement.title) || 'utan rubrik'}`,
    counterpart: ctx.startupName,
    startupId: str(agreement.startup) || null,
    documentDate: str(agreement.signed_at) || null,
    documentHash: str(agreement.document_hash) || null,
    snapshot: { kind: str(agreement.kind) },
    via,
    closeCase: true
  };
}

export function procurementRegistration(
  row: { id: string; tenant: string; title?: unknown; supplier?: unknown; procedure?: unknown; diarienummer?: unknown; created?: unknown },
  ctx: { actorId?: string | null },
  via: RegisterVia
): RegisterInput {
  return {
    tenant: row.tenant,
    actorId: ctx.actorId,
    typeKey: 'procurement_opened',
    source: { collection: 'procurements', id: row.id, event: 'opened' },
    title: `Upphandling: ${str(row.title) || 'utan rubrik'}`,
    counterpart: str(row.supplier),
    documentDate: str(row.created) || null,
    snapshot: { procedure: str(row.procedure), external_diarienummer: str(row.diarienummer) },
    via
  };
}

export function screeningRegistration(
  row: { id: string; tenant: string; startup?: unknown; subject_name?: unknown; completed_at?: unknown; file_id?: unknown; state_aid_outcome?: unknown; vinnova_outcome?: unknown },
  ctx: { actorId?: string | null },
  via: RegisterVia
): RegisterInput {
  const name = str(row.subject_name) || 'bolag';
  return {
    tenant: row.tenant,
    actorId: ctx.actorId,
    typeKey: 'screening_final',
    source: { collection: 'screening_cases', id: row.id, event: `final:${str(row.file_id) || day(row.completed_at)}` },
    title: `Slutbedömning statsstöd och Vinnova: ${name}`,
    caseTitle: `Bedömning excellens — ${name}`,
    counterpart: name,
    startupId: str(row.startup) || null,
    documentDate: str(row.completed_at) || null,
    snapshot: { state_aid_outcome: str(row.state_aid_outcome), vinnova_outcome: str(row.vinnova_outcome) },
    via,
    closeCase: true
  };
}

// ─── Täckning och efterregistrering ───────────────────────────────────────

/** PB-filter (med `{:t}`) för de poster i varje källa som ska ha ett ärende. */
export const SOURCE_FILTERS: Record<RegisterSource, string> = {
  support_check_applications: 'tenant = {:t} && submitted_at != ""',
  agreements: 'startup.tenant = {:t} && status = "signed"',
  procurements: 'tenant = {:t}',
  compass_leads: `tenant = {:t} && completion = "completed" && source_key != "${PREVIEW_SOURCE}"`,
  screening_cases: 'tenant = {:t} && status = "done"'
};

const BACKFILL_PER_SOURCE = 300;

export interface BackfillResult {
  ok: boolean;
  registered: number;
  /** Källposter som fortfarande saknar ärende efter körningen (taket nåddes eller fel). */
  remaining: number;
  errors: number;
  error?: string;
}

/**
 * Efterregistrerar källposter som saknar ärende. Handlingens datum blir
 * originalets, registreringsdatumet blir i dag och posten märks
 * "Efterregistrerad" — diariet låtsas aldrig att registreringen skedde då.
 */
export async function backfillRegister(tenant: string, actorId: string): Promise<BackfillResult> {
  const su = await getSuperuserPb();
  if (!su.ok) return { ok: false, registered: 0, remaining: 0, errors: 0, error: 'Superuser-uppgifter saknas på web-appen.' };
  const pb = su.pb;
  let registered = 0;
  let remaining = 0;
  let errors = 0;

  const known = new Set<string>();
  try {
    const cases = await pb.collection('register_cases').getFullList<{ source_collection: string; source_id: string }>({
      filter: pb.filter('tenant = {:t} && source_id != ""', { t: tenant }),
      fields: 'source_collection,source_id',
      batch: 500
    });
    for (const c of cases) known.add(`${c.source_collection}:${c.source_id}`);
  } catch {
    return { ok: false, registered: 0, remaining: 0, errors: 0, error: 'Diariet kunde inte läsas — kör migration 1700000219.' };
  }

  const run = async (source: RegisterSource, expand: string, build: (row: Record<string, unknown> & { id: string }) => RegisterInput[]) => {
    let rows: (Record<string, unknown> & { id: string })[];
    try {
      rows = await pb.collection(source).getFullList({ filter: pb.filter(SOURCE_FILTERS[source], { t: tenant }), expand, sort: 'created', batch: 500 });
    } catch {
      errors += 1;
      return;
    }
    const todo = rows.filter((r) => !known.has(`${source}:${r.id}`));
    remaining += Math.max(0, todo.length - BACKFILL_PER_SOURCE);
    for (const row of todo.slice(0, BACKFILL_PER_SOURCE)) {
      for (const input of build(row)) {
        const res = await registerRecord(input);
        if (res.status === 'registered') registered += 1;
        else if (res.status === 'error') errors += 1;
      }
    }
  };

  const startupName = (row: Record<string, unknown>) => str((row.expand as { startup?: { name?: string } } | undefined)?.startup?.name) || 'Bolaget';

  await run('compass_leads', '', (r) => [leadRegistration({ ...r, tenant }, 'backfill')]);
  await run('agreements', 'startup', (r) => [agreementRegistration(r, { tenant, startupName: startupName(r), actorId }, 'backfill')]);
  await run('procurements', '', (r) => [procurementRegistration({ ...r, tenant }, { actorId }, 'backfill')]);
  await run('screening_cases', '', (r) => [screeningRegistration({ ...r, tenant }, { actorId }, 'backfill')]);
  await run('support_check_applications', 'startup,check_type', (r) => {
    const typeTitle = str((r.expand as { check_type?: { title?: string } } | undefined)?.check_type?.title);
    const ctx = { startupName: startupName(r), typeTitle, actorId };
    const out = [supportCheckSubmission({ ...r, tenant }, { ...ctx, revision: typeof r.revision === 'number' ? r.revision : 1 }, 'backfill')];
    const decided = str(r.decided_at);
    if (decided && ['approved', 'paid', 'closed', 'rejected'].includes(str(r.status))) {
      out.push(
        supportCheckDecision(
          { ...r, tenant },
          { ...ctx, outcome: str(r.status) === 'rejected' ? 'rejected' : 'approved', decidedAt: decided, approvedAmountSek: num(r.approved_amount_sek), stateAidBasis: str(r.state_aid_basis) || null },
          'backfill'
        )
      );
    }
    return out;
  });

  return { ok: errors === 0, registered, remaining, errors };
}
