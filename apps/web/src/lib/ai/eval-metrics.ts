/**
 * Ren, IO-fri retrieval-evaluering för RAG (CLAUDE.md § 26.5 — "eval-harness").
 *
 * Mäter hur bra sökningen hämtar RÄTT källor mot ett gyllene set (query →
 * förväntade relevanta käll-id). Detta är skillnaden mellan att GISSA att
 * hybrid/MMR/rerank blev bättre och att MÄTA det: kör samma gyllene set före
 * och efter en ändring och jämför recall/MRR/nDCG.
 *
 * Medvetet fri från `server-only`/PocketBase/`@/` så att den kan ENHETSTESTAS
 * och köras av en fristående runner (scripts/rag-eval.mjs). Den faktiska
 * retrievaln (`searchOrgKnowledge`) körs separat — den här modulen poängsätter
 * bara resultatet.
 */

export interface EvalScoredCase {
  /** Förväntade relevanta käll-id (eller titlar) — facit. */
  relevant: string[];
  /** Returnerade käll-id i rankordning (bäst först). */
  retrieved: string[];
}

const relevantSet = (relevant: string[]): Set<string> => new Set(relevant);

/** Andel av facit som återfanns bland topp-K (täckning). */
export function recallAtK(relevant: string[], retrieved: string[], k: number): number {
  if (relevant.length === 0) return 1; // inget att hitta → trivialt uppfyllt
  const rel = relevantSet(relevant);
  const top = retrieved.slice(0, k);
  let hits = 0;
  for (const id of top) if (rel.has(id)) hits++;
  return hits / rel.size;
}

/** Andel av topp-K som var relevanta (precision). */
export function precisionAtK(relevant: string[], retrieved: string[], k: number): number {
  const top = retrieved.slice(0, k);
  if (top.length === 0) return 0;
  const rel = relevantSet(relevant);
  let hits = 0;
  for (const id of top) if (rel.has(id)) hits++;
  return hits / top.length;
}

/** 1 om minst en relevant källa finns i topp-K, annars 0. */
export function hitAtK(relevant: string[], retrieved: string[], k: number): number {
  if (relevant.length === 0) return 1;
  const rel = relevantSet(relevant);
  return retrieved.slice(0, k).some((id) => rel.has(id)) ? 1 : 0;
}

/** Reciprocal rank: 1/(rangen för första relevanta träffen), annars 0. */
export function reciprocalRank(relevant: string[], retrieved: string[]): number {
  const rel = relevantSet(relevant);
  for (let i = 0; i < retrieved.length; i++) {
    if (rel.has(retrieved[i])) return 1 / (i + 1);
  }
  return 0;
}

/** Normaliserad DCG@K med binära relevansvärden (0/1). */
export function ndcgAtK(relevant: string[], retrieved: string[], k: number): number {
  const rel = relevantSet(relevant);
  let dcg = 0;
  const top = retrieved.slice(0, k);
  for (let i = 0; i < top.length; i++) {
    if (rel.has(top[i])) dcg += 1 / Math.log2(i + 2);
  }
  // Ideal DCG: alla relevanta ligger först (begränsat av K).
  const idealHits = Math.min(rel.size, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 1 : dcg / idcg;
}

export interface AggregateMetrics {
  cases: number;
  k: number;
  recallAtK: number;
  precisionAtK: number;
  mrr: number;
  ndcgAtK: number;
  hitRate: number;
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Aggregerar metrik över ett gyllene set (medel över fall). */
export function aggregate(cases: EvalScoredCase[], k = 6): AggregateMetrics {
  return {
    cases: cases.length,
    k,
    recallAtK: mean(cases.map((c) => recallAtK(c.relevant, c.retrieved, k))),
    precisionAtK: mean(cases.map((c) => precisionAtK(c.relevant, c.retrieved, k))),
    mrr: mean(cases.map((c) => reciprocalRank(c.relevant, c.retrieved))),
    ndcgAtK: mean(cases.map((c) => ndcgAtK(c.relevant, c.retrieved, k))),
    hitRate: mean(cases.map((c) => hitAtK(c.relevant, c.retrieved, k)))
  };
}
