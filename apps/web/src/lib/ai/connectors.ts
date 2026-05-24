import 'server-only';
import { createFetchClient, IntegrationFetchError } from '@/lib/integrations/http';

// Klient mot Mistrals connector-API. Workspace-API-nyckeln är gemensam
// för hela vår applikation — connectors aktiveras i Mistral-workspacet
// och listas via /v1/connectors. Per-användare-aktivering lever i vår
// egen `user_mistral_connectors`-collection.
//
// CLAUDE.md § 9.3: MISTRAL_API_KEY läses bara server-side.
// CLAUDE.md § 10.3: kortlivad cache (5 min) för listan så vi inte
// spammar Mistrals API vid varje sidladdning.

const MISTRAL_API_BASE = 'https://api.mistral.ai';
const LIST_CACHE_TTL_MS = 5 * 60 * 1000;

export interface MistralConnector {
  id: string;
  name: string;
  description?: string;
  // requires_auth=true betyder OAuth-flow per slutanvändare; false = redan
  // konfigurerad i workspacet (delad).
  requires_auth: boolean;
  active: boolean;
  visibility?: 'private' | 'shared_workspace';
  // Lista av tool-namn som connectorn exponerar (om Mistral har upptäckt
  // dem redan); annars hämtas via listConnectorTools().
  tools?: { name: string; description?: string }[];
}

export interface MistralConnectorTool {
  name: string;
  description?: string;
}

type CacheEntry = {
  fetchedAt: number;
  value: MistralConnector[];
};

let listCache: CacheEntry | null = null;

function getClient() {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY saknas i miljövariablerna.');
  }
  return createFetchClient(MISTRAL_API_BASE, {
    Authorization: `Bearer ${apiKey}`
  });
}

/**
 * Listar aktiva connectors i vårt Mistral-workspace. Cachas 5 min för
 * att inte spamma Mistral vid varje sidladdning. Fail-soft: vid fel
 * returneras tom array — UI:t fortsätter visa built-ins.
 *
 * Mistrals API tar filtret som `query_filters` (JSON-objekt), inte
 * som top-level query-param. Utan korrekt filter returneras hela
 * workspacets connector-register inklusive de användaren disablat i
 * Le Chat. Paginering: { items, pagination: { next_cursor } } — vi
 * loopar tills cursor är null eller taket nås.
 */
const MAX_CONNECTORS = 200;
const PAGE_SIZE = 50;

export async function listActiveConnectors(): Promise<MistralConnector[]> {
  const now = Date.now();
  if (listCache && now - listCache.fetchedAt < LIST_CACHE_TTL_MS) {
    return listCache.value;
  }

  try {
    const client = getClient();
    const filter = JSON.stringify({ active: true });
    const collected: MistralConnector[] = [];
    let cursor: string | undefined = undefined;

    for (let page = 0; page < 10; page++) {
      const response: {
        data?: MistralConnector[];
        items?: MistralConnector[];
        pagination?: { next_cursor?: string | null };
        next_cursor?: string | null;
      } = await client('/v1/connectors', {
        query: {
          query_filters: filter,
          page_size: PAGE_SIZE,
          ...(cursor ? { page_cursor: cursor } : {})
        }
      });

      const items = response.data ?? response.items ?? [];
      for (const c of items) {
        if (c.active === false) continue;
        collected.push({
          ...c,
          requires_auth: c.requires_auth === true
        });
        if (collected.length >= MAX_CONNECTORS) break;
      }

      const next = response.pagination?.next_cursor ?? response.next_cursor ?? null;
      if (!next || collected.length >= MAX_CONNECTORS) break;
      cursor = next;
    }

    listCache = { fetchedAt: now, value: collected };
    return collected;
  } catch (err) {
    if (err instanceof IntegrationFetchError) {
      console.error('[mistral/connectors] list failed', {
        status: err.status,
        body: err.bodySnippet
      });
    } else {
      console.error('[mistral/connectors] list failed', err);
    }
    return [];
  }
}

/**
 * Listar de tools en specifik connector exponerar. Används på detaljvyn.
 */
export async function listConnectorTools(
  connectorId: string
): Promise<MistralConnectorTool[]> {
  try {
    const client = getClient();
    const response = await client<{
      data?: MistralConnectorTool[];
      items?: MistralConnectorTool[];
    }>(`/v1/connectors/${encodeURIComponent(connectorId)}/tools`);
    return response.data ?? response.items ?? [];
  } catch (err) {
    console.warn('[mistral/connectors] list tools failed', { connectorId, err });
    return [];
  }
}

export interface ConnectorOAuthStart {
  authorization_url: string;
  // Mistral genererar normalt egen state — vi wrappar i vår egen signerade
  // state i callback-route:n. Spara originalet för debug.
  provider_state?: string;
}

/**
 * Begär en authorization_url från Mistral för en OAuth-skyddad connector.
 * Vår callback-route tar emot ?code och växlar mot token via Mistral.
 *
 * `returnTo` blir Mistrals app_return_url efter samtycke. Vi pekar alltid
 * på vår oauth-callback-route som i sin tur redirectar användaren vidare.
 */
export async function startConnectorOAuth(
  connectorId: string,
  returnTo: string,
  state: string
): Promise<ConnectorOAuthStart> {
  const client = getClient();
  return client<ConnectorOAuthStart>(
    `/v1/connectors/${encodeURIComponent(connectorId)}/oauth/start`,
    {
      method: 'POST',
      body: {
        app_return_url: returnTo,
        state
      }
    }
  );
}

/**
 * Växlar en OAuth-code mot ett token-objekt (returneras opakt och
 * krypteras innan persistens). Mistral ansvarar för refresh-rotation
 * via sin connector-runtime — vi behöver bara skicka tillbaka tokenet
 * vid varje chat-turn.
 */
export async function completeConnectorOAuth(
  connectorId: string,
  code: string
): Promise<{ token: string } & Record<string, unknown>> {
  const client = getClient();
  return client<{ token: string } & Record<string, unknown>>(
    `/v1/connectors/${encodeURIComponent(connectorId)}/oauth/exchange`,
    {
      method: 'POST',
      body: { code }
    }
  );
}

// Endast för tester: gör det möjligt att resetta cachen mellan testkörningar.
export function _resetConnectorCacheForTests() {
  listCache = null;
}
