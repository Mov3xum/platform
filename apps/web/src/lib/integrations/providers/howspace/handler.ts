import 'server-only';
import {
  HOWSPACE_DEFAULT_APP_URL,
  extractHowspaceList,
  parseHowspaceStats,
  parseHowspaceWorkspace,
  safeHowspaceUrl,
  type HowspaceWorkspaceData
} from '@platform/shared';
import type { IntegrationHandler, NormalizedRecord } from '../../types';
import { IntegrationFetchError } from '../../http';
import { createHowspaceClient, howspaceBaseUrl, howspacePaths, howspaceStatsPath } from './client';
import { normalizeWorkspace, normalizeWorkspaceStats } from './normalize';

// Howspace — collaborative learning (FI/EU), CLAUDE.md § 11.3 + § 59.
// Riskklass: begränsad (Howspaces AI-insights, art. 50). Vi synkar bara
// workspace-metadata och aggregerade deltagarräkningar — aldrig namn,
// e-post eller inläggstext. Howspaces Partner API saknar publik
// dokumentation; bas-URL och sökvägar är därför överstyrbara (client.ts)
// och svaren tolkas tolerant (@platform/shared howspace.ts).

const WORKSPACE_FETCH_LIMIT = 50;

/** Howspace-kontots egen adress (SSO-landning), t.ex. https://movexum.howspace.com. */
export function howspaceAppUrl(): string {
  return safeHowspaceUrl((process.env.HOWSPACE_APP_URL || '').trim()) ?? HOWSPACE_DEFAULT_APP_URL;
}

function describeFetchError(err: unknown): string {
  if (err instanceof IntegrationFetchError) {
    if (err.status === 401 || err.status === 403) {
      return 'API-token avvisades av Howspace (401/403). Kontrollera att nyckeln är aktiv och har läsbehörighet.';
    }
    if (err.status === 404) {
      return 'Howspace svarade 404 — bekräfta API-URL och sökvägar mot dokumentationen i ert Howspace-konto (Settings → Integrations → API).';
    }
    return `Howspace svarade ${err.status}.`;
  }
  if (err instanceof Error && /Bas-URL/.test(err.message)) return err.message;
  return 'Kunde inte nå Howspace (nätverksfel eller tidsgräns).';
}

export const howspaceHandler: IntegrationHandler = {
  slug: 'howspace',
  residency: 'Finland (EU)',
  riskClass: 'limited',
  complianceNote:
    'Howspace AI-insights klassas som begränsad risk enligt EU AI Act art. 50. Vi synkar bara aggregerade deltagarräkningar och workspace-metadata — inga deltagarnamn, e-postadresser eller inläggstexter lagras hos oss. Inloggningen för personalen sker med SSO direkt mot Howspace, inte via plattformen.',
  credentialFields: [
    {
      key: 'api_token',
      label: 'Howspace API-token',
      type: 'password',
      required: true,
      help: 'Genereras av en Howspace-admin under Settings → Integrations → API (Partner API — ingår i vissa paket eller köps som tillägg). Bearer-token med läsbehörighet på workspaces och participants. Krypteras med AES-256-GCM.'
    },
    {
      key: 'base_url',
      label: 'API-URL (valfri)',
      type: 'text',
      required: false,
      help: 'Adressen som står på API-sidan i ert Howspace-konto, t.ex. https://api.howspace.com/v1. Lämna tom för standardadressen. Måste vara https och ligga under howspace.com.'
    }
  ],

  async testConnection(creds) {
    const token = creds.api_token?.trim();
    if (!token) return { ok: false, error: 'API-token saknas.' };
    let baseUrl: string;
    try {
      baseUrl = howspaceBaseUrl(creds);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Ogiltig API-URL.' };
    }
    try {
      const client = createHowspaceClient(token, baseUrl);
      await client<unknown>(howspacePaths().me);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeFetchError(err) };
    }
  },

  async sync(creds) {
    const token = creds.api_token?.trim();
    if (!token) throw new Error('API-token saknas.');
    const baseUrl = howspaceBaseUrl(creds);
    const paths = howspacePaths();
    const appUrl = howspaceAppUrl();
    const client = createHowspaceClient(token, baseUrl);
    const syncedAt = new Date().toISOString();
    const records: NormalizedRecord[] = [];

    let response: unknown;
    try {
      response = await client<unknown>(paths.workspaces, { query: { limit: WORKSPACE_FETCH_LIMIT } });
    } catch (err) {
      throw new Error(describeFetchError(err));
    }

    const workspaces = extractHowspaceList(response)
      .map(parseHowspaceWorkspace)
      .filter((ws): ws is HowspaceWorkspaceData => ws !== null);

    if (workspaces.length === 0) {
      // Ett 200-svar utan tolkbara workspaces är inte en lyckad synk —
      // sökvägen eller schemat stämmer inte (§ 11.8-principen: aldrig tyst tomt).
      throw new Error(
        'Howspace svarade utan tolkbara workspaces. Kontrollera API-URL/sökvägar mot kontots dokumentation.'
      );
    }

    for (const ws of workspaces) {
      records.push(normalizeWorkspace(ws, appUrl, syncedAt));

      // Aggregerade deltagarräkningar — aldrig namn/e-post. Fail-soft per
      // workspace: statistik-endpointen kan saknas i paketet.
      try {
        const stats = parseHowspaceStats(await client<unknown>(howspaceStatsPath(paths.stats, ws.id)));
        if (stats.total !== null || stats.active !== null) {
          records.push(normalizeWorkspaceStats(ws, stats, syncedAt, appUrl));
        }
      } catch {
        /* statistik valfri */
      }
    }

    return records;
  }
};
