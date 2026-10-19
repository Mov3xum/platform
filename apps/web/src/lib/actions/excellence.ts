'use server';

import type PocketBase from 'pocketbase';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import {
  MAX_RELATED_COMPANIES,
  deriveGroupCompanies,
  normalizeScreeningFacts,
  type GroupCompanyFacts,
  type RelatedCompanyRef,
  type ScreeningFinancialsYear,
  type ScreeningManualFacts
} from '@platform/shared';
import { runRegistryLookup } from '@/lib/integrations/company-registry/lookup.server';
import { isPersonalOrgNr, isValidOrgNr, normalizeOrgNr } from '@/lib/integrations/company-registry/orgnr';
import { sumRegistryCosts } from '@/lib/integrations/company-registry/pricing';
import type { RegistryPartId } from '@/lib/integrations/company-registry/parts';
import {
  attachPlatformDeMinimis,
  findStartupByOrgNr,
  groupFactsFromRegistry,
  groupFactsFromSaved,
  loadPlatformStartupFacts,
  platformPart
} from '@/lib/excellence/data.server';
import { parseAssessmentContext, type AssessmentContext } from '@/lib/excellence/context';
import type { ExcellenceAssessment } from '@/lib/excellence/types';
import { upsertGroupCompany } from '@/lib/excellence/merge';
import { renderExcellenceAssessmentPdf, storeExcellenceAssessmentPdf } from '@/lib/excellence/assessment-store.server';
import { loadLatestScreeningContext, storeScreeningRun } from '@/lib/excellence/history.server';
import { computeAssessment, loadCaseAssessment, refreshPlatformInContext } from '@/lib/excellence/compute.server';
import { findOpenScreeningCase, loadScreeningCase, saveAssessmentToCase, setScreeningCaseStatus } from '@/lib/excellence/cases.server';
import { isScreeningCaseId } from '@/lib/excellence/cases';
import { pbStatus } from '@/lib/pb-error';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { saveStartupScreeningFacts } from '@/lib/core/write/startups';
import type { Actor } from '@/lib/core/write/types';

// "Bedömning excellens" (CLAUDE.md § 51). Kör regelträdet (art. 22 GBER /
// de minimis / Vinnovas målgrupp) på ett bolag OCH dess koncern — antingen på
// FÄRSKA registeruppslag hos en ansluten leverantör (Roaring), utan att
// registerdata sparas på bolagskortet, eller på det som redan är sparat för
// ett portföljbolag (inget leverantörsanrop). Själva bedömningen arkiveras
// som PDF i den inloggades Filer, i bolagets mapp (§ 51.3). Anknutna/partner-
// företag ur startup-bolagets ägarbild slås upp automatiskt (tak
// MAX_RELATED_COMPANIES) så grundförutsättningarna prövas för hela koncernen
// — det var där Combly föll (Ewell AB från 2006).
//
// Manuella svar (§ 51.4): det registret inte kan svara på fyller
// controllern i efter körningen. Svaren sparas på bolagskortet
// (`startups.screening_facts`) och bedömningen räknas om på SAMMA underlag
// (rundtur via `context`, § 51.4) — inga nya debiterade anrop.
//
// Bedömningen är deterministisk (ingen AI) och är ett underlag för
// controllern — den skriver aldrig statsstödsgrund eller excellensflagga.

export type { ExcellenceAssessment, ExcellenceAssessmentFile } from '@/lib/excellence/types';

export type ExcellenceAssessmentState = {
  error?: string;
  assessment?: ExcellenceAssessment;
};

const LOOKUP_ROLES = ['admin', 'incubator_lead'] as const;
/** Modulens roller (§ 51) — samma krets klarmarkerar och öppnar ärenden. */
const CASE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

type SessionUser = Awaited<ReturnType<typeof requireUser>>;

function actorOf(user: SessionUser): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

/**
 * Arkiverar en bedömning: PDF:en renderas EN gång och sparas i den
 * inloggades Filer (§ 51.3) och — för ett portföljbolag — som körning på
 * bolagskortet (§ 51.6). Båda fail-soft (felet följer med i resultatet).
 */
async function archiveAssessment(pb: PocketBase, user: SessionUser, assessment: ExcellenceAssessment): Promise<ExcellenceAssessment> {
  const pdf = await renderExcellenceAssessmentPdf(assessment);
  let out = await storeExcellenceAssessmentPdf(pb, user, assessment, pdf);
  if (assessment.subject.startupId) {
    const stored = await storeScreeningRun(pb, actorOf(user), out, pdf);
    out = {
      ...out,
      history: stored.ok ? { runId: stored.value.id, previous: stored.value.previous, diff: stored.value.diff } : { error: stored.error }
    };
  }
  return out;
}

/**
 * Räknar bedömningen på ett underlag + manuella svar, sparar svaren på
 * bolagskortet (portföljbolag) och underlaget i ärendet (§ 51.10). Delas av
 * första körningen och alla omräkningar så samma underlag alltid ger samma
 * resultat.
 *
 * PDF + körning på bolagskortet skapas BARA när ärendet klarmarkeras
 * (`completeScreeningCaseAction`) — arbetet däremellan fyller inte Filer med
 * utkast. Undantag: `archive: 'always'` (bolagskortets uttryckliga "Räkna om
 * och spara ny PDF", § 51.8) och när ärendet inte kunde sparas
 * (`'if_no_case'`) — då vore en betald körning annars helt borta.
 */
async function finishAssessment(
  pb: PocketBase,
  user: SessionUser,
  ctx: AssessmentContext,
  facts: ScreeningManualFacts,
  opts: { saveFacts: boolean; recomputed?: boolean; caseId?: string; createCase: boolean; archive?: 'always' | 'if_no_case' }
): Promise<ExcellenceAssessment> {
  let factsSaved: boolean | undefined;
  let factsSchemaMissing: boolean | undefined;
  let startupId = ctx.subject.startupId;
  if (opts.saveFacts && startupId) {
    const saved = await saveStartupScreeningFacts(pb, actorOf(user), { startupId, facts });
    if (saved.ok) {
      factsSaved = true;
      factsSchemaMissing = saved.value.schemaMissing || undefined;
    } else if (saved.code === 'NOT_FOUND' || saved.code === 'TENANT_MISMATCH') {
      // Underlaget pekade på ett bolag som inte finns i tenanten — PDF:en
      // får ingen bolagsmapp och svaren sparas inte.
      startupId = undefined;
      factsSaved = false;
    } else {
      factsSaved = false;
    }
  }

  const assessment = await computeAssessment(pb, user, { ...ctx, subject: { ...ctx.subject, startupId } }, facts, {
    factsSaved,
    factsSchemaMissing,
    recomputed: opts.recomputed
  });
  const out = opts.archive === 'always' ? await archiveAssessment(pb, user, assessment) : assessment;
  // Ärendet (§ 51.10): underlaget sparas så ärendet kan fortsättas utan nya
  // registeranrop. Fail-soft — bedömningen visas även om ärendet inte sparas.
  const saved = await saveAssessmentToCase(pb, actorOf(user), out, { caseId: opts.caseId, create: opts.createCase });
  if (saved.ok === true) return { ...out, caseId: saved.id, caseStatus: saved.status, caseCreated: saved.created || undefined };
  const kept = opts.archive === 'if_no_case' ? await archiveAssessment(pb, user, out) : out;
  if (saved.ok === false) return { ...kept, caseError: saved.error };
  return kept;
}

/**
 * Manuella svar sparade i ärendet för ett bolag utanför plattformen: det
 * uttryckliga ärendet (om det gäller samma org-nr), annars det pågående
 * ärendet för org-numret. Null när inget ärende finns.
 */
async function caseFactsFor(pb: PocketBase, user: SessionUser, caseId: string | undefined, orgNr: string): Promise<ScreeningManualFacts | null> {
  const viewer = { tenant: user.tenant, roles: user.roles };
  const explicit = caseId ? await loadScreeningCase(pb, viewer, caseId) : null;
  if (explicit && explicit.row.org_nr === orgNr) return explicit.facts;
  const open = await findOpenScreeningCase(pb, viewer, { orgNr });
  if (!open) return null;
  return (await loadScreeningCase(pb, viewer, open.id))?.facts ?? null;
}

/** Ärendet en rapport/åtgärd hör till (`case_id` i formuläret), validerat. */
function caseIdFrom(formData: FormData): string | undefined {
  const v = String(formData.get('case_id') || '').trim();
  return isScreeningCaseId(v) ? v : undefined;
}

export async function assessExcellenceAction(
  _prev: ExcellenceAssessmentState,
  formData: FormData
): Promise<ExcellenceAssessmentState> {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'bedomning_excellens', user.enabledModules)) {
    return { error: 'Du har inte tillgång till Bedömning excellens.' };
  }
  const mode = formData.get('mode') === 'saved' ? 'saved' : 'register';
  const startupId = String(formData.get('startup_id') || '').trim();
  if (startupId && !/^[a-z0-9]{1,30}$/i.test(startupId)) return { error: 'Ogiltigt bolag.' };

  const pb = await getServerPb();
  // Portföljbolaget läses med användarens token (RLS) och tenant-verifieras.
  const platform = startupId ? await loadPlatformStartupFacts(pb, user.tenant, startupId) : null;
  if (startupId && !platform) return { error: 'Bolaget hittades inte.' };
  const now = new Date();
  let facts: ScreeningManualFacts = platform?.facts ?? normalizeScreeningFacts(null);

  if (mode === 'saved') {
    if (!platform) return { error: 'Välj ett portföljbolag för att bedöma sparade data.' };
    const subject = groupFactsFromSaved(platform);
    // Anknutna bolag som själva är portföljbolag får sina sparade fakta.
    const related: GroupCompanyFacts[] = [];
    const financialsByOrg: Record<string, ScreeningFinancialsYear[]> = { [platform.orgNr]: platform.financials };
    for (const ref of deriveGroupCompanies(subject, [], facts.group_companies).slice(0, MAX_RELATED_COMPANIES)) {
      if (!ref.org_nr || ref.relation === 'exempt') continue;
      const id = await findStartupByOrgNr(pb, user.tenant, ref.org_nr);
      const f = id ? await loadPlatformStartupFacts(pb, user.tenant, id) : null;
      if (f) {
        related.push({ ...groupFactsFromSaved(f), name: f.name });
        financialsByOrg[f.orgNr] = f.financials;
      }
    }
    const ctx: AssessmentContext = {
      mode: 'saved',
      subject: {
        name: platform.name,
        orgNr: platform.orgNr,
        startupId: platform.id,
        bolagsform: platform.bolagsform,
        registeredAt: platform.registeredAt,
        kommun: platform.kommun,
        industri: platform.industri,
        bolagStatus: platform.bolagStatus
      },
      input: {
        subject,
        related,
        deMinimis: platform.deMinimis,
        irl: platform.irl,
        meetsExcellenceFlag: platform.meetsExcellence,
        sekPerEur: platformPart(platform, undefined).sekPerEur
      },
      platformFounders: platform.founders,
      financialsByOrg,
      notes: [],
      lookupWarnings: [],
      assessedAt: now.toISOString()
    };
    return { assessment: await finishAssessment(pb, user, ctx, facts, { saveFacts: false, caseId: caseIdFrom(formData), createCase: true, archive: 'if_no_case' }) };
  }

  // Färska uppslag: leverantörerna debiterar per anrop — samma krets som
  // "Testa mot org-nr" (admin/incubator_lead).
  if (!hasRole(user.roles, [...LOOKUP_ROLES])) {
    return { error: 'Endast inkubatorledning kan hämta från bolagsregistret. Bedöm sparade data i stället.' };
  }
  const providerSlug = String(formData.get('provider_slug') || '');
  // För ett portföljbolag gäller bolagskortets org-nr, aldrig ett fritt fält.
  const orgNrRaw = platform ? platform.orgNr : String(formData.get('org_nr') || '');
  if (platform && !platform.orgNr) return { error: 'Bolaget saknar organisationsnummer på bolagskortet.' };
  const lookup = await runRegistryLookup(user, {
    providerSlug,
    orgNrRaw,
    formData,
    auditLabel: 'bolagsuppslag för bedömning excellens'
  });
  if (!lookup.ok) return { error: lookup.error };
  if (!platform) {
    // Bolag utanför plattformen: de manuella svaren bor bara i ärendet
    // (§ 51.10) — en ny hämtning i ett pågående ärende tappar dem aldrig.
    facts = await caseFactsFor(pb, user, caseIdFrom(formData), lookup.orgNr) ?? facts;
  }
  const c = lookup.company;
  const subject = groupFactsFromRegistry(c, platform?.name);
  const financialsByOrg: Record<string, ScreeningFinancialsYear[]> = { [subject.orgNr]: c.financials };
  const notes: AssessmentContext['notes'] = [{ orgNr: subject.orgNr, name: subject.name, notes: c.notes }];
  const lookupWarnings: string[] = [];
  // Koncernen i två led: (1) startup-bolagets ägarbild + koncernregistrets
  // HELA lista (moder, moderns moder, syskon, dotter — alla anknutna, bilaga
  // I art. 3.3) + manuellt angivna koncernbolag (§ 51.8), (2) det som de
  // uppslagna bolagen i sin tur visar. Varje bolag slås upp EN gång, högst
  // MAX_RELATED_COMPANIES totalt.
  const related: GroupCompanyFacts[] = [];
  const costs = [lookup.cost];
  await followGroupLookups(user, pb, {
    providerSlug,
    subject,
    related,
    facts,
    requestedParts: lookup.requestedParts,
    financialsByOrg,
    notes,
    lookupWarnings,
    costs
  });

  const ctx: AssessmentContext = {
    mode: 'register',
    providerName: providerSlug.charAt(0).toUpperCase() + providerSlug.slice(1),
    providerSlug,
    subject: {
      name: c.name ?? platform?.name,
      orgNr: lookup.orgNr,
      startupId: platform?.id,
      bolagsform: c.startup.bolagsform,
      registeredAt: c.startup.company_registered_at,
      kommun: c.startup.kommun,
      industri: c.startup.industri,
      bolagStatus: c.startup.bolag_status
    },
    input: {
      subject,
      related,
      deMinimis: platform ? platform.deMinimis : null,
      irl: platform?.irl ?? null,
      meetsExcellenceFlag: platform ? platform.meetsExcellence : undefined,
      sekPerEur: platformPart(platform, undefined).sekPerEur
    },
    platformFounders: platform ? platform.founders : null,
    financialsByOrg,
    notes,
    lookupWarnings,
    cost: sumRegistryCosts(costs),
    assessedAt: now.toISOString()
  };
  return { assessment: await finishAssessment(pb, user, ctx, facts, { saveFacts: false, caseId: caseIdFrom(formData), createCase: true, archive: 'if_no_case' }) };
}

/**
 * "Spara svar och uppdatera bedömningen": tar underlaget från den senaste
 * körningen (rundtur, byggs om fält för fält i `parseAssessmentContext`) och
 * de manuella svaren, sparar svaren på bolagskortet och räknar om — utan
 * nya leverantörsanrop. Ny PDF arkiveras.
 */
export async function applyExcellenceFactsAction(
  _prev: ExcellenceAssessmentState,
  formData: FormData
): Promise<ExcellenceAssessmentState> {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'bedomning_excellens', user.enabledModules)) {
    return { error: 'Du har inte tillgång till Bedömning excellens.' };
  }
  const ctx = parseAssessmentContext(String(formData.get('context') || ''));
  if (!ctx) return { error: 'Underlaget kunde inte läsas — kör bedömningen igen.' };
  let rawFacts: unknown = null;
  try {
    rawFacts = JSON.parse(String(formData.get('facts') || 'null'));
  } catch {
    return { error: 'De manuella svaren kunde inte läsas.' };
  }
  const facts = normalizeScreeningFacts(rawFacts);
  const pb = await getServerPb();
  // Bara ett portföljbolag i den egna tenanten får sina svar sparade —
  // verifieras i skrivlagret; ett okänt id tappar bolagsmappen.
  if (ctx.subject.startupId && !(await loadPlatformStartupFacts(pb, user.tenant, ctx.subject.startupId))) {
    ctx.subject.startupId = undefined;
  }
  return {
    // Tomma svar sparas också (nollställer tidigare svar på bolagskortet).
    assessment: await finishAssessment(pb, user, ctx, facts, { saveFacts: !!ctx.subject.startupId, caseId: caseIdFrom(formData), createCase: true, archive: 'if_no_case' })
  };
}

/**
 * "Hämta mer" för ETT bolag i koncernkartan (§ 51.7): slår upp bolaget hos
 * leverantören med de delar personalen kryssat i (kostnaden visades innan),
 * slår ihop svaret med underlaget (bara hämtade delar ersätter —
 * `mergeGroupCompanyFacts`) och räknar om bedömningen med samma manuella
 * svar. Kostnaden summeras på bedömningens löpande total. Inga nya
 * datavägar: samma uppslagskärna, samma rate-limit och audit som § 11.8.
 */
export async function fetchGroupCompanyAction(
  _prev: ExcellenceAssessmentState,
  formData: FormData
): Promise<ExcellenceAssessmentState> {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'bedomning_excellens', user.enabledModules)) {
    return { error: 'Du har inte tillgång till Bedömning excellens.' };
  }
  if (!hasRole(user.roles, [...LOOKUP_ROLES])) {
    return { error: 'Endast inkubatorledning kan hämta från bolagsregistret.' };
  }
  const ctx = parseAssessmentContext(String(formData.get('context') || ''));
  if (!ctx) return { error: 'Underlaget kunde inte läsas — kör bedömningen igen.' };
  if (ctx.mode !== 'register' || !ctx.providerSlug) {
    return { error: 'Fler uppslag går bara i registerläget — kör "Hämta från bolagsregistret och bedöm" först.' };
  }
  let rawFacts: unknown = null;
  try {
    rawFacts = JSON.parse(String(formData.get('facts') || 'null'));
  } catch {
    return { error: 'De manuella svaren kunde inte läsas.' };
  }
  const facts = normalizeScreeningFacts(rawFacts);
  const orgNrRaw = String(formData.get('org_nr') || '');
  const lookup = await runRegistryLookup(user, {
    providerSlug: ctx.providerSlug,
    orgNrRaw,
    formData,
    auditLabel: 'koncernbolag (hämta mer) för bedömning excellens'
  });
  if (!lookup.ok) return { error: lookup.error };
  if (lookup.orgNr === ctx.input.subject.orgNr) {
    return { error: 'Det är startup-bolaget självt — kör en ny bedömning för att hämta om det.' };
  }
  const pb = await getServerPb();
  const next = await applyLookupToContext(pb, user.tenant, ctx, lookup);
  if (ctx.subject.startupId && !(await loadPlatformStartupFacts(pb, user.tenant, ctx.subject.startupId))) {
    next.subject = { ...next.subject, startupId: undefined };
  }
  return { assessment: await finishAssessment(pb, user, next, facts, { saveFacts: false, caseId: caseIdFrom(formData), createCase: true, archive: 'if_no_case' }) };
}


/**
 * Följer koncernen i upp till två led: härleder koncernbolag ur startup-
 * bolaget (ägarbild + koncernlista + manuellt angivna), slår upp dem som inte
 * redan är uppslagna och härleder igen ur svaren (andra ledet). Varje bolag
 * slås upp EN gång, högst MAX_RELATED_COMPANIES totalt; kostnaden per uppslag
 * läggs på `costs`. Delas av den ursprungliga bedömningen och "Lägg till
 * koncernbolag" (§ 51.8) så samma regler gäller oavsett var koncernen
 * upptäcktes.
 */
async function followGroupLookups(
  user: SessionUser,
  pb: PocketBase,
  args: {
    providerSlug: string;
    subject: GroupCompanyFacts;
    related: GroupCompanyFacts[];
    facts: ScreeningManualFacts;
    requestedParts: RegistryPartId[];
    financialsByOrg: Record<string, ScreeningFinancialsYear[]>;
    notes: AssessmentContext['notes'];
    lookupWarnings: string[];
    costs: NonNullable<AssessmentContext['cost']>[];
  }
): Promise<void> {
  const { subject, related, facts, financialsByOrg, notes, lookupWarnings, costs } = args;
  const lookedUp = new Set<string>([subject.orgNr, ...related.filter((r) => r.dataFetched).map((r) => r.orgNr)]);
  const skipped = new Set<string>();
  let overflow = 0;
  let partsHint = false;
  for (let round = 0; round < 2; round++) {
    const refs = subject.basic?.isPersonal ? [] : deriveGroupCompanies(subject, related, facts.group_companies).filter((r) => r.relation !== 'exempt');
    const pending = refs.filter((r) => {
      const key = r.org_nr ?? `name:${r.name ?? ''}`;
      return !lookedUp.has(key) && !skipped.has(key);
    });
    if (pending.length === 0) break;
    for (const ref of pending) {
      const key = ref.org_nr ?? `name:${ref.name ?? ''}`;
      const label = ref.name || ref.org_nr || 'okänt bolag';
      if (related.length >= MAX_RELATED_COMPANIES) {
        overflow++;
        skipped.add(key);
        continue;
      }
      if (!ref.org_nr) {
        lookupWarnings.push(`${label}: saknar org-nr i registret — kunde inte slås upp.`);
        skipped.add(key);
        continue;
      }
      if (isPersonalOrgNr(ref.org_nr)) {
        lookupWarnings.push(`${label}: enskild firma — slås inte upp (org-nr = personnummer).`);
        skipped.add(key);
        continue;
      }
      const parts = partsForRelated(ref, args.requestedParts);
      if (parts.length === 0) {
        partsHint = true;
        skipped.add(key);
        continue;
      }
      const r = await runRegistryLookup(user, {
        providerSlug: args.providerSlug,
        orgNrRaw: ref.org_nr,
        parts,
        auditLabel: 'koncernbolag för bedömning excellens'
      });
      lookedUp.add(key);
      if (!r.ok) {
        lookupWarnings.push(`${label}: ${r.error}`);
        continue;
      }
      costs.push(r.cost);
      // Ett anknutet bolag som själv är portföljbolag får sitt registrerade
      // de minimis-stöd ur plattformen (annars intyg via Manuella svar).
      const f = await attachPlatformDeMinimis(pb, user.tenant, groupFactsFromRegistry(r.company, ref.name));
      const idx = related.findIndex((x) => x.orgNr === f.orgNr);
      if (idx === -1) related.push(f);
      else related[idx] = f;
      financialsByOrg[f.orgNr] = r.company.financials;
      if (r.company.notes.length > 0) notes.push({ orgNr: f.orgNr, name: f.name, notes: r.company.notes });
    }
  }
  if (overflow > 0) {
    lookupWarnings.push(
      `Koncernen har fler bolag än som slås upp per bedömning — ${overflow} bolag slogs inte upp (tak ${MAX_RELATED_COMPANIES}). De visas ändå i koncernkartan utan grundförutsättningar.`
    );
  }
  if (partsHint) {
    lookupWarnings.push(
      'Koncernbolagen slogs inte upp: välj Grunddata (ålder/status) och Bokslut (tröskelvärde) så prövas grundförutsättningarna även för dem.'
    );
  }
}

/** Slår in ett färskt uppslag i underlaget (bara hämtade delar ersätter, § 51.7). */
async function applyLookupToContext(
  pb: PocketBase,
  tenant: string,
  ctx: AssessmentContext,
  lookup: Extract<Awaited<ReturnType<typeof runRegistryLookup>>, { ok: true }>
): Promise<AssessmentContext> {
  const prevName = ctx.input.related.find((r) => r.orgNr === lookup.orgNr)?.name;
  const fresh = await attachPlatformDeMinimis(pb, tenant, groupFactsFromRegistry(lookup.company, prevName));
  const related = upsertGroupCompany(ctx.input.related, fresh);
  const financialsByOrg = { ...ctx.financialsByOrg };
  if (lookup.company.fetchedParts?.includes('financials') || lookup.company.noRecordParts?.includes('financials')) {
    financialsByOrg[fresh.orgNr] = lookup.company.financials;
  }
  const notes = ctx.notes.filter((n) => n.orgNr !== fresh.orgNr);
  if (lookup.company.notes.length > 0) notes.push({ orgNr: fresh.orgNr, name: fresh.name, notes: lookup.company.notes });
  return {
    ...ctx,
    input: { ...ctx.input, related },
    financialsByOrg,
    notes,
    // Varningar om just det här bolaget ("kunde inte slås upp") är inaktuella nu.
    lookupWarnings: ctx.lookupWarnings.filter((w) => !(fresh.name && w.startsWith(`${fresh.name}:`)) && !w.startsWith(`${fresh.orgNr}:`)),
    cost: sumRegistryCosts([...(ctx.cost ? [ctx.cost] : []), lookup.cost])
  };
}

/**
 * "Lägg till koncernbolag" (§ 51.8): controllern anger ett bolag registret
 * inte bar (aktieboken — t.ex. moderbolaget till ett nystartat bolag som
 * ännu inte finns i någon koncernredovisning). Bolaget sparas i de manuella
 * svaren (bolagskortet) så varje senare körning räknar med det, och i
 * registerläget slås det upp med de valda delarna; med "följ koncernen
 * vidare" hämtas även bolagen i dess koncern (andra ledet — grunddata och
 * bokslut av det valda, samma regel som den ursprungliga bedömningen).
 * `remove=1` tar bort ett tidigare angivet bolag och räknar om. Kostnaden
 * visas innan och läggs på totalen; samma uppslagskärna, rate-limit och
 * audit som § 11.8. Fungerar för vilket svenskt org-nr som helst.
 */
export async function addGroupCompanyAction(
  _prev: ExcellenceAssessmentState,
  formData: FormData
): Promise<ExcellenceAssessmentState> {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'bedomning_excellens', user.enabledModules)) {
    return { error: 'Du har inte tillgång till Bedömning excellens.' };
  }
  const ctx = parseAssessmentContext(String(formData.get('context') || ''));
  if (!ctx) return { error: 'Underlaget kunde inte läsas — kör bedömningen igen.' };
  let rawFacts: unknown = null;
  try {
    rawFacts = JSON.parse(String(formData.get('facts') || 'null'));
  } catch {
    return { error: 'De manuella svaren kunde inte läsas.' };
  }
  const facts = normalizeScreeningFacts(rawFacts);
  const orgNr = normalizeOrgNr(String(formData.get('org_nr') || ''));
  if (!orgNr || !isValidOrgNr(orgNr)) return { error: 'Ange ett giltigt organisationsnummer (10 siffror).' };
  if (isPersonalOrgNr(orgNr)) return { error: 'Enskild firma är en fysisk person — ange den som ägare under verklig huvudman, inte som koncernbolag.' };
  if (orgNr === ctx.input.subject.orgNr) return { error: 'Det är startup-bolaget självt.' };

  const remove = formData.get('remove') === '1';
  const pb = await getServerPb();
  if (ctx.subject.startupId && !(await loadPlatformStartupFacts(pb, user.tenant, ctx.subject.startupId))) {
    ctx.subject.startupId = undefined;
  }
  if (remove) {
    facts.group_companies = facts.group_companies.filter((g) => g.org_nr !== orgNr);
    return { assessment: await finishAssessment(pb, user, ctx, facts, { saveFacts: !!ctx.subject.startupId, caseId: caseIdFrom(formData), createCase: true, archive: 'if_no_case' }) };
  }

  // Normaliseringen (ren, enhetstestad) avgör relation/riktning/andel/not.
  const declared = normalizeScreeningFacts({
    group_companies: [
      {
        org_nr: orgNr,
        name: String(formData.get('name') || ''),
        relation: String(formData.get('relation') || 'linked'),
        direction: String(formData.get('direction') || 'owner'),
        share_pct: String(formData.get('share_pct') || ''),
        note: String(formData.get('note') || '')
      }
    ]
  }).group_companies[0];
  if (!declared) return { error: 'Bolaget kunde inte tolkas.' };
  facts.group_companies = [...facts.group_companies.filter((g) => g.org_nr !== orgNr), declared];

  let next = ctx;
  const wantsLookup = ctx.mode === 'register' && !!ctx.providerSlug && formData.has('parts_present');
  if (wantsLookup) {
    if (!hasRole(user.roles, [...LOOKUP_ROLES])) {
      return { error: 'Endast inkubatorledning kan hämta från bolagsregistret — bolaget läggs till utan uppslag om du tar bort valet av delar.' };
    }
    const lookup = await runRegistryLookup(user, {
      providerSlug: ctx.providerSlug!,
      orgNrRaw: orgNr,
      formData,
      auditLabel: 'manuellt angivet koncernbolag för bedömning excellens'
    });
    if (!lookup.ok) return { error: lookup.error };
    next = await applyLookupToContext(pb, user.tenant, ctx, lookup);
    if (!declared.name && lookup.company.name) {
      facts.group_companies = facts.group_companies.map((g) => (g.org_nr === orgNr ? { ...g, name: lookup.company.name } : g));
    }
    if (formData.get('follow') === '1') {
      const related = [...next.input.related];
      const financialsByOrg = { ...next.financialsByOrg };
      const notes = [...next.notes];
      const lookupWarnings = [...next.lookupWarnings];
      const costs: NonNullable<AssessmentContext['cost']>[] = next.cost ? [next.cost] : [];
      await followGroupLookups(user, pb, {
        providerSlug: ctx.providerSlug!,
        subject: next.input.subject,
        related,
        facts,
        requestedParts: lookup.requestedParts,
        financialsByOrg,
        notes,
        lookupWarnings,
        costs
      });
      next = { ...next, input: { ...next.input, related }, financialsByOrg, notes, lookupWarnings, cost: sumRegistryCosts(costs) };
    }
  }
  return {
    assessment: await finishAssessment(pb, user, next, facts, { saveFacts: !!next.subject.startupId, caseId: caseIdFrom(formData), createCase: true, archive: 'if_no_case' })
  };
}

/**
 * Vilka datadelar ett koncern-/partnerbolag slås upp med. Startup-bolagets
 * koncernlista bär redan hela koncernen, så ett bolag UR listan hämtar inte
 * koncernstrukturen igen (150 credits/bolag) — bara grunddata (ålder/status)
 * och bokslut (tröskelvärde) av det som valdes; verklig huvudman bara för
 * moderbolagen (indirekt grundarägande). Ett bolag ur ägarbilden som INTE
 * ligger i koncernlistan (partner/oklart ur verklig huvudman) hämtas med
 * hela valet, så dess egen koncern (andra ledet) blir känd.
 */
function partsForRelated(ref: RelatedCompanyRef, requested: RegistryPartId[]): RegistryPartId[] {
  if (!ref.groupRole && !ref.transitive) return requested;
  return requested.filter((p) => p !== 'group_structure' && (p !== 'beneficial_owners' || ref.groupRole === 'parent'));
}

/**
 * "Räkna om med svaren och spara ny PDF" (§ 51.8) — ett klick från
 * bolagskortet eller svarssidan: tar det SENAST sparade underlaget
 * (`startup_screenings.context`, inga nya leverantörsanrop), väger in
 * bolagskortets manuella svar (dit kompletteringarna redan slagits ihop)
 * och sparar en ny körning (PDF på bolagskortet + i den inloggades Filer).
 * Formuläraction: tillbaka till bolagskortet med utfallet i `?bedomning=`.
 */
export async function recomputeLatestScreeningAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const startupId = String(formData.get('startup_id') || '').trim();
  const back = String(formData.get('back') || '').trim();
  const target = back.startsWith('/') && !back.startsWith('//') ? back : `/startups/${startupId}/ekonomi`;
  const done = (code: string) => {
    const sep = target.includes('?') ? '&' : '?';
    redirect(`${target.split('#')[0]}${sep}bedomning=${code}#statsstod`);
  };
  if (!/^[a-z0-9]{1,30}$/i.test(startupId)) done('fel');
  if (!canAccessModuleForUser(user.roles, 'bedomning_excellens', user.enabledModules) || !hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    done('behorighet');
  }
  const pb = await getServerPb();
  const platform = await loadPlatformStartupFacts(pb, user.tenant, startupId);
  if (!platform) done('fel');
  const latest = await loadLatestScreeningContext(pb, user.tenant, startupId);
  if (!latest) done('underlag');
  const ctx: AssessmentContext = {
    // Plattformens egna fakta läses färskt (de minimis, IRL, grundare kan ha ändrats).
    ...refreshPlatformInContext(latest!.context, platform!),
    // Inga nya anrop: kostnaden för DEN HÄR körningen är noll.
    cost: undefined,
    assessedAt: new Date().toISOString()
  };
  // Ett pågående ärende för bolaget fylls på med omräkningen (§ 51.10) —
  // från bolagskortet skapas inget nytt ärende.
  const openCase = await findOpenScreeningCase(pb, { tenant: user.tenant, roles: user.roles }, { startupId });
  try {
    await finishAssessment(pb, user, ctx, platform!.facts, { saveFacts: false, recomputed: true, caseId: openCase?.id, createCase: false, archive: 'always' });
  } catch (err) {
    console.error('[excellence] recompute failed', { status: pbStatus(err), userId: user.id });
    done('fel');
  }
  revalidatePath(`/startups/${startupId}`);
  done('ok');
}

/**
 * Klarmarkerar ett ärende (§ 51.10) — slutbedömningen räknas på ärendets
 * sparade underlag och senaste svar (inga registeranrop) och arkiveras som
 * PDF i Filer och som körning på bolagskortet. Först när PDF:en är sparad
 * klarmarkeras ärendet; det lämnar då listan över aktuella ärenden men finns
 * kvar under "Avslutade" och kan öppnas igen. Formuläraction.
 */
export async function completeScreeningCaseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const caseId = guardCaseAction(user, formData);
  const pb = await getServerPb();
  const loaded = await loadCaseAssessment(
    pb,
    { id: user.id, tenant: user.tenant, roles: user.roles, linkedStartups: user.linkedStartups, name: user.name },
    caseId,
    { final: true }
  );
  if (!loaded) redirect('/bedomning-excellens?fel=arende');
  if (!loaded!.assessment) redirect(`/bedomning-excellens?arende=${caseId}&fel=underlag`);
  let archived: ExcellenceAssessment;
  try {
    archived = await archiveAssessment(pb, user, loaded!.assessment!);
  } catch (err) {
    console.error('[excellence] final pdf failed', { status: pbStatus(err), userId: user.id });
    redirect(`/bedomning-excellens?arende=${caseId}&fel=pdf`);
  }
  // Utan sparad PDF klarmarkeras inget — ett avslutat ärende ska alltid ha sin slutbedömning.
  if (!archived!.file) redirect(`/bedomning-excellens?arende=${caseId}&fel=pdf`);
  const res = await setScreeningCaseStatus(pb, actorOf(user), caseId, 'done', {
    file_id: archived!.file!.id,
    file_name: archived!.file!.filename.slice(0, 200)
  });
  if (!res.ok) redirect(`/bedomning-excellens?arende=${caseId}&fel=status`);
  revalidatePath('/bedomning-excellens');
  if (archived!.subject.startupId) revalidatePath(`/startups/${archived!.subject.startupId}`);
  redirect('/bedomning-excellens?klarmarkerat=1');
}

/** Öppnar ett klarmarkerat ärende igen (§ 51.10). Formuläraction. */
export async function reopenScreeningCaseAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const caseId = guardCaseAction(user, formData);
  const pb = await getServerPb();
  const res = await setScreeningCaseStatus(pb, actorOf(user), caseId, 'open');
  if (!res.ok) redirect(`/bedomning-excellens?arende=${caseId}&fel=status`);
  revalidatePath('/bedomning-excellens');
  redirect(`/bedomning-excellens?arende=${caseId}`);
}

/** Ärendets id + behörighet (modulens roller) — redirectar annars. */
function guardCaseAction(user: SessionUser, formData: FormData): string {
  const caseId = caseIdFrom(formData);
  if (!caseId) redirect('/bedomning-excellens?fel=arende');
  if (!canAccessModuleForUser(user.roles, 'bedomning_excellens', user.enabledModules) || !hasRole(user.roles, [...CASE_ROLES])) {
    redirect(`/bedomning-excellens?arende=${caseId}&fel=behorighet`);
  }
  return caseId!;
}
