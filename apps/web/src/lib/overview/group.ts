// Ren, enhetstestad logik för "Mina uppgifter" (/inkorg): tidsindelning av
// arbetsposter efter förfallodatum, sortering och räkning. Ingen IO, inga
// React-beroenden — delas av server (aggregate.ts) och klient (OverviewWork).
//
// All datumlogik räknas på SVENSKA kalenderdygn (CLAUDE.md § 38): `due_at`
// lagras som datum utan klockslag (PB: "YYYY-MM-DD 00:00:00.000Z"), så en
// jämförelse mot `Date.now()` gjorde att "idag" blev försenad från 00:01.

import { stockholmDateKey, stockholmDayDiff } from '@platform/shared';
import type { WorkItem } from './status';

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'undated';

export const DUE_BUCKETS: { id: DueBucket; label: string }[] = [
  { id: 'overdue', label: 'Försenat' },
  { id: 'today', label: 'Idag' },
  { id: 'week', label: 'Denna vecka' },
  { id: 'later', label: 'Senare' },
  { id: 'undated', label: 'Utan datum' }
];

/** Antal hela dygn (svenska kalenderdatum) från `now` till `dueAt`; null om ogiltigt/saknas. */
export function dueDayDiff(dueAt: string | undefined, now: Date): number | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  return stockholmDayDiff(now, d);
}

/** Vilken tidshink en post hör till, räknat på svenska kalenderdygn. */
export function dueBucket(dueAt: string | undefined, now: Date): DueBucket {
  const diff = dueDayDiff(dueAt, now);
  if (diff === null) return 'undated';
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 7) return 'week';
  return 'later';
}

/** Försenad = förfallodatumet ligger på ett tidigare kalenderdygn och posten är inte klar. */
export function isOverdue(item: Pick<WorkItem, 'dueAt' | 'status'>, now: Date): boolean {
  if (item.status === 'done') return false;
  return dueBucket(item.dueAt, now) === 'overdue';
}

/** Kort svensk etikett för ett förfallodatum ("idag", "om 3d", "2d sen", "12 okt"). */
export function formatDueLabel(dueAt: string, now: Date): string {
  const diff = dueDayDiff(dueAt, now);
  if (diff === null) return dueAt;
  if (diff === 0) return 'idag';
  if (diff === 1) return 'imorgon';
  if (diff === -1) return 'igår';
  if (diff < 0) return `${Math.abs(diff)}d sen`;
  if (diff < 7) return `om ${diff}d`;
  return new Date(dueAt).toLocaleDateString('sv-SE', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/Stockholm'
  });
}

/** Datum → "YYYY-MM-DD" (svenskt dygn) för `<input type="date">`; tom sträng om saknas. */
export function dueDateInputValue(dueAt: string | undefined): string {
  if (!dueAt) return '';
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return '';
  return stockholmDateKey(d);
}

/**
 * Sorterar poster: daterade före odaterade, tidigast först, sedan titel.
 * Stabil så två lika poster behåller inbördes ordning.
 */
export function compareWorkItems(a: WorkItem, b: WorkItem): number {
  const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.NaN;
  const db = b.dueAt ? new Date(b.dueAt).getTime() : Number.NaN;
  const aDated = !Number.isNaN(da);
  const bDated = !Number.isNaN(db);
  if (aDated && bDated && da !== db) return da - db;
  if (aDated !== bDated) return aDated ? -1 : 1;
  return a.title.localeCompare(b.title, 'sv');
}

export function sortWorkItems(items: WorkItem[]): WorkItem[] {
  return [...items].sort(compareWorkItems);
}

export interface DueGroup {
  id: DueBucket;
  label: string;
  items: WorkItem[];
}

/**
 * Grupperar ÖPPNA poster (status ≠ done) i tidshinkar i fast ordning:
 * Försenat · Idag · Denna vecka · Senare · Utan datum. Tomma hinkar utelämnas.
 */
export function groupByDue(items: WorkItem[], now: Date): DueGroup[] {
  const buckets = new Map<DueBucket, WorkItem[]>();
  for (const it of items) {
    if (it.status === 'done') continue;
    const b = dueBucket(it.dueAt, now);
    const list = buckets.get(b) ?? [];
    list.push(it);
    buckets.set(b, list);
  }
  return DUE_BUCKETS.filter((b) => (buckets.get(b.id)?.length ?? 0) > 0).map((b) => ({
    id: b.id,
    label: b.label,
    items: sortWorkItems(buckets.get(b.id) ?? [])
  }));
}

/** Klara poster, senast förfallna/senast först (för "Klart nyligen"). */
export function recentlyDone(items: WorkItem[]): WorkItem[] {
  return sortWorkItems(items.filter((it) => it.status === 'done')).reverse();
}

/** Antal öppna poster (det som rubriken ska visa — aldrig inklusive klara). */
export function openCount(items: Pick<WorkItem, 'status'>[]): number {
  let n = 0;
  for (const it of items) if (it.status !== 'done') n++;
  return n;
}

/** Antal försenade öppna poster. */
export function overdueCount(items: Pick<WorkItem, 'status' | 'dueAt'>[], now: Date): number {
  let n = 0;
  for (const it of items) if (isOverdue(it, now)) n++;
  return n;
}
