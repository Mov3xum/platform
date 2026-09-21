/**
 * Minimal, beroendefri LRU-cache. Används av RAG-lagret (CLAUDE.md § 26/§ 27)
 * för att (a) cacha frågeembeddings så upprepade frågor slipper ett nytt
 * `/v1/embeddings`-anrop, och (b) cacha parsade chunk-vektorer så de inte
 * JSON-parsas om vid varje sökning (PocketBase saknar pgvector → vi gör vad vi
 * kan med en in-process-cache).
 *
 * Medvetet fri från `server-only`/PocketBase/`@/` så att den kan ENHETSTESTAS
 * (apps/web/src/lib/ai/lru.test.ts) — samma mönster som fuzzy/redaction/rank.
 *
 * In-memory per process: vid horisontell skalning bör cachen lyftas till Redis
 * eller en delad vektortjänst (samma kommentar som connectors-cachen § 13.6).
 */
export class LruCache<K, V> {
  private map = new Map<K, V>();
  private readonly max: number;

  constructor(max: number) {
    if (max < 1) throw new Error('LruCache: max måste vara >= 1');
    this.max = max;
  }

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // Markera som senast använd (flytta sist i insättningsordningen).
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
