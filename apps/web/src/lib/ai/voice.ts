import 'server-only';

import { MistralError } from './mistral';
import { MAX_VOICE_BYTES, validateVoiceClip } from '@platform/shared';
import {
  DEFAULT_VOICE_MODEL,
  LanguageHintMemory,
  estimateSpeechCostUsd,
  resolveSpeechProviders,
  type SpeechProvider,
  type TranscriptionResult
} from './voice-transcription';
import { VoiceError, transcribeWithCandidates, type TranscribeOptions } from './voice-ladder';

export type { TranscriptionResult, TranscriptTurn, SpeechProvider } from './voice-transcription';
export { VoiceError, type TranscribeOptions } from './voice-ladder';

/**
 * Tal-till-text för röststyrning (CLAUDE.md § 31) och mötesläget (§ 34).
 *
 * Primärt Voxtral 3 — Mistrals tal-till-text-modell med svenska bland sina
 * språk, på samma EU-infrastruktur som övriga AI-anrop (samma leverantör,
 * samma DPA, § 10.2). Valfritt kan en egen OpenAI-kompatibel EU-endpoint med
 * en svensktränad modell (KB-Whisper självhostad eller hos en svensk värd)
 * sättas som primär via env (`MOVEXUM_STT_BASE_URL`, se
 * `voice-transcription.ts`); Voxtral blir då reserv. Ren fetch, ingen
 * npm-dependency (samma mönster som `mistral.ts`).
 *
 * Dataflöde (dataminimering, GDPR § 5): ljudklippet strömmar från webbläsaren
 * till route-handlern, vidare till transkriberingstjänsten, och kastas när
 * texten returnerat. Vi lagrar ALDRIG ljudet — varken i PocketBase eller på
 * disk. Endast texten lever vidare.
 *
 * Säkerhet (§ 9.3): transkriptet är DATA, inte instruktioner. Vi använder
 * ALDRIG rösten för identifiering, känslodetektering eller biometrisk
 * kategorisering — det vore förbjuden/högrisk-praktik enligt EU AI Act
 * (§ 10.1). Diarisering (talarturer) ger bara anonyma, segmentlokala
 * etiketter och skapar inga röstavtryck.
 *
 * Robusthet (art. 15 / SOC 2): retry med backoff på 429/5xx, timeout, och en
 * "parametertrappa" mot avvisade anrop (400/422): språkhintet släpps,
 * extraparametrarna (kontext-bias/diarisering) stryks, och till sist provas
 * nästa modell/leverantör i kandidatlistan — så att en API-ändring hos
 * leverantören degraderar kvaliteten i stället för att stoppa mötet. Trappan
 * hänger INTE på felets ordalydelse (incident 2026-11-26): ordalydelsen
 * avgör bara vad som minns till nästa anrop. Ett avvisat anrop bearbetar
 * aldrig ljudet → ingen kostnad.
 */

// Processminne över språkhint, extraparametrar och modeller som en kandidat
// avvisat (§ 31.2) — så att bara det FÖRSTA anropet efter en omstart betalar
// de extra rundturerna.
const hintMemory = new LanguageHintMemory();

/** Ordnad providerlista ur env (se `resolveSpeechProviders`). */
export function speechProviders(): SpeechProvider[] {
  return resolveSpeechProviders(process.env);
}

/** Primär modell (för loggning innan ett svar finns). */
export function voiceModel(): string {
  return speechProviders()[0]?.model || DEFAULT_VOICE_MODEL;
}

/**
 * Kostnad för en transkribering i USD, per ljudminut (så tjänsterna debiterar)
 * — eller undefined när priset inte är känt, och loggen faller då tillbaka på
 * token-uppskattningen. `fallbackSeconds` = klippets längd mätt hos oss, för
 * tjänster som inte rapporterar ljudlängden.
 */
export function speechCostUsd(
  outcome: { model?: string; provider?: SpeechProvider['label']; audioSeconds?: number },
  fallbackSeconds?: number
): number | undefined {
  if (!outcome.model || !outcome.provider) return undefined;
  const cost = estimateSpeechCostUsd(
    outcome.model,
    outcome.provider,
    outcome.audioSeconds ?? fallbackSeconds,
    process.env
  );
  return cost === null ? undefined : cost;
}

/**
 * Transkriberar TAL. Kastar `VoiceError` med ett användarvänligt svenskt
 * felmeddelande och en lämplig HTTP-status. Kedjan (parametertrappa + växling
 * mellan modeller/leverantörer) bor i `voice-ladder.ts`.
 *
 * Anroparen bör mäta ljudnivån först (`@platform/shared` audio-level.ts) så
 * att tystnad aldrig skickas alls, och MÅSTE bokföra `VoiceError.usage` även
 * i 422-grenen (§ 9.6, § 31.4, § 34.5).
 */
export async function transcribeSpeech(
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
  return transcribeWithCandidates(speechProviders(), audio, validation.mime, options, {
    fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
    memory: hintMemory,
    warn: (message, data) => console.warn(message, data)
  });
}

// Re-exporteras så att kallare kan skilja Mistral-fel från våra egna.
export { MistralError };
