import 'server-only';
import type PocketBase from 'pocketbase';
import {
  applyQuizTextVerdicts,
  buildQuizTextScoringMessage,
  formatQuizTextNote,
  isResultBucketArray,
  isSurveyModule,
  parseQuizTextVerdicts,
  quizAiInstruction,
  quizSupportsTextScoring,
  quizTextItems,
  quizTextWeight,
  resolveBucket,
  scoreQuiz,
  type QuizScore,
  type ResultBucket
} from '@platform/shared';
import { callMistral } from '@/lib/ai/mistral';
import { assertWithinAiBudget } from '@/lib/ai/budget.server';
import { logAiUsage } from '@/lib/ai/usage';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { buildQuizTextScoringPrompt } from './prompts';
import type { CompassModule, CompassQuestion } from './types';

/* ────────────────────────────────────────────────────────────────────
   Quizets poängsättning — delad av den publika routen och admin-previewen
   (CLAUDE.md § 23.3 + § 23.14, ingen divergerande kopia).

   Kryssfrågorna räknas deterministiskt (`scoreQuiz`). Har modulen en
   bedömningsinstruktion (`system_prompt`) pekas dessutom varje fritextsvar
   mot högst en resultatprofil av en modell, med fast låg vikt. AI-steget är
   best-effort: saknad nyckel, nått kostnadstak, tidsgräns eller otolkbart
   svar ⇒ resultatet räknas på kryssfrågorna, exakt som utan AI.
   ──────────────────────────────────────────────────────────────────── */

const MODEL = 'mistral-small-latest';
const TIMEOUT_MS = 12_000;
const MAX_PER_TENANT_HOUR = 300;

// Personnummer-sanering (§ 15.6-regexen) — före modellanropet OCH på
// motiveringen som sparas på leadet.
const PERSONNUMMER_RE = /\d{6,8}[-+]?\d{4}/g;
const redact = (s: string): string => s.replace(PERSONNUMMER_RE, '[REDACTED]');

export interface QuizOutcome {
  score: QuizScore;
  bucket: ResultBucket | null;
  /** Sant när minst ett fritextsvar bedömts av AI och räknats in. */
  aiAssessed: boolean;
  /** Personalens spår på leadet (tomt utan AI-bedömning). Aldrig till besökaren. */
  aiNote: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
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

export async function scoreQuizSubmission(
  pb: PocketBase,
  tenant: string,
  module: CompassModule,
  questions: CompassQuestion[],
  answers: Record<string, string | string[]>,
  actor: { userId?: string | null } = {}
): Promise<QuizOutcome> {
  const buckets = isResultBucketArray(module.result_buckets) ? module.result_buckets : [];
  const base = scoreQuiz(
    questions.map((q) => ({ key: q.key, input_type: q.input_type, choices: q.choices })),
    answers
  );
  const deterministic: QuizOutcome = {
    score: base,
    bucket: resolveBucket(base, buckets),
    aiAssessed: false,
    aiNote: ''
  };

  // Enkäter (§ 43) är alltid deterministiska.
  const instruction = quizAiInstruction(module.system_prompt);
  if (!instruction || isSurveyModule(module) || !quizSupportsTextScoring(buckets)) return deterministic;
  const items = quizTextItems(questions, answers).map((i) => ({ ...i, answer: redact(i.answer) }));
  if (items.length === 0) return deterministic;

  try {
    // Kostnadsskydd som AI-sammanställningen (§ 23.6): tak per tenant/timme
    // oavsett IP + månadstaket (§ 9.6) före modellanropet.
    const tenantKey = `quiz-ai:${tenant}`;
    if ((await checkRateLimit(tenantKey, MAX_PER_TENANT_HOUR)).blocked) return deterministic;
    await recordFailure(tenantKey, 60 * 60 * 1000);
    await assertWithinAiBudget(pb, tenant);

    const res = await withTimeout(
      callMistral(
        MODEL,
        [
          { role: 'system', content: buildQuizTextScoringPrompt(instruction) },
          { role: 'user', content: buildQuizTextScoringMessage(items, buckets) }
        ],
        { temperature: 0, maxTokens: 700, responseFormat: 'json_object' }
      ),
      TIMEOUT_MS
    );
    await logAiUsage(pb, {
      tenant,
      userId: actor.userId ?? null,
      surface: 'suggestions',
      model: MODEL,
      tokensIn: Number(res.usage?.prompt_tokens) || 0,
      tokensOut: Number(res.usage?.completion_tokens) || 0
    });

    const verdicts = parseQuizTextVerdicts(
      res.text,
      items,
      buckets.map((b) => b.key)
    ).map((v) => ({ ...v, reason: redact(v.reason) }));
    if (verdicts.length === 0) return deterministic;

    const weight = quizTextWeight(questions);
    const score = applyQuizTextVerdicts(base, verdicts, weight);
    return {
      score,
      bucket: resolveBucket(score, buckets),
      aiAssessed: verdicts.some((v) => v.bucket),
      aiNote: formatQuizTextNote(verdicts, items, buckets, weight)
    };
  } catch (err) {
    // PII-fri logg: aldrig svar eller instruktion.
    console.warn('[compass] quiz text scoring skipped', {
      reason: err instanceof Error ? err.name : 'unknown'
    });
    return deterministic;
  }
}
