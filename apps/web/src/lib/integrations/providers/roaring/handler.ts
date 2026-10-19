import 'server-only';
import { createCompanyRegistryHandler } from '../../company-registry/handler-factory';
import { isPersonalOrgNr } from '../../company-registry/orgnr';
import type { RegistryPartId } from '../../company-registry/parts';
import type { CompanyRegistryHandler } from '../../types';
import type { RegistryEngagementCompany, RegistryOwnerEngagement } from '../../company-registry/types';
import {
  readRoaringCredentials,
  roaringAmountMultiplier,
  roaringFinancialYears,
  roaringGetFirst,
  roaringToken,
  ROARING_MAX_ENGAGEMENT_COMPANIES,
  ROARING_MAX_ENGAGEMENT_PERSONS,
  ROARING_PATHS,
  type RoaringCredentials,
  type RoaringFetchOutcome
} from './client';
import {
  describeRecordKeys,
  normalizeRoaringCompany,
  normalizeRoaringOverview,
  normalizeRoaringPersonEngagements,
  roaringBeneficialOwnerPersons,
  type RoaringRawBundle
} from './normalize';

/**
 * Förhandsgranskningens "vad svarade API:t"-not: vilken sökväg som gav data
 * och vilka FÄLTNYCKLAR svaret bar (aldrig värden — § 11.4). Gör att fält-
 * mappningen kan verifieras mot sandboxen utan att någon behöver läsa rå JSON.
 */
function responseNote(label: string, outcome: RoaringFetchOutcome): string {
  if (!outcome.ok) return `Roaring ${label} (${outcome.path}): ${outcome.reason}`;
  const keys = describeRecordKeys(outcome.data);
  return `Roaring ${label} (${outcome.path}) svarade med fälten: ${keys.length > 0 ? keys.join(', ') : '(tomt)'}`;
}

/** Kör `fn` över listan med högst `limit` samtidiga anrop, i ordning. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Ägarnas andra bolag (§ 51.11): för varje fysisk huvudman söks personens
 * övriga bolag (verklig huvudman per person) och varje hittat bolag får sin
 * grunddata (SNI-kod, ålder, status). Personnumret läses ur bolagets
 * huvudmannasvar och används BARA som parameter i anropet — det lämnar
 * aldrig funktionen (inte i resultat, noter eller loggar).
 */
async function fetchOwnerEngagements(
  c: RoaringCredentials,
  subjectOrgNr: string,
  beneficialRaw: unknown,
  notes: string[]
): Promise<{ engagements: RegistryOwnerEngagement[]; personCalls: number; overviewCalls: number; answered: boolean }> {
  const persons = roaringBeneficialOwnerPersons(beneficialRaw);
  if (persons.length === 0) {
    notes.push('Roaring ägarnas andra bolag: inga fysiska huvudmän i svaret — inget att söka.');
    return { engagements: [], personCalls: 0, overviewCalls: 0, answered: true };
  }
  const searchable = persons.filter((p) => p.personalNumber).slice(0, ROARING_MAX_ENGAGEMENT_PERSONS);
  const skippedCap = persons.filter((p) => p.personalNumber).length - searchable.length;
  if (skippedCap > 0) notes.push(`Roaring ägarnas andra bolag: ${skippedCap} huvudman/-män söktes inte (tak ${ROARING_MAX_ENGAGEMENT_PERSONS}).`);
  const noId = persons.filter((p) => !p.personalNumber);
  if (noId.length > 0) {
    notes.push(
      `Roaring ägarnas andra bolag: personnummer saknas för ${noId.length} huvudman/-män i svaret (form: ${[...new Set(noId.map((p) => p.shape))].join(' | ')}) — deras andra bolag kan inte sökas.`
    );
  }

  let answered = false;
  const engagements: RegistryOwnerEngagement[] = [];
  const results = await mapLimit(searchable, 3, async (p) => ({
    person: p,
    outcome: await roaringGetFirst(c, ROARING_PATHS.personEngagements(), p.personalNumber!)
  }));
  for (const { person, outcome } of results) {
    const base: Omit<RegistryOwnerEngagement, 'status' | 'companies'> = {
      person_name: person.name,
      subject_capital_pct: person.capital_pct,
      subject_pct_min: person.pct_min,
      subject_pct_max: person.pct_max
    };
    if (!outcome.ok) {
      if (outcome.status === 404) {
        answered = true;
        engagements.push({ ...base, status: 'none', companies: [] });
      } else {
        engagements.push({ ...base, status: 'failed', reason: `${outcome.reason} (${outcome.path})`, companies: [] });
      }
      continue;
    }
    answered = true;
    notes.push(`Roaring ägarnas andra bolag (${outcome.path}) svarade med fälten: ${describeRecordKeys(outcome.data).join(', ') || '(tomt)'}`);
    const companies = normalizeRoaringPersonEngagements(outcome.data, person.personalNumber, notes).filter((x) => x.org_nr !== subjectOrgNr);
    engagements.push({ ...base, status: companies.length > 0 ? 'ok' : 'none', companies });
  }
  for (const p of noId) {
    engagements.push({
      person_name: p.name,
      subject_capital_pct: p.capital_pct,
      subject_pct_min: p.pct_min,
      subject_pct_max: p.pct_max,
      status: 'no_id',
      reason: 'Personnummer saknas i huvudmannens post hos Roaring.',
      companies: []
    });
  }

  // Grunddata (SNI) per unikt bolag — ett anrop per bolag, tak per uppslag.
  const unique = new Map<string, RegistryEngagementCompany[]>();
  for (const e of engagements) {
    for (const co of e.companies) {
      if (!co.org_nr) continue;
      const list = unique.get(co.org_nr) ?? [];
      list.push(co);
      unique.set(co.org_nr, list);
    }
  }
  const orgNrs = [...unique.keys()].slice(0, ROARING_MAX_ENGAGEMENT_COMPANIES);
  if (unique.size > orgNrs.length) {
    notes.push(`Roaring ägarnas andra bolag: grunddata hämtades för ${orgNrs.length} av ${unique.size} bolag (tak ${ROARING_MAX_ENGAGEMENT_COMPANIES}) — övriga saknar SNI-kod.`);
  }
  const overviews = await mapLimit(orgNrs, 4, async (orgNr) => ({ orgNr, outcome: await roaringGetFirst(c, ROARING_PATHS.overview(), orgNr) }));
  for (const { orgNr, outcome } of overviews) {
    const targets = unique.get(orgNr) ?? [];
    if (!outcome.ok) {
      for (const t of targets) t.note = `Grunddata kunde inte hämtas: ${outcome.reason}`;
      continue;
    }
    const ov = normalizeRoaringOverview(outcome.data, []);
    for (const t of targets) {
      t.name = t.name ?? ov.name;
      t.basic = {
        registered_at: ov.patch.company_registered_at,
        bolag_status: ov.patch.bolag_status,
        bolagsform: ov.patch.bolagsform,
        sni: ov.sni
      };
    }
  }
  for (const list of [...unique.entries()].filter(([k]) => !orgNrs.includes(k)).map(([, v]) => v)) {
    for (const t of list) t.note = 'Grunddata hämtades inte (tak för antal bolag per uppslag).';
  }
  return { engagements, personCalls: searchable.length, overviewCalls: orgNrs.length, answered };
}

// Roaring — bolagsregister-provider (CLAUDE.md § 11.8). Hämtar upp till fyra
// API:er per bolag (grunddata, bokslut med beslutad utdelning, koncernstruktur,
// verklig huvudman) och — bara vid uppslag — ägarnas andra bolag (§ 51.11) —
// bara de personalen valt — och normaliserar till RegistryCompany. Valda
// grunddata är blockerande — felar det felar bolaget; de övriga är fail-soft
// med not i `notes` och räknas inte som hämtade (`fetchedParts`).
//
// Riskklass: begränsad (EU AI Act art. 11) — ingen AI, men verklig huvudman
// är personuppgifter hos leverantören. Namn visas i uppslag/bedömning;
// personnumret används bara för sökningen av ägarnas andra bolag och lagras
// aldrig. `startup_ownership` får andel/kontrollgrund, se writer.ts.

export const roaringHandler: CompanyRegistryHandler = createCompanyRegistryHandler({
  slug: 'roaring',
  source: 'roaring',
  residency: 'Sverige (EU)',
  riskClass: 'limited',
  complianceNote:
    'Roaring AB (Stockholm) levererar bolagsdata från Bolagsverket, SCB och Skatteverket. Vi lagrar grunddata, bokslutsposter och ägarbild. Fysiska personer i ägarbilden (verklig huvudman) lagras på bolagskortet som andel/kontrollintervall; namnen visas i uppslag och i Bedömning excellens. Personnummer används bara för att söka ägarnas andra bolag och lagras aldrig. Enskild firma synkas utan ägarbild. DPA med Roaring krävs innan produktion (CLAUDE.md § 10.3 A.5.19).',
  credentialFields: [
    {
      key: 'client_id',
      label: 'Client ID',
      type: 'text',
      required: true,
      help: 'Skapas i Roarings utvecklarportal under Applications → Credentials.'
    },
    {
      key: 'client_secret',
      label: 'Client secret',
      type: 'password',
      required: true,
      help: 'Krypteras med AES-256-GCM innan lagring. Visas aldrig igen.'
    },
    {
      key: 'base_url',
      label: 'Bas-URL (valfri)',
      type: 'text',
      required: false,
      help: 'Lämna tom för https://api.roaring.io. Roarings sandbox använder SAMMA adress — det är nyckelparet (sandbox- eller produktionsapplikation i utvecklarportalen) som avgör om svaren är testdata.'
    }
  ],
  throttleMs: 250,
  parts: ['basic', 'financials', 'group_structure', 'beneficial_owners'],
  // Bara vid uppslag (Testa mot org-nr, Bedömning excellens) — skrivs aldrig.
  lookupOnlyParts: ['owner_engagements'],
  // Första kandidaten per API (env vinner) — visas vid kryssrutorna så
  // personalen ser exakt vilket Roaring-API varje val anropar.
  partEndpoints: () => ({
    basic: ROARING_PATHS.overview()[0],
    financials: ROARING_PATHS.financials()[0],
    group_structure: ROARING_PATHS.groupStructure()[0],
    beneficial_owners: ROARING_PATHS.beneficialOwners()[0],
    owner_engagements: `${ROARING_PATHS.personEngagements()[0]}/{personnummer} + ${ROARING_PATHS.overview()[0]} per bolag`
  }),

  async testConnection(creds) {
    let c;
    try {
      c = readRoaringCredentials(creds);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Ogiltig bas-URL.' };
    }
    if (!c) return { ok: false, error: 'Client ID och client secret krävs.' };
    try {
      await roaringToken(c);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Kunde inte hämta token.' };
    }
  },

  async fetchCompany(orgNr, creds, parts) {
    const c = readRoaringCredentials(creds);
    if (!c) throw new Error('Roaring: client ID/secret saknas.');
    const isPersonal = isPersonalOrgNr(orgNr);
    const want = (p: RegistryPartId) => parts.includes(p);

    // Bara de valda API:erna anropas (valbara delar, § 11.8) — varje anrop
    // debiteras av Roaring. Grunddata är blockerande NÄR den valts; övriga
    // delar är fail-soft och noteras.
    const [overview, financials, group, beneficial] = await Promise.all([
      want('basic') ? roaringGetFirst(c, ROARING_PATHS.overview(), orgNr) : Promise.resolve(null),
      // economy-overview 2.1 /extended tar `years` (spec-default 5) — flera
      // räkenskapsår med utdelning, personalkostnad och skatt i ETT anrop.
      want('financials')
        ? roaringGetFirst(c, ROARING_PATHS.financials(), orgNr, { years: String(roaringFinancialYears()) })
        : Promise.resolve(null),
      want('group_structure') && !isPersonal
        ? roaringGetFirst(c, ROARING_PATHS.groupStructure(), orgNr)
        : Promise.resolve(null),
      want('beneficial_owners') && !isPersonal
        ? roaringGetFirst(c, ROARING_PATHS.beneficialOwners(), orgNr)
        : Promise.resolve(null)
    ]);
    if (overview && !overview.ok) {
      throw new Error(`Roaring grunddata (${overview.path}): ${overview.reason}`);
    }

    const bundle: RoaringRawBundle = {};
    const fetchedParts: RegistryPartId[] = [];
    const noRecordParts: RegistryPartId[] = [];
    const softNotes: string[] = [];
    const take = (
      part: RegistryPartId,
      label: string,
      outcome: RoaringFetchOutcome | null,
      assign: (data: unknown) => void
    ) => {
      if (!outcome) return;
      softNotes.push(responseNote(label, outcome));
      if (!outcome.ok) {
        // 404 = Roaring har inga uppgifter i det API:t (nystartat bolag utan
        // bokslut, bolag utanför varje koncern, inga registrerade huvudmän).
        if (outcome.status === 404) noRecordParts.push(part);
        return;
      }
      assign(outcome.data);
      fetchedParts.push(part);
    };
    take('basic', 'grunddata', overview, (d) => (bundle.overview = d));
    take('financials', 'bokslut', financials, (d) => (bundle.financials = d));
    take('group_structure', 'koncernstruktur', group, (d) => (bundle.groupStructure = d));
    take('beneficial_owners', 'verklig huvudman', beneficial, (d) => (bundle.beneficialOwners = d));

    const company = normalizeRoaringCompany(orgNr, bundle, {
      amountMultiplier: roaringAmountMultiplier(),
      isPersonal
    });
    company.notes.push(...softNotes);

    // Ägarnas andra bolag (§ 51.11) — kräver huvudmannasvaret (personnumret).
    if (want('owner_engagements') && !isPersonal) {
      if (beneficial?.ok) {
        const eng = await fetchOwnerEngagements(c, orgNr, beneficial.data, company.notes);
        company.ownerEngagements = eng.engagements;
        company.extraCalls = { owner_engagements: eng.personCalls, basic: eng.overviewCalls };
        if (eng.answered) fetchedParts.push('owner_engagements');
      } else {
        company.notes.push('Roaring ägarnas andra bolag: verklig huvudman kunde inte hämtas — personernas andra bolag söktes inte.');
        company.extraCalls = { owner_engagements: 0 };
      }
    }
    company.fetchedParts = fetchedParts;
    company.noRecordParts = noRecordParts;
    return company;
  }
});
