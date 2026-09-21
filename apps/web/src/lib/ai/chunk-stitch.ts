/**
 * Ren, IO-fri hopslagning av intilliggande RAG-chunkar ("parent-document" /
 * small-to-big, CLAUDE.md § 26.5). Vi söker på små chunkar (precision) men kan
 * returnera ett större, sammanhängande textfönster (kontext) genom att slå ihop
 * grannchunkar. Eftersom chunkar overlappar (CHUNK_OVERLAP tecken) tas
 * dubbletten i skarven bort.
 *
 * Medvetet fri från `server-only`/PocketBase så att logiken kan ENHETSTESTAS
 * (chunk-stitch.test.ts) — samma mönster som fuzzy/redaction/rank/ooxml-text.
 */

/**
 * Längden på det längsta suffixet av `a` som också är prefix av `b`
 * (≤ maxOverlap). 0 om inget överlapp — då är chunkarna inte intilliggande och
 * de fogas bara ihop.
 */
export function overlapLength(a: string, b: string, maxOverlap: number): number {
  const max = Math.min(maxOverlap, a.length, b.length);
  for (let len = max; len > 0; len--) {
    if (a.slice(a.length - len) === b.slice(0, len)) return len;
  }
  return 0;
}

export interface StitchPart {
  index: number;
  text: string;
}

/**
 * Slår ihop chunkar i index-ordning, tar bort overlap-dubbletten i varje skarv
 * och cappar resultatet till `maxChars`. Tom input → tom sträng.
 */
export function stitchChunks(
  parts: StitchPart[],
  opts: { maxOverlap: number; maxChars: number }
): string {
  const sorted = parts.slice().sort((a, b) => a.index - b.index);
  let out = '';
  for (const p of sorted) {
    const text = p.text ?? '';
    if (!text) continue;
    if (!out) {
      out = text;
    } else {
      const ov = overlapLength(out, text, opts.maxOverlap);
      out += text.slice(ov);
    }
    if (out.length >= opts.maxChars) {
      out = out.slice(0, opts.maxChars);
      break;
    }
  }
  return out;
}
