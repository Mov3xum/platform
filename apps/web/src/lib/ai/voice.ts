import 'server-only';

import { MistralError } from './mistral';
import { primaryBase, transcriptionsUrl } from './mistral-endpoints';
import {
  MAX_VOICE_BYTES,
  normalizeVoiceMime,
  validateVoiceClip,
  type VoiceMime
} from '@platform/shared';

/**
 * Voxtral-transkribering för röststyrning av chatten (CLAUDE.md § 31).
 *
 * Voxtral är Mistrals egen tal-till-text-modell och körs på samma EU-
 * infrastruktur som övriga AI-anrop (samma leverantör, samma DPA, § 10.2) —
 * ingen ny leverantör, ingen US-tjänst, ingen ny npm-dependency (ren fetch,
 * samma mönster som `mistral.ts`).
 *
 * Dataflöde (dataminimering, GDPR § 5): ljudklippet strömmar från webbläsaren
 * till route-handlern, vidare till Mistral, och kastas när transkriberingen
 * returnerat. Vi lagrar ALDRIG ljudet — varken i PocketBase eller på disk.
 * Endast den transkriberade texten lever vidare, och då som användarens eget
 * chatt-meddelande (precis som om hen skrivit det).
 *
 * Säkerhet (§ 9.3): transkriptet är DATA, inte instruktioner. Det matas in som
 * ett vanligt user-meddelande och omfattas därmed av samma immutabla
 * säkerhetspreamble som all annan användarinmatning. Vi använder ALDRIG rösten
 * för identifiering, känslodetektering eller biometrisk kategorisering — det
 * vore förbjuden/högrisk-praktik enligt EU AI Act (§ 10.1).
 */

// Modellen är env-överstyrbar så att en uppgradering (eller ett byte till
// voxtral-small för svårare ljud) inte kräver en kodändring. Default är
// mini-varianten: billigast och byggd för just transkribering.
const DEFAULT_VOICE_MODEL = 'voxtral-mini-latest';

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 800;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

// Transkribering av upp till ~2 minuters ljud går snabbt, men nätverket kan
// vara långsamt. Ett explicit tak gör att ett hängande anrop failar tydligt i
// stället för att låsa route-handlern (SOC 2 availability, § 10.4).
const REQUEST_TIMEOUT_MS = 60_000;

export class VoiceError extends Error {
  /** HTTP-status att svara klienten med. */
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'VoiceError';
    this.status = status;
  }
}

export interface TranscriptionResult {
  /** Transkriberad text (trimmad). */
  text: string;
  /** Modellen som faktiskt svarade (för kostnadsloggning per modell). */
  model: string;
  /** Språkkod modellen rapporterade, när den gör det. */
  language?: string;
  usage: { tokensIn: number; tokensOut: number };
}

export function voiceModel(): string {
  return process.env.MISTRAL_VOICE_MODEL?.trim() || DEFAULT_VOICE_MODEL;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  const base = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
  const jitter = base * (Math.random() * 0.4 - 0.2); // ±20 %
  return Math.round(base + jitter);
}

function extensionFor(mime: VoiceMime | string): string {
  switch (normalizeVoiceMime(mime)) {
    case 'audio/webm':
      return 'webm';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/mp4':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/flac':
      return 'flac';
    default:
      return 'wav';
  }
}

/**
 * Läser Voxtrals svar. Transkriberings-endpointen svarar OpenAI-kompatibelt
 * (`{ text, language?, usage? }`); usage saknas i vissa svar och räknas då som
 * 0 (loggen blir en underskattning, aldrig en gissning).
 */
function parseTranscription(payload: unknown, model: string): TranscriptionResult {
  const data = (payload ?? {}) as {
    text?: unknown;
    language?: unknown;
    model?: unknown;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      prompt_audio_seconds?: unknown;
    };
  };
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  const tokensIn = Number(data.usage?.prompt_tokens);
  const tokensOut = Number(data.usage?.completion_tokens);

  return {
    text,
    model: typeof data.model === 'string' && data.model ? data.model : model,
    language: typeof data.language === 'string' ? data.language : undefined,
    usage: {
      tokensIn: Number.isFinite(tokensIn) && tokensIn > 0 ? tokensIn : 0,
      tokensOut: Number.isFinite(tokensOut) && tokensOut > 0 ? tokensOut : 0
    }
  };
}

export interface TranscribeOptions {
  /**
   * ISO-språkkod. Movexum är svenskspråkigt, så vi låser till `sv` som default
   * — det höjer träffsäkerheten markant på domänord jämfört med autodetekt.
   */
  language?: string;
}

/**
 * Transkriberar ett ljudklipp med Voxtral. Kastar `VoiceError` med ett
 * användarvänligt svenskt felmeddelande och en lämplig HTTP-status.
 */
export async function transcribeAudio(
  audio: Buffer,
  mime: string,
  options: TranscribeOptions = {}
): Promise<TranscriptionResult> {
  const validation = validateVoiceClip(mime, audio.byteLength);
  if (!validation.ok) {
    throw new VoiceError(validation.error, 400);
  }
  if (audio.byteLength > MAX_VOICE_BYTES) {
    throw new VoiceError('Ljudklippet är för stort.', 413);
  }

  const apiKey = process.env.MISTRAL_API_KEY?.trim();
  if (!apiKey) {
    // Degraderat läge ska felera tydligt, inte tyst (SOC 2, § 10.4).
    throw new VoiceError(
      'Röstinmatning är inte konfigurerad — MISTRAL_API_KEY saknas i miljön.',
      503
    );
  }

  const model = voiceModel();
  const url = transcriptionsUrl(primaryBase(process.env));
  const language = (options.language ?? 'sv').trim();

  let lastError: VoiceError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // FormData/Blob byggs om per försök — en konsumerad body kan inte skickas igen.
    const form = new FormData();
    form.append('model', model);
    if (language) form.append('language', language);
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: validation.mime }),
      `rost.${extensionFor(validation.mime)}`
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'TimeoutError';
      lastError = new VoiceError(
        aborted
          ? 'Transkriberingen tog för lång tid. Försök med en kortare inspelning.'
          : 'Kunde inte nå AI-tjänsten för transkribering.',
        503
      );
      if (attempt < MAX_ATTEMPTS && !aborted) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new VoiceError('AI-tjänsten svarade i ett format vi inte kunde läsa.', 502);
      }
      const result = parseTranscription(payload, model);
      if (!result.text) {
        throw new VoiceError('Ingen text kunde höras i inspelningen. Försök igen.', 422);
      }
      return result;
    }

    // Loggen är PII-fri: status + modell, aldrig ljudet eller transkriptet.
    const body = await response.text().catch(() => '');
    console.warn('[voice] transkribering misslyckades', {
      status: response.status,
      model,
      attempt
    });
    lastError = toVoiceError(response.status, body);

    if (!RETRYABLE_STATUSES.has(response.status) || attempt >= MAX_ATTEMPTS) {
      throw lastError;
    }
    await sleep(backoffMs(attempt));
  }

  throw lastError ?? new VoiceError('Okänt fel vid transkribering.', 502);
}

function toVoiceError(status: number, body: string): VoiceError {
  if (status === 429) {
    return new VoiceError(
      'AI-tjänsten är tillfälligt överbelastad. Försök igen om en stund.',
      429
    );
  }
  if (status === 401 || status === 403) {
    return new VoiceError('AI-tjänsten avvisade anropet (kontrollera API-nyckeln).', 502);
  }
  if (status === 404) {
    return new VoiceError(
      'Rösttjänsten (Voxtral) är inte tillgänglig för det här kontot.',
      502
    );
  }
  if (status >= 500) {
    return new VoiceError('AI-tjänsten svarade med ett fel. Försök igen.', 502);
  }
  // 4xx: oftast ett ljudformat Voxtral inte accepterar.
  const detail = body.length > 200 ? body.slice(0, 200) + '…' : body;
  console.warn('[voice] avvisat av Mistral', { status, detail });
  return new VoiceError('Ljudklippet kunde inte transkriberas.', 400);
}

// Re-exporteras så att kallare kan skilja Mistral-fel från våra egna.
export { MistralError };
