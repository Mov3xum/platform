/**
 * Ren, enhetstestad aggregeringskärna för `aggregate_collection` (CLAUDE.md
 * § 9.3). Separerad från den server-only hämtningen i `tools.ts` så att
 * "ljug-aldrig"-semantiken kan låsas med tester (samma mönster som
 * `fuzzy.ts` / `redaction.ts`).
 *
 * PocketBase v0.23 saknar en server-side GROUP BY/SUM över REST, så
 * aggregeringen sker i JS över en hämtad radmängd. Den FARLIGA fällan är att
 * en `sum`/`avg`/`min`/`max` över en TRUNKERAD radmängd ser komplett ut men är
 * fel — ett `max` kan ligga i en oskannad rad, ett `avg` blir statistiskt
 * meningslöst. Därför markerar vi resultatet `incomplete` och bifogar en
 * uttrycklig `warning` som modellen instrueras (guidance.ts) att alltid lyfta.
 * Bara ogrupperad `count` (= sann totalsumma från PB:s `totalItems`) är exakt
 * även när skanningen capades.
 */

export const AGG_OPS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type AggOp = (typeof AGG_OPS)[number];

export interface AggregateRequest {
  op: AggOp;
  /** Numeriskt fält för sum/avg/min/max (ignoreras för count). */
  field?: string;
  /** Valfritt grupperingsfält. */
  groupBy?: string;
  /** Den faktiska (minimala) radmängd som hämtades. */
  rows: Record<string, unknown>[];
  /** PB:s `totalItems` för det filtrerade settet — den SANNA radmängden. */
  total: number;
}

export interface AggregateGroup {
  group: string;
  value: number | null;
  count: number;
}

export interface AggregateResult {
  op: AggOp;
  field?: string;
  group_by?: string;
  /** Antal rader aggregeringen faktiskt räknade på. */
  scanned: number;
  /** Sann radmängd i det filtrerade settet (PB totalItems). */
  total: number;
  /** True när fler rader fanns än som hanns skannas. */
  capped: boolean;
  /**
   * True när det returnerade VÄRDET inte kan litas på som exakt/komplett.
   * Ogrupperad `count` är aldrig incomplete (vi använder `total`). Alla andra
   * operationer är incomplete så fort skanningen capades.
   */
  incomplete: boolean;
  /** Människoläsbar varning som modellen MÅSTE vidarebefordra. */
  warning?: string;
  value?: number | null;
  groups?: AggregateGroup[];
}

export function reduceAgg(op: AggOp, values: number[]): number | null {
  if (op === 'count') return values.length;
  const nums = values.filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  if (op === 'sum') return nums.reduce((a, b) => a + b, 0);
  if (op === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (op === 'min') return Math.min(...nums);
  if (op === 'max') return Math.max(...nums);
  return null;
}

function warningText(op: AggOp, scanned: number, total: number): string {
  return (
    `OFULLSTÄNDIGT: bara ${scanned} av ${total} rader kunde skannas. ` +
    `${op.toUpperCase()}-värdet är därför partiellt och får INTE presenteras ` +
    `som exakt eller komplett. Tala om för användaren att siffran är ` +
    `ofullständig (det finns fler rader än vad som kunde summeras), och ` +
    `föreslå en snävare filtrering om ett exakt svar behövs.`
  );
}

/**
 * Kärnan: tar den hämtade radmängden + sanna totalen och bygger ett resultat
 * som ALDRIG tyst påstår att ett capat värde är komplett.
 */
export function computeAggregate(req: AggregateRequest): AggregateResult {
  const { op, field, groupBy, rows, total } = req;
  const scanned = rows.length;
  const capped = total > scanned;

  const numOf = (r: Record<string, unknown>): number => (op === 'count' ? 1 : Number(field ? r[field] : NaN));

  if (groupBy) {
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const raw = r[groupBy];
      const g = raw === null || raw === undefined || raw === '' ? '(tomt)' : String(raw);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(numOf(r));
    }
    const result: AggregateGroup[] = Array.from(groups.entries())
      .map(([group, vals]) => ({ group, value: reduceAgg(op, vals), count: vals.length }))
      .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
    // Grupperat resultat är ALDRIG exakt när skanningen capades: en hel grupp
    // kan saknas, och varje grupps värde kan vara undersummerat.
    return {
      op,
      field: field || undefined,
      group_by: groupBy,
      scanned,
      total,
      capped,
      incomplete: capped,
      ...(capped ? { warning: warningText(op, scanned, total) } : {}),
      groups: result
    };
  }

  // Ogrupperad count = sann totalsumma (PB totalItems), exakt även vid cap.
  if (op === 'count') {
    return { op, scanned, total, capped, incomplete: false, value: total };
  }

  // Ogrupperad sum/avg/min/max över de skannade raderna.
  return {
    op,
    field: field || undefined,
    scanned,
    total,
    capped,
    incomplete: capped,
    ...(capped ? { warning: warningText(op, scanned, total) } : {}),
    value: reduceAgg(op, rows.map(numOf))
  };
}
