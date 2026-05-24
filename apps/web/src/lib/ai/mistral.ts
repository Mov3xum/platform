import 'server-only';
import { getModelMeta } from './models';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_CONVERSATIONS_URL = 'https://api.mistral.ai/v1/conversations';
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
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new MistralError('MISTRAL_API_KEY saknas i miljövariablerna.', 0);
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: options.maxTokens ?? MAX_TOKENS,
    temperature: options.temperature ?? 0.3
  };

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

  let lastError: MistralError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(MISTRAL_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
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
    'pixtral-large-latest': [0.15, 0.15]
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
      response = await fetch(MISTRAL_CONVERSATIONS_URL, {
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
