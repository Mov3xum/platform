import 'server-only';
import type { IntegrationHandler, NormalizedRecord } from '../../types';
import { IntegrationFetchError } from '../../http';
import {
  createHowspaceClient,
  type HowspaceMe,
  type HowspaceParticipantStats,
  type HowspaceWorkspace,
  type HowspaceWorkspaceList
} from './client';
import { normalizeWorkspace, normalizeWorkspaceStats } from './normalize';

const WORKSPACE_FETCH_LIMIT = 50;

export const howspaceHandler: IntegrationHandler = {
  slug: 'howspace',
  residency: 'Finland (EU)',
  riskClass: 'limited',
  complianceNote:
    'Howspace AI-insights klassas som begränsad risk enligt EU AI Act art. 50. Vi synkar bara aggregerade deltagarräkningar och workspace-metadata — inga deltagarnamn, e-postadresser eller post-innehåll lagras hos oss.',
  credentialFields: [
    {
      key: 'api_token',
      label: 'Howspace API-token',
      type: 'password',
      required: true,
      help: 'Genereras av en Howspace-admin under Settings → Integrations → API. Bearer-token med läsbehörighet på workspaces och participants.'
    }
  ],

  async testConnection(creds) {
    const token = creds.api_token?.trim();
    if (!token) return { ok: false, error: 'API-token saknas.' };
    try {
      const client = createHowspaceClient(token);
      await client<HowspaceMe>('/me');
      return { ok: true };
    } catch (err) {
      if (err instanceof IntegrationFetchError) {
        if (err.status === 401 || err.status === 403) {
          return { ok: false, error: 'API-token avvisades av Howspace (401/403).' };
        }
        if (err.status === 404) {
          return {
            ok: false,
            error: 'Howspace API svarade 404 — bekräfta att kontot har API-åtkomst aktiverat.'
          };
        }
        return { ok: false, error: `Howspace svarade ${err.status}.` };
      }
      return { ok: false, error: 'Kunde inte nå Howspace (nätverksfel).' };
    }
  },

  async sync(creds) {
    const token = creds.api_token?.trim();
    if (!token) throw new Error('API-token saknas.');
    const client = createHowspaceClient(token);
    const syncedAt = new Date().toISOString();
    const records: NormalizedRecord[] = [];

    const wsResponse = await client<HowspaceWorkspaceList>('/workspaces', {
      query: { limit: WORKSPACE_FETCH_LIMIT }
    });
    const workspaces: HowspaceWorkspace[] =
      wsResponse.workspaces ?? wsResponse.data ?? [];

    for (const ws of workspaces) {
      records.push(normalizeWorkspace(ws));

      // Fetch aggregate participant counts only — never names/emails.
      try {
        const stats = await client<HowspaceParticipantStats>(
          `/workspaces/${encodeURIComponent(ws.id)}/participants/stats`
        );
        records.push(normalizeWorkspaceStats(ws.id, ws.name, stats, syncedAt));
      } catch {
        // Stats endpoint optional per workspace — skip silently.
      }
    }

    return records;
  }
};
