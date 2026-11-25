// Startupkompassen — AI-bedömning av fritextsvar i quiz (ren, IO-fri logik).
//
// Ett quiz räknar poäng på svarsalternativ (compass-quiz.ts). Har modulen en
// bedömningsinstruktion (`compass_modules.system_prompt`) får dessutom varje
// fritextsvar pekas mot HÖGST EN resultatprofil av en modell — med en fast,
// låg vikt, så att texten kan avgöra ett jämnt läge men aldrig köra över
// kryssfrågorna. Den här modulen äger allt som inte är IO: vilka svar som
// bedöms, vikten, tolkningen av modellens svar (okända profiler/nycklar
// kastas) och sammanslagningen med de deterministiska poängen. Modellanropet
// ligger i apps/web/src/lib/compass/quiz-ai.ts.

import type { QuizAnswer, QuizChoice, QuizScore, ResultBucket } from './compass-quiz';

/** Frågetyper vars svar är fri text (e-post/telefon bedöms aldrig). */
export const QUIZ_TEXT_INPUT_TYPES: readonly string[] = ['short_text', 'long_text'];

/** Tak (defense-in-depth mot prompt-explosion och kostnad). */
export const QUIZ_TEXT_MAX_QUESTIONS = 8;
export const QUIZ_TEXT_ANSWER_MAX = 2000;
export const QUIZ_TEXT_REASON_MAX = 200;
export const QUIZ_AI_INSTRUCTION_MAX = 8000;

export interface QuizTextQuestion {
  key: string;
  input_type: string;
  prompt: string;
  choices?: QuizChoice[];
}

export interface QuizTextItem {
  key: string;
  question: string;
  answer: string;
}

export interface QuizTextVerdict {
  key: string;
  /** Profilens nyckel exakt som i `result_buckets`, eller null = inga poäng. */
  bucket: string | null;
  reason: string;
}

/** Modulens bedömningsinstruktion, trimmad och cappad. Tom = ingen AI-bedömning. */
export function quizAiInstruction(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, QUIZ_AI_INSTRUCTION_MAX) : '';
}

/**
 * AI-bedömningen gäller bara topp-hink-quiz (profilen med flest poäng vinner)
 * med minst två profiler. I intervall-läge (min/max) finns ingen profil att
 * peka svaret mot.
 */
export function quizSupportsTextScoring(buckets: ResultBucket[]): boolean {
  if (buckets.length < 2) return false;
  return !buckets.some((b) => typeof b.min === 'number' || typeof b.max === 'number');
}

/** Besvarade fritextfrågor, i frågornas ordning. */
export function quizTextItems(
  questions: QuizTextQuestion[],
  answers: Record<string, QuizAnswer>
): QuizTextItem[] {
  const items: QuizTextItem[] = [];
  for (const q of questions) {
    if (!QUIZ_TEXT_INPUT_TYPES.includes(q.input_type)) continue;
    const raw = answers[q.key];
    if (typeof raw !== 'string') continue;
    const answer = raw.trim().slice(0, QUIZ_TEXT_ANSWER_MAX);
    if (!answer) continue;
    items.push({ key: q.key, question: String(q.prompt || '').trim().slice(0, 300), answer });
    if (items.length >= QUIZ_TEXT_MAX_QUESTIONS) break;
  }
  return items;
}

function topChoiceWeight(choices: QuizChoice[] | undefined): number {
  let top = 0;
  for (const c of choices ?? []) {
    if (c.buckets && typeof c.buckets === 'object') {
      for (const raw of Object.values(c.buckets)) {
        const n = Number(raw);
        if (Number.isFinite(n) && n > top) top = n;
      }
    } else if (c.bucket) {
      const n = typeof c.score === 'number' ? c.score : 1;
      if (Number.isFinite(n) && n > top) top = n;
    }
  }
  return top;
}

/**
 * Vikten ett fritextsvar får: lika mycket som quizets LÄTTASTE poängsatta
 * kryssfråga kan ge en profil (1 när inga kryssfrågor har poäng). Ett quiz
 * som räknar 1/2 får alltså 1 per fritextsvar, ett som räknar 10/20 får 10.
 */
export function quizTextWeight(questions: QuizTextQuestion[]): number {
  let lightest = Infinity;
  for (const q of questions) {
    const top = topChoiceWeight(q.choices);
    if (top > 0 && top < lightest) lightest = top;
  }
  return Number.isFinite(lightest) ? lightest : 1;
}

function extractJsonObject(raw: string): unknown {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Tolkar modellens svar `{ "answers": [{ "key", "bucket", "reason" }] }`.
 * Allt som inte matchar en fråga som faktiskt skickades eller en profil som
 * faktiskt finns kastas — modellen kan aldrig hitta på en profil, bedöma en
 * fråga två gånger eller ge mer än ett utslag per svar. Otolkbart svar ⇒ [].
 */
export function parseQuizTextVerdicts(
  raw: string,
  items: QuizTextItem[],
  bucketKeys: string[]
): QuizTextVerdict[] {
  const parsed = extractJsonObject(raw);
  const list = parsed && typeof parsed === 'object' ? (parsed as { answers?: unknown }).answers : null;
  if (!Array.isArray(list)) return [];
  const itemKeys = new Set(items.map((i) => i.key));
  const canonical = new Map(bucketKeys.map((k) => [k.trim().toLowerCase(), k]));
  const seen = new Set<string>();
  const out: QuizTextVerdict[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const key = typeof rec.key === 'string' ? rec.key : '';
    if (!itemKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    const bucket =
      typeof rec.bucket === 'string' ? canonical.get(rec.bucket.trim().toLowerCase()) ?? null : null;
    const reason =
      typeof rec.reason === 'string'
        ? rec.reason.replace(/\s+/g, ' ').trim().slice(0, QUIZ_TEXT_REASON_MAX)
        : '';
    out.push({ key, bucket, reason });
  }
  return out;
}

/** Lägger AI-utslagen ovanpå de deterministiska poängen (muterar inte indata). */
export function applyQuizTextVerdicts(
  score: QuizScore,
  verdicts: QuizTextVerdict[],
  weight: number
): QuizScore {
  const byBucket = { ...score.byBucket };
  let total = score.total;
  const w = Number.isFinite(weight) && weight > 0 ? weight : 1;
  for (const v of verdicts) {
    if (!v.bucket) continue;
    byBucket[v.bucket] = (byBucket[v.bucket] ?? 0) + w;
    total += w;
  }
  return { total, byBucket };
}

/** Användarmeddelandet till modellen: profilerna + svaren som JSON (data). */
export function buildQuizTextScoringMessage(items: QuizTextItem[], buckets: ResultBucket[]): string {
  return JSON.stringify(
    {
      profiler: buckets.map((b) => ({ nyckel: b.key, titel: b.title })),
      svar: items.map((i) => ({ key: i.key, fraga: i.question, svar: i.answer }))
    },
    null,
    1
  );
}

/**
 * Personalens spår på leadet: vilket fritextsvar som pekades mot vilken
 * profil och varför. Besökaren ser aldrig detta.
 */
export function formatQuizTextNote(
  verdicts: QuizTextVerdict[],
  items: QuizTextItem[],
  buckets: ResultBucket[],
  weight: number
): string {
  if (verdicts.length === 0) return '';
  const question = new Map(items.map((i) => [i.key, i.question]));
  const title = new Map(buckets.map((b) => [b.key, b.title]));
  const lines = verdicts.map((v) => {
    const q = question.get(v.key) || v.key;
    const outcome = v.bucket
      ? `${title.get(v.bucket) || v.bucket} (+${weight} p)`
      : 'inga poäng';
    return `- "${q}": ${outcome}${v.reason ? ` — ${v.reason}` : ''}`;
  });
  return ['AI-bedömning av fritextsvar (genererad av AI – verifiera):', ...lines].join('\n');
}
