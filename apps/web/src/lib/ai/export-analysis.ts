import 'server-only';

import {
  EXPORT_DYNAMIC_INPUT_PREAMBLE,
  EXPORT_PROMPT_VERSION,
  buildExportSystemPrompt,
  mockExportPlan,
  mockExportProfile,
  mockExportSufficiency,
  mockExportUpdate,
  normalizeExportPlan,
  normalizeExportProfile,
  normalizeExportSufficiency,
  normalizeExportUpdateAnalysis,
  parseExportModelJson,
  type ExportPlan,
  type ExportPlanAIInput,
  type ExportProfile,
  type ExportProfileAIInput,
  type ExportStep,
  type ExportSufficiency,
  type ExportSufficiencyAIInput,
  type ExportUpdateAIInput,
  type ExportUpdateAnalysis
} from '@platform/shared';
import { callMistralWithFallback, MistralError } from './mistral';
import { EXPORT_MOCK_MODEL, isExportMockMode } from './export-runtime';

// ─────────────────────────────────────────────────────────────────────────────
// Export Lab — AI-stegen (CLAUDE.md § 58). Fyra isolerade Mistral-körningar
// (large → medium vid 429/5xx, låg temperatur, inga verktyg, JSON-läge) med
// systemprompten ur export-lab-prompts.ts och det dynamiska underlaget i
// USER-rollen. Svaret tvingas in i typerna av de rena, enhetstestade
// normaliserarna — modellen skriver aldrig till databasen.
//   1. profile     — exportprofil, väg, mognad, marknadsurval (CAGE), regelverk
//   2. sufficiency — räcker underlaget? annars EN fråga per marknad/dimension
//   3. plan        — exportplanen
//   4. update      — state + delta → uppdaterad plan + deltaSummary
// Säkerhet (§ 9.3): bolagets underlag är DATA, inte instruktioner. Texten är
// personnummer-sanerad på skrivvägen. EU-suveränt: Mistral (FR). Riskklass:
// begränsad (beslutsstöd om bolag, människa granskar varje steg).
// ─────────────────────────────────────────────────────────────────────────────

export const EXPORT_MODELS = ['mistral-large-latest', 'mistral-medium-latest'];
const MAX_TOKENS = 12000;
const TEMPERATURE = 0.2;
export const EXPORT_DEFAULT_TIMEOUT_MS = 240_000;
export const EXPORT_DEFAULT_MAX_RETRIES = 2;

export type ExportFailureKind = 'configuration' | 'invalid_output' | 'unavailable' | 'empty_output' | 'timeout';

export interface ExportStepConfig {
  step: ExportStep;
  timeoutMs: number;
  maxRetries: number;
}

function readInt(env: NodeJS.ProcessEnv, names: string[], fallback: number, min: number, max: number): number {
  for (const name of names) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') continue;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= min && n <= max) return n;
    console.warn('[export-analysis] ignoring invalid env value', { name });
  }
  return fallback;
}

/** Per steg: `EXPORT_LAB_<STEG>_TIMEOUT_MS`/`EXPORT_LAB_AI_TIMEOUT_MS`, `EXPORT_LAB_<STEG>_MAX_RETRIES`/`EXPORT_LAB_AI_MAX_RETRIES`. */
export function getExportStepConfig(step: ExportStep, env: NodeJS.ProcessEnv = process.env): ExportStepConfig {
  const prefix = `EXPORT_LAB_${step.toUpperCase()}`;
  return {
    step,
    timeoutMs: readInt(env, [`${prefix}_TIMEOUT_MS`, 'EXPORT_LAB_AI_TIMEOUT_MS'], EXPORT_DEFAULT_TIMEOUT_MS, 1, 600_000),
    maxRetries: readInt(env, [`${prefix}_MAX_RETRIES`, 'EXPORT_LAB_AI_MAX_RETRIES'], EXPORT_DEFAULT_MAX_RETRIES, 0, 5)
  };
}

class ExportTimeoutError extends Error {
  constructor(ms: number) {
    super(`AI-steget tog längre än ${Math.round(ms / 1000)} s.`);
    this.name = 'ExportTimeoutError';
  }
}

function withDeadline<T>(run: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ExportTimeoutError(ms)), ms);
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

function mockStep(step: ExportStep, input: unknown): unknown {
  switch (step) {
    case 'profile':
      return mockExportProfile(input as ExportProfileAIInput);
    case 'sufficiency':
      return mockExportSufficiency(input as ExportSufficiencyAIInput);
    case 'plan':
      return mockExportPlan(input as ExportPlanAIInput);
    case 'update':
      return mockExportUpdate(input as ExportUpdateAIInput);
  }
}

export interface ExportAiUsage {
  tokensIn: number;
  tokensOut: number;
}

export interface ExportAiOutcome<T> {
  result: T | null;
  raw: unknown;
  model: string;
  promptVersion: string;
  usage: ExportAiUsage;
  latencyMs: number;
  error?: string;
  errorKind?: ExportFailureKind;
}

export const EXPORT_FAILURE_MESSAGES: Record<ExportFailureKind, string> = {
  configuration: 'AI-tjänsten är inte korrekt konfigurerad. Underlaget är sparat; kontakta en administratör innan du försöker igen.',
  invalid_output: 'AI-tjänsten returnerade inget användbart analysresultat. Underlaget är sparat och du kan försöka igen.',
  empty_output: 'AI-tjänsten returnerade inget strukturerat analysresultat. Underlaget är sparat och du kan försöka igen.',
  unavailable: 'AI-tjänsten är tillfälligt otillgänglig. Underlaget är sparat och du kan försöka igen.',
  timeout: 'AI-analysen tog för lång tid och avbröts. Underlaget är sparat och du kan försöka igen.'
};

async function runStep<T>(step: ExportStep, input: unknown, normalize: (raw: unknown) => T): Promise<ExportAiOutcome<T>> {
  const startedAt = Date.now();
  const config = getExportStepConfig(step);
  const fail = (kind: ExportFailureKind, model: string, raw: unknown, usage: ExportAiUsage, retryCount: number): ExportAiOutcome<T> => {
    const latencyMs = Date.now() - startedAt;
    console.info(JSON.stringify({ event: 'movexum.export_ai_step', step, model, latencyMs, retryCount, ...usage, success: false, errorKind: kind }));
    return { result: null, raw, model, promptVersion: EXPORT_PROMPT_VERSION, usage, latencyMs, error: EXPORT_FAILURE_MESSAGES[kind], errorKind: kind };
  };
  const succeed = (result: T, raw: unknown, model: string, usage: ExportAiUsage, retryCount: number): ExportAiOutcome<T> => {
    const latencyMs = Date.now() - startedAt;
    console.info(JSON.stringify({ event: 'movexum.export_ai_step', step, model, latencyMs, retryCount, ...usage, success: true }));
    return { result, raw, model, promptVersion: EXPORT_PROMPT_VERSION, usage, latencyMs };
  };

  if (isExportMockMode()) {
    const usage = { tokensIn: 0, tokensOut: 0 };
    const raw = mockStep(step, input);
    try {
      return succeed(normalize(raw), raw, EXPORT_MOCK_MODEL, usage, 0);
    } catch (err) {
      console.warn('[export-analysis] mock normalize failed', { step, kind: err instanceof Error ? err.name : 'error' });
      return fail('invalid_output', EXPORT_MOCK_MODEL, raw, usage, 0);
    }
  }

  const system = buildExportSystemPrompt(step);
  const user = `${EXPORT_DYNAMIC_INPUT_PREAMBLE}\n${JSON.stringify(input) ?? 'null'}`;
  let retryCount = 0;
  for (;;) {
    try {
      const res = await withDeadline(
        () =>
          callMistralWithFallback(
            EXPORT_MODELS,
            [
              { role: 'system', content: system },
              { role: 'user', content: user }
            ],
            { temperature: TEMPERATURE, maxTokens: MAX_TOKENS, responseFormat: 'json_object' }
          ),
        config.timeoutMs
      );
      const usage = { tokensIn: res.usage.prompt_tokens, tokensOut: res.usage.completion_tokens };
      const raw = parseExportModelJson(res.text);
      if (!raw) {
        console.warn('[export-analysis] no json in model answer', { step, model: res.modelUsed, finish: res.finishReason });
        return fail('empty_output', res.modelUsed, null, usage, retryCount);
      }
      let result: T;
      try {
        result = normalize(raw);
      } catch (err) {
        console.warn('[export-analysis] normalize failed', { step, model: res.modelUsed, kind: err instanceof Error ? err.name : 'error' });
        return fail('invalid_output', res.modelUsed, raw, usage, retryCount);
      }
      return succeed(result, raw, res.modelUsed, usage, retryCount);
    } catch (err) {
      const usage = { tokensIn: 0, tokensOut: 0 };
      if (err instanceof ExportTimeoutError) {
        console.warn('[export-analysis] timeout', { step, timeoutMs: config.timeoutMs, retryCount });
        return fail('timeout', EXPORT_MODELS[0], null, usage, retryCount);
      }
      const status = err instanceof MistralError ? err.status : -1;
      if (status === 0 && /saknas/i.test(String((err as Error).message))) {
        console.warn('[export-analysis] not configured', { step });
        return fail('configuration', EXPORT_MODELS[0], null, usage, retryCount);
      }
      if (RETRYABLE.has(status) && retryCount < config.maxRetries) {
        retryCount += 1;
        console.warn('[export-analysis] retrying', { step, status, retryCount });
        await new Promise((r) => setTimeout(r, 500 * retryCount));
        continue;
      }
      console.warn('[export-analysis] failed', { step, status, retryCount });
      return fail('unavailable', EXPORT_MODELS[0], null, usage, retryCount);
    }
  }
}

export function runExportProfile(input: ExportProfileAIInput): Promise<ExportAiOutcome<ExportProfile>> {
  return runStep('profile', input, normalizeExportProfile);
}
export function runExportSufficiency(input: ExportSufficiencyAIInput): Promise<ExportAiOutcome<ExportSufficiency>> {
  return runStep('sufficiency', input, normalizeExportSufficiency);
}
export function runExportPlan(input: ExportPlanAIInput): Promise<ExportAiOutcome<ExportPlan>> {
  return runStep('plan', input, normalizeExportPlan);
}
export function runExportUpdate(input: ExportUpdateAIInput): Promise<ExportAiOutcome<ExportUpdateAnalysis>> {
  return runStep('update', input, normalizeExportUpdateAnalysis);
}
