import 'server-only';
import { createCompanyRegistryHandler } from '../../company-registry/handler-factory';
import { mapBolagStatus, type RegistryCompany } from '../../company-registry/types';
import type { CompanyRegistryHandler } from '../../types';
import {
  AllabolagNotImplementedError,
  fetchCompanyByOrgNr,
  isProviderConfigured
} from './client';
import { buildFinancialsPatches, buildStartupPatch } from './normalize';

// Allabolag-stubben (CLAUDE.md § 11.3) — körs numera genom samma fabrik som
// Roaring/Bolagsverket (§ 11.8) så skrivvägen (writer.ts) är EN. Beteendet är
// oförändrat: 'mock' ger en deterministisk fixtur; övriga lägen kastar
// AllabolagNotImplementedError tills en riktig leverantör pluggas in — i
// praktiken är Roaring/Bolagsverket-providrarna den vägen.

export const allabolagHandler: CompanyRegistryHandler = createCompanyRegistryHandler({
  slug: 'allabolag',
  source: 'allabolag',
  residency: 'Sverige (EU)',
  riskClass: 'minimal',
  complianceNote:
    'Publik bolagsdata från svenska källor (Bolagsverket-derivat). Inga personuppgifter för aktiebolag. För enskild firma exkluderas org_nr från AI-prompts (CLAUDE.md § 9.3).',
  credentialFields: [
    {
      key: 'note',
      label: 'Anteckning',
      type: 'text',
      required: false,
      help: 'Allabolag-leverantör styrs via MOVEXUM_ALLABOLAG_PROVIDER på servern. Det här fältet är bara en valfri anteckning för audit.'
    }
  ],

  parts: ['basic', 'financials'],
  async testConnection() {
    if (!isProviderConfigured()) {
      return {
        ok: false,
        error:
          'MOVEXUM_ALLABOLAG_PROVIDER är inte satt på servern. Kontakta plattformsadmin.'
      };
    }
    return { ok: true };
  },

  async fetchCompany(orgNr, creds): Promise<RegistryCompany> {
    let company;
    try {
      company = await fetchCompanyByOrgNr(orgNr, creds);
    } catch (err) {
      if (err instanceof AllabolagNotImplementedError) throw new Error(err.message);
      throw err;
    }
    const raw = buildStartupPatch(company);
    return {
      org_nr: orgNr,
      isPersonal: company.isPersonal,
      startup: {
        bolagsform: raw.bolagsform,
        kommun: raw.kommun,
        industri: raw.industri,
        bolag_status: mapBolagStatus(raw.bolag_status)
      },
      financials: buildFinancialsPatches(company),
      ownership: [],
      notes: ['Allabolag-stubben levererar ingen ägarbild.']
    };
  }
});
