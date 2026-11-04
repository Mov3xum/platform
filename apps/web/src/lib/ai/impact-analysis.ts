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
import { IMPACT_MOCK_MODEL, isImpactMockMode } from './impact-runtime';
import { mockImpactFinalAnalysis, mockImpactMateriality, mockImpactSufficiency, mockImpactUpdateAnalysis } from '@platform/shared';

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
/** Originalets steg-standarder: 240 s per försök, högst 2 omförsök vid kapacitet/utfall. */
export const IMPACT_DEFAULT_TIMEOUT_MS = 240_000;
export const IMPACT_DEFAULT_MAX_RETRIES = 2;

export type ImpactFailureKind = 'configuration' | 'invalid_output' | 'unavailable' | 'empty_output' | 'timeout';

export interface ImpactStepConfig {
  step: ImpactPromptStep;
  timeoutMs: number;
  maxRetries: number;
}

function readInt(env: NodeJS.ProcessEnv, names: string[], fallback: number, min: number, max: number): number {
  for (const name of names) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') continue;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= min && n <= max) return n;
    console.warn('[impact-analysis] ignoring invalid env value', { name });
  }
  return fallback;
}

/** Per steg: `IMPACT_<STEG>_TIMEOUT_MS`/`IMPACT_AI_TIMEOUT_MS`, `IMPACT_<STEG>_MAX_RETRIES`/`IMPACT_AI_MAX_RETRIES` (Coolify, aldrig i kod). */
export function getImpactStepConfig(step: ImpactPromptStep, env: NodeJS.ProcessEnv = process.env): ImpactStepConfig {
  const prefix = `IMPACT_${step.toUpperCase()}`;
  return {
    step,
    timeoutMs: readInt(env, [`${prefix}_TIMEOUT_MS`, 'IMPACT_AI_TIMEOUT_MS'], IMPACT_DEFAULT_TIMEOUT_MS, 1, 600_000),
    maxRetries: readInt(env, [`${prefix}_MAX_RETRIES`, 'IMPACT_AI_MAX_RETRIES'], IMPACT_DEFAULT_MAX_RETRIES, 0, 5)
  };
}

class ImpactTimeoutError extends Error {
  constructor(ms: number) {
    super(`AI-steget tog längre än ${Math.round(ms / 1000)} s.`);
    this.name = 'ImpactTimeoutError';
  }
}

function withDeadline<T>(run: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ImpactTimeoutError(ms)), ms);
    run().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

const RETRYABLE = new Set([0, 408, 429, 500, 502, 503, 504]);

function mockStep(step: ImpactPromptStep, input: unknown): unknown {
  switch (step) {
    case 'materiality':
      return mockImpactMateriality(input as ImpactMaterialityAIInput);
    case 'sufficiency':
      return mockImpactSufficiency(input as ImpactSufficiencyAIInput);
    case 'final':
      return mockImpactFinalAnalysis(input as ImpactFinalAnalysisAIInput);
    case 'update':
      return mockImpactUpdateAnalysis(input as ImpactUpdateAnalysisAIInput);
  }
}

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
  unavailable: 'AI-tjänsten är tillfälligt otillgänglig. Underlaget är sparat och du kan försöka igen.',
  timeout: 'AI-analysen tog för lång tid och avbröts. Underlaget är sparat och du kan försöka igen.'
};

function serializeInput(input: unknown): string {
  return JSON.stringify(input) ?? 'null';
}

async function runStep<T>(step: ImpactPromptStep, input: unknown, normalize: (raw: unknown) => T): Promise<ImpactAiOutcome<T>> {
  const startedAt = Date.now();
  const config = getImpactStepConfig(step);
  const fail = (kind: ImpactFailureKind, model: string, raw: unknown, usage: ImpactAiUsage, retryCount: number): ImpactAiOutcome<T> => {
    const latencyMs = Date.now() - startedAt;
    console.info(JSON.stringify({ event: 'movexum.impact_ai_step', step, model, latencyMs, retryCount, ...usage, success: false, errorKind: kind }));
    return { result: null, raw, model, promptVersion: IMPACT_PROMPT_VERSION, usage, latencyMs, error: IMPACT_FAILURE_MESSAGES[kind], errorKind: kind };
  };
  const succeed = (result: T, raw: unknown, model: string, usage: ImpactAiUsage, retryCount: number): ImpactAiOutcome<T> => {
    const latencyMs = Date.now() - startedAt;
    console.info(JSON.stringify({ event: 'movexum.impact_ai_step', step, model, latencyMs, retryCount, ...usage, success: true }));
    return { result, raw, model, promptVersion: IMPACT_PROMPT_VERSION, usage, latencyMs };
  };

  // Mockläge (originalets MockAIService): deterministiskt svar, inga tokens —
  // går genom SAMMA normalisering som ett modellsvar.
  if (isImpactMockMode()) {
    const usage = { tokensIn: 0, tokensOut: 0 };
    const raw = mockStep(step, input);
    try {
      return succeed(normalize(raw), raw, IMPACT_MOCK_MODEL, usage, 0);
    } catch (err) {
      console.warn('[impact-analysis] mock normalize failed', { step, kind: err instanceof Error ? err.name : 'error' });
      return fail('invalid_output', IMPACT_MOCK_MODEL, raw, usage, 0);
    }
  }

  const system = buildImpactSystemPrompt(step);
  const user = `${IMPACT_DYNAMIC_INPUT_PREAMBLE}\n${serializeInput(input)}`;
  let retryCount = 0;
  for (;;) {
    try {
      const res = await withDeadline(
        () =>
          callMistralWithFallback(
            IMPACT_MODELS,
            [
              { role: 'system', content: system },
              { role: 'user', content: user }
            ],
            { temperature: TEMPERATURE, maxTokens: MAX_TOKENS, responseFormat: 'json_object' }
          ),
        config.timeoutMs
      );
      const usage = { tokensIn: res.usage.prompt_tokens, tokensOut: res.usage.completion_tokens };
      const raw = parseImpactModelJson(res.text);
      if (!raw) {
        console.warn('[impact-analysis] no json in model answer', { step, model: res.modelUsed, finish: res.finishReason });
        return fail('empty_output', res.modelUsed, null, usage, retryCount);
      }
      let result: T;
      try {
        result = normalize(raw);
      } catch (err) {
        console.warn('[impact-analysis] normalize failed', { step, model: res.modelUsed, kind: err instanceof Error ? err.name : 'error' });
        return fail('invalid_output', res.modelUsed, raw, usage, retryCount);
      }
      return succeed(result, raw, res.modelUsed, usage, retryCount);
    } catch (err) {
      const usage = { tokensIn: 0, tokensOut: 0 };
      if (err instanceof ImpactTimeoutError) {
        console.warn('[impact-analysis] timeout', { step, timeoutMs: config.timeoutMs, retryCount });
        return fail('timeout', IMPACT_MODELS[0], null, usage, retryCount);
      }
      const status = err instanceof MistralError ? err.status : -1;
      if (status === 0 && /saknas/i.test(String((err as Error).message))) {
        console.warn('[impact-analysis] not configured', { step });
        return fail('configuration', IMPACT_MODELS[0], null, usage, retryCount);
      }
      if (RETRYABLE.has(status) && retryCount < config.maxRetries) {
        retryCount += 1;
        console.warn('[impact-analysis] retrying', { step, status, retryCount });
        await new Promise((r) => setTimeout(r, 500 * retryCount));
        continue;
      }
      console.warn('[impact-analysis] failed', { step, status, retryCount });
      return fail('unavailable', IMPACT_MODELS[0], null, usage, retryCount);
    }
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
