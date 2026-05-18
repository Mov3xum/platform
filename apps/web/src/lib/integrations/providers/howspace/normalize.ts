import 'server-only';
import type { NormalizedRecord } from '../../types';
import type { HowspaceParticipantStats, HowspaceWorkspace } from './client';

// Howspace → NormalizedRecord. Participant data is reduced to counts
// only — no participant names, emails or post bodies leave Howspace
// (CLAUDE.md § 10.2 GDPR § 5).

export function normalizeWorkspace(ws: HowspaceWorkspace): NormalizedRecord {
  const occurred = ws.updatedAt || ws.createdAt || new Date().toISOString();
  return {
    externalId: ws.id,
    recordType: 'workspace',
    title: ws.name,
    summary: ws.description?.slice(0, 240) || (ws.status ? `Status: ${ws.status}` : ''),
    url: ws.url || `https://app.howspace.com/workspace/${ws.id}`,
    occurredAt: occurred,
    payload: {
      status: ws.status || '',
      participantCount: ws.participantCount ?? 0
    }
  };
}

export function normalizeWorkspaceStats(
  workspaceId: string,
  workspaceName: string,
  stats: HowspaceParticipantStats,
  syncedAt: string
): NormalizedRecord {
  return {
    externalId: `${workspaceId}:stats`,
    recordType: 'workspace_stats',
    title: `${workspaceName} – deltagarstatistik`,
    summary: `${stats.total ?? 0} totalt · ${stats.active ?? 0} aktiva (anonymiserad)`,
    url: `https://app.howspace.com/workspace/${workspaceId}`,
    occurredAt: syncedAt,
    payload: {
      total: stats.total ?? 0,
      active: stats.active ?? 0
    }
  };
}
