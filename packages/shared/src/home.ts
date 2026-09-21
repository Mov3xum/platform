// Dashboard — rena hjälpare för startsidan (CLAUDE.md § 37).
//
// Datumrad i svensk tid, sammanslagen agenda (årshjul + events) för "den här
// veckan" och sammanslagning av omvärldsflöden. Ingen IO, ingen PII —
// enhetstestat i home.test.ts.

import { isoWeekNumber } from './annual-wheel';
import { SWEDISH_TIMEZONE } from './greeting';

const WEEKDAYS_SV = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
const MONTHS_SV = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december'
];

/** Kalenderdelar (år/månad/dag/veckodag) för ett ögonblick i svensk tid. */
export function stockholmCalendarParts(at: Date): {
  year: number;
  month: number;
  day: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SWEDISH_TIMEZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: weekdayIndex < 0 ? at.getDay() : weekdayIndex
  };
}

/** Ett lokalt "dagens datum"-objekt (midnatt) för svensk tid. */
export function stockholmToday(at: Date = new Date()): Date {
  const p = stockholmCalendarParts(at);
  return new Date(p.year, p.month - 1, p.day);
}

/** "Tisdag 9 september · v. 37" i svensk tid. */
export function swedishDateLine(at: Date = new Date()): string {
  const p = stockholmCalendarParts(at);
  const weekday = WEEKDAYS_SV[p.weekday];
  const label = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${p.day} ${MONTHS_SV[p.month - 1]}`;
  const week = isoWeekNumber(new Date(p.year, p.month - 1, p.day));
  return `${label} · v. ${week}`;
}

// ─── Agenda ──────────────────────────────────────────────────────────────────

export type HomeAgendaSource = 'arshjul' | 'event';

export interface HomeAgendaItem {
  id: string;
  title: string;
  /** Lokal start (midnatt om bara dag är känd). */
  start: Date;
  /** Lokalt slut (för perioder/heldagar). */
  end?: Date;
  /** true när posten bara har en dag/period, inget klockslag. */
  allDay: boolean;
  source: HomeAgendaSource;
  href: string;
  /** Kort etikett: kategori, plats, typ … */
  meta?: string;
}

export interface HomeAgendaGroup {
  label: string;
  items: HomeAgendaItem[];
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

/** "Idag", "Imorgon", veckodag ("Torsdag") eller "Nästa vecka"/datum. */
export function homeDayLabel(date: Date, today: Date): string {
  const diff = dayDiff(today, date);
  if (diff <= 0) return 'Idag';
  if (diff === 1) return 'Imorgon';
  if (diff < 7) {
    const w = WEEKDAYS_SV[date.getDay()];
    return `${w.charAt(0).toUpperCase()}${w.slice(1)}`;
  }
  return `${date.getDate()} ${MONTHS_SV[date.getMonth()].slice(0, 3)}`;
}

/**
 * Väljer det som pågår eller börjar inom `horizonDays` och grupperar per dag
 * ("Idag", "Imorgon", "Torsdag", "15 sep"). Pågående perioder hamnar under
 * "Idag". Sorterat på start, sedan titel. Hårt tak på antal poster så
 * startsidan förblir lugn.
 */
export function buildHomeAgenda(
  items: readonly HomeAgendaItem[],
  today: Date,
  horizonDays = 14,
  max = 8
): HomeAgendaGroup[] {
  const t0 = startOfDay(today);
  const horizon = new Date(t0);
  horizon.setDate(horizon.getDate() + horizonDays);

  const relevant = items
    .filter((it) => !Number.isNaN(it.start.getTime()))
    .filter((it) => {
      const end = it.end ?? it.start;
      if (end.getTime() < t0.getTime()) return false; // passerad
      return it.start.getTime() < horizon.getTime();
    })
    .map((it) => ({
      it,
      // Pågående (start före idag) sorteras som idag.
      anchor: it.start.getTime() < t0.getTime() ? t0 : it.start
    }))
    .sort((a, b) => {
      const d = a.anchor.getTime() - b.anchor.getTime();
      return d !== 0 ? d : a.it.title.localeCompare(b.it.title, 'sv');
    })
    .slice(0, max);

  const groups: HomeAgendaGroup[] = [];
  for (const { it, anchor } of relevant) {
    const label = homeDayLabel(anchor, t0);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }
  return groups;
}

// ─── Omvärldsbevakning ───────────────────────────────────────────────────────

export interface OmvarldItem {
  title: string;
  link: string;
  /** Källans etikett ("Breakit", "Vinnova"). */
  source: string;
  sourceKey: string;
  pubDate?: string;
  summary?: string;
}

/**
 * Slår ihop flera källors flöden till EN lista: nyast först (poster utan datum
 * sist), dedupe på länk, och max `perSource` från samma källa så en pratig
 * källa inte tränger ut de andra. Rent och deterministiskt.
 */
export function mergeOmvarldItems(
  feeds: readonly { sourceKey: string; source: string; items: readonly Omit<OmvarldItem, 'source' | 'sourceKey'>[] }[],
  max = 8,
  perSource = 3
): OmvarldItem[] {
  const all: OmvarldItem[] = [];
  const seen = new Set<string>();
  for (const feed of feeds) {
    for (const item of feed.items) {
      const link = (item.link || '').trim();
      const title = (item.title || '').trim();
      if (!title || !link || seen.has(link)) continue;
      seen.add(link);
      all.push({ ...item, title, link, source: feed.source, sourceKey: feed.sourceKey });
    }
  }
  const time = (s?: string) => {
    if (!s) return Number.NaN;
    const t = new Date(s).getTime();
    return Number.isNaN(t) ? Number.NaN : t;
  };
  all.sort((a, b) => {
    const ta = time(a.pubDate);
    const tb = time(b.pubDate);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
  const counts = new Map<string, number>();
  const out: OmvarldItem[] = [];
  for (const item of all) {
    if (out.length >= max) break;
    const n = counts.get(item.sourceKey) ?? 0;
    if (n >= perSource) continue;
    counts.set(item.sourceKey, n + 1);
    out.push(item);
  }
  return out;
}

// ─── Tidslinje (14-dagarsremsan på Hemmaplan) ────────────────────────────────

export interface HomeTimelineDay {
  date: Date;
  /** "må", "ti" … */
  weekday: string;
  day: number;
  isToday: boolean;
  isWeekend: boolean;
  /** Satt på första dagen i fönstret och på varje månadsskifte ("sep", "okt"). */
  monthLabel?: string;
}

export interface HomeTimelineSpan {
  item: HomeAgendaItem;
  /** Dagindex (0-baserat) i fönstret där bandet börjar/slutar (klippt mot fönstret). */
  from: number;
  to: number;
  /** true när bandet egentligen började före fönstret / fortsätter efter. */
  clippedStart: boolean;
  clippedEnd: boolean;
  /** Radposition (0-baserad) — överlappande band packas i körfält. */
  lane: number;
  /**
   * Sista dagindex etiketten får sträcka sig över (in i lediga dagar i samma
   * körfält, fram till nästa band) — så att en endagspost kan visa sin titel
   * i stället för att klippas i en smal kolumn. ≥ `to`.
   */
  labelTo: number;
}

export interface HomeTimeline {
  days: HomeTimelineDay[];
  spans: HomeTimelineSpan[];
  lanes: number;
}

const WEEKDAYS_SHORT_SV = ['sö', 'må', 'ti', 'on', 'to', 'fr', 'lö'];

/**
 * Lägger agendaposterna på en dagremsa från `today` och `days` dagar framåt:
 * varje post blir ett band över de dagar den löper (klippt mot fönstret) och
 * överlappande band packas i körfält så inget ritas ovanpå något annat.
 * Passerade poster utelämnas; poster som börjar bortom fönstret också.
 * Rent och deterministiskt (sorterat på start, längst band först, sedan titel).
 */
export function buildHomeTimeline(items: readonly HomeAgendaItem[], today: Date, days = 14): HomeTimeline {
  const t0 = startOfDay(today);
  const dayList: HomeTimelineDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(t0);
    d.setDate(d.getDate() + i);
    const monthStart = i === 0 || d.getDate() === 1;
    dayList.push({
      date: d,
      weekday: WEEKDAYS_SHORT_SV[d.getDay()],
      day: d.getDate(),
      isToday: i === 0,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      monthLabel: monthStart ? MONTHS_SV[d.getMonth()].slice(0, 3) : undefined
    });
  }

  const raw = items
    .filter((it) => !Number.isNaN(it.start.getTime()))
    .map((it) => {
      const end = it.end && !Number.isNaN(it.end.getTime()) ? it.end : it.start;
      const from = dayDiff(t0, it.start);
      const to = dayDiff(t0, end);
      return { it, from, to };
    })
    .filter(({ from, to }) => to >= 0 && from < days)
    .map(({ it, from, to }) => ({
      item: it,
      from: Math.max(0, from),
      to: Math.min(days - 1, to),
      clippedStart: from < 0,
      clippedEnd: to > days - 1
    }))
    .sort((a, b) => {
      if (a.from !== b.from) return a.from - b.from;
      const la = a.to - a.from;
      const lb = b.to - b.from;
      if (la !== lb) return lb - la;
      return a.item.title.localeCompare(b.item.title, 'sv');
    });

  // Körfältspackning: bland lediga körfält väljs det vars föregående band
  // slutade tidigast (mest luft för dess etikett). Ligger även det bandet
  // vägg-i-vägg med det nya öppnas hellre ett nytt körfält (upp till
  // MAX_COMFORT_LANES) så endagsposter får plats att visa sin titel.
  const MAX_COMFORT_LANES = 3;
  const laneEnds: number[] = [];
  const spans: HomeTimelineSpan[] = raw.map((s) => {
    let lane = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] < s.from && (lane === -1 || laneEnds[i] < laneEnds[lane])) lane = i;
    }
    const adjacent = lane !== -1 && laneEnds[lane] === s.from - 1;
    if (lane === -1 || (adjacent && laneEnds.length < MAX_COMFORT_LANES)) {
      lane = laneEnds.length;
      laneEnds.push(s.to);
    } else {
      laneEnds[lane] = s.to;
    }
    return { ...s, lane, labelTo: s.to };
  });
  // Etikettutrymme: fram till dagen före nästa band i samma körfält.
  for (const s of spans) {
    const next = spans
      .filter((o) => o !== s && o.lane === s.lane && o.from > s.to)
      .reduce<number | null>((min, o) => (min === null || o.from < min ? o.from : min), null);
    s.labelTo = next === null ? days - 1 : next - 1;
  }

  return { days: dayList, spans, lanes: laneEnds.length };
}

// ─── Kalenderfönster på Hemmaplan ────────────────────────────────────────────

/** Query-parametern som styr kalenderfönstret (`/hem?dagar=7|14|30`). */
export const HOME_WINDOW_PARAM = 'dagar';
export const HOME_WINDOW_OPTIONS = [7, 14, 30] as const;
export type HomeWindowDays = (typeof HOME_WINDOW_OPTIONS)[number];
export const HOME_WINDOW_DEFAULT: HomeWindowDays = 7;

/** Okänt/saknat värde ger default (7 dagar). */
export function parseHomeWindowDays(raw: string | undefined | null): HomeWindowDays {
  const n = Number(raw);
  return (HOME_WINDOW_OPTIONS as readonly number[]).includes(n) ? (n as HomeWindowDays) : HOME_WINDOW_DEFAULT;
}

export function homeWindowLabel(days: HomeWindowDays): string {
  if (days === 7) return 'De närmaste sju dagarna';
  if (days === 14) return 'De närmaste fjorton dagarna';
  return 'Den närmaste månaden';
}
