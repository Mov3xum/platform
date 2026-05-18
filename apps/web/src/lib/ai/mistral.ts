import 'server-only';
import { getModelMeta } from './models';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MAX_TOKENS = 4000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1000;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export type MistralContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

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

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
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
