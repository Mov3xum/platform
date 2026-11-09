import 'server-only';
import { createCompanyRegistryHandler } from '../../company-registry/handler-factory';
import { isPersonalOrgNr } from '../../company-registry/orgnr';
import type { CompanyRegistryHandler } from '../../types';
import {
  bolagsverketLookup,
  bolagsverketToken,
  readBolagsverketCredentials
} from './client';
import { normalizeBolagsverketCompany } from './normalize';

// Bolagsverket — bolagsregister-provider (CLAUDE.md § 11.8). Primärkälla för
// grunddata: officiellt namn, bolagsform, registreringsdatum (5-årsregeln i
// art. 22 GBER), SNI, status, säte. Ingen ägarbild, inga bokslutsposter.
// Riskklass: minimal — publik registerdata om juridiska personer, ingen AI.

export const bolagsverketHandler: CompanyRegistryHandler = createCompanyRegistryHandler({
  slug: 'bolagsverket',
  source: 'bolagsverket',
  residency: 'Sverige (EU) — svensk myndighet',
  riskClass: 'minimal',
  complianceNote:
    'Bolagsverkets kostnadsfria API för värdefulla datamängder. Publik registerdata om juridiska personer (namn, bolagsform, registreringsdatum, SNI, status, säte) — inga personuppgifter för aktiebolag. För enskild firma är org-nr ett personnummer och exkluderas ur AI-kontexten (CLAUDE.md § 9.3). Ingen tredjelandsöverföring.',
  credentialFields: [
    {
      key: 'client_id',
      label: 'Client ID',
      type: 'text',
      required: true,
      help: 'Erhålls efter kundanmälan till API för värdefulla datamängder på bolagsverket.se.'
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
      help: 'Lämna tom för produktion (https://gw.api.bolagsverket.se). Ange testmiljöns gateway för verifiering.'
    }
  ],
  throttleMs: 200,

  parts: ['basic'],
  async testConnection(creds) {
    let c;
    try {
      c = readBolagsverketCredentials(creds);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Ogiltig bas-URL.' };
    }
    if (!c) return { ok: false, error: 'Client ID och client secret krävs.' };
    try {
      await bolagsverketToken(c);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Kunde inte hämta token.' };
    }
  },

  async fetchCompany(orgNr, creds) {
    const c = readBolagsverketCredentials(creds);
    if (!c) throw new Error('Bolagsverket: client ID/secret saknas.');
    const outcome = await bolagsverketLookup(c, orgNr);
    if (!outcome.ok) throw new Error(`Bolagsverket: ${outcome.reason}`);
    return normalizeBolagsverketCompany(orgNr, outcome.data, isPersonalOrgNr(orgNr));
  }
});
