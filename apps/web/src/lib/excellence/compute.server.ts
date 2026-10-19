import 'server-only';
import type PocketBase from 'pocketbase';
import { deriveScreeningRequestItems, screenExcellence, type Role, type ScreeningManualFacts } from '@platform/shared';
import { platformPart, loadPlatformStartupFacts, type PlatformStartupFacts } from './data.server';
import { serializeAssessmentContext, type AssessmentContext } from './context';
import { listScreeningRequestsForStartup } from './requests.server';
import { findOpenScreeningCase, loadScreeningCase, saveAssessmentToCase, type ScreeningCaseRow } from './cases.server';
import type { AssessmentRequestSummary, ExcellenceAssessment } from './types';

// Räknar Bedömning excellens på ett underlag + manuella svar (CLAUDE.md § 51)
// utan sidoeffekter: ingen PDF, ingen historik, inget ärende. Delas av
// server-actionerna (som sedan arkiverar och sparar ärendet) och ärendevyn,
// som öppnar ett sparat ärende utan nya registeranrop (§ 51.10).

export interface AssessmentViewer {
  id: string;
  tenant: string;
  roles: Role[];
  linkedStartups: string[];
  name?: string;
}

/** Visningsnamn för PDF:en — aldrig e-post (SessionUser.name faller tillbaka på e-post). */
export function displayName(user: { name?: string }): string | undefined {
  const n = (user.name || '').trim();
  return n && !n.includes('@') ? n : undefined;
}

/** Begäran om komplettering för bolaget, PII-fritt sammanfattade för PDF:n (fail-soft). */
async function loadRequestSummaries(pb: PocketBase, user: AssessmentViewer, startupId: string): Promise<AssessmentRequestSummary[] | undefined> {
  const { requests } = await listScreeningRequestsForStartup(
    pb,
    { tenant: user.tenant, roles: user.roles, linkedStartups: user.linkedStartups },
    startupId,
    { limit: 20 }
  );
  if (requests.length === 0) return undefined;
  return requests.map((r) => ({
    id: r.id,
    recipient_kind: r.recipient_kind,
    recipient_name: r.recipient_name,
    requested_by_name: r.requested_by_name,
    status: r.status,
    created: r.created,
    due_at: r.due_at,
    items: r.items.map((i) => ({ label: i.label, kind: i.kind, status: i.status, answer_label: i.answer_label, answered_at: i.answered_at }))
  }));
}

/** Plattformens egna fakta läses färskt (de minimis, IRL, grundare kan ha ändrats sedan underlaget togs). */
export function refreshPlatformInContext(ctx: AssessmentContext, platform: PlatformStartupFacts): AssessmentContext {
  return {
    ...ctx,
    subject: { ...ctx.subject, startupId: platform.id, name: ctx.subject.name ?? platform.name },
    input: { ...ctx.input, deMinimis: platform.deMinimis, irl: platform.irl, meetsExcellenceFlag: platform.meetsExcellence },
    platformFounders: platform.founders
  };
}

/** Bedömningen för ett underlag + svar. Referensdag = nu. */
export async function computeAssessment(
  pb: PocketBase,
  user: AssessmentViewer,
  ctx: AssessmentContext,
  facts: ScreeningManualFacts,
  extra: { factsSaved?: boolean; factsSchemaMissing?: boolean; recomputed?: boolean; assessedAt?: string; assessedBy?: string } = {}
): Promise<ExcellenceAssessment> {
  const now = new Date();
  const platformLike =
    ctx.platformFounders === null
      ? null
      : {
          founders: ctx.platformFounders,
          deMinimis: ctx.input.deMinimis ?? null,
          irl: ctx.input.irl ?? null,
          meetsExcellence: ctx.input.meetsExcellenceFlag === true
        };
  const part = platformPart(platformLike, facts);
  const result = screenExcellence({
    refDate: now,
    subject: ctx.input.subject,
    related: ctx.input.related,
    ...part,
    // Bolag utanför plattformen: flaggan är okänd, inte "falsk".
    meetsExcellenceFlag: ctx.platformFounders === null ? undefined : part.meetsExcellenceFlag
  });
  const assessedAt = extra.assessedAt ?? now.toISOString();
  const context: AssessmentContext = { ...ctx, assessedAt };
  const startupId = ctx.subject.startupId;
  return {
    mode: ctx.mode,
    providerName: ctx.providerName,
    subject: context.subject,
    result,
    financialsByOrg: ctx.financialsByOrg,
    founders: part.founders ?? null,
    foundersSource: part.foundersSource ?? 'platform',
    facts,
    factsSaved: extra.factsSaved,
    factsSchemaMissing: extra.factsSchemaMissing,
    context: serializeAssessmentContext(context),
    notes: ctx.notes,
    lookupWarnings: ctx.lookupWarnings,
    cost: ctx.cost,
    assessedAt,
    assessedBy: extra.assessedBy ?? displayName(user),
    requestItems: deriveScreeningRequestItems(result, {
      subjectName: context.subject.name,
      deMinimisFromPlatform: ctx.input.related.filter((r) => r.deMinimis?.source === 'platform').map((r) => r.orgNr)
    }),
    // Bolagets begäran om komplettering med svar — sammanställs i PDF:n (§ 51.8).
    requests: startupId ? await loadRequestSummaries(pb, user, startupId) : undefined,
    recomputed: extra.recomputed || undefined
  };
}

/**
 * Öppnar ett sparat ärende (§ 51.10): räknar om på ärendets underlag med
 * de senaste svaren — för ett portföljbolag bolagskortets svar (dit även
 * kompletteringarna slagits ihop, § 51.6), annars ärendets egna. Inga
 * leverantörsanrop, ingen PDF. `assessment` saknas när ärendet inte har ett
 * tolkbart underlag (då körs bedömningen om).
 */
export async function loadCaseAssessment(
  pb: PocketBase,
  user: AssessmentViewer,
  caseId: string,
  /** `final`: slutbedömningen vid klarmarkering — daterad nu och av den som klarmarkerar. */
  opts: { final?: boolean } = {}
): Promise<{ row: ScreeningCaseRow; assessment?: ExcellenceAssessment } | null> {
  const loaded = await loadScreeningCase(pb, { tenant: user.tenant, roles: user.roles }, caseId);
  if (!loaded) return null;
  const { row } = loaded;
  if (!loaded.context) return { row };
  let ctx = loaded.context;
  let facts = loaded.facts;
  const platform = ctx.subject.startupId ? await loadPlatformStartupFacts(pb, user.tenant, ctx.subject.startupId) : null;
  if (platform) {
    ctx = refreshPlatformInContext(ctx, platform);
    facts = platform.facts;
  } else if (ctx.subject.startupId) {
    // Bolaget finns inte längre (eller inte i tenanten) — ingen bolagsmapp, inga sparade svar på bolagskortet.
    ctx = { ...ctx, subject: { ...ctx.subject, startupId: undefined } };
  }
  const assessment = await computeAssessment(
    pb,
    user,
    ctx,
    facts,
    // Visa när ärendet senast sparades, inte när sidan öppnades.
    opts.final ? {} : { assessedAt: row.last_assessed_at, assessedBy: row.last_assessed_by_name }
  );
  assessment.caseId = row.id;
  assessment.caseStatus = row.status;
  // Slutbedömningens PDF (skapas vid klarmarkering) ligger i den som
  // klarmarkerade ärendets egna Filer (ägaren-bara, § 51.3).
  if (!opts.final && row.status === 'done' && row.file_id && row.file_name && row.completed_by === user.id) {
    assessment.file = { id: row.file_id, filename: row.file_name, href: `/api/files/${row.file_id}`, startupId: ctx.subject.startupId };
  }
  return { row, assessment };
}

/**
 * Räknar om bolagets PÅGÅENDE ärende (§ 51.10) på dess sparade underlag med
 * bolagskortets aktuella svar och plattformsfakta — anropas när en
 * komplettering besvaras eller bolagskortet räknas om, så ärendelistans
 * utfall och "okänt"-antal aldrig visar ett gammalt läge. Inga
 * registeranrop, ingen PDF, "senast sparad av" lämnas orört. Fail-soft:
 * `error` beskriver varför ärendet inte kunde uppdateras.
 */
export async function refreshOpenScreeningCase(
  pb: PocketBase,
  user: AssessmentViewer,
  startupId: string
): Promise<{ caseId?: string; error?: string }> {
  const viewer = { tenant: user.tenant, roles: user.roles };
  const open = await findOpenScreeningCase(pb, viewer, { startupId });
  if (!open) return {};
  const loaded = await loadCaseAssessment(pb, user, open.id);
  if (!loaded?.assessment) return { caseId: open.id, error: 'Ärendet saknar sparat underlag.' };
  const saved = await saveAssessmentToCase(
    pb,
    { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles },
    loaded.assessment,
    { caseId: open.id, create: false, touch: false }
  );
  if (saved.ok === false) return { caseId: open.id, error: saved.error };
  return { caseId: open.id };
}
