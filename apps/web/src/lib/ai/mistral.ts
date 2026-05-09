import 'server-only';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MAX_TOKENS = 4000;

export interface MistralMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface MistralResponse {
  text: string;
  /**
   * Token usage from the API response.
   * - prompt_tokens: input tokens (used for cost estimation as tokensIn)
   * - completion_tokens: output tokens (used for cost estimation as tokensOut)
   */
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/**
 * Thin fetch-client for the Mistral API (OpenAI-compatible format).
 * Reads MISTRAL_API_KEY from environment (server-side only).
 * No npm dependencies — uses native fetch.
 */
export async function callMistral(
  model: string,
  messages: MistralMessage[]
): Promise<MistralResponse> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY saknas i miljövariablerna.');
  }

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: MAX_TOKENS,
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Mistral API-fel ${response.status}: ${errorBody}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  const text = data.choices?.[0]?.message?.content ?? '';
  const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };

  return { text, usage };
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
