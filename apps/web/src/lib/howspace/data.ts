import 'server-only';
import type PocketBase from 'pocketbase';
import {
  buildHowspaceWorkspaceViews,
  type HowspaceSyncedRecord,
  type HowspaceWorkspaceView
} from '@platform/shared';

/**
 * Enda läsvägen för `/howspace` (CLAUDE.md § 59). Läser med användarens
 * token → RLS § 21 gäller (`integration_records`/`tenant_integrations` är
 * staff/observer-scopade). Fail-soft: varje källa som inte kan läsas
 * rapporteras i `notices` och visas som banner — aldrig en tyst tom sida
 * (§ 33.4-principen). Ingen PII: posterna bär bara workspace-metadata och
 * räknare (§ 11.4).
 */

export const HOWSPACE_SLUG = 'howspace';
const RECORDS_PAGE = 200;

interface ProviderRow {
  id: string;
  name: string;
  active?: boolean;
}

interface TenantIntegrationRow {
  id: string;
  status: 'available' | 'pilot_requested' | 'connected' | 'disabled';
  last_sync_at?: string;
  last_sync_status?: 'success' | 'failed' | 'partial';
  last_sync_summary?: string;
}

export interface HowspaceOverview {
  /** Katalograden finns (migration 1700000055/1700000213 körd). */
  providerKnown: boolean;
  connected: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: 'success' | 'failed' | 'partial' | null;
  lastSyncSummary: string | null;
  workspaces: HowspaceWorkspaceView[];
  /** Läsfel/kapning, PII-fria, visas som banner. */
  notices: string[];
}

export async function loadHowspaceOverview(pb: PocketBase, tenantId: string): Promise<HowspaceOverview> {
  const notices: string[] = [];
  let provider: ProviderRow | null = null;
  try {
    provider = await pb
      .collection('integration_providers')
      .getFirstListItem<ProviderRow>(pb.filter('slug = {:slug}', { slug: HOWSPACE_SLUG }), {
        fields: 'id,name,active'
      });
  } catch {
    provider = null;
  }

  let integration: TenantIntegrationRow | null = null;
  if (provider) {
    try {
      integration = await pb
        .collection('tenant_integrations')
        .getFirstListItem<TenantIntegrationRow>(
          pb.filter('tenant = {:tenant} && provider = {:provider}', { tenant: tenantId, provider: provider.id }),
          { fields: 'id,status,last_sync_at,last_sync_status,last_sync_summary' }
        );
    } catch (err) {
      // 404 = inte ansluten (normalt). Andra fel rapporteras.
      const status = (err as { status?: number } | null)?.status;
      if (status && status !== 404) notices.push('Kopplingen till Howspace kunde inte läsas just nu.');
      integration = null;
    }
  }

  const connected = integration?.status === 'connected';
  let workspaces: HowspaceWorkspaceView[] = [];
  if (connected && integration) {
    try {
      const res = await pb.collection('integration_records').getList<HowspaceSyncedRecord>(1, RECORDS_PAGE, {
        filter: pb.filter('tenant = {:tenant} && tenant_integration = {:ti} && provider_slug = {:slug}', {
          tenant: tenantId,
          ti: integration.id,
          slug: HOWSPACE_SLUG
        }),
        sort: 'title',
        fields: 'record_type,external_id,title,summary,url,occurred_at,synced_at,payload'
      });
      workspaces = buildHowspaceWorkspaceViews(res.items);
      if (res.totalItems > res.items.length) {
        notices.push(`Visar ${workspaces.length} workspaces av ${res.totalItems} synkade poster — listan är kapad.`);
      }
    } catch {
      notices.push('De synkade workspace-posterna kunde inte läsas. Prova att ladda om sidan.');
    }
  }

  return {
    providerKnown: provider !== null,
    connected,
    lastSyncAt: integration?.last_sync_at || null,
    lastSyncStatus: integration?.last_sync_status || null,
    lastSyncSummary: integration?.last_sync_summary || null,
    workspaces,
    notices
  };
}
