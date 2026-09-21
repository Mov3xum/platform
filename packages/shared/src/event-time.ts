// Kalender-/eventtid i svensk tid.
//
// Servern (Coolify-container på UpCloud) kör i UTC. Ett klockslag som
// personalen skriver i ett formulär ("2026-09-08T14:00", utan tidszon) är ett
// SVENSKT klockslag, inte UTC — tolkas det som UTC förskjuts eventet två timmar
// i sommartid (en i vintertid), och "idag"/"pågår nu"-gränser hamnar på fel
// dygn runt midnatt. Den här modulen är enda stället där väggklocka ↔ ögonblick
// översätts: ren logik, inga beroenden, enhetstestad (`event-time.test.ts`).

import { SWEDISH_TIMEZONE } from './greeting';

export interface StockholmWallClock {
  year: number;
  /** 1–12 */
  month: number;
  /** 1–31 */
  day: number;
  /** 0–23 */
  hour: number;
  minute: number;
  second: number;
}

const WALL_CLOCK_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: SWEDISH_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

/** Väggklockan i Europe/Stockholm för ett givet ögonblick. */
export function stockholmWallClock(at: Date): StockholmWallClock {
  const parts = WALL_CLOCK_FORMAT.formatToParts(at);
  const num = (type: Intl.DateTimeFormatPartTypes): number =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10) || 0;
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    // "24" kan förekomma i vissa ICU-versioner för midnatt trots h23.
    hour: num('hour') % 24,
    minute: num('minute'),
    second: num('second')
  };
}

/** UTC-offset i minuter för Europe/Stockholm vid ett givet ögonblick (60 / 120). */
export function stockholmOffsetMinutes(at: Date): number {
  const wc = stockholmWallClock(at);
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  const wholeSeconds = Math.floor(at.getTime() / 1000) * 1000;
  return Math.round((asUtc - wholeSeconds) / 60_000);
}

/** "YYYY-MM-DD" för det svenska kalenderdygn som ögonblicket ligger i. */
export function stockholmDateKey(at: Date): string {
  const wc = stockholmWallClock(at);
  return `${wc.year}-${pad2(wc.month)}-${pad2(wc.day)}`;
}

/** Hela dygn från `from` till `to`, räknat på svenska kalenderdatum (kan vara negativt). */
export function stockholmDayDiff(from: Date, to: Date): number {
  const a = stockholmWallClock(from);
  const b = stockholmWallClock(to);
  const ua = Date.UTC(a.year, a.month - 1, a.day);
  const ub = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((ub - ua) / 86_400_000);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const LOCAL_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?$/;

/** Bär strängen en explicit tidszon (`Z` eller `±hh:mm`)? Då är den redan ett ögonblick. */
export function hasExplicitUtcOffset(input: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(input.trim());
}

/**
 * Tolkar ett svenskt väggklockslag ("2026-09-08T14:00", "2026-09-08 14:00:00"
 * eller bara "2026-09-08" = midnatt) som ögonblicket i Europe/Stockholm.
 * Returnerar null för ogiltigt format eller omöjliga kalendervärden.
 * DST-medveten: offseten härleds för det aktuella datumet, inte "nu".
 */
export function parseStockholmLocalDateTime(input: string): Date | null {
  const m = LOCAL_DATETIME_RE.exec(input.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4] ?? '0');
  const minute = Number(m[5] ?? '0');
  const second = Number(m[6] ?? '0');
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  // Gissa offseten vid det naiva ögonblicket och förfina en gång — täcker
  // klockslag nära DST-övergången utan iterativ sökning.
  let instant = naive - stockholmOffsetMinutes(new Date(naive)) * 60_000;
  const refined = naive - stockholmOffsetMinutes(new Date(instant)) * 60_000;
  if (refined !== instant) instant = refined;
  return new Date(instant);
}

/**
 * Tolkar en tidpunkt från formulär, chatt-agent eller integration:
 *  - explicit offset/`Z` → ögonblicket som det är (Outlook, ISO från agenten),
 *  - utan tidszon → svenskt väggklockslag (datetime-local-fält, "2026-09-08 14:00").
 * Returnerar null när inget av det går att tolka.
 */
export function parseDateTimeInput(input: string): Date | null {
  const s = input.trim();
  if (!s) return null;
  if (hasExplicitUtcOffset(s)) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  const local = parseStockholmLocalDateTime(s);
  if (local) return local;
  // Sista utväg för udda men giltiga format — men ALDRIG offsetlös ISO (den
  // hade fångats ovan), så serverns UTC-klocka kan inte smyga in här.
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Värde för ett `<input type="datetime-local">` i svensk tid ("YYYY-MM-DDTHH:mm"). */
export function toStockholmDateTimeInputValue(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const wc = stockholmWallClock(d);
  return `${wc.year}-${pad2(wc.month)}-${pad2(wc.day)}T${pad2(wc.hour)}:${pad2(wc.minute)}`;
}

/** Första ögonblicket (00:00 svensk tid) i det svenska dygn som ögonblicket ligger i. */
export function startOfStockholmDay(at: Date): Date {
  return parseStockholmLocalDateTime(stockholmDateKey(at)) ?? at;
}

/**
 * Tidsstämpel i PocketBase-filterformat ("YYYY-MM-DD HH:MM:SS.sssZ", UTC).
 * PB lagrar datumfält så; ett svenskt datum ("2026-09-09") jämfört rakt av
 * skulle tappa eventen mellan 00:00 och 02:00 svensk tid.
 */
export function toPocketBaseDateTime(at: Date): string {
  return at.toISOString().replace('T', ' ');
}

/** Sista millisekunden i det svenska dygn som ögonblicket ligger i. */
export function endOfStockholmDay(at: Date): Date {
  const end = parseStockholmLocalDateTime(`${stockholmDateKey(at)}T23:59:59`);
  // Datumnyckeln är alltid giltig, men håll typen ärlig.
  return end ? new Date(end.getTime() + 999) : at;
}

// ─── Eventets faktiska fas ("pågår nu" ska följa klockan, inte bara statusfältet) ─

export type EventPhase = 'upcoming' | 'live' | 'completed' | 'cancelled';

export const EVENT_PHASE_LABEL: Record<EventPhase, string> = {
  upcoming: 'Kommande',
  live: 'Pågår nu',
  completed: 'Avslutat',
  cancelled: 'Inställt'
};

export interface EventPhaseInput {
  starts_at: string;
  ends_at?: string | null;
  status?: string | null;
}

/**
 * Sluttidpunkten som fasen räknas mot: `ends_at` om satt, annars slutet av
 * startdagens svenska dygn (ett event utan sluttid är över när dagen är slut).
 */
export function eventEffectiveEndMs(event: EventPhaseInput): number | null {
  const startMs = Date.parse(event.starts_at);
  if (!Number.isFinite(startMs)) return null;
  const endMs = event.ends_at ? Date.parse(event.ends_at) : Number.NaN;
  const end = Number.isFinite(endMs) ? endMs : endOfStockholmDay(new Date(startMs)).getTime();
  return Math.max(end, startMs);
}

/**
 * Eventets fas vid `now`. Manuellt `cancelled`/`completed` vinner alltid; ett
 * event vars slut har passerat är `completed` oavsett om någon glömt att byta
 * från `live`/`planned`; `live` sätts av statusfältet ELLER av att klockan
 * ligger mellan start och slut. Ren och testbar — ingen skrivning sker.
 */
export function eventPhase(event: EventPhaseInput, now: Date): EventPhase {
  if (event.status === 'cancelled') return 'cancelled';
  if (event.status === 'completed') return 'completed';
  const startMs = Date.parse(event.starts_at);
  if (!Number.isFinite(startMs)) return event.status === 'live' ? 'live' : 'upcoming';
  const endMs = eventEffectiveEndMs(event) as number;
  const t = now.getTime();
  if (t > endMs) return 'completed';
  if (event.status === 'live') return 'live';
  if (t >= startMs) return 'live';
  return 'upcoming';
}

// ─── Visning ─────────────────────────────────────────────────────────────────

/** "08 sep. 2026 14:00" i svensk tid (tom sträng för ogiltig tidpunkt). */
export function formatStockholmDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('sv-SE', {
    timeZone: SWEDISH_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/** "2026-09-08" i svensk tid (tom sträng för ogiltig tidpunkt). */
export function formatStockholmDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return stockholmDateKey(d);
}

/** "14:00" i svensk tid, eller null när klockslaget är midnatt (rent datumfält). */
export function formatStockholmTimeOrNull(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const wc = stockholmWallClock(d);
  if (wc.hour === 0 && wc.minute === 0) return null;
  return `${pad2(wc.hour)}:${pad2(wc.minute)}`;
}
