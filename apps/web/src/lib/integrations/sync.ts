import 'server-only';
import type PocketBase from 'pocketbase';
import { escFilter } from '@/lib/pb-filter';
import { getSuperuserPb, loadCredentialsResult } from './credentials';
import { describeCredentialFailure } from './credential-errors';
import { getHandler } from './registry';
import { describeRegistryParts, type RegistryPartId } from './company-registry/parts';
import { registrySyncStatus, summarizeRegistrySkips } from './company-registry/sync-errors';
import type {
  CompanyRegistryHandler,
  IntegrationHandler,
  NormalizedRecord,
  RegistrySyncResult,
  SyncContext,
  SyncResult
} from './types';

// runSync is the only entry point that produces integration_records
// and integration_sync_runs. Idempotency comes from the unique index
// (tenant_integration, record_type, external_id) declared in
// 1700000054_create_integration_records.js. The function never
// throws — failures are recorded on the sync_run row and surfaced
// via SyncResult.

interface TenantIntegrationRecord {
  id: string;
  tenant: string;
  provider: string;
  expand?: {
    provider?: { id: string; slug: string };
  };
}

interface ExistingRecord {
  id: string;
}

function toError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message).slice(0, 500);
  }
  return 'Okänt fel';
}

async function upsertRecord(
  pb: PocketBase,
  tenantId: string,
  tenantIntegrationId: string,
  providerSlug: string,
  rec: NormalizedRecord,
  syncedAt: string
): Promise<'created' | 'updated' | 'skipped'> {
  // record_type/external_id kommer från extern leverantörsdata → escapas
  // (filter-injection mot superuser-PB, CLAUDE.md § 10.3 A.8.9).
  const filter =
    `tenant_integration = "${escFilter(tenantIntegrationId)}" && ` +
    `record_type = "${escFilter(rec.recordType)}" && ` +
    `external_id = "${escFilter(rec.externalId)}"`;

  let existing: ExistingRecord | null = null;
  try {
    existing = await pb
      .collection('integration_records')
      .getFirstListItem<ExistingRecord>(filter);
  } catch {
    existing = null;
  }

  const payload: Record<string, unknown> = {
    tenant: tenantId,
    tenant_integration: tenantIntegrationId,
    provider_slug: providerSlug,
    external_id: rec.externalId,
    record_type: rec.recordType,
    title: rec.title,
    summary: rec.summary,
    url: rec.url,
    occurred_at: rec.occurredAt,
    payload: rec.payload,
    synced_at: syncedAt
  };

  try {
    if (existing) {
      await pb.collection('integration_records').update(existing.id, payload);
      return 'updated';
    }
    await pb.collection('integration_records').create(payload);
    return 'created';
  } catch (err) {
    console.error('[integrations:sync] upsert failed', {
      tenantIntegrationId,
      recordType: rec.recordType,
      externalId: rec.externalId,
      error: toError(err)
    });
    return 'skipped';
  }
}

function summarize(
  providerSlug: string,
  created: number,
  updated: number,
  skipped: number
): string {
  const total = created + updated;
  const parts = [`${total} poster synkade (${created} nya, ${updated} uppdaterade)`];
  if (skipped > 0) parts.push(`${skipped} hoppade över`);
  return `${providerSlug}: ${parts.join(', ')}`;
}

function summarizeRegistry(
  providerSlug: string,
  startupsUpdated: number,
  financialsUpserted: number,
  skipped: number,
  ownershipWritten = 0
): string {
  const parts = [
    `${startupsUpdated} bolag uppdaterade, ${financialsUpserted} årsrader synkade`
  ];
  if (ownershipWritten > 0) parts.push(`${ownershipWritten} ägarrader`);
  if (skipped > 0) parts.push(`${skipped} hoppade över`);
  return `${providerSlug}: ${parts.join(', ')}`;
}

async function runRecordsSync(
  adminPb: PocketBase,
  handler: Extract<IntegrationHandler, { kind?: 'records' }>,
  creds: Record<string, string>,
  tenantId: string,
  tenantIntegrationId: string,
  providerSlug: string
): Promise<{ created: number; updated: number; skipped: number; fetchError: string | null }> {
  let normalizedRecords: NormalizedRecord[] = [];
  let fetchError: string | null = null;
  try {
    normalizedRecords = await handler.sync(creds, {
      tenantId,
      tenantIntegrationId
    });
  } catch (err) {
    fetchError = toError(err);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const syncedAt = new Date().toISOString();
  if (!fetchError) {
    for (const rec of normalizedRecords) {
      const outcome = await upsertRecord(
        adminPb,
        tenantId,
        tenantIntegrationId,
        providerSlug,
        rec,
        syncedAt
      );
      if (outcome === 'created') created++;
      else if (outcome === 'updated') updated++;
      else skipped++;
    }
  }
  return { created, updated, skipped, fetchError };
}

/** "· Valda delar: Grunddata, Bokslut" i audit-sammanfattningen (PII-fri). */
function partsNote(parts: RegistryPartId[] | undefined): string {
  return parts && parts.length > 0 ? ` · Valda delar: ${describeRegistryParts(parts)}` : '';
}

/** Valfria inställningar för en synk. */
export interface SyncOptions {
  /** Bolagsregister: datadelar att hämta (§ 11.8). Utelämnat = alla. */
  parts?: RegistryPartId[];
}

// Registry-providers (Allabolag etc.) skip integration_records and
// write directly to startups + startup_financials. The orchestrator
// still records an integration_sync_runs row for audit (CLAUDE.md
// § 11.2). Errors per startup are aggregated into `skipped` plus a
// PII-free first-error string surfaced to the user.
async function runRegistrySync(
  handler: CompanyRegistryHandler,
  creds: Record<string, string>,
  ctx: SyncContext
): Promise<{
  startupsUpdated: number;
  financialsUpserted: number;
  ownershipWritten: number;
  skipped: number;
  fetchError: string | null;
  skipSummary: string;
}> {
  try {
    const result = await handler.syncRegistry(creds, ctx);
    // Orsaken per bolag sparas i synk-loggen — annars syns bara "partial"/
    // "failed" utan förklaring. Meddelandena är PII-fria (sökväg + orsak).
    const skipSummary = summarizeRegistrySkips(result.perStartupErrors ?? [], result.startupsTotal);
    if (skipSummary) {
      console.warn('[integrations:sync] registry startups skipped', {
        provider: handler.slug,
        summary: skipSummary
      });
    }
    return {
      startupsUpdated: result.startupsUpdated,
      financialsUpserted: result.financialsUpserted,
      ownershipWritten: result.ownershipWritten ?? 0,
      skipped: result.skipped,
      fetchError: null,
      skipSummary
    };
  } catch (err) {
    return {
      startupsUpdated: 0,
      financialsUpserted: 0,
      ownershipWritten: 0,
      skipped: 0,
      fetchError: toError(err),
      skipSummary: ''
    };
  }
}

// Per-startup sync entry point. Reused by the "Synka från Allabolag"
// button on /startups/[id]. Tenant verification MUST happen in the
// caller (server action) before this is invoked — see
// CLAUDE.md § 10.5 punkt 5.
export async function runRegistrySyncForStartup(
  tenantIntegrationId: string,
  startupId: string,
  triggeredBy: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const startedAt = new Date();
  const startedIso = startedAt.toISOString();

  const adminResult = await getSuperuserPb();
  if (!adminResult.ok) {
    return {
      runId: '',
      status: 'failed',
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      errorMessage: 'Superuser-credentials saknas på servern.',
      durationMs: Date.now() - startedAt.getTime()
    };
  }
  const adminPb = adminResult.pb;

  let tenantIntegration: TenantIntegrationRecord;
  try {
    tenantIntegration = await adminPb
      .collection('tenant_integrations')
      .getOne<TenantIntegrationRecord>(tenantIntegrationId, {
        expand: 'provider'
      });
  } catch {
    return {
      runId: '',
      status: 'failed',
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      errorMessage: 'Integrationen hittades inte.',
      durationMs: Date.now() - startedAt.getTime()
    };
  }

  const providerSlug = tenantIntegration.expand?.provider?.slug || '';
  const tenantId = tenantIntegration.tenant;

  let syncRunId = '';
  try {
    const run = await adminPb.collection('integration_sync_runs').create({
      tenant: tenantId,
      tenant_integration: tenantIntegrationId,
      provider_slug: providerSlug,
      status: 'started',
      triggered_by: triggeredBy,
      started_at: startedIso,
      records_created: 0,
      records_updated: 0,
      records_skipped: 0
    });
    syncRunId = run.id as string;
  } catch (err) {
    console.error('[integrations:sync] failed to create sync_run', {
      tenantIntegrationId,
      error: toError(err)
    });
  }

  const handler = getHandler(providerSlug);
  if (!handler || handler.kind !== 'company_registry') {
    const errorMessage =
      'Per-startup-synk stöds bara för bolagsregister-providers.';
    if (syncRunId) {
      try {
        await adminPb.collection('integration_sync_runs').update(syncRunId, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt.getTime(),
          error_message: errorMessage
        });
      } catch {
        /* ignore */
      }
    }
    return {
      runId: syncRunId,
      status: 'failed',
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      errorMessage,
      durationMs: Date.now() - startedAt.getTime()
    };
  }

  const loaded = await loadCredentialsResult(tenantIntegrationId);
  if (!loaded.ok) {
    const errorMessage = describeCredentialFailure(loaded.reason);
    if (syncRunId) {
      try {
        await adminPb.collection('integration_sync_runs').update(syncRunId, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt.getTime(),
          error_message: errorMessage
        });
      } catch {
        /* ignore */
      }
    }
    return {
      runId: syncRunId,
      status: 'failed',
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      errorMessage,
      durationMs: Date.now() - startedAt.getTime()
    };
  }

  let result: RegistrySyncResult;
  let fetchError: string | null = null;
  try {
    result = await handler.syncSingleStartup(
      loaded.value,
      { tenantId, tenantIntegrationId, parts: options.parts },
      startupId
    );
  } catch (err) {
    fetchError = toError(err);
    result = { startupsUpdated: 0, financialsUpserted: 0, skipped: 0 };
  }

  // Ett bolag: handlern fångar bolagets fel i perStartupErrors i stället för
  // att kasta. Kunde bolaget inte hämtas alls (skipped) är synken misslyckad
  // och orsaken ska fram till bolagskortet — inte svälja som "Synk klar".
  const startupError = result.perStartupErrors?.[0]?.error;
  if (!fetchError && result.skipped > 0) fetchError = startupError || 'Bolaget kunde inte synkas.';
  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const status: SyncResult['status'] = fetchError
    ? 'failed'
    : startupError
      ? 'partial'
      : 'success';
  const summary = fetchError
    ? `${providerSlug}: synk misslyckades (per-startup)`
    : summarizeRegistry(
        providerSlug,
        result.startupsUpdated,
        result.financialsUpserted,
        result.skipped,
        result.ownershipWritten ?? 0
      ) + partsNote(options.parts);

  if (syncRunId) {
    try {
      await adminPb.collection('integration_sync_runs').update(syncRunId, {
        status,
        finished_at: finishedAt.toISOString(),
        duration_ms: durationMs,
        records_created: result.financialsUpserted,
        records_updated: result.startupsUpdated,
        records_skipped: result.skipped,
        error_message: (fetchError || startupError || '').slice(0, 500)
      });
    } catch {
      /* ignore */
    }
  }

  try {
    await adminPb.collection('tenant_integrations').update(tenantIntegrationId, {
      last_sync_at: finishedAt.toISOString(),
      last_sync_status: status,
      last_sync_summary: summary.slice(0, 500)
    });
  } catch {
    /* ignore */
  }

  return {
    runId: syncRunId,
    status,
    recordsCreated: result.financialsUpserted,
    recordsUpdated: result.startupsUpdated,
    recordsSkipped: result.skipped,
    errorMessage: fetchError || startupError || undefined,
    durationMs
  };
}

export async function runSync(
  tenantIntegrationId: string,
  triggeredBy: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const startedAt = new Date();
  const startedIso = startedAt.toISOString();

  const adminResult = await getSuperuserPb();
  if (!adminResult.ok) {
    return {
      runId: '',
      status: 'failed',
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      errorMessage: 'Superuser-credentials saknas på servern.',
      durationMs: Date.now() - startedAt.getTime()
    };
  }
  const adminPb = adminResult.pb;

  let tenantIntegration: TenantIntegrationRecord;
  try {
    tenantIntegration = await adminPb
      .collection('tenant_integrations')
      .getOne<TenantIntegrationRecord>(tenantIntegrationId, {
        expand: 'provider'
      });
  } catch {
    return {
      runId: '',
      status: 'failed',
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      errorMessage: 'Integrationen hittades inte.',
      durationMs: Date.now() - startedAt.getTime()
    };
  }

  const providerSlug = tenantIntegration.expand?.provider?.slug || '';
  const tenantId = tenantIntegration.tenant;

  let syncRunId = '';
  try {
    const run = await adminPb.collection('integration_sync_runs').create({
      tenant: tenantId,
      tenant_integration: tenantIntegrationId,
      provider_slug: providerSlug,
      status: 'started',
      triggered_by: triggeredBy,
      started_at: startedIso,
      records_created: 0,
      records_updated: 0,
      records_skipped: 0
    });
    syncRunId = run.id as string;
  } catch (err) {
    console.error('[integrations:sync] failed to create sync_run', {
      tenantIntegrationId,
      error: toError(err)
    });
  }

  const handler = getHandler(providerSlug);
  if (!handler) {
    const errorMessage = `Saknar handler för leverantör "${providerSlug}".`;
    if (syncRunId) {
      try {
        await adminPb.collection('integration_sync_runs').update(syncRunId, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt.getTime(),
          error_message: errorMessage
        });
      } catch {
        /* ignore */
      }
    }
    return {
      runId: syncRunId,
      status: 'failed',
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      errorMessage,
      durationMs: Date.now() - startedAt.getTime()
    };
  }

  const loaded = await loadCredentialsResult(tenantIntegrationId);
  if (!loaded.ok) {
    const errorMessage = describeCredentialFailure(loaded.reason);
    if (syncRunId) {
      try {
        await adminPb.collection('integration_sync_runs').update(syncRunId, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt.getTime(),
          error_message: errorMessage
        });
      } catch {
        /* ignore */
      }
    }
    return {
      runId: syncRunId,
      status: 'failed',
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsSkipped: 0,
      errorMessage,
      durationMs: Date.now() - startedAt.getTime()
    };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let ownershipWritten = 0;
  let fetchError: string | null = null;
  let skipSummary = '';

  const kind = handler.kind ?? 'records';
  if (kind === 'company_registry') {
    const result = await runRegistrySync(
      handler as CompanyRegistryHandler,
      loaded.value,
      { tenantId, tenantIntegrationId, parts: options.parts }
    );
    fetchError = result.fetchError;
    created = result.financialsUpserted;
    updated = result.startupsUpdated;
    skipped = result.skipped;
    ownershipWritten = result.ownershipWritten;
    skipSummary = result.skipSummary;
  } else {
    const result = await runRecordsSync(
      adminPb,
      handler as Extract<IntegrationHandler, { kind?: 'records' }>,
      loaded.value,
      tenantId,
      tenantIntegrationId,
      providerSlug
    );
    fetchError = result.fetchError;
    created = result.created;
    updated = result.updated;
    skipped = result.skipped;
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const status: SyncResult['status'] = fetchError
    ? 'failed'
    : kind === 'company_registry'
      ? registrySyncStatus({
          startupsUpdated: updated,
          financialsUpserted: created,
          ownershipWritten,
          skipped
        })
      : skipped > 0
        ? 'partial'
        : 'success';
  const summary = fetchError
    ? `${providerSlug}: synk misslyckades`
    : kind === 'company_registry'
      ? summarizeRegistry(providerSlug, updated, created, skipped, ownershipWritten)
      : summarize(providerSlug, created, updated, skipped);
  const summaryWithParts = kind === 'company_registry' ? summary + partsNote(options.parts) : summary;

  if (syncRunId) {
    try {
      await adminPb.collection('integration_sync_runs').update(syncRunId, {
        status,
        finished_at: finishedAt.toISOString(),
        duration_ms: durationMs,
        records_created: created,
        records_updated: updated,
        records_skipped: skipped,
        error_message: (fetchError || skipSummary || '').slice(0, 500)
      });
    } catch (err) {
      console.error('[integrations:sync] failed to close sync_run', {
        syncRunId,
        error: toError(err)
      });
    }
  }

  try {
    await adminPb.collection('tenant_integrations').update(tenantIntegrationId, {
      last_sync_at: finishedAt.toISOString(),
      last_sync_status: status,
      last_sync_summary: summaryWithParts.slice(0, 500)
    });
  } catch (err) {
    console.error('[integrations:sync] failed to update tenant_integration', {
      tenantIntegrationId,
      error: toError(err)
    });
  }

  return {
    runId: syncRunId,
    status,
    recordsCreated: created,
    recordsUpdated: updated,
    recordsSkipped: skipped,
    errorMessage: fetchError || skipSummary || undefined,
    durationMs
  };
}
