'use server';

import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import {
  MAX_RELATED_COMPANIES,
  deriveRelatedCompanies,
  screenExcellence,
  type GroupCompanyFacts,
  type ScreeningFinancialsYear,
  type ScreeningFounderRow
} from '@platform/shared';
import { runRegistryLookup } from '@/lib/integrations/company-registry/lookup.server';
import type { RegistryPartId } from '@/lib/integrations/company-registry/parts';
import { isPersonalOrgNr } from '@/lib/integrations/company-registry/orgnr';
import { estimateRegistryCost } from '@/lib/integrations/company-registry/pricing';
import {
  findStartupByOrgNr,
  groupFactsFromRegistry,
  groupFactsFromSaved,
  loadPlatformStartupFacts,
  platformPart
} from '@/lib/excellence/data.server';
import type { ExcellenceAssessment } from '@/lib/excellence/types';
import { storeExcellenceAssessmentPdf } from '@/lib/excellence/assessment-store.server';

// "Bedömning excellens" (CLAUDE.md § 51). Kör regelträdet (art. 22 GBER /
// de minimis / Vinnovas målgrupp) på ett bolag OCH dess koncern — antingen på
// FÄRSKA registeruppslag hos en ansluten leverantör (Roaring), utan att
// registerdata sparas på bolagskortet, eller på det som redan är sparat för
// ett portföljbolag (inget leverantörsanrop). Själva bedömningen arkiveras
// som PDF i den inloggades Filer, i bolagets mapp (§ 51.3). Anknutna/partnerföretag ur startup-bolagets ägarbild
// slås upp automatiskt (tak MAX_RELATED_COMPANIES) så grundförutsättningarna
// prövas för hela koncernen — det var där Combly föll (Ewell AB från 2006).
// Bedömningen är deterministisk (ingen AI) och är ett underlag för
// controllern — den skriver aldrig statsstödsgrund eller excellensflagga.

export type { ExcellenceAssessment, ExcellenceAssessmentFile } from '@/lib/excellence/types';

export type ExcellenceAssessmentState = {
  error?: string;
  assessment?: ExcellenceAssessment;
};

const LOOKUP_ROLES = ['admin', 'incubator_lead'] as const;

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
    const subject = groupFactsFromSaved(platform);
    // Anknutna bolag som själva är portföljbolag får sina sparade fakta.
    const related: GroupCompanyFacts[] = [];
    const financialsByOrg: Record<string, ScreeningFinancialsYear[]> = { [platform.orgNr]: platform.financials };
    for (const ref of deriveRelatedCompanies(subject.ownership).slice(0, MAX_RELATED_COMPANIES)) {
      if (!ref.org_nr || ref.relation === 'exempt') continue;
      const id = await findStartupByOrgNr(pb, user.tenant, ref.org_nr);
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
        assessedBy: displayName(user)
      };
    return { assessment: await storeExcellenceAssessmentPdf(pb, user, assessment) };
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
  const notes: ExcellenceAssessment['notes'] = [{ orgNr: subject.orgNr, name: subject.name, notes: c.notes }];
  const lookupWarnings: string[] = [];
  // Kostnad: varje uppslag (startup + varje koncernbolag) är egna debiterade
  // anrop med samma valda delar — summeras till en rad i resultatet.
  let companiesLookedUp = 1;

  // Koncernen: slå upp anknutna/partner-/oklara bolag med samma datadelar som
  // valdes för startup-bolaget (ägardelarna behövs för deras egen ägarbild,
  // grunddata för åldern, bokslut för tröskelvärdet).
  const related: GroupCompanyFacts[] = [];
  const refs = subject.basic?.isPersonal ? [] : deriveRelatedCompanies(subject.ownership).filter((r) => r.relation !== 'exempt');
  if (refs.length > MAX_RELATED_COMPANIES) {
    lookupWarnings.push(
      `Koncernen har ${refs.length} anknutna/partnerbolag — bara de ${MAX_RELATED_COMPANIES} första slogs upp.`
    );
  }
  // Årsredovisningen (utdelning, den dyraste delen) hämtas BARA för
  // startup-bolaget: art. 22-villkoret "har inte delat ut vinst" prövas på
  // stödmottagaren, inte på dess anknutna bolag.
  const parts: RegistryPartId[] = lookup.requestedParts.filter((p) => p !== 'annual_report');
  for (const ref of refs.slice(0, MAX_RELATED_COMPANIES)) {
    const label = ref.name || ref.org_nr || 'okänt bolag';
    if (!ref.org_nr) {
      lookupWarnings.push(`${label}: saknar org-nr i registret — kunde inte slås upp.`);
      continue;
    }
    if (isPersonalOrgNr(ref.org_nr)) {
      lookupWarnings.push(`${label}: enskild firma — slås inte upp (org-nr = personnummer).`);
      continue;
    }
    const r = await runRegistryLookup(user, {
      providerSlug,
      orgNrRaw: ref.org_nr,
      parts,
      auditLabel: 'koncernbolag för bedömning excellens'
    });
    if (!r.ok) {
      lookupWarnings.push(`${label}: ${r.error}`);
      continue;
    }
    companiesLookedUp++;
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
      assessedAt: now.toISOString(),
      assessedBy: displayName(user)
    };
  return { assessment: await storeExcellenceAssessmentPdf(pb, user, assessment) };
}

/** Visningsnamn för PDF:en — aldrig e-post (SessionUser.name faller tillbaka på e-post). */
function displayName(user: { name?: string }): string | undefined {
  const n = (user.name || '').trim();
  return n && !n.includes('@') ? n : undefined;
}
