import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '../credentials';
import { escFilter } from '../../pb-filter';
import type {
  CompanyRegistryHandler,
  CredentialField,
  RegistrySyncResult,
  SyncContext,
  TestConnectionResult
} from '../types';
import { isPersonalOrgNr, normalizeOrgNr } from './orgnr';
import type { RegistryCompany, RegistrySource } from './types';
import { applyRegistryCompany } from './writer';

// Fabrik för bolagsregister-handlers (CLAUDE.md § 11.8). En provider
// implementerar BARA `fetchCompany(orgNr, creds)` (+ testConnection); listning
// av tenantens bolag, tenant-verifiering, skrivning (writer.ts) och
// felaggregering är gemensamma — så Roaring, Bolagsverket och Allabolag-
// stubben inte har varsin kopia av samma orkestrering.
//
// Enskild firma: org-nr är ett personnummer-derivat (§ 9.3). Providern får
// hämta grunddata (publik), men fabriken markerar `isPersonal` och skriver
// ALDRIG ägarbild för sådana bolag (ägaren ÄR personen).

export interface CompanyRegistrySpec {
  slug: string;
  source: RegistrySource;
  residency: string;
  riskClass: 'minimal' | 'limited' | 'high';
  complianceNote: string;
  credentialFields: CredentialField[];
  /** Verifierar inloggningsuppgifterna mot leverantören utan att skriva något. */
  testConnection(creds: Record<string, string>): Promise<TestConnectionResult>;
  /** Hämtar + normaliserar ett bolag. `orgNr` är alltid 10 siffror. */
  fetchCompany(orgNr: string, creds: Record<string, string>): Promise<RegistryCompany>;
  /** Paus mellan bolag vid portföljsynk (leverantörens rate-limit). */
  throttleMs?: number;
}

interface StartupRow {
  id: string;
  tenant: string;
  org_nr?: string;
}

const PAGE = 200;

async function listStartupsWithOrgNr(pb: PocketBase, tenantId: string): Promise<StartupRow[]> {
  const out: StartupRow[] = [];
  let page = 1;
  while (true) {
    const result = await pb.collection('startups').getList<StartupRow>(page, PAGE, {
      filter: `tenant = "${escFilter(tenantId)}" && org_nr != ""`,
      sort: 'name',
      fields: 'id,tenant,org_nr'
    });
    out.push(...result.items);
    if (result.items.length < PAGE || page * PAGE >= result.totalItems) break;
    page++;
  }
  return out;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return 'Okänt fel';
}

function emptyResult(startupId: string, error: string): RegistrySyncResult {
  return {
    startupsUpdated: 0,
    financialsUpserted: 0,
    ownershipWritten: 0,
    skipped: 1,
    perStartupErrors: [{ startupId, error }]
  };
}

export function createCompanyRegistryHandler(spec: CompanyRegistrySpec): CompanyRegistryHandler {
  async function syncOne(
    pb: PocketBase,
    tenantId: string,
    startup: StartupRow,
    creds: Record<string, string>,
    syncedAt: string
  ) {
    const orgNr = normalizeOrgNr(startup.org_nr);
    if (!orgNr) throw new Error('Ogiltigt organisationsnummer på bolagskortet.');
    const company = await spec.fetchCompany(orgNr, creds);
    if (isPersonalOrgNr(orgNr) || company.isPersonal) {
      // Enskild firma: ingen ägarbild (ägaren är en fysisk person = PII).
      company.ownership = [];
      company.isPersonal = true;
    }
    return applyRegistryCompany(pb, tenantId, startup.id, company, spec.source, syncedAt);
  }

  return {
    slug: spec.slug,
    kind: 'company_registry',
    residency: spec.residency,
    riskClass: spec.riskClass,
    complianceNote: spec.complianceNote,
    credentialFields: spec.credentialFields,
    testConnection: (creds) => spec.testConnection(creds),

    async lookup(orgNrRaw, creds) {
      const orgNr = normalizeOrgNr(orgNrRaw);
      if (!orgNr) throw new Error('Ogiltigt organisationsnummer (10 siffror krävs).');
      const company = await spec.fetchCompany(orgNr, creds);
      if (isPersonalOrgNr(orgNr) || company.isPersonal) {
        company.isPersonal = true;
        company.ownership = [];
        company.notes.push('Enskild firma: ägarbild hämtas/lagras inte (org-nr = personnummer).');
      }
      return company;
    },

    async syncRegistry(creds, ctx: SyncContext): Promise<RegistrySyncResult> {
      const adminResult = await getSuperuserPb();
      if (!adminResult.ok) throw new Error('Superuser-credentials saknas.');
      const pb = adminResult.pb;

      const startups = await listStartupsWithOrgNr(pb, ctx.tenantId);
      const syncedAt = new Date().toISOString();
      const perStartupErrors: Array<{ startupId: string; error: string }> = [];
      let startupsUpdated = 0;
      let financialsUpserted = 0;
      let ownershipWritten = 0;
      let skipped = 0;

      for (const startup of startups) {
        try {
          const r = await syncOne(pb, ctx.tenantId, startup, creds, syncedAt);
          if (r.startupUpdated) startupsUpdated++;
          financialsUpserted += r.financialsUpserted;
          ownershipWritten += r.ownershipWritten;
          if (r.errors.length > 0) {
            perStartupErrors.push({ startupId: startup.id, error: r.errors.join('; ').slice(0, 200) });
          }
        } catch (err) {
          skipped++;
          perStartupErrors.push({ startupId: startup.id, error: errorMessage(err) });
        }
        if (spec.throttleMs) {
          await new Promise((r) => setTimeout(r, spec.throttleMs));
        }
      }

      return { startupsUpdated, financialsUpserted, ownershipWritten, skipped, perStartupErrors };
    },

    async syncSingleStartup(creds, ctx: SyncContext, startupId: string): Promise<RegistrySyncResult> {
      const adminResult = await getSuperuserPb();
      if (!adminResult.ok) throw new Error('Superuser-credentials saknas.');
      const pb = adminResult.pb;

      let startup: StartupRow;
      try {
        startup = await pb
          .collection('startups')
          .getOne<StartupRow>(startupId, { fields: 'id,tenant,org_nr' });
      } catch {
        return emptyResult(startupId, 'Bolaget hittades inte.');
      }
      // Defense-in-depth — server action ska redan ha verifierat tenant.
      if (startup.tenant !== ctx.tenantId) return emptyResult(startupId, 'Tenant-mismatch.');
      if (!startup.org_nr) return emptyResult(startupId, 'Bolaget saknar org_nr.');

      const syncedAt = new Date().toISOString();
      try {
        const r = await syncOne(pb, ctx.tenantId, startup, creds, syncedAt);
        return {
          startupsUpdated: r.startupUpdated ? 1 : 0,
          financialsUpserted: r.financialsUpserted,
          ownershipWritten: r.ownershipWritten,
          skipped: 0,
          perStartupErrors:
            r.errors.length > 0
              ? [{ startupId, error: r.errors.join('; ').slice(0, 200) }]
              : undefined
        };
      } catch (err) {
        return emptyResult(startupId, errorMessage(err));
      }
    }
  };
}
