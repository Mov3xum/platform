'use server';

import type PocketBase from 'pocketbase';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import {
  MAX_RELATED_COMPANIES,
  deriveGroupCompanies,
  normalizeScreeningFacts,
  screenExcellence,
  type GroupCompanyFacts,
  type RelatedCompanyRef,
  type ScreeningFinancialsYear,
  type ScreeningManualFacts
} from '@platform/shared';
import { runRegistryLookup } from '@/lib/integrations/company-registry/lookup.server';
import { isPersonalOrgNr } from '@/lib/integrations/company-registry/orgnr';
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
import {
  parseAssessmentContext,
  serializeAssessmentContext,
  type AssessmentContext
} from '@/lib/excellence/context';
import type { ExcellenceAssessment } from '@/lib/excellence/types';
import { storeExcellenceAssessmentPdf } from '@/lib/excellence/assessment-store.server';
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

type SessionUser = Awaited<ReturnType<typeof requireUser>>;

function actorOf(user: SessionUser): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

/**
 * Räknar bedömningen på ett underlag + manuella svar, sparar svaren på
 * bolagskortet (portföljbolag) och arkiverar PDF:en. Delas av första
 * körningen och "Spara svar"-omräkningen så båda ger exakt samma resultat
 * för samma underlag.
 */
async function finishAssessment(
  pb: PocketBase,
  user: SessionUser,
  ctx: AssessmentContext,
  facts: ScreeningManualFacts,
  opts: { saveFacts: boolean }
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

  const context: AssessmentContext = { ...ctx, assessedAt: now.toISOString(), subject: { ...ctx.subject, startupId } };
  const assessment: ExcellenceAssessment = {
    mode: ctx.mode,
    providerName: ctx.providerName,
    subject: context.subject,
    result,
    financialsByOrg: ctx.financialsByOrg,
    founders: part.founders ?? null,
    foundersSource: part.foundersSource ?? 'platform',
    facts,
    factsSaved,
    factsSchemaMissing,
    context: serializeAssessmentContext(context),
    notes: ctx.notes,
    lookupWarnings: ctx.lookupWarnings,
    cost: ctx.cost,
    assessedAt: context.assessedAt,
    assessedBy: displayName(user)
  };
  return storeExcellenceAssessmentPdf(pb, user, assessment);
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
  const facts: ScreeningManualFacts = platform?.facts ?? normalizeScreeningFacts(null);

  if (mode === 'saved') {
    if (!platform) return { error: 'Välj ett portföljbolag för att bedöma sparade data.' };
    const subject = groupFactsFromSaved(platform);
    // Anknutna bolag som själva är portföljbolag får sina sparade fakta.
    const related: GroupCompanyFacts[] = [];
    const financialsByOrg: Record<string, ScreeningFinancialsYear[]> = { [platform.orgNr]: platform.financials };
    for (const ref of deriveGroupCompanies(subject, []).slice(0, MAX_RELATED_COMPANIES)) {
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
    return { assessment: await finishAssessment(pb, user, ctx, facts, { saveFacts: false }) };
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
  const c = lookup.company;
  const subject = groupFactsFromRegistry(c, platform?.name);
  const financialsByOrg: Record<string, ScreeningFinancialsYear[]> = { [subject.orgNr]: c.financials };
  const notes: AssessmentContext['notes'] = [{ orgNr: subject.orgNr, name: subject.name, notes: c.notes }];
  const lookupWarnings: string[] = [];
  // Kostnad: varje uppslag är egna debiterade anrop — koncernbolagen hämtas
  // med FÄRRE delar än startup-bolaget (koncernen är redan känd ur dess
  // koncernlista), så summan räknas per uppslag (§ 11.8).
  const costs = [lookup.cost];

  // Koncernen i två led: (1) startup-bolagets ägarbild + koncernregistrets
  // HELA lista (moder, moderns moder, syskon, dotter — alla anknutna, bilaga
  // I art. 3.3), (2) det som de uppslagna bolagen i sin tur visar (ett
  // anknutet bolags anknutna; ett partnerföretags koncern). Varje bolag slås
  // upp EN gång, högst MAX_RELATED_COMPANIES totalt.
  const related: GroupCompanyFacts[] = [];
  const lookedUp = new Set<string>([subject.orgNr]);
  const skipped = new Set<string>();
  let overflow = 0;
  let partsHint = false;
  for (let round = 0; round < 2; round++) {
    const refs = subject.basic?.isPersonal ? [] : deriveGroupCompanies(subject, related).filter((r) => r.relation !== 'exempt');
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
      const parts = partsForRelated(ref, lookup.requestedParts);
      if (parts.length === 0) {
        partsHint = true;
        skipped.add(key);
        continue;
      }
      const r = await runRegistryLookup(user, {
        providerSlug,
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
      related.push(f);
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

  const ctx: AssessmentContext = {
    mode: 'register',
    providerName: providerSlug.charAt(0).toUpperCase() + providerSlug.slice(1),
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
  return { assessment: await finishAssessment(pb, user, ctx, facts, { saveFacts: false }) };
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
    assessment: await finishAssessment(pb, user, ctx, facts, { saveFacts: !!ctx.subject.startupId })
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

/** Visningsnamn för PDF:en — aldrig e-post (SessionUser.name faller tillbaka på e-post). */
function displayName(user: { name?: string }): string | undefined {
  const n = (user.name || '').trim();
  return n && !n.includes('@') ? n : undefined;
}
