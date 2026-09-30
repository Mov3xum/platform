import 'server-only';
import { createCompanyRegistryHandler } from '../../company-registry/handler-factory';
import { isPersonalOrgNr } from '../../company-registry/orgnr';
import type { CompanyRegistryHandler } from '../../types';
import {
  readRoaringCredentials,
  roaringAmountMultiplier,
  roaringGetFirst,
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

// Roaring — bolagsregister-provider (CLAUDE.md § 11.8). Hämtar fyra API:er
// per bolag (grunddata, bokslut, koncernstruktur, verklig huvudman) och
// normaliserar till RegistryCompany. Grunddata (overview) är obligatoriskt —
// felar det felar bolaget; de övriga är fail-soft med not i `notes`.
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
      help: 'Lämna tom för https://api.roaring.io. Roarings sandbox använder SAMMA adress — det är nyckelparet (sandbox- eller produktionsapplikation i utvecklarportalen) som avgör om svaren är testdata.'
    }
  ],
  throttleMs: 250,

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

  async fetchCompany(orgNr, creds) {
    const c = readRoaringCredentials(creds);
    if (!c) throw new Error('Roaring: client ID/secret saknas.');
    const isPersonal = isPersonalOrgNr(orgNr);

    const overview = await roaringGetFirst(c, ROARING_PATHS.overview(), orgNr);
    if (!overview.ok) {
      throw new Error(`Roaring grunddata (${overview.path}): ${overview.reason}`);
    }

    const [financials, group, beneficial] = await Promise.all([
      roaringGetFirst(c, ROARING_PATHS.financials(), orgNr),
      isPersonal ? Promise.resolve(null) : roaringGetFirst(c, ROARING_PATHS.groupStructure(), orgNr),
      isPersonal ? Promise.resolve(null) : roaringGetFirst(c, ROARING_PATHS.beneficialOwners(), orgNr)
    ]);

    const bundle: RoaringRawBundle = { overview: overview.data };
    const softNotes: string[] = [responseNote('grunddata', overview)];
    if (financials.ok) bundle.financials = financials.data;
    softNotes.push(responseNote('bokslut', financials));
    if (group) {
      if (group.ok) bundle.groupStructure = group.data;
      softNotes.push(responseNote('koncernstruktur', group));
    }
    if (beneficial) {
      if (beneficial.ok) bundle.beneficialOwners = beneficial.data;
      softNotes.push(responseNote('verklig huvudman', beneficial));
    }

    const company = normalizeRoaringCompany(orgNr, bundle, {
      amountMultiplier: roaringAmountMultiplier(),
      isPersonal
    });
    company.notes.push(...softNotes);
    return company;
  }
});
