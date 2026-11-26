import 'server-only';
import type PocketBase from 'pocketbase';
import { sanitizeSparkVector, sparkEmbeddingText, sparkTextHash } from '@platform/shared';
import { EMBEDDING_MODEL, embedTexts } from '@/lib/ai/mistral';
import { logIndexUsage } from '@/lib/ai/usage';
import type { SparkNeedRow, SparkSolutionRow } from './data';

/**
 * Innehållslikhet i SPARK (CLAUDE.md § 61.7): en embedding per behov och
 * lösning i `spark_embeddings`. Vektorerna läses bara på matchningssidan —
 * registrets vanliga läsningar bär dem inte. Reads/writes med användarens
 * token (Movexum-personal; RLS som registret).
 */

export const SPARK_EMBEDDINGS = 'spark_embeddings';
const MAX_VECTORS = 1500;
const MAX_PER_RUN = 200;
const BATCH = 32;
const MIN_TEXT = 20;

type Raw = Record<string, unknown>;
type Kind = 'need' | 'solution';

export interface SparkVectors {
  needs: Map<string, number[]>;
  solutions: Map<string, number[]>;
  /** Kollektionen saknas (migration 1700000224 inte körd). */
  missing: boolean;
}

export async function loadSparkVectors(pb: PocketBase, tenant: string): Promise<SparkVectors> {
  const out: SparkVectors = { needs: new Map(), solutions: new Map(), missing: false };
  try {
    for (let page = 1; out.needs.size + out.solutions.size < MAX_VECTORS; page += 1) {
      const res = await pb.collection(SPARK_EMBEDDINGS).getList<Raw>(page, 200, {
        filter: pb.filter('tenant = {:t}', { t: tenant }),
        fields: 'kind,record_id,embedding'
      });
      for (const r of res.items) {
        const vec = sanitizeSparkVector(r.embedding);
        if (vec.length === 0) continue;
        (r.kind === 'need' ? out.needs : out.solutions).set(String(r.record_id), vec);
      }
      if (page >= res.totalPages) break;
    }
  } catch (err) {
    if ((err as { status?: number } | null)?.status === 404) out.missing = true;
  }
  return out;
}

export interface SparkIndexResult {
  /** Poster som fick en ny eller uppdaterad vektor. */
  embedded: number;
  /** Poster som redan var aktuella. */
  current: number;
  /** Poster som återstår (taket per körning nått). */
  remaining: number;
  removed: number;
}

/**
 * Embeddar de behov och lösningar vars text är ny eller ändrad, och tar bort
 * vektorer för poster som inte längre finns. Kastar vid AI-fel — anroparen
 * avgör om det är fail-soft.
 */
export async function indexSparkEmbeddings(
  pb: PocketBase,
  who: { tenant: string; userId: string },
  reg: { needs: readonly SparkNeedRow[]; solutions: readonly SparkSolutionRow[] }
): Promise<SparkIndexResult> {
  const existing = new Map<string, { id: string; hash: string }>();
  for (let page = 1; existing.size < 5000; page += 1) {
    const res = await pb.collection(SPARK_EMBEDDINGS).getList<Raw>(page, 500, {
      filter: pb.filter('tenant = {:t}', { t: who.tenant }),
      fields: 'id,kind,record_id,text_hash'
    });
    for (const r of res.items) existing.set(`${String(r.kind)}:${String(r.record_id)}`, { id: String(r.id), hash: String(r.text_hash ?? '') });
    if (page >= res.totalPages) break;
  }

  const wanted: { kind: Kind; id: string; text: string; hash: string }[] = [];
  const live = new Set<string>();
  let current = 0;
  const consider = (kind: Kind, id: string, text: string) => {
    live.add(`${kind}:${id}`);
    if (text.length < MIN_TEXT) return;
    const hash = sparkTextHash(text);
    if (existing.get(`${kind}:${id}`)?.hash === hash) current += 1;
    else wanted.push({ kind, id, text, hash });
  };
  for (const n of reg.needs) consider('need', n.id, sparkEmbeddingText('need', n));
  for (const s of reg.solutions) consider('solution', s.id, sparkEmbeddingText('solution', s));

  const queue = wanted.slice(0, MAX_PER_RUN);
  let embedded = 0;
  let tokensIn = 0;
  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH);
    const res = await embedTexts(batch.map((b) => b.text));
    tokensIn += res.usage.prompt_tokens;
    for (let j = 0; j < batch.length; j += 1) {
      const vec = res.vectors[j];
      if (!Array.isArray(vec) || vec.length === 0) continue;
      const item = batch[j];
      // Fyra decimaler räcker för cosinus och håller posten liten.
      const embedding = vec.map((x) => Math.round(x * 10000) / 10000);
      const prior = existing.get(`${item.kind}:${item.id}`);
      if (prior) await pb.collection(SPARK_EMBEDDINGS).update(prior.id, { text_hash: item.hash, embedding, model: EMBEDDING_MODEL });
      else {
        await pb.collection(SPARK_EMBEDDINGS).create({
          tenant: who.tenant,
          kind: item.kind,
          record_id: item.id,
          text_hash: item.hash,
          embedding,
          model: EMBEDDING_MODEL,
          created_by: who.userId
        });
      }
      embedded += 1;
    }
  }
  let removed = 0;
  for (const [key, row] of existing) {
    if (live.has(key)) continue;
    await pb
      .collection(SPARK_EMBEDDINGS)
      .delete(row.id)
      .then(() => {
        removed += 1;
      })
      .catch(() => undefined);
  }
  if (tokensIn > 0) await logIndexUsage(pb, { tenant: who.tenant, userId: who.userId }, { tokensIn, tokensOut: 0 });
  return { embedded, current, remaining: wanted.length - queue.length, removed };
}
