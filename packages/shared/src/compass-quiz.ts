// Startupkompassen — quiz-poängsättning (ren, server/React-fri logik).
//
// Poängsättningen körs ALLTID server-side (i den publika API-routen) så att en
// besökare inte kan manipulera sitt resultat — klienten renderar bara det som
// API:t returnerar. Logiken bor här i `@platform/shared` för att kunna
// enhetstestas utan PocketBase/Next (samma mönster som de-minimis.ts).
//
// Två poängmodeller stöds, så att båda de seedade quizen funkar:
//   • Topp-hink (bucket-tally): varje svarsval pekar på en `bucket` (profil)
//     med en valfri `score` (vikt, default 1). Profilen med flest poäng vinner.
//     ("Är du entreprenör?" — builder/explorer/potential.)
//   • Intervall (range): varje val har en `score`; totalpoängen jämförs mot
//     hinkarnas `min`/`max`. ("Innovationspotential" — grön/gul/röd.)
// Vilken modell som används avgörs av om någon hink har `min`/`max` satt.

export interface QuizChoice {
  value: string;
  label: string;
  /** Poäng valet ger (default 1 i hink-läge, 0 om utelämnat i intervall-läge). */
  score?: number;
  /** Profil/hink valet pekar på (topp-hink-läge). */
  bucket?: string;
  /**
   * Multi-hink-läge: ett enda val kan ge poäng till FLERA profiler samtidigt
   * ({ builder: 2, explorer: 1, potential: 0 }). När `buckets` är satt har det
   * företräde framför `bucket`/`score`. Används av "Är du entreprenör?"-quizet.
   */
  buckets?: Record<string, number>;
}

export interface ResultBucket {
  key: string;
  label?: string;
  title: string;
  body: string;
  tips: string[];
  cta?: { label: string; url: string };
  /** Intervall-läge: nedre/övre gräns (inklusiv) för totalpoängen. */
  min?: number;
  max?: number;
}

/** En quiz-fråga reducerad till det poängsättningen behöver. */
export interface QuizQuestion {
  key: string;
  input_type: string;
  choices?: QuizChoice[];
}

export type QuizAnswer = string | string[] | number | undefined;

export interface QuizScore {
  total: number;
  byBucket: Record<string, number>;
}

function selectedValues(answer: QuizAnswer): string[] {
  if (answer === undefined || answer === null) return [];
  if (Array.isArray(answer)) return answer.map((v) => String(v));
  return [String(answer)];
}

/**
 * Summerar quiz-poäng från svaren. Returnerar totalpoäng + poäng per hink.
 * Saknade svar bidrar med 0. Skala-frågor bidrar med sitt numeriska värde.
 */
export function scoreQuiz(
  questions: QuizQuestion[],
  answers: Record<string, QuizAnswer>
): QuizScore {
  let total = 0;
  const byBucket: Record<string, number> = {};

  for (const q of questions) {
    const answer = answers[q.key];

    if (q.input_type === 'scale') {
      const n = Number(Array.isArray(answer) ? answer[0] : answer);
      if (Number.isFinite(n)) total += n;
      continue;
    }

    const chosen = selectedValues(answer);
    if (chosen.length === 0) continue;
    const choices = q.choices ?? [];
    for (const value of chosen) {
      const choice = choices.find((c) => c.value === value);
      if (!choice) continue;
      if (choice.buckets && typeof choice.buckets === 'object') {
        // Multi-hink: valet fördelar poäng över flera profiler samtidigt.
        for (const [key, raw] of Object.entries(choice.buckets)) {
          const weight = Number(raw);
          if (!Number.isFinite(weight)) continue;
          byBucket[key] = (byBucket[key] ?? 0) + weight;
          total += weight;
        }
      } else if (choice.bucket) {
        const weight = typeof choice.score === 'number' ? choice.score : 1;
        byBucket[choice.bucket] = (byBucket[choice.bucket] ?? 0) + weight;
        total += weight;
      } else if (typeof choice.score === 'number') {
        total += choice.score;
      }
    }
  }

  return { total, byBucket };
}

function bucketsUseRanges(buckets: ResultBucket[]): boolean {
  return buckets.some((b) => typeof b.min === 'number' || typeof b.max === 'number');
}

/**
 * Väljer vinnande resultatprofil. Intervall-läge om någon hink har min/max,
 * annars topp-hink (flest poäng). Returnerar null om ingen matchar.
 */
export function resolveBucket(score: QuizScore, buckets: ResultBucket[]): ResultBucket | null {
  if (buckets.length === 0) return null;

  if (bucketsUseRanges(buckets)) {
    const match = buckets.find((b) => {
      const lo = typeof b.min === 'number' ? b.min : -Infinity;
      const hi = typeof b.max === 'number' ? b.max : Infinity;
      return score.total >= lo && score.total <= hi;
    });
    return match ?? null;
  }

  // Topp-hink: högst poäng vinner; oavgjort → första i buckets-ordningen.
  let best: ResultBucket | null = null;
  let bestScore = -Infinity;
  for (const b of buckets) {
    const s = score.byBucket[b.key] ?? 0;
    if (s > bestScore) {
      bestScore = s;
      best = b;
    }
  }
  return best;
}

/** Type-guard som validerar en (parsad) result_buckets-array från DB:n. */
export function isResultBucketArray(v: unknown): v is ResultBucket[] {
  if (!Array.isArray(v)) return false;
  return v.every(
    (b) =>
      b &&
      typeof b === 'object' &&
      typeof (b as ResultBucket).key === 'string' &&
      typeof (b as ResultBucket).title === 'string'
  );
}
