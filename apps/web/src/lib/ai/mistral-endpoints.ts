/**
 * Ren, IO-fri resolvning av Mistral-endpoints + en valfri EU-fallback-provider
 * (CLAUDE.md § 10.4 SOC 2 availability, § 10.2 EU-suveränitet). Skild från den
 * server-only klienten (`mistral.ts`) så logiken kan ENHETSTESTAS.
 *
 * Degraderat läge: om Mistrals API (api.mistral.ai, FR/EU) är otillgängligt
 * eller kapacitetstaket nås, kan operatören peka en **självhostad,
 * OpenAI-kompatibel** endpoint (vLLM/Ollama med Mistral open-weights på
 * UpCloud, EU) via env — så chatten degraderar i stället för att gå ner.
 * Dormant tills env är satt → inget beteende ändras i dagsläget.
 *
 * Env (aldrig i kod, ISO 27001 A.8.24):
 *   MISTRAL_API_BASE_URL       — överstyr primär bas (default api.mistral.ai)
 *   MISTRAL_FALLBACK_BASE_URL  — självhostad EU-fallback för chat completions
 *   MISTRAL_FALLBACK_API_KEY   — nyckel för fallbacken (faller tillbaka på
 *                                primärnyckeln om utelämnad)
 */

export const DEFAULT_MISTRAL_BASE = 'https://api.mistral.ai';

export interface ChatProvider {
  url: string;
  apiKey: string;
  label: 'primary' | 'fallback';
}

// Bred nog att ta emot `process.env` (ProcessEnv) direkt. Relevanta nycklar:
// MISTRAL_API_KEY, MISTRAL_API_BASE_URL, MISTRAL_FALLBACK_BASE_URL,
// MISTRAL_FALLBACK_API_KEY.
type MistralEnv = Record<string, string | undefined>;

function trimBase(base: string): string {
  return base.trim().replace(/\/+$/, '');
}

export function chatCompletionsUrl(base: string): string {
  return `${trimBase(base)}/v1/chat/completions`;
}

export function conversationsUrl(base: string): string {
  return `${trimBase(base)}/v1/conversations`;
}

export function embeddingsUrl(base: string): string {
  return `${trimBase(base)}/v1/embeddings`;
}

/** Primär bas-URL (env-override eller Mistrals EU-API). */
export function primaryBase(env: MistralEnv): string {
  const raw = env.MISTRAL_API_BASE_URL?.trim();
  return raw ? raw : DEFAULT_MISTRAL_BASE;
}

/**
 * Ordnad lista av chat-completions-providers: primär först, sedan en valfri
 * EU-fallback. Tom när ingen API-nyckel finns (anroparen kastar samma
 * "MISTRAL_API_KEY saknas"-fel som förut). Fallbacken läggs bara till när en
 * egen bas-URL är satt — så default-beteendet (en provider) är oförändrat.
 */
export function resolveChatProviders(env: MistralEnv): ChatProvider[] {
  const providers: ChatProvider[] = [];
  const primaryKey = env.MISTRAL_API_KEY?.trim();
  if (primaryKey) {
    providers.push({
      url: chatCompletionsUrl(primaryBase(env)),
      apiKey: primaryKey,
      label: 'primary'
    });
  }
  const fbBase = env.MISTRAL_FALLBACK_BASE_URL?.trim();
  const fbKey = env.MISTRAL_FALLBACK_API_KEY?.trim() || primaryKey;
  if (fbBase && fbKey) {
    providers.push({ url: chatCompletionsUrl(fbBase), apiKey: fbKey, label: 'fallback' });
  }
  return providers;
}
