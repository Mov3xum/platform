import 'server-only';
import { getModelMeta } from './models';
import {
  conversationsUrl,
  embeddingsUrl,
  primaryBase,
  resolveChatProviders,
  type ChatProvider
} from './mistral-endpoints';

export const EMBEDDING_MODEL = 'mistral-embed';
const MAX_TOKENS = 4000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export type MistralContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: string | { url: string } };

export type MistralContentBlock = MistralContentPart;

export interface MistralTextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | MistralContentPart[];
}

export interface MistralAssistantWithToolCalls {
  role: 'assistant';
  content: string | null;
  tool_calls: MistralToolCall[];
}

export interface MistralToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  name: string;
  content: string;
}

export type MistralMessage =
  | MistralTextMessage
  | MistralAssistantWithToolCalls
  | MistralToolResultMessage;

export interface MistralToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface MistralToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// Mistrals first-party "built-in tools" (web_search, code_interpreter,
// image_generation, document_library) skickas inline i tools-arrayen som
// {type: '<id>'} utan function-blob. Se lib/ai/builtins.ts.
export interface MistralBuiltinToolDefinition {
  type: 'web_search' | 'code_interpreter' | 'image_generation' | 'document_library';
}

// MCP-connectors aktiverade i workspacet refereras via {type:'mcp', connector_id}.
// `connector_auth` skickas när connectorn är OAuth-skyddad (dekrypterad blob).
export interface MistralMcpToolDefinition {
  type: 'mcp';
  connector_id: string;
  connector_auth?: Record<string, unknown>;
}

export type MistralAnyTool =
  | MistralToolDefinition
  | MistralBuiltinToolDefinition
  | MistralMcpToolDefinition;

export interface MistralResponse {
  text: string;
  toolCalls: MistralToolCall[];
  finishReason: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export interface CallMistralOptions {
  tools?: MistralToolDefinition[];
  // Mistrals first-party built-ins och MCP-connectors appendas till tools-arrayen.
  builtins?: MistralBuiltinToolDefinition['type'][];
  connectors?: { connector_id: string; auth?: Record<string, unknown> }[];
  toolChoice?: 'auto' | 'none' | 'any';
  temperature?: number;
  maxTokens?: number;
  /**
   * När satt strömmas svaret token-för-token: varje text-delta forwardas
   * direkt via `onToken` (för live-utskrift i chatten) medan funktionen ändå
   * returnerar hela det ackumulerade svaret (text + tool_calls + usage). En
   * tur som bara anropar verktyg strömmar ingen text (delta.content är tom).
   */
  onToken?: (delta: string) => void;
}

export class MistralError extends Error {
  status: number;
  code?: string;
  rawBody?: string;

  constructor(message: string, status: number, code?: string, rawBody?: string) {
    super(message);
    this.name = 'MistralError';
    this.status = status;
    this.code = code;
    this.rawBody = rawBody;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const asInt = parseInt(header, 10);
  if (!Number.isNaN(asInt) && asInt > 0) return Math.min(asInt * 1000, 10_000);
  return null;
}

function classifyError(status: number, body: string): MistralError {
  // Try to extract Mistral's error code (e.g. "3505") for diagnostics.
  let code: string | undefined;
  try {
    const parsed = JSON.parse(body) as { code?: string; type?: string };
    code = parsed.code || parsed.type;
  } catch {
    // ignore
  }
  const truncated = body.length > 200 ? body.slice(0, 200) + '…' : body;

  if (status === 429) {
    return new MistralError(
      'AI-tjänsten är tillfälligt överbelastad. Försök igen om en stund.',
      status,
      code,
      truncated
    );
  }
  if (status === 401 || status === 403) {
    return new MistralError(
      'AI-tjänsten är inte korrekt konfigurerad.',
      status,
      code,
      truncated
    );
  }
  return new MistralError(
    `Mistral API-fel ${status}: ${truncated}`,
    status,
    code,
    truncated
  );
}

/**
 * Thin fetch-client for the Mistral API (OpenAI-compatible JSON format,
 * runs on Mistral AI's EU infrastructure — api.mistral.ai).
 * Reads MISTRAL_API_KEY from environment (server-side only).
 *
 * Retries automatically on 429/5xx with exponential backoff (1s, 2s,
 * with ±20% jitter) up to 3 attempts total, respecting Retry-After.
 * Throws MistralError on final failure.
 */
export async function callMistral(
  model: string,
  messages: MistralMessage[],
  options: CallMistralOptions = {}
): Promise<MistralResponse> {
  const providers = resolveChatProviders(process.env);
  if (providers.length === 0) {
    throw new MistralError('MISTRAL_API_KEY saknas i miljövariablerna.', 0);
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: options.maxTokens ?? MAX_TOKENS,
    temperature: options.temperature ?? 0.3
  };
  if (options.onToken) body.stream = true;

  const combinedTools: MistralAnyTool[] = [];
  if (options.tools && options.tools.length > 0) {
    combinedTools.push(...options.tools);
  }
  if (options.builtins && options.builtins.length > 0) {
    for (const id of options.builtins) {
      combinedTools.push({ type: id });
    }
  }
  if (options.connectors && options.connectors.length > 0) {
    for (const c of options.connectors) {
      const def: MistralMcpToolDefinition = {
        type: 'mcp',
        connector_id: c.connector_id
      };
      if (c.auth) def.connector_auth = c.auth;
      combinedTools.push(def);
    }
  }
  if (combinedTools.length > 0) {
    body.tools = combinedTools;
    body.tool_choice = options.toolChoice ?? 'auto';
  }

  // Primär provider (Mistral EU) först, sedan en valfri självhostad EU-fallback
  // (degraderat läge, § 10.4). Vid kapacitet/utfall byter vi provider; vid
  // request-fel (4xx, t.ex. auth) kastar vi direkt — fallbacken hjälper inte.
  let lastError: MistralError | null = null;
  for (let p = 0; p < providers.length; p++) {
    const provider = providers[p];
    try {
      return await attemptChatProvider(provider, body, options.onToken);
    } catch (err) {
      lastError = err instanceof MistralError ? err : new MistralError(String(err), 0);
      const status = lastError.status;
      const retryable = status === 0 || RETRYABLE_STATUSES.has(status);
      const hasFallback = p < providers.length - 1;
      if (!retryable || !hasFallback) throw lastError;
      console.warn('[mistral] provider failed, degrading to fallback', {
        from: provider.label,
        to: providers[p + 1].label,
        status
      });
    }
  }
  // Unreachable — loopen returnerar eller kastar.
  throw lastError ?? new MistralError('Okänt fel vid AI-anrop.', 0);
}

/**
 * Kör MAX_ATTEMPTS-loopen med backoff mot EN provider (url + nyckel).
 * Returnerar svaret eller kastar MistralError. Bryts ut så att den yttre
 * provider-loopen kan falla över till EU-fallbacken vid utfall/kapacitet.
 */
async function attemptChatProvider(
  provider: ChatProvider,
  body: Record<string, unknown>,
  onToken?: (delta: string) => void
): Promise<MistralResponse> {
  let lastError: MistralError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(provider.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      // Network-level failure — retry as if it were 503.
      lastError = new MistralError(
        err instanceof Error ? err.message : 'Nätverksfel mot AI-tjänsten.',
        503
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw lastError;
    }

    if (response.ok && onToken) {
      // Strömmande läge: HTTP-statusen var OK, så ev. retry/fallback (429/5xx)
      // har redan hanterats ovan. Härifrån läser vi SSE-strömmen och
      // forwardar text-deltan live. readChatStream rethrowar bara om INGET
      // hann strömmas (säkert att retrya) — annars returneras det partiella
      // svaret så vi aldrig dubbelskriver redan utskriven text.
      return await readChatStream(response, onToken);
    }

    if (response.ok) {
      const data = (await response.json()) as {
        choices: Array<{
          message: {
            content: string | null;
            tool_calls?: MistralToolCall[];
          };
          finish_reason: string;
        }>;
        usage: { prompt_tokens: number; completion_tokens: number };
      };

      const choice = data.choices?.[0];
      const message = choice?.message;
      const text = message?.content ?? '';
      const toolCalls = message?.tool_calls ?? [];
      const finishReason = choice?.finish_reason ?? '';
      const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };

      return { text, toolCalls, finishReason, usage };
    }

    const errorBody = await response.text().catch(() => '');
    lastError = classifyError(response.status, errorBody);

    if (!RETRYABLE_STATUSES.has(response.status) || attempt >= MAX_ATTEMPTS) {
      throw lastError;
    }

    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    await sleep(backoffMs(attempt, retryAfter));
  }

  // Unreachable — loop either returns or throws.
  throw lastError ?? new MistralError('Okänt fel vid AI-anrop.', 0);
}

/**
 * Läser en Mistral chat-completions SSE-ström (`stream: true`) och forwardar
 * varje text-delta via `onToken` medan den ackumulerar hela svaret (text +
 * tool_calls + usage) till samma `MistralResponse`-form som det icke-strömmande
 * fallet. Tool-call-deltan slås ihop per `index`. Kastar bara om strömmen
 * bryts INNAN något hann tas emot (då är retry säkert); annars returneras det
 * partiella svaret så vi aldrig dubbelskriver redan utströmmad text.
 */
async function readChatStream(
  response: Response,
  onToken: (delta: string) => void
): Promise<MistralResponse> {
  const reader = response.body?.getReader();
  if (!reader) throw new MistralError('AI-strömmen saknar kropp.', 503);

  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let finishReason = '';
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();

  const handleData = (payload: string) => {
    if (!payload || payload === '[DONE]') return;
    let json: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const choice = json.choices?.[0];
    const delta = choice?.delta;
    if (delta) {
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content;
        onToken(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = typeof tc.index === 'number' ? tc.index : 0;
          const cur = toolAcc.get(idx) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (typeof tc.function?.arguments === 'string') cur.args += tc.function.arguments;
          toolAcc.set(idx, cur);
        }
      }
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (json.usage) {
      if (typeof json.usage.prompt_tokens === 'number') usage.prompt_tokens = json.usage.prompt_tokens;
      if (typeof json.usage.completion_tokens === 'number') usage.completion_tokens = json.usage.completion_tokens;
    }
  };

  const drainLines = () => {
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) handleData(line.slice(5).trim());
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      drainLines();
    }
    const rest = buf.trim();
    if (rest.startsWith('data:')) handleData(rest.slice(5).trim());
  } catch (err) {
    // Bröt strömmen innan något togs emot → säkert att retrya/falla över.
    if (!text && toolAcc.size === 0) {
      throw new MistralError(
        err instanceof Error ? err.message : 'AI-strömmen bröts.',
        503
      );
    }
    // Annars: behåll det partiella svaret (texten är redan utskriven).
  }

  const toolCalls: MistralToolCall[] = Array.from(toolAcc.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, t]) => ({
      id: t.id,
      type: 'function' as const,
      function: { name: t.name, arguments: t.args }
    }))
    .filter((t) => t.function.name);

  // Strömmen returnerar inte alltid usage i sista chunken — uppskatta grovt
  // ur textlängden så kostnadsloggningen inte blir noll.
  if (usage.completion_tokens === 0 && text) {
    usage.completion_tokens = Math.ceil(text.length / 4);
  }

  return { text, toolCalls, finishReason: finishReason || 'stop', usage };
}

function backoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return retryAfterMs;
  const base = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
  const jitter = base * (Math.random() * 0.4 - 0.2); // ±20%
  return Math.round(base + jitter);
}

/**
 * Försöker en serie modeller i ordning. Vid 429 (kapacitetstak) byts
 * modell och vi försöker igen. Andra fel kastas direkt. Användbart när
 * en mindre modell är överbelastad och vi vill falla tillbaka på en
 * större (eller tvärtom).
 */
export async function callMistralWithFallback(
  models: string[],
  messages: MistralMessage[],
  options: CallMistralOptions = {}
): Promise<MistralResponse & { modelUsed: string }> {
  if (models.length === 0) {
    throw new MistralError('Ingen modell angiven för fallback-kedja.', 0);
  }

  let lastError: unknown = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const res = await callMistral(model, messages, options);
      return { ...res, modelUsed: model };
    } catch (err) {
      lastError = err;
      const isCapacity = err instanceof MistralError && err.status === 429;
      if (!isCapacity || i === models.length - 1) {
        throw err;
      }
      // Logga och fortsätt till nästa modell.
      console.warn('[mistral] capacity exceeded, falling back', {
        from: model,
        to: models[i + 1]
      });
    }
  }
  // Unreachable.
  throw lastError ?? new MistralError('Okänt fel vid AI-anrop.', 0);
}

/**
 * Estimates cost in USD using the central model registry (lib/ai/models.ts).
 * Unknown models default to the Large-tier pricing.
 */
export function estimateCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  const pricing: Record<string, [number, number]> = {
    'mistral-large-latest': [2.0, 6.0],
    'mistral-medium-latest': [0.4, 1.2],
    'mistral-small-latest': [0.1, 0.3],
    'pixtral-large-latest': [0.15, 0.15],
    // Embeddings: ~€0.1/1M input-tokens, ingen output (vektorn räknas inte som
    // completion-tokens). Utan denna rad skulle estimateCostUsd defaulta till
    // Large-tier och kraftigt överskatta RAG-kostnaden.
    'mistral-embed': [0.1, 0.0],
    // Voxtral (röstinmatning, § 31). Ljudtokens debiteras som input; en
    // transkribering ger bara den transkriberade texten som output. Utan
    // dessa rader skulle estimateCostUsd defaulta till Large-tier och
    // kraftigt överskatta rösttranskriberingen.
    'voxtral-mini-latest': [0.04, 0.04],
    'voxtral-small-latest': [0.1, 0.3]
  };
  const [inPrice, outPrice] = pricing[model] ?? [2.0, 6.0];
  return (tokensIn / 1_000_000) * inPrice + (tokensOut / 1_000_000) * outPrice;
}

// ── /v1/conversations — built-ins och MCP-connectors ────────────────────
//
// Mistrals built-in tools (web_search, code_interpreter, image_generation,
// document_library) och MCP-connectors stöds BARA av /v1/conversations,
// inte av /v1/chat/completions. Endpoint:s payload-format skiljer sig:
//   - system-prompt går i `instructions`, inte som message med role=system
//   - användarmeddelanden går i `inputs` (kan vara string eller array av
//     MessageInputEntry { role, content })
//   - tools använder samma type-värden som chat-API:t för function-typer
//     men `connector` (inte 'mcp') för MCP-connectors
//   - response har `outputs: [{type:'message.output', role:'assistant',
//     content: string | TextChunk[]}, ToolExecutionEntry, ...]`
//
// Vi exponerar en separat funktion `callMistralConversation()` och låter
// connector-chat-vägen i `runConnectorTurnAction` använda den. callMistral()
// (chat.completions) lämnas orörd för alla andra Mistral-anrop.

export interface ConversationConnector {
  connector_id: string;
  // OAuth/API-key blob för CustomConnector.authorization. Lämnas
  // tom om connectorn är pre-auth:ad i Le Chat (vanligaste fallet).
  auth?: Record<string, unknown>;
}

export interface CallMistralConversationOptions {
  builtins?: MistralBuiltinToolDefinition['type'][];
  connectors?: ConversationConnector[];
  temperature?: number;
  maxTokens?: number;
}

interface ConversationInputEntry {
  role: 'user' | 'assistant';
  content: string | MistralContentPart[];
}

/**
 * Anropar Mistrals /v1/conversations-endpoint. Använd för chattar som
 * behöver built-in tools (web_search etc.) eller MCP-connectors.
 *
 * @param messages — chat-historik inkl. ev. system-message först.
 *   System-message extraheras automatiskt och skickas som `instructions`.
 * @param options.builtins — lista av built-in tool-typer att aktivera.
 * @param options.connectors — lista av MCP-connectors att aktivera.
 */
export async function callMistralConversation(
  model: string,
  messages: MistralMessage[],
  options: CallMistralConversationOptions = {}
): Promise<MistralResponse> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new MistralError('MISTRAL_API_KEY saknas i miljövariablerna.', 0);
  }

  // Plocka ut system-message → instructions. Övriga → inputs.
  let instructions: string | undefined;
  const inputs: ConversationInputEntry[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      if (typeof m.content === 'string') {
        instructions = instructions ? `${instructions}\n\n${m.content}` : m.content;
      }
      continue;
    }
    if (m.role === 'user' || m.role === 'assistant') {
      const textOrParts = (m as MistralTextMessage).content;
      inputs.push({ role: m.role, content: textOrParts });
    }
    // 'tool'-meddelanden ignoreras tills vidare — conversations-API:t
    // hanterar tool-resultat via ToolExecutionEntry, inte tool-role
    // messages. Vi gör inte function-calling i connector-chat ändå.
  }

  // Bygg tools-array i conversations-format.
  const tools: Record<string, unknown>[] = [];
  if (options.builtins) {
    for (const id of options.builtins) {
      tools.push({ type: id });
    }
  }
  if (options.connectors) {
    for (const c of options.connectors) {
      const def: Record<string, unknown> = {
        type: 'connector',
        connector_id: c.connector_id
      };
      // Authorization-blob (OAuth2TokenAuth eller APIKeyAuth). Om
      // user har auth:at i Le Chat på workspace-nivå räcker
      // connector_id ofta — Mistral hanterar tokenet internt då.
      if (c.auth && Object.keys(c.auth).length > 0) {
        def.authorization = c.auth;
      }
      tools.push(def);
    }
  }

  const body: Record<string, unknown> = {
    model,
    inputs,
    store: false
  };
  if (instructions) body.instructions = instructions;
  if (tools.length > 0) body.tools = tools;

  const completionArgs: Record<string, unknown> = {};
  if (options.temperature !== undefined) completionArgs.temperature = options.temperature;
  else completionArgs.temperature = 0.3;
  completionArgs.max_tokens = options.maxTokens ?? MAX_TOKENS;
  body.completion_args = completionArgs;

  let lastError: MistralError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(conversationsUrl(primaryBase(process.env)), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
    } catch (err) {
      lastError = new MistralError(
        err instanceof Error ? err.message : 'Nätverksfel mot AI-tjänsten.',
        503
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      const data = (await response.json()) as {
        outputs?: Array<{
          type?: string;
          role?: string;
          content?: string | Array<{ type?: string; text?: string }>;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      // Extrahera assistent-text från outputs[] (message.output-entries).
      // ToolExecutionEntry m.fl. ignoreras — vi visar bara modellens text.
      let text = '';
      for (const out of data.outputs ?? []) {
        if (out.type !== 'message.output' || out.role !== 'assistant') continue;
        if (typeof out.content === 'string') {
          text += (text ? '\n\n' : '') + out.content;
        } else if (Array.isArray(out.content)) {
          for (const chunk of out.content) {
            if (chunk.type === 'text' && typeof chunk.text === 'string') {
              text += (text ? '\n\n' : '') + chunk.text;
            }
          }
        }
      }

      const usage = {
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0
      };

      return { text, toolCalls: [], finishReason: 'stop', usage };
    }

    const errorBody = await response.text().catch(() => '');
    lastError = classifyError(response.status, errorBody);

    if (!RETRYABLE_STATUSES.has(response.status) || attempt >= MAX_ATTEMPTS) {
      throw lastError;
    }

    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    await sleep(backoffMs(attempt, retryAfter));
  }

  throw lastError ?? new MistralError('Okänt fel vid AI-anrop.', 0);
}

// ── /v1/embeddings — mistral-embed (RAG-index, § 26) ────────────────────────

export interface EmbeddingResult {
  /** En vektor per input-text, i samma ordning. */
  vectors: number[][];
  usage: { prompt_tokens: number; completion_tokens: number };
}

/**
 * Skapar embeddings för en batch texter via Mistrals /v1/embeddings
 * (mistral-embed, körs på Mistral AI:s EU-infrastruktur). Samma retry-/
 * backoff-policy som callMistral. Tom input → tom vektorlista (inget anrop).
 * Throws MistralError vid slutligt fel.
 */
export async function embedTexts(inputs: string[]): Promise<EmbeddingResult> {
  if (inputs.length === 0) {
    return { vectors: [], usage: { prompt_tokens: 0, completion_tokens: 0 } };
  }
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new MistralError('MISTRAL_API_KEY saknas i miljövariablerna.', 0);
  }

  const body = JSON.stringify({ model: EMBEDDING_MODEL, input: inputs });
  let lastError: MistralError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(embeddingsUrl(primaryBase(process.env)), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body
      });
    } catch (err) {
      lastError = new MistralError(
        err instanceof Error ? err.message : 'Nätverksfel mot AI-tjänsten.',
        503
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      const data = (await response.json()) as {
        data?: Array<{ embedding?: number[]; index?: number }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      // Sortera på `index` för att garantera samma ordning som input.
      const rows = (data.data ?? [])
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const vectors = rows.map((r) => (Array.isArray(r.embedding) ? r.embedding : []));
      return {
        vectors,
        usage: {
          prompt_tokens: data.usage?.prompt_tokens ?? 0,
          completion_tokens: data.usage?.completion_tokens ?? 0
        }
      };
    }

    const errorBody = await response.text().catch(() => '');
    lastError = classifyError(response.status, errorBody);
    if (!RETRYABLE_STATUSES.has(response.status) || attempt >= MAX_ATTEMPTS) {
      throw lastError;
    }
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    await sleep(backoffMs(attempt, retryAfter));
  }

  throw lastError ?? new MistralError('Okänt fel vid embedding-anrop.', 0);
}
