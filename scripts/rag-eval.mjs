// RAG eval-runner (CLAUDE.md § 26.5).
//
// OFFLINE-SCORING (kör nu, inga hemligheter krävs):
//   node --experimental-strip-types scripts/rag-eval.mjs <results.jsonl> [--k 6]
//
// Varje rad i <results.jsonl> är ett JSON-objekt:
//   {"query": "...", "relevant": ["id1","id2"], "retrieved": ["idA","idB",...]}
// där `retrieved` är käll-id i rankordning som RAG returnerade för frågan, och
// `relevant` är facit. Skriptet skriver ut recall@K, precision@K, MRR, nDCG@K
// och hit-rate (medel över fall).
//
// SÅ FÅR DU `retrieved` (live-läge — när ni börjar mäta):
//   Retrievaln (`searchOrgKnowledge`/`searchUserFiles` i apps/web/src/lib/ai/rag.ts)
//   är server-only och kräver PB + MISTRAL_API_KEY, så den körs inifrån appen.
//   Lägg en tillfällig admin-route/server-action som för varje rad i
//   eval/rag-golden.jsonl kör searchOrgKnowledge({ tenant, query }) och skriver
//   ut hits.map(h => h.sourceId) som `retrieved`. Mata den filen hit för poäng.
//   (Avsiktligt inte inbyggt här — håller runnern hemlighetsfri och CI-vänlig.)

import { readFileSync } from 'node:fs';
import { aggregate } from '../apps/web/src/lib/ai/eval-metrics.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const kArg = args.indexOf('--k');
const k = kArg !== -1 && args[kArg + 1] ? Number(args[kArg + 1]) : 6;

if (!file) {
  console.error('Användning: node --experimental-strip-types scripts/rag-eval.mjs <results.jsonl> [--k 6]');
  process.exit(1);
}

const lines = readFileSync(file, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);

const cases = [];
for (const line of lines) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    console.warn('Hoppar över ogiltig JSON-rad:', line.slice(0, 80));
    continue;
  }
  if (!Array.isArray(row.retrieved)) {
    console.warn(`Raden "${row.query ?? '?'}" saknar "retrieved" — hoppar över.`);
    continue;
  }
  cases.push({
    relevant: Array.isArray(row.relevant) ? row.relevant.map(String) : [],
    retrieved: row.retrieved.map(String)
  });
}

if (cases.length === 0) {
  console.error('Inga poängsättbara fall (varje rad behöver "retrieved").');
  process.exit(1);
}

const m = aggregate(cases, k);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log(`\nRAG eval — ${m.cases} fall, K=${m.k}\n`);
console.log(`  recall@${k}     ${pct(m.recallAtK)}`);
console.log(`  precision@${k}  ${pct(m.precisionAtK)}`);
console.log(`  hit-rate@${k}   ${pct(m.hitRate)}`);
console.log(`  MRR           ${m.mrr.toFixed(3)}`);
console.log(`  nDCG@${k}      ${m.ndcgAtK.toFixed(3)}\n`);
