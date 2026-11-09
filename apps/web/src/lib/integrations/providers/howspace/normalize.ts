/**
 * Howspace → NormalizedRecord — REN modul (ingen IO, inget `server-only`),
 * enhetstestad i `normalize.test.ts`. Fälttolkningen bor i
 * `@platform/shared` (howspace.ts) och delas med `/howspace`-sidan.
 *
 * Deltagardata reduceras till räknare — inga namn, e-postadresser eller
 * inläggstexter lämnar Howspace (CLAUDE.md § 11.4, GDPR § 5).
 */
import {
  HOWSPACE_DEFAULT_APP_URL,
  HOWSPACE_RECORD_TYPES,
  howspaceWorkspaceUrl,
  type HowspaceStatsData,
  type HowspaceWorkspaceData
} from '@platform/shared';
import type { NormalizedRecord } from '../../types';

export function normalizeWorkspace(
  ws: HowspaceWorkspaceData,
  appUrl: string = HOWSPACE_DEFAULT_APP_URL,
  now: string = new Date().toISOString()
): NormalizedRecord {
  const occurred = ws.updatedAt || ws.createdAt || now;
  return {
    externalId: ws.id,
    recordType: HOWSPACE_RECORD_TYPES.workspace,
    title: ws.name,
    summary: ws.description.slice(0, 240) || (ws.status ? `Status: ${ws.status}` : ''),
    url: howspaceWorkspaceUrl(ws.id, ws.url, appUrl),
    occurredAt: occurred,
    payload: {
      status: ws.status,
      participantCount: ws.participantCount ?? 0
    }
  };
}

export function normalizeWorkspaceStats(
  ws: HowspaceWorkspaceData,
  stats: HowspaceStatsData,
  syncedAt: string,
  appUrl: string = HOWSPACE_DEFAULT_APP_URL
): NormalizedRecord {
  return {
    externalId: `${ws.id}:stats`,
    recordType: HOWSPACE_RECORD_TYPES.workspaceStats,
    title: `${ws.name} – deltagarstatistik`,
    summary: `${stats.total ?? 0} totalt · ${stats.active ?? 0} aktiva (anonymiserad)`,
    url: howspaceWorkspaceUrl(ws.id, ws.url, appUrl),
    occurredAt: syncedAt,
    payload: {
      total: stats.total ?? 0,
      active: stats.active ?? 0
    }
  };
}
