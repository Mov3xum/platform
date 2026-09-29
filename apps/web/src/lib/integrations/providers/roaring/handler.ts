import 'server-only';
import { createCompanyRegistryHandler } from '../../company-registry/handler-factory';
import { isPersonalOrgNr } from '../../company-registry/orgnr';
import type { CompanyRegistryHandler } from '../../types';
import {
  readRoaringCredentials,
  roaringAmountMultiplier,
  roaringGet,
  roaringToken,
  ROARING_PATHS
} from './client';
import { normalizeRoaringCompany, type RoaringRawBundle } from './normalize';

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
      help: 'Lämna tom för https://api.roaring.io. Sätt bara för sandbox-miljö.'
    }
  ],
  throttleMs: 250,

  async testConnection(creds) {
    const c = readRoaringCredentials(creds);
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

    const overview = await roaringGet(c, ROARING_PATHS.overview(), orgNr);
    if (!overview.ok) {
      throw new Error(`Roaring grunddata: ${overview.reason}`);
    }

    const [financials, group, beneficial] = await Promise.all([
      roaringGet(c, ROARING_PATHS.financials(), orgNr),
      isPersonal ? Promise.resolve(null) : roaringGet(c, ROARING_PATHS.groupStructure(), orgNr),
      isPersonal ? Promise.resolve(null) : roaringGet(c, ROARING_PATHS.beneficialOwners(), orgNr)
    ]);

    const bundle: RoaringRawBundle = { overview: overview.data };
    const softNotes: string[] = [];
    if (financials.ok) bundle.financials = financials.data;
    else softNotes.push(`Roaring bokslut: ${financials.reason}`);
    if (group) {
      if (group.ok) bundle.groupStructure = group.data;
      else softNotes.push(`Roaring koncernstruktur: ${group.reason}`);
    }
    if (beneficial) {
      if (beneficial.ok) bundle.beneficialOwners = beneficial.data;
      else softNotes.push(`Roaring verklig huvudman: ${beneficial.reason}`);
    }

    const company = normalizeRoaringCompany(orgNr, bundle, {
      amountMultiplier: roaringAmountMultiplier(),
      isPersonal
    });
    company.notes.push(...softNotes);
    return company;
  }
});
