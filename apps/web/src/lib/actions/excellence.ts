'use server';

import type PocketBase from 'pocketbase';
import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import {
  MAX_RELATED_COMPANIES,
  deriveGroupCompanies,
  normalizeExcellenceManualReview,
  screenExcellence,
  type ExcellenceManualReview,
  type GroupCompanyFacts,
  type Role,
  type ScreeningFinancialsYear
} from '@platform/shared';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { logAgentAction } from '@/lib/core/write/audit';
import { writeWithFallback } from '@/lib/core/write/helpers';
import { pbStatus } from '@/lib/pb-error';
import { runRegistryLookup } from '@/lib/integrations/company-registry/lookup.server';
import type { RegistryPartId } from '@/lib/integrations/company-registry/parts';
import { isPersonalOrgNr } from '@/lib/integrations/company-registry/orgnr';
import { estimateRegistryCost } from '@/lib/integrations/company-registry/pricing';
import {
  findStartupByOrgNr,
  groupFactsFromRegistry,
  groupFactsFromSaved,
  loadPlatformStartupFacts,
  platformPart,
  type PlatformStartupFacts
} from '@/lib/excellence/data.server';
import type { ExcellenceAssessment, ExcellenceSavedToCard } from '@/lib/excellence/types';
import { storeExcellenceAssessmentPdf } from '@/lib/excellence/assessment-store.server';

// "Bedömning excellens" (CLAUDE.md § 51). Kör regelträdet (art. 22 GBER /
// de minimis / Vinnovas målgrupp) på ett bolag OCH dess koncern — antingen på
// FÄRSKA registeruppslag hos en ansluten leverantör (Roaring) — som då
// också skrivs till bolagskortet för portföljbolag (§ 51.4), så datan går att
// komma åt där utan ett nytt betalt uppslag — eller på det som redan är
// sparat för ett portföljbolag (inget leverantörsanrop). Själva bedömningen
// arkiveras som PDF i den inloggades Filer, i bolagets mapp (§ 51.3). Anknutna/partnerföretag ur startup-bolagets ägarbild
// slås upp automatiskt (tak MAX_RELATED_COMPANIES) så grundförutsättningarna
// prövas för hela koncernen — det var där Combly föll (Ewell AB från 2006).
// Bedömningen är deterministisk (ingen AI) och är ett underlag för
// controllern — den skriver aldrig statsstödsgrund eller excellensflagga.

export type { ExcellenceAssessment, ExcellenceAssessmentFile } from '@/lib/excellence/types';

export type ExcellenceAssessmentState = {
  error?: string;
  assessment?: ExcellenceAssessment;
  /** Schema-drift: manuella uppgifter kunde inte sparas (fältet saknas). */
  warning?: string;
};

const LOOKUP_ROLES = ['admin', 'incubator_lead'] as const;
/** Får spara manuella uppgifter — samma krets som modulen (§ 51.5). */
const REVIEW_ROLES: Role[] = ['admin', 'incubator_lead', 'coach'];
const REVIEW_JSON_MAX = 20_000;

type SessionLike = { id: string; tenant: string; roles: Role[]; name?: string };

/**
 * "Bedöm sparade data": regelträdet på det som redan finns i plattformen
 * (bolagskortets registerdata, grundare, de minimis, IRL, manuella
 * uppgifter) — inget leverantörsanrop. Delas av den vanliga körningen och
 * av sparandet av manuella uppgifter, som alltid ger en ny bedömning + PDF.
 */
async function assessSaved(pb: PocketBase, user: SessionLike, platform: PlatformStartupFacts, now: Date) {
  const subject = groupFactsFromSaved(platform);
  // Anknutna bolag som själva är portföljbolag får sina sparade fakta.
  const related: GroupCompanyFacts[] = [];
  const financialsByOrg: Record<string, ScreeningFinancialsYear[]> = { [platform.orgNr]: platform.financials };
  // Ägarkedjan följs genom koncernen: varje bolag som själv finns i
  // plattformen ger sin sparade ägarbild, som kan peka vidare (holdingbolag
  // → investerare/bolag som äger holdingbolaget).
  const looked = new Set<string>([platform.orgNr]);
  for (let i = 0; i < MAX_RELATED_COMPANIES; i++) {
    const next = deriveGroupCompanies(subject, related).find(
      (r) => !!r.org_nr && r.relation !== 'exempt' && !looked.has(r.org_nr)
    );
    if (!next?.org_nr) break;
    looked.add(next.org_nr);
    const id = await findStartupByOrgNr(pb, user.tenant, next.org_nr);
    const facts = id ? await loadPlatformStartupFacts(pb, user.tenant, id) : null;
    if (facts) {
      related.push({ ...groupFactsFromSaved(facts), name: facts.name });
      financialsByOrg[facts.orgNr] = facts.financials;
    }
  }
  const assessment: ExcellenceAssessment = {
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
    result: screenExcellence({ refDate: now, subject, related, ...platformPart(platform) }),
    financialsByOrg,
    founders: platform.founders,
    notes: [],
    lookupWarnings: [],
    assessedAt: now.toISOString(),
    assessedBy: displayName(user),
    manualEditable: platform.manualFieldPresent,
    manual: platform.manual
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

  if (mode === 'saved') {
    if (!platform) return { error: 'Välj ett portföljbolag för att bedöma sparade data.' };
    return { assessment: await assessSaved(pb, user, platform, now) };
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
  // Det hämtade skrivs till bolagskortet (samma skrivväg som "Synka från
  // <leverantör>") så det går att komma åt där utan ett nytt betalt uppslag.
  const lookup = await runRegistryLookup(user, {
    providerSlug,
    orgNrRaw,
    formData,
    auditLabel: 'bolagsuppslag för bedömning excellens',
    persistToStartupId: platform?.id
  });
  if (!lookup.ok) return { error: lookup.error };
  const c = lookup.company;
  const savedToCards: ExcellenceSavedToCard[] = [];
  if (lookup.saved) savedToCards.push({ ...lookup.saved, name: platform?.name ?? c.name });
  const subject = groupFactsFromRegistry(c, platform?.name);
  const financialsByOrg: Record<string, ScreeningFinancialsYear[]> = { [subject.orgNr]: c.financials };
  const notes: ExcellenceAssessment['notes'] = [{ orgNr: subject.orgNr, name: subject.name, notes: c.notes }];
  const lookupWarnings: string[] = [];
  // Kostnad: varje uppslag (startup + varje koncernbolag) är egna debiterade
  // anrop med samma valda delar — summeras till en rad i resultatet.
  let companiesLookedUp = 1;

  // Koncernen: slå upp anknutna/partner-/oklara bolag med samma datadelar som
  // valdes för startup-bolaget (ägardelarna behövs för deras egen ägarbild,
  // grunddata för åldern, bokslut för tröskelvärdet).
  // Arbetslista: ägarkedjan följs nivå för nivå — ett holdingbolag som äger
  // 100 % är inte slutet på kedjan; dess egen ägarbild (hämtad här) kan peka
  // på investerare eller bolag som i sin tur slås upp (bilaga I art. 3.3/6.3).
  const related: GroupCompanyFacts[] = [];
  const parts: RegistryPartId[] = lookup.requestedParts;
  const looked = new Set<string>([subject.orgNr]);
  const skipped = new Set<string>();
  const nextRef = () =>
    subject.basic?.isPersonal
      ? undefined
      : deriveGroupCompanies(subject, related).find(
          (r) => r.relation !== 'exempt' && !looked.has(r.org_nr ?? '') && !skipped.has(r.org_nr || r.name || '')
        );
  let lookedUp = 0;
  for (let ref = nextRef(); ref; ref = nextRef()) {
    const label = ref.name || ref.org_nr || 'okänt bolag';
    if (!ref.org_nr) {
      skipped.add(ref.name || '');
      lookupWarnings.push(`${label}: saknar org-nr i registret — kunde inte slås upp.`);
      continue;
    }
    if (isPersonalOrgNr(ref.org_nr)) {
      skipped.add(ref.org_nr);
      lookupWarnings.push(`${label}: enskild firma — slås inte upp (org-nr = personnummer).`);
      continue;
    }
    if (lookedUp >= MAX_RELATED_COMPANIES) {
      const rest = deriveGroupCompanies(subject, related).filter(
        (r) => r.relation !== 'exempt' && !!r.org_nr && !looked.has(r.org_nr) && !skipped.has(r.org_nr)
      );
      lookupWarnings.push(
        `Koncernen har fler bolag i ägarkedjan än taket (${MAX_RELATED_COMPANIES}) — inte uppslagna: ${rest
          .map((r) => r.name || r.org_nr)
          .join(', ')}.`
      );
      break;
    }
    looked.add(ref.org_nr);
    lookedUp++;
    // Ett koncernbolag som själv är portföljbolag får också sitt kort uppdaterat.
    const relatedStartupId = await findStartupByOrgNr(pb, user.tenant, ref.org_nr);
    const r = await runRegistryLookup(user, {
      providerSlug,
      orgNrRaw: ref.org_nr,
      parts,
      auditLabel: 'koncernbolag för bedömning excellens',
      persistToStartupId: relatedStartupId ?? undefined
    });
    if (!r.ok) {
      lookupWarnings.push(`${label}: ${r.error}`);
      continue;
    }
    companiesLookedUp++;
    if (r.saved) savedToCards.push({ ...r.saved, name: ref.name ?? r.company.name });
    const facts = groupFactsFromRegistry(r.company, ref.name);
    related.push(facts);
    financialsByOrg[facts.orgNr] = r.company.financials;
    if (r.company.notes.length > 0) notes.push({ orgNr: facts.orgNr, name: facts.name, notes: r.company.notes });
  }

  const assessment: ExcellenceAssessment = {
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
      result: screenExcellence({ refDate: now, subject, related, ...platformPart(platform) }),
      financialsByOrg,
      founders: platform ? platform.founders : null,
      notes,
      lookupWarnings,
      cost: estimateRegistryCost(lookup.pricing, lookup.requestedParts, companiesLookedUp),
      savedToCards,
      assessedAt: now.toISOString(),
      assessedBy: displayName(user),
      manualEditable: platform ? platform.manualFieldPresent : false,
      manual: platform?.manual
    };
  // Bolagskorten som fick registerdata ska visa den direkt (Ägarbild,
  // Finansiell historik, grunddata) — inte efter en omladdning.
  for (const card of savedToCards) revalidatePath(`/startups/${card.startupId}`);
  return { assessment: await storeExcellenceAssessmentPdf(pb, user, assessment) };
}

/**
 * Sparar controllerns manuella komplettering (§ 51.5) för ett portföljbolag
 * och ger direkt en ny bedömning på sparade data (+ ny PDF i Filer).
 *
 * Säkerhet: modulgrind + roll (admin/incubator_lead/coach); bolaget läses med
 * användarens token och tenant-verifieras; indata normaliseras tolerant
 * (`normalizeExcellenceManualReview`: bara kända nycklar/utfall, cappade
 * texter) och alla fritexter personnummer-saneras. Systemet vinner alltid —
 * en uppgift för en punkt registret besvarar ignoreras av regelträdet.
 * Skrivningen går via användartoken med superuser-fallback bara vid PB
 * v0.23.4:s tysta regel-nekande (§ 21.3); posten läses tillbaka så ett
 * schema utan fältet aldrig blir en tyst no-op (§ 24.4). Auditeras PII-fritt
 * (nycklar + utfall, aldrig noter).
 */
export async function saveExcellenceReviewAction(
  _prev: ExcellenceAssessmentState,
  formData: FormData
): Promise<ExcellenceAssessmentState> {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'bedomning_excellens', user.enabledModules) || !hasRole(user.roles, REVIEW_ROLES)) {
    return { error: 'Du har inte behörighet att spara manuella uppgifter.' };
  }
  const startupId = String(formData.get('startup_id') || '').trim();
  if (!/^[a-z0-9]{1,30}$/i.test(startupId)) return { error: 'Ogiltigt bolag.' };
  const raw = String(formData.get('review_json') || '');
  if (raw.length > REVIEW_JSON_MAX) return { error: 'De manuella uppgifterna är för långa.' };
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return { error: 'De manuella uppgifterna kunde inte tolkas.' };
  }

  const pb = await getServerPb();
  const platform = await loadPlatformStartupFacts(pb, user.tenant, startupId);
  if (!platform) return { error: 'Bolaget hittades inte.' };
  if (!platform.manualFieldPresent) {
    return {
      error:
        'Manuella uppgifter kan inte sparas: fältet excellence_review saknas i PocketBase-schemat (kör migration 1700000189).'
    };
  }

  const now = new Date();
  const incoming = normalizeExcellenceManualReview(parsed);
  const review = stampReview(incoming, platform.manual, now.toISOString());

  try {
    const updated = await writeWithFallback(pb, (c) =>
      c.collection('startups').update<{ excellence_review?: unknown }>(startupId, { excellence_review: review }, { fields: 'id,excellence_review' })
    );
    // Schema-drift (§ 24.4): PB släpper okända fält tyst.
    if (!('excellence_review' in updated)) {
      return { error: 'Uppgifterna sparades inte: fältet excellence_review saknas i schemat (kör migration 1700000189).' };
    }
  } catch (err) {
    console.error('[excellence] save review failed', { status: pbStatus(err), startupId });
    return { error: 'Kunde inte spara de manuella uppgifterna. Försök igen.' };
  }

  // Audit (ISO 27001 A.8.15): nycklar + utfall — aldrig noter (fritext).
  logAgentAction(pb, {
    actor: { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles },
    action_type: 'update',
    collection: 'startups',
    record_id: startupId,
    field: 'excellence_review',
    after_value: {
      checks: Object.fromEntries(Object.entries(review.checks).map(([k, v]) => [k, v.verdict])),
      engagement_phase: review.engagement?.phase ?? null,
      founders_with_engagement: (review.engagement?.founders ?? []).filter((f) => typeof f.pct === 'number').length
    }
  }).catch(() => undefined);
  revalidatePath(`/startups/${startupId}`);

  const fresh = await loadPlatformStartupFacts(pb, user.tenant, startupId);
  if (!fresh) return { error: 'Bolaget kunde inte läsas om efter sparandet.' };
  return { assessment: await assessSaved(pb, user, fresh, now) };
}

/**
 * Personnummer-sanerar fritexter och stämplar `updated_at` på uppgifter som
 * ändrats sedan den sparade posten (oförändrade behåller sin tid).
 */
function stampReview(incoming: ExcellenceManualReview, previous: ExcellenceManualReview, nowIso: string): ExcellenceManualReview {
  const checks: ExcellenceManualReview['checks'] = {};
  for (const [key, entry] of Object.entries(incoming.checks)) {
    const note = entry.note ? sanitizePersonnummer(entry.note) : undefined;
    const prev = previous.checks[key];
    const unchanged = prev && prev.verdict === entry.verdict && (prev.note ?? '') === (note ?? '');
    checks[key] = {
      verdict: entry.verdict,
      ...(note ? { note } : {}),
      updated_at: unchanged && prev.updated_at ? prev.updated_at : nowIso
    };
  }
  const out: ExcellenceManualReview = { checks };
  if (incoming.engagement) {
    out.engagement = {
      phase: incoming.engagement.phase,
      founders: incoming.engagement.founders.map((f) => ({ name: sanitizePersonnummer(f.name), pct: f.pct }))
    };
  }
  return out;
}

/** Visningsnamn för PDF:en — aldrig e-post (SessionUser.name faller tillbaka på e-post). */
function displayName(user: { name?: string }): string | undefined {
  const n = (user.name || '').trim();
  return n && !n.includes('@') ? n : undefined;
}
