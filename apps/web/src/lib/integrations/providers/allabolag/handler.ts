import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '../../credentials';
import { escFilter } from '../../../pb-filter';
import type {
  CompanyRegistryHandler,
  RegistrySyncResult,
  SyncContext
} from '../../types';
import {
  AllabolagNotImplementedError,
  fetchCompanyByOrgNr,
  isProviderConfigured
} from './client';
import {
  buildFinancialsPatches,
  buildStartupPatch,
  type FinancialsPatch
} from './normalize';

interface StartupRow {
  id: string;
  tenant: string;
  org_nr?: string;
}

interface FinancialsRow {
  id: string;
}

async function listStartupsWithOrgNr(
  pb: PocketBase,
  tenantId: string
): Promise<StartupRow[]> {
  const out: StartupRow[] = [];
  let page = 1;
  while (true) {
    const result = await pb
      .collection('startups')
      .getList<StartupRow>(page, 200, {
        filter: `tenant = "${escFilter(tenantId)}" && org_nr != ""`,
        sort: 'name',
        fields: 'id,tenant,org_nr'
      });
    out.push(...result.items);
    if (result.items.length < 200 || page * 200 >= result.totalItems) break;
    page++;
  }
  return out;
}

async function upsertFinancialsRow(
  pb: PocketBase,
  tenantId: string,
  startupId: string,
  row: FinancialsPatch,
  syncedAt: string
): Promise<'created' | 'updated'> {
  const filter = `startup = "${escFilter(startupId)}" && year = ${row.year}`;
  let existing: FinancialsRow | null = null;
  try {
    existing = await pb
      .collection('startup_financials')
      .getFirstListItem<FinancialsRow>(filter);
  } catch {
    existing = null;
  }

  const payload: Record<string, unknown> = {
    tenant: tenantId,
    startup: startupId,
    year: row.year,
    employees: row.employees,
    revenue_sek: row.revenue_sek,
    personnel_cost_sek: row.personnel_cost_sek,
    corporate_tax_sek: row.corporate_tax_sek,
    source: 'allabolag',
    synced_at: syncedAt
  };

  if (existing) {
    await pb.collection('startup_financials').update(existing.id, payload);
    return 'updated';
  }
  try {
    await pb.collection('startup_financials').create(payload);
    return 'created';
  } catch (err) {
    // Race: en parallell sync hann skapa raden (unique-index migration
    // 59). Read-after-write och uppdatera istället.
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: number }).status
        : 0;
    if (status === 400) {
      const retry = await pb
        .collection('startup_financials')
        .getFirstListItem<FinancialsRow>(filter);
      await pb.collection('startup_financials').update(retry.id, payload);
      return 'updated';
    }
    throw err;
  }
}

async function syncOneStartup(
  pb: PocketBase,
  tenantId: string,
  startup: StartupRow,
  creds: Record<string, string>,
  syncedAt: string
): Promise<{ updatedStartup: boolean; upserted: number }> {
  if (!startup.org_nr) return { updatedStartup: false, upserted: 0 };
  const company = await fetchCompanyByOrgNr(startup.org_nr, creds);

  const startupPatch = buildStartupPatch(company);
  let updatedStartup = false;
  if (Object.keys(startupPatch).length > 0) {
    await pb.collection('startups').update(startup.id, startupPatch);
    updatedStartup = true;
  }

  let upserted = 0;
  for (const row of buildFinancialsPatches(company)) {
    try {
      await upsertFinancialsRow(pb, tenantId, startup.id, row, syncedAt);
      upserted++;
    } catch (err) {
      console.error('[allabolag] financials upsert failed', {
        startupId: startup.id,
        year: row.year,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return { updatedStartup, upserted };
}

export const allabolagHandler: CompanyRegistryHandler = {
  slug: 'allabolag',
  kind: 'company_registry',
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

  async syncRegistry(creds, ctx: SyncContext): Promise<RegistrySyncResult> {
    const adminResult = await getSuperuserPb();
    if (!adminResult.ok) {
      throw new Error('Superuser-credentials saknas.');
    }
    const pb = adminResult.pb;

    const startups = await listStartupsWithOrgNr(pb, ctx.tenantId);
    const syncedAt = new Date().toISOString();
    const perStartupErrors: Array<{ startupId: string; error: string }> = [];
    let startupsUpdated = 0;
    let financialsUpserted = 0;
    let skipped = 0;

    for (const startup of startups) {
      try {
        const result = await syncOneStartup(pb, ctx.tenantId, startup, creds, syncedAt);
        if (result.updatedStartup) startupsUpdated++;
        financialsUpserted += result.upserted;
      } catch (err) {
        skipped++;
        const message =
          err instanceof AllabolagNotImplementedError
            ? err.message
            : err instanceof Error
              ? err.message.slice(0, 200)
              : 'Okänt fel';
        perStartupErrors.push({ startupId: startup.id, error: message });
      }
    }

    return { startupsUpdated, financialsUpserted, skipped, perStartupErrors };
  },

  async syncSingleStartup(
    creds,
    ctx: SyncContext,
    startupId: string
  ): Promise<RegistrySyncResult> {
    const adminResult = await getSuperuserPb();
    if (!adminResult.ok) {
      throw new Error('Superuser-credentials saknas.');
    }
    const pb = adminResult.pb;

    let startup: StartupRow;
    try {
      startup = await pb
        .collection('startups')
        .getOne<StartupRow>(startupId, { fields: 'id,tenant,org_nr' });
    } catch {
      return {
        startupsUpdated: 0,
        financialsUpserted: 0,
        skipped: 1,
        perStartupErrors: [{ startupId, error: 'Bolaget hittades inte.' }]
      };
    }
    if (startup.tenant !== ctx.tenantId) {
      // Defense-in-depth — server action ska redan ha verifierat detta.
      return {
        startupsUpdated: 0,
        financialsUpserted: 0,
        skipped: 1,
        perStartupErrors: [{ startupId, error: 'Tenant-mismatch.' }]
      };
    }
    if (!startup.org_nr) {
      return {
        startupsUpdated: 0,
        financialsUpserted: 0,
        skipped: 1,
        perStartupErrors: [{ startupId, error: 'Bolaget saknar org_nr.' }]
      };
    }

    const syncedAt = new Date().toISOString();
    try {
      const result = await syncOneStartup(pb, ctx.tenantId, startup, creds, syncedAt);
      return {
        startupsUpdated: result.updatedStartup ? 1 : 0,
        financialsUpserted: result.upserted,
        skipped: 0
      };
    } catch (err) {
      const message =
        err instanceof AllabolagNotImplementedError
          ? err.message
          : err instanceof Error
            ? err.message.slice(0, 200)
            : 'Okänt fel';
      return {
        startupsUpdated: 0,
        financialsUpserted: 0,
        skipped: 1,
        perStartupErrors: [{ startupId, error: message }]
      };
    }
  }
};
