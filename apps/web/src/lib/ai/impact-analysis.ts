import 'server-only';

import {
  IMPACT_DYNAMIC_INPUT_PREAMBLE,
  IMPACT_PROMPT_VERSION,
  buildImpactSystemPrompt,
  normalizeImpactDashboard,
  normalizeImpactMateriality,
  normalizeImpactSufficiency,
  normalizeImpactUpdateAnalysis,
  parseImpactModelJson,
  type ImpactDashboard,
  type ImpactFinalAnalysisAIInput,
  type ImpactMateriality,
  type ImpactMaterialityAIInput,
  type ImpactPromptStep,
  type ImpactSufficiency,
  type ImpactSufficiencyAIInput,
  type ImpactUpdateAnalysis,
  type ImpactUpdateAnalysisAIInput
} from '@platform/shared';
import { callMistralWithFallback, MistralError } from './mistral';

// ─────────────────────────────────────────────────────────────────────────────
// Impact Navigator — AI-stegen (CLAUDE.md § 56), porterade från originalet.
//
// Fyra isolerade körningar med originalets promptar (promptversion
// 2026-08-10-v1): den gemensamma systemrollen + stegets instruktioner (+
// frågeregler) + outputformatet går i SYSTEM-rollen; det dynamiska underlaget
// (samma JSON-struktur som originalets inputbyggare producerade) går i
// USER-rollen bakom preambeln "Dynamiskt analysunderlag (JSON):". Originalet
// körde OpenAI med Zod-strukturerade svar; här körs Mistral i JSON-läge
// (large → medium-fallback vid 429/5xx, låg temperatur, inga verktyg) och
// svaret tvingas in i typerna av de rena, enhetstestade normaliserarna —
// modellen skriver aldrig till databasen.
//   1. materiality  — väsentliga hållbarhetsområden (ESG) för bolaget
//   2. sufficiency  — räcker underlaget? annars EN kompletteringsfråga/område
//   3. final        — slutanalysen ("dashboard")
//   4. update       — state + delta → uppdaterad dashboard + deltaSummary
//
// Säkerhet (§ 9.3): bolagets underlag är DATA, inte instruktioner (sägs i
// systemprompten). Texten är redan personnummer-sanerad på skrivvägen.
// EU-suveränt: Mistral (FR). Riskklass: begränsad (beslutsstöd om bolag,
// människa granskar varje steg).
// ─────────────────────────────────────────────────────────────────────────────

export const IMPACT_MODELS = ['mistral-large-latest', 'mistral-medium-latest'];
const MAX_TOKENS = 8000;
const TEMPERATURE = 0.2;

export type ImpactFailureKind = 'configuration' | 'invalid_output' | 'unavailable' | 'empty_output';

export interface ImpactAiUsage {
  tokensIn: number;
  tokensOut: number;
}

export interface ImpactAiOutcome<T> {
  result: T | null;
  raw: unknown;
  model: string;
  promptVersion: string;
  usage: ImpactAiUsage;
  latencyMs: number;
  error?: string;
  errorKind?: ImpactFailureKind;
}

/** Felmeddelanden i originalets anda — underlaget är sparat, användaren kan försöka igen. */
export const IMPACT_FAILURE_MESSAGES: Record<ImpactFailureKind, string> = {
  configuration: 'AI-tjänsten är inte korrekt konfigurerad. Underlaget är sparat; kontakta en administratör innan du försöker igen.',
  invalid_output: 'AI-tjänsten returnerade inget användbart analysresultat. Underlaget är sparat och du kan försöka igen.',
  empty_output: 'AI-tjänsten returnerade inget strukturerat analysresultat. Underlaget är sparat och du kan försöka igen.',
  unavailable: 'AI-tjänsten är tillfälligt otillgänglig. Underlaget är sparat och du kan försöka igen.'
};

function serializeInput(input: unknown): string {
  return JSON.stringify(input) ?? 'null';
}

async function runStep<T>(step: ImpactPromptStep, input: unknown, normalize: (raw: unknown) => T): Promise<ImpactAiOutcome<T>> {
  const startedAt = Date.now();
  const system = buildImpactSystemPrompt(step);
  const user = `${IMPACT_DYNAMIC_INPUT_PREAMBLE}\n${serializeInput(input)}`;
  try {
    const res = await callMistralWithFallback(
      IMPACT_MODELS,
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      { temperature: TEMPERATURE, maxTokens: MAX_TOKENS, responseFormat: 'json_object' }
    );
    const usage = { tokensIn: res.usage.prompt_tokens, tokensOut: res.usage.completion_tokens };
    const latencyMs = Date.now() - startedAt;
    const raw = parseImpactModelJson(res.text);
    if (!raw) {
      console.warn('[impact-analysis] no json in model answer', { step, model: res.modelUsed, finish: res.finishReason });
      return {
        result: null,
        raw: null,
        model: res.modelUsed,
        promptVersion: IMPACT_PROMPT_VERSION,
        usage,
        latencyMs,
        error: IMPACT_FAILURE_MESSAGES.empty_output,
        errorKind: 'empty_output'
      };
    }
    let result: T;
    try {
      result = normalize(raw);
    } catch (err) {
      console.warn('[impact-analysis] normalize failed', { step, model: res.modelUsed, kind: err instanceof Error ? err.name : 'error' });
      return {
        result: null,
        raw,
        model: res.modelUsed,
        promptVersion: IMPACT_PROMPT_VERSION,
        usage,
        latencyMs,
        error: IMPACT_FAILURE_MESSAGES.invalid_output,
        errorKind: 'invalid_output'
      };
    }
    console.info(JSON.stringify({ event: 'movexum.impact_ai_step', step, model: res.modelUsed, latencyMs, ...usage, success: true }));
    return { result, raw, model: res.modelUsed, promptVersion: IMPACT_PROMPT_VERSION, usage, latencyMs };
  } catch (err) {
    const status = err instanceof MistralError ? err.status : -1;
    const kind: ImpactFailureKind = status === 0 && /saknas/i.test(String((err as Error).message)) ? 'configuration' : 'unavailable';
    console.warn('[impact-analysis] failed', { step, kind, status });
    return {
      result: null,
      raw: null,
      model: IMPACT_MODELS[0],
      promptVersion: IMPACT_PROMPT_VERSION,
      usage: { tokensIn: 0, tokensOut: 0 },
      latencyMs: Date.now() - startedAt,
      error: IMPACT_FAILURE_MESSAGES[kind],
      errorKind: kind
    };
  }
}

export function runImpactMateriality(input: ImpactMaterialityAIInput): Promise<ImpactAiOutcome<ImpactMateriality>> {
  return runStep('materiality', input, normalizeImpactMateriality);
}

export function runImpactSufficiency(input: ImpactSufficiencyAIInput): Promise<ImpactAiOutcome<ImpactSufficiency>> {
  return runStep('sufficiency', input, normalizeImpactSufficiency);
}

export function runImpactFinal(input: ImpactFinalAnalysisAIInput): Promise<ImpactAiOutcome<ImpactDashboard>> {
  return runStep('final', input, (raw) => {
    const d = normalizeImpactDashboard(raw);
    // Som originalet: slutanalysen bär tillräcklighetsprövningens kvalitetstal.
    d.informationQualityScore = input.informationStatus.overallInformationQuality;
    return d;
  });
}

export function runImpactUpdate(input: ImpactUpdateAnalysisAIInput, previousInformationQuality: number | null): Promise<ImpactAiOutcome<ImpactUpdateAnalysis>> {
  return runStep('update', input, (raw) => {
    const r = normalizeImpactUpdateAnalysis(raw);
    if (previousInformationQuality != null) r.updatedDashboard.informationQualityScore = previousInformationQuality;
    return r;
  });
}
