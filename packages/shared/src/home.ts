// Hemmaplan — rena hjälpare för startsidan (CLAUDE.md § 37).
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
