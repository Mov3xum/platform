import 'server-only';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MAX_TOKENS = 4000;

export interface MistralTextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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

/**
 * Thin fetch-client for the Mistral API (OpenAI-compatible JSON format,
 * runs on Mistral AI's EU infrastructure — api.mistral.ai).
 * Reads MISTRAL_API_KEY from environment (server-side only).
 */
export async function callMistral(
  model: string,
  messages: MistralMessage[],
  options: CallMistralOptions = {}
): Promise<MistralResponse> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY saknas i miljövariablerna.');
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

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Mistral API-fel ${response.status}: ${errorBody}`);
  }

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

/**
 * Estimates cost in USD based on Mistral pricing (approximate).
 * mistral-large-latest: $2/1M in, $6/1M out
 * mistral-medium-latest: $0.4/1M in, $1.2/1M out
 * mistral-small-latest: $0.1/1M in, $0.3/1M out
 */
export function estimateCostUsd(
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  const pricing: Record<string, [number, number]> = {
    'mistral-large-latest': [2.0, 6.0],
    'mistral-medium-latest': [0.4, 1.2],
    'mistral-small-latest': [0.1, 0.3]
  };
  const [inPrice, outPrice] = pricing[model] ?? [2.0, 6.0];
  return (tokensIn / 1_000_000) * inPrice + (tokensOut / 1_000_000) * outPrice;
}
