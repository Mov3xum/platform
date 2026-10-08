import 'server-only';
import { createCompanyRegistryHandler } from '../../company-registry/handler-factory';
import { isPersonalOrgNr } from '../../company-registry/orgnr';
import type { RegistryPartId } from '../../company-registry/parts';
import type { CompanyRegistryHandler } from '../../types';
import {
  readRoaringCredentials,
  roaringAmountMultiplier,
  roaringGetFirst,
  roaringHost,
  roaringToken,
  ROARING_PATHS,
  type RoaringFetchOutcome
} from './client';
import { describeRecordKeys, normalizeRoaringCompany, type RoaringRawBundle } from './normalize';

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

// Roaring — bolagsregister-provider (CLAUDE.md § 11.8). Hämtar upp till fyra
// API:er per bolag (grunddata, bokslut, koncernstruktur, verklig huvudman) —
// bara de personalen valt — och normaliserar till RegistryCompany. Valda
// grunddata är blockerande — felar det felar bolaget; de övriga är fail-soft
// med not i `notes` och räknas inte som hämtade (`fetchedParts`).
//
// Riskklass: begränsad (EU AI Act art. 11) — ingen AI, men verklig huvudman
// är personuppgifter hos leverantören. Vi läser dem transient och lagrar
// bara andel/kontrollgrund (aldrig namn/personnummer), se normalize.ts.

export const roaringHandler: CompanyRegistryHandler = createCompanyRegistryHandler({
  slug: 'roaring',
  source: 'roaring',
  residency: 'Sverige (EU)',
  riskClass: 'limited',
  complianceNote:
    'Roaring AB (Stockholm) levererar bolagsdata från Bolagsverket, SCB och Skatteverket. Vi lagrar grunddata, bokslutsposter och ägarbild. Fysiska personer i ägarbilden (verklig huvudman) lagras ENBART som andel/kontrollintervall — inga namn, födelsedatum eller personnummer. Enskild firma synkas utan ägarbild. DPA med Roaring krävs innan produktion (CLAUDE.md § 10.3 A.5.19).',
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
      help: 'Lämna tom för https://api.roaring.io. Sandbox-nycklar ger bara Roarings fiktiva testobjekt — får ni riktiga bolagsuppgifter för ett riktigt org-nr är nycklarna produktionsnycklar och anropen debiteras.'
    }
  ],
  throttleMs: 250,
  parts: ['basic', 'financials', 'group_structure', 'beneficial_owners'],
  // Första kandidaten per API (env vinner) — visas vid kryssrutorna så
  // personalen ser exakt vilket Roaring-API varje val anropar.
  partEndpoints: () => ({
    basic: ROARING_PATHS.overview()[0],
    financials: ROARING_PATHS.financials()[0],
    group_structure: ROARING_PATHS.groupStructure()[0],
    beneficial_owners: ROARING_PATHS.beneficialOwners()[0]
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
      want('financials') ? roaringGetFirst(c, ROARING_PATHS.financials(), orgNr) : Promise.resolve(null),
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
    const softNotes: string[] = [];
    const take = (
      part: RegistryPartId,
      label: string,
      outcome: RoaringFetchOutcome | null,
      assign: (data: unknown) => void
    ) => {
      if (!outcome) return;
      softNotes.push(responseNote(label, outcome));
      if (!outcome.ok) return;
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
    company.notes.push(`Anropen gick till ${roaringHost(c)}.`, ...softNotes);
    company.fetchedParts = fetchedParts;
    return company;
  }
});
