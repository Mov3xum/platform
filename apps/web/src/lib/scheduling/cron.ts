// Minimal cron-parser för Movexums schemaläggning.
//
// Designprinciper (samma som web.ts: ingen npm-dep för utility-kod):
//  - Standard 5-fält cron: "m h dom M dow"
//  - Stöd för `*`, fast tal, `,`-lista och `a-b`-intervall i alla fält.
//  - Stegvärden `*/n` på minut- och timme-fältet (vanligaste use casen).
//  - Söndag = 0 eller 7 (POSIX-konvention).
//  - Tidszoner via Intl.DateTimeFormat — vi räknar i wall-clock i `tz`
//    och konverterar tillbaka till UTC. Detta är "best effort": Movexum
//    kör i Europe/Stockholm i praktiken och DST-glitches på exakt en
//    timme om året under övergångar är acceptabla (verktyget får då en
//    extra eller skippad körning den dagen).
//
// Säkerhet: inga reguljära uttryck med katastrofal backtracking, ingen
// eval. Alla numeriska gränser klampas till lagliga cron-värden.

const RANGES = [
  { min: 0, max: 59, name: 'minute' }, // minut
  { min: 0, max: 23, name: 'hour' }, // timme
  { min: 1, max: 31, name: 'dom' }, // day-of-month
  { min: 1, max: 12, name: 'month' }, // månad
  { min: 0, max: 7, name: 'dow' } // day-of-week (0 = sön, 7 = sön)
] as const;

export class CronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronError';
  }
}

interface ParsedField {
  values: Set<number>;
  star: boolean;
}

interface ParsedCron {
  minute: ParsedField;
  hour: ParsedField;
  dom: ParsedField;
  month: ParsedField;
  dow: ParsedField;
}

export function parseCron(expression: string): ParsedCron {
  if (typeof expression !== 'string') {
    throw new CronError('Cron-uttryck måste vara en sträng.');
  }
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError(
      'Cron-uttrycket måste ha exakt 5 fält (minut timme dag månad veckodag).'
    );
  }

  const fields = parts.map((part, idx) => parseField(part, RANGES[idx]));
  return {
    minute: fields[0],
    hour: fields[1],
    dom: fields[2],
    month: fields[3],
    dow: fields[4]
  };
}

function parseField(
  raw: string,
  range: { min: number; max: number; name: string }
): ParsedField {
  if (raw.length === 0 || raw.length > 60) {
    throw new CronError(`Ogiltigt ${range.name}-fält.`);
  }

  // Stegvärde, t.ex. */15 eller 0-30/5
  let stepBase = raw;
  let step = 1;
  if (raw.includes('/')) {
    const [base, stepPart] = raw.split('/');
    const stepNum = Number(stepPart);
    if (!Number.isInteger(stepNum) || stepNum < 1 || stepNum > range.max + 1) {
      throw new CronError(`Ogiltigt stegvärde i ${range.name}-fält.`);
    }
    stepBase = base || '*';
    step = stepNum;
  }

  const values = new Set<number>();
  const star = stepBase === '*';

  if (star) {
    for (let v = range.min; v <= range.max; v += step) values.add(v);
    return { values, star: step === 1 };
  }

  // Komma-lista av singletons/ranges
  for (const piece of stepBase.split(',')) {
    if (piece.includes('-')) {
      const [lo, hi] = piece.split('-').map((s) => Number(s));
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) {
        throw new CronError(`Ogiltigt intervall "${piece}" i ${range.name}-fält.`);
      }
      const lower = clamp(lo, range.min, range.max);
      const upper = clamp(hi, range.min, range.max);
      for (let v = lower; v <= upper; v += step) values.add(v);
    } else {
      const num = Number(piece);
      if (!Number.isInteger(num)) {
        throw new CronError(`"${piece}" är inte ett heltal i ${range.name}-fält.`);
      }
      values.add(clamp(num, range.min, range.max));
    }
  }

  if (values.size === 0) {
    throw new CronError(`${range.name}-fält har inga giltiga värden.`);
  }
  return { values, star: false };
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Validerar att uttrycket går att parsa. Kasta `CronError` om inte.
 */
export function validateCronExpression(expression: string): void {
  parseCron(expression);
}

interface WallClock {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  dow: number; // 0-6 (sön = 0)
}

const TZ_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getTzFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = TZ_FORMATTER_CACHE.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short'
    });
    TZ_FORMATTER_CACHE.set(timezone, fmt);
  }
  return fmt;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

function toWallClock(date: Date, timezone: string): WallClock {
  const parts = getTzFormatter(timezone).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    dow: WEEKDAY_MAP[get('weekday')] ?? 0
  };
}

/**
 * Konverterar en wall-clock i `timezone` till motsvarande UTC-tidpunkt.
 * Pragmatisk algoritm: konstruera ett antagande, mät avvikelsen, korrigera
 * en gång. Hanterar normala fall korrekt; under DST-övergång (1 timme/år)
 * kan resultatet hamna 0–1 timme fel, vilket är acceptabelt för
 * scheman på minut-/timme-nivå.
 */
function wallClockToUtc(wc: WallClock, timezone: string): Date {
  const guess = new Date(
    Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, 0, 0)
  );
  const actualWc = toWallClock(guess, timezone);

  const guessUtc = Date.UTC(
    actualWc.year,
    actualWc.month - 1,
    actualWc.day,
    actualWc.hour,
    actualWc.minute,
    0,
    0
  );
  const desiredUtc = Date.UTC(
    wc.year,
    wc.month - 1,
    wc.day,
    wc.hour,
    wc.minute,
    0,
    0
  );
  const offsetMs = desiredUtc - guessUtc;
  return new Date(guess.getTime() + offsetMs);
}

/**
 * Beräknar nästa körningstidpunkt (UTC) efter `after` baserat på
 * cron-uttrycket tolkat i `timezone`.
 *
 * Implementationen är "increment & match": börja en minut efter `after`,
 * gå minut för minut framåt tills alla fält matchar. Begränsad till
 * 4 års sökning så att en omöjlig kombination (t.ex. "0 0 31 2 *")
 * inte loopar oändligt.
 */
export function computeNextRunAt(
  expression: string,
  after: Date,
  timezone = 'Europe/Stockholm'
): Date {
  const parsed = parseCron(expression);

  // Börja från nästa hela minut efter `after` i UTC.
  const start = new Date(after.getTime());
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  const maxIterations = 4 * 366 * 24 * 60; // 4 år i minuter
  let cursor = new Date(start.getTime());

  for (let i = 0; i < maxIterations; i++) {
    const wc = toWallClock(cursor, timezone);
    if (matches(parsed, wc)) {
      // Förankra exakt sekund 0 i wall-clock-tiden.
      return wallClockToUtc(wc, timezone);
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }

  throw new CronError(
    'Hittade ingen nästa körning inom 4 år — kontrollera cron-uttrycket.'
  );
}

function matches(parsed: ParsedCron, wc: WallClock): boolean {
  if (!parsed.minute.values.has(wc.minute)) return false;
  if (!parsed.hour.values.has(wc.hour)) return false;
  if (!parsed.month.values.has(wc.month)) return false;

  // POSIX-konvention: om både dom och dow är begränsade matchar OR.
  const domOk = parsed.dom.values.has(wc.day);
  // Cron tillåter dow 0 eller 7 för söndag — normalisera bägge.
  const dowOk =
    parsed.dow.values.has(wc.dow) ||
    (wc.dow === 0 && parsed.dow.values.has(7));

  if (parsed.dom.star && parsed.dow.star) return true;
  if (parsed.dom.star) return dowOk;
  if (parsed.dow.star) return domOk;
  return domOk || dowOk;
}

/**
 * Returnerar en presentabel sammanfattning av cron-uttrycket på svenska.
 * Endast vanligaste mönstren — fall tillbaka till råuttrycket annars.
 */
export function describeCron(expression: string): string {
  try {
    parseCron(expression);
  } catch {
    return expression;
  }
  const [m, h, dom, mo, dow] = expression.trim().split(/\s+/);

  if (dom === '*' && mo === '*' && dow === '*') {
    if (m === '0' && h === '*') return 'Varje timme';
    if (h !== '*' && /^\d+$/.test(h) && /^\d+$/.test(m)) {
      return `Varje dag kl ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
    }
  }
  if (dom === '*' && mo === '*' && dow !== '*' && /^\d+$/.test(h) && /^\d+$/.test(m)) {
    const dayNames = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
    const idx = Number(dow) % 7;
    return `Varje ${dayNames[idx]} kl ${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  }
  return expression;
}

export const SCHEDULE_PRESETS: Array<{
  label: string;
  description: string;
  expression: string;
}> = [
  {
    label: 'Varje morgon 07:00',
    description: 'Dagligen klockan 07:00 (Europe/Stockholm)',
    expression: '0 7 * * *'
  },
  {
    label: 'Vardagsmorgnar 07:00',
    description: 'Måndag till fredag klockan 07:00',
    expression: '0 7 * * 1-5'
  },
  {
    label: 'Varje måndag 08:00',
    description: 'En gång i veckan, måndag morgon',
    expression: '0 8 * * 1'
  },
  {
    label: 'Var sjätte timme',
    description: 'Var sjätte timme (00:00, 06:00, 12:00, 18:00)',
    expression: '0 */6 * * *'
  }
];
