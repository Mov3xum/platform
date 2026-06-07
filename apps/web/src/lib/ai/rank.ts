/**
 * Ren, IO-fri rankningsmatematik för RAG-retrieval (CLAUDE.md § 26–§27).
 *
 * Medvetet fri från `server-only`, PocketBase och `@/`-importer så att logiken
 * kan ENHETSTESTAS (körs av `yarn test` via apps/web/src/lib/ai/rank.test.ts) —
 * samma mönster som `fuzzy.ts` och `redaction.ts`. `rag.ts` (server-only)
 * orkestrerar hämtning + embeddings och delegerar all ranking hit.
 */

/** Cosine-similaritet mellan två vektorer. 0 vid degenererad input. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Reciprocal Rank Fusion: slår ihop flera rankade id-listor till en kombinerad
 * poäng. Robust mot att de olika sökmetoderna (semantisk vs nyckelord) har
 * helt olika poängskalor — bara RANG-ordningen räknas. `k` dämpar svansens
 * inflytande (standardvärdet 60 från originalpappret, Cormack et al. 2009).
 *
 * @param lists  ordnade id-listor (index 0 = bäst i den listan).
 * @returns      Map id → fusionspoäng (högre = bättre).
 */
export function reciprocalRankFusion(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (let idx = 0; idx < list.length; idx++) {
      const id = list[idx];
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + idx + 1));
    }
  }
  return scores;
}

/** Min-max-normaliserar en poäng-map till [0,1]. Tom/konstant input → alla 1. */
export function normalizeScores(scores: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  if (scores.size === 0) return out;
  let min = Infinity;
  let max = -Infinity;
  for (const v of scores.values()) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  for (const [id, v] of scores) {
    out.set(id, span > 0 ? (v - min) / span : 1);
  }
  return out;
}

export interface MmrInput {
  /** Kandidat-id (valfri ordning). */
  ids: string[];
  /** Relevanspoäng per id, förväntat normaliserat till [0,1]. */
  relevance: Map<string, number>;
  /** Embeddings per id (för diversitetsstraffet). Saknas → max diversitet. */
  vectors: Map<string, number[]>;
  /** Vikt på relevans vs diversitet (0..1, default 0.7 = relevansvänlig). */
  lambda?: number;
  /** Hur många som ska väljas. */
  topK: number;
}

/**
 * Maximal Marginal Relevance: girig urvalsordning som balanserar relevans mot
 * inbördes olikhet, så att överlappande chunkar (vi chunkar med 200 teckens
 * overlap → näst intill dubbletter) inte fyller hela topp-K. En kandidat utan
 * embedding får inget diversitetsstraff och kan fortfarande väljas på relevans.
 */
export function mmrOrder(input: MmrInput): string[] {
  const lambda = input.lambda ?? 0.7;
  const selected: string[] = [];
  const remaining = new Set(input.ids);

  while (selected.length < input.topK && remaining.size > 0) {
    let bestId: string | null = null;
    let bestScore = -Infinity;
    for (const id of remaining) {
      const rel = input.relevance.get(id) ?? 0;
      let maxSim = 0;
      const v = input.vectors.get(id);
      if (v) {
        for (const s of selected) {
          const sv = input.vectors.get(s);
          if (sv) {
            const sim = cosineSimilarity(v, sv);
            if (sim > maxSim) maxSim = sim;
          }
        }
      }
      const score = lambda * rel - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
    if (!bestId) break;
    selected.push(bestId);
    remaining.delete(bestId);
  }
  return selected;
}
