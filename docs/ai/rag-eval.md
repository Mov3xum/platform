# RAG eval-harness

Mäter hur bra chattens kunskaps-/filsökning (`searchOrgKnowledge` /
`searchUserFiles`, CLAUDE.md § 26–§ 27) hämtar **rätt källor**. Syftet är att
göra retrieval-kvalitet **mätbar** i stället för spekulativ: kör samma gyllene
set före och efter en ändring (chunkstorlek, top-K, hybrid-vikter, rerank på/av,
embedding-modell) och jämför.

## Status

Scaffold på plats — **inga gyllene fall ifyllda än** (medvetet; fylls av teamet
när ni börjar mäta). Metrik-koden är enhetstestad (`eval-metrics.test.ts`).

## Delar

| Fil | Roll |
|-----|------|
| `apps/web/src/lib/ai/eval-metrics.ts` | Ren metrik: recall@K, precision@K, MRR, nDCG@K, hit-rate (enhetstestad) |
| `eval/rag-golden.example.jsonl` | Mall för gyllene set (query → förväntade relevanta käll-id) |
| `scripts/rag-eval.mjs` | Offline-runner: poängsätter en resultatfil och skriver ut metrik |

## Arbetsflöde

1. **Bygg ett gyllene set.** Kopiera `eval/rag-golden.example.jsonl` →
   `eval/rag-golden.jsonl` och fyll med 30–50 verkliga Movexum-frågor. Per rad:
   `{"query": "...", "relevant": ["<källtitel eller org_knowledge-id>", ...]}`.
   `relevant` = de källor som *borde* komma upp.

2. **Generera `retrieved` (live-läge).** Retrievaln är server-only (kräver PB +
   `MISTRAL_API_KEY`), så den körs inifrån appen. Lägg en tillfällig
   admin-route/server-action som för varje fråga kör
   `searchOrgKnowledge({ tenant, query })` och skriver ut
   `hits.map(h => h.sourceId)` som fältet `retrieved` på raden. Spara resultatet
   som `eval/rag-results.jsonl`.

3. **Poängsätt (offline, inga hemligheter):**
   ```bash
   node --experimental-strip-types scripts/rag-eval.mjs eval/rag-results.jsonl --k 6
   ```
   Skriver ut recall@6, precision@6, hit-rate, MRR och nDCG@6 (medel över fall).

4. **Jämför över ändringar.** Spara siffrorna, gör en retrieval-ändring, kör om.
   En ändring som sänker recall/MRR ska inte mergas utan motivering.

## Tolkning

- **recall@K** — andel av facit som kom med i topp-K. Viktigast: missar vi rätt
  källa helt?
- **MRR / nDCG@K** — hamnar rätt källa *högt*? Mäter ranking, inte bara närvaro.
- **precision@K** — hur mycket brus i topp-K (för långa kontexter/kostnad).

## Nästa steg

- CI-mål när ett gyllene set finns: kör eval i en nattlig job (kräver
  PB-staging + Mistral-nyckel) och larma vid regression.
- Lägg svarskvalitet (LLM-as-judge mot facit-svar) ovanpå retrieval-metriken.
