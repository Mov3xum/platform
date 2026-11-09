import 'server-only';
import { HOWSPACE_ALLOWED_HOSTS, HOWSPACE_DEFAULT_API_BASE_URL } from '@platform/shared';
import { createFetchClient } from '../../http';
import { assertAllowedBaseUrl } from '../../company-registry/types';

// Howspace Partner API (CLAUDE.md § 59). Howspace publicerar ingen öppen
// dokumentation — API-URL, nyckel och schema ligger i kontot under
// Settings → Integrations → API. Bas-URL och sökvägar är därför överstyrbara
// så att de kan stämmas av mot kontots dokumentation utan kodändring:
//   creds.base_url (per tenant, krypterat) → env HOWSPACE_API_BASE_URL → default
//   env HOWSPACE_ME_PATH / HOWSPACE_WORKSPACES_PATH / HOWSPACE_STATS_PATH
// Allowlist + https eftersom bearer-tokenen skickas dit (§ 10.3 A.8.9).

function env(name: string, fallback: string): string {
  const v = (process.env[name] || '').trim();
  return v || fallback;
}

export function howspaceBaseUrl(creds: Record<string, string>): string {
  const raw = (creds.base_url || '').trim() || env('HOWSPACE_API_BASE_URL', HOWSPACE_DEFAULT_API_BASE_URL);
  return assertAllowedBaseUrl(raw, HOWSPACE_ALLOWED_HOSTS);
}

export interface HowspacePaths {
  me: string;
  workspaces: string;
  /** `{id}` ersätts med workspace-id. */
  stats: string;
}

export function howspacePaths(): HowspacePaths {
  return {
    me: env('HOWSPACE_ME_PATH', '/me'),
    workspaces: env('HOWSPACE_WORKSPACES_PATH', '/workspaces'),
    stats: env('HOWSPACE_STATS_PATH', '/workspaces/{id}/participants/stats')
  };
}

export function howspaceStatsPath(template: string, workspaceId: string): string {
  return template.replace('{id}', encodeURIComponent(workspaceId));
}

export function createHowspaceClient(apiToken: string, baseUrl: string) {
  return createFetchClient(baseUrl, {
    Authorization: `Bearer ${apiToken}`
  });
}
