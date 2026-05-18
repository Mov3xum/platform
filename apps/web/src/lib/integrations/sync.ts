import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb, loadCredentials } from './credentials';
import { getHandler } from './registry';
import type { NormalizedRecord, SyncResult } from './types';

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
  const filter = `tenant_integration = "${tenantIntegrationId}" && record_type = "${rec.recordType}" && external_id = "${rec.externalId}"`;

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

export async function runSync(
  tenantIntegrationId: string,
  triggeredBy: string
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

  const creds = await loadCredentials(tenantIntegrationId);
  if (!creds) {
    const errorMessage = 'Inloggningsuppgifter saknas eller kunde inte dekrypteras.';
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

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const status: SyncResult['status'] = fetchError
    ? 'failed'
    : skipped > 0
      ? 'partial'
      : 'success';
  const summary = fetchError
    ? `${providerSlug}: synk misslyckades`
    : summarize(providerSlug, created, updated, skipped);

  if (syncRunId) {
    try {
      await adminPb.collection('integration_sync_runs').update(syncRunId, {
        status,
        finished_at: finishedAt.toISOString(),
        duration_ms: durationMs,
        records_created: created,
        records_updated: updated,
        records_skipped: skipped,
        error_message: fetchError || ''
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
      last_sync_summary: summary.slice(0, 500)
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
    errorMessage: fetchError || undefined,
    durationMs
  };
}
