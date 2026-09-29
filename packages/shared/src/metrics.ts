/**
 * Metrikregister — ren, IO-fri definition och beräkning av verksamhetens
 * nyckeltal (CLAUDE.md § 41).
 *
 * Princip: **en indikator, en definition, en beräkning.** Katalogen här
 * (`METRIC_DEFINITIONS`) säger VAD ett nyckeltal är (etikett, enhet,
 * riktning, känslighet); IO-registret i webben (`lib/metrics/registry.ts`)
 * säger HUR det läses ur PocketBase. Startsidan, målcockpiten,
 * programansvarig-cockpiten och rapporterna konsumerar samma register i
 * stället för att räkna var för sig.
 *
 * Beräkningarna nedan är rena funktioner över redan lästa rader så de kan
 * enhetstestas utan databas. Ingen AI-inferens → riskklass n/a.
 */

import type { StartupPhase } from './index';
import { addMonths, parseDateOnlyLocal, toDateOnly } from './date-only';

// ─── Katalog ────────────────────────────────────────────────────────────────

export const METRIC_KEYS = [
  'active_startups',
  'startups_in_program',
  'alumni_count',
  'excellence_share',
  'conv_bc_to_inc',
  'conv_inc_to_acc_8m',
  'leads_in_period',
  'partners_count',
  'workshops_in_progress',
  'my_open_tasks',
  'women_led_share'
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export function isMetricKey(v: unknown): v is MetricKey {
  return (METRIC_KEYS as readonly string[]).includes(String(v));
}

export type MetricUnit = 'count' | 'pct' | 'days';
/** `aggregate_only`: värdet får bara visas som aggregat över en k-anonym grupp (GDPR art. 9, § 10.2). */
export type MetricSensitivity = 'none' | 'aggregate_only';
/** `user`: beräknas för den inloggade (t.ex. egna uppgifter) — inte ett tenant-nyckeltal för mål. */
export type MetricScope = 'tenant' | 'user';

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  /** Kort förklaring för tooltip/mål-editor — vad som räknas och hur. */
  description: string;
  unit: MetricUnit;
  higherIsBetter: boolean;
  sensitivity: MetricSensitivity;
  scope: MetricScope;
  /** Följer `MetricPeriod` (annars ögonblicksvärde). */
  periodic: boolean;
}

export const METRIC_DEFINITIONS: Record<MetricKey, MetricDefinition> = {
  active_startups: {
    key: 'active_startups',
    label: 'Aktiva bolag',
    description: 'Bolag med status aktiv i inkubatorn just nu (alla faser).',
    unit: 'count',
    higherIsBetter: true,
    sensitivity: 'none',
    scope: 'tenant',
    periodic: false
  },
  startups_in_program: {
    key: 'startups_in_program',
    label: 'Bolag i ink/acc',
    description: 'Aktiva bolag i faserna inkubation, prescale eller acceleration.',
    unit: 'count',
    higherIsBetter: true,
    sensitivity: 'none',
    scope: 'tenant',
    periodic: false
  },
  alumni_count: {
    key: 'alumni_count',
    label: 'Alumnibolag',
    description: 'Bolag som gått in i alumnifasen under perioden (fashistoriken).',
    unit: 'count',
    higherIsBetter: true,
    sensitivity: 'none',
    scope: 'tenant',
    periodic: true
  },
  excellence_share: {
    key: 'excellence_share',
    label: 'Excellenta bolag',
    description: 'Andel av bolagen i ink/acc som uppfyller excellenskriterierna.',
    unit: 'pct',
    higherIsBetter: true,
    sensitivity: 'none',
    scope: 'tenant',
    periodic: false
  },
  conv_bc_to_inc: {
    key: 'conv_bc_to_inc',
    label: 'Konvertering BC → inkubator',
    description: 'Andel bolag som gick in i BoostChamber under perioden och därefter i inkubation.',
    unit: 'pct',
    higherIsBetter: true,
    sensitivity: 'none',
    scope: 'tenant',
    periodic: true
  },
  conv_inc_to_acc_8m: {
    key: 'conv_inc_to_acc_8m',
    label: 'Konvertering ink → acc inom 8 mån',
    description:
      'Andel bolag som gick in i inkubation under perioden och nådde acceleration inom 8 månader. Bolag som ännu inte haft 8 månader räknas inte.',
    unit: 'pct',
    higherIsBetter: true,
    sensitivity: 'none',
    scope: 'tenant',
    periodic: true
  },
  leads_in_period: {
    key: 'leads_in_period',
    label: 'Nya leads',
    description: 'Leads skapade i Startupkompassen under perioden (förhandsgranskningar exkluderade).',
    unit: 'count',
    higherIsBetter: true,
    sensitivity: 'none',
    scope: 'tenant',
    periodic: true
  },
  partners_count: {
    key: 'partners_count',
    label: 'Partners',
    description: 'Registrerade partners i tenanten.',
    unit: 'count',
    higherIsBetter: true,
    sensitivity: 'none',
    scope: 'tenant',
    periodic: false
  },
  workshops_in_progress: {
    key: 'workshops_in_progress',
    label: 'Pågående workshops',
    description: 'Workshop-tilldelningar med status pågår.',
    unit: 'count',
    higherIsBetter: true,
    sensitivity: 'none',
    scope: 'tenant',
    periodic: false
  },
  my_open_tasks: {
    key: 'my_open_tasks',
    label: 'Mina uppgifter',
    description: 'Öppna uppgifter tilldelade den inloggade.',
    unit: 'count',
    higherIsBetter: false,
    sensitivity: 'none',
    scope: 'user',
    periodic: false
  },
  women_led_share: {
    key: 'women_led_share',
    label: 'Kvinnliga grundare',
    description:
      'Andel av bolagen i ink/acc med känd grundarprofil där grundaren är kvinna. Visas bara när gruppen är minst 5 bolag (GDPR art. 9 — aldrig per bolag, aldrig i AI-kontext).',
    unit: 'pct',
    higherIsBetter: true,
    sensitivity: 'aggregate_only',
    scope: 'tenant',
    periodic: false
  }
};

// ─── Värden ─────────────────────────────────────────────────────────────────

/** Period i ISO-datum (ÅÅÅÅ-MM-DD), inklusive `from`, exklusive `to`. */
export interface MetricPeriod {
  from: string;
  to: string;
}

export interface MetricValue {
  key: MetricKey;
  /** null = kunde inte beräknas (läsfel, för liten grupp, ingen data) — visas som "–", aldrig som 0. */
  value: number | null;
  numerator?: number;
  denominator?: number;
  /** false när underlaget kapades (tak i läsningen) — visa som "≥"/varning, aldrig som exakt. */
  complete: boolean;
  /** PII-fri förklaring till null/incomplete ("för få bolag", "läsfel"). */
  note?: string;
}

/** Fasgrupperna målen talar om (§ 4.1 i analysen). */
export const PROGRAM_PHASES: readonly StartupPhase[] = ['incubation', 'prescale', 'acceleration'];

/** Minsta gruppstorlek för art. 9-aggregat (§ 10.2). */
export const AGGREGATE_MIN_GROUP = 5;

/**
 * Andel med k-anonymitet: returnerar null när nämnaren är mindre än `k`,
 * OCH när någon av de två grupperna (räknaren eller resten) är mindre än
 * `k` — en homogen grupp (0 % eller 100 %) skulle annars avslöja varje
 * enskild post. Används för ALLA `aggregate_only`-mått (art. 9, § 10.2).
 */
export function shareWithThreshold(
  numerator: number,
  denominator: number,
  k: number = AGGREGATE_MIN_GROUP
): number | null {
  if (denominator < k || denominator <= 0) return null;
  if (numerator < k || denominator - numerator < k) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Vanlig andel i procent (en decimal); null vid tom nämnare. */
export function sharePct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** Absolut förändring mot föregående period; null när något saknas. */
export function metricDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

export function formatMetricValue(def: Pick<MetricDefinition, 'unit'>, value: number | null): string {
  if (value === null || Number.isNaN(value)) return '–';
  switch (def.unit) {
    case 'pct':
      return `${value.toLocaleString('sv-SE', { maximumFractionDigits: 1 })} %`;
    case 'days':
      return `${Math.round(value)} d`;
    default:
      return value.toLocaleString('sv-SE', { maximumFractionDigits: 0 });
  }
}

// ─── Fashistorik → konvertering och tid i fas ───────────────────────────────

export interface PhaseHistoryRow {
  startup: string;
  phase: StartupPhase | string;
  /** ISO-datum eller PB-datetime — bara dagen används. */
  entered_at: string;
  exited_at?: string | null;
}

export interface PhaseConversionOptions {
  from: StartupPhase;
  to: StartupPhase;
  /** Kohort: bolag vars FÖRSTA inträde i `from` ligger i perioden (annars alla). */
  cohort?: MetricPeriod;
  /** Konverteringen måste ske inom så många månader från inträdet. */
  withinMonths?: number;
  /** ÅÅÅÅ-MM-DD — behövs när `withinMonths` är satt (bolag som inte haft tiden räknas inte). */
  today?: string;
}

export interface PhaseConversionResult {
  /** Bolag i kohorten som konverterade (inom fristen om satt). */
  numerator: number;
  /** Bolag i kohorten som haft chansen att konvertera. */
  denominator: number;
  /** Bolag i kohorten vars frist inte löpt ut och som inte konverterat — exkluderade ur nämnaren. */
  pending: number;
  /** Procent (en decimal) eller null när nämnaren är tom. */
  value: number | null;
}

function dayOf(value: string | null | undefined): string | null {
  const d = parseDateOnlyLocal(value ?? null);
  return d ? toDateOnly(d) : null;
}

function inPeriod(day: string, period: MetricPeriod | undefined): boolean {
  if (!period) return true;
  return day >= period.from && day < period.to;
}

/**
 * Konvertering mellan två faser ur `startup_phase_history`. Ett bolag räknas
 * som konverterat om det har ett inträde i `to` som ligger på eller efter
 * dess första inträde i `from` (och inom `withinMonths` om satt). Bolag
 * vars frist inte gått ut och som inte konverterat rapporteras som `pending`
 * och räknas INTE i nämnaren — så en färsk kohort inte ser ut att
 * misslyckas. Deterministisk, dagnivå.
 */
export function phaseConversion(
  rows: readonly PhaseHistoryRow[],
  opts: PhaseConversionOptions
): PhaseConversionResult {
  const firstFrom = new Map<string, string>();
  const toEntries = new Map<string, string[]>();
  for (const r of rows) {
    const day = dayOf(r.entered_at);
    if (!day) continue;
    if (r.phase === opts.from) {
      const prev = firstFrom.get(r.startup);
      if (!prev || day < prev) firstFrom.set(r.startup, day);
    }
    if (r.phase === opts.to) {
      const list = toEntries.get(r.startup) ?? [];
      list.push(day);
      toEntries.set(r.startup, list);
    }
  }

  let numerator = 0;
  let denominator = 0;
  let pending = 0;
  for (const [startup, enteredDay] of firstFrom) {
    if (!inPeriod(enteredDay, opts.cohort)) continue;
    let deadline: string | null = null;
    if (opts.withinMonths !== undefined) {
      const start = parseDateOnlyLocal(enteredDay)!;
      deadline = toDateOnly(addMonths(start, opts.withinMonths));
    }
    const converted = (toEntries.get(startup) ?? []).some(
      (d) => d >= enteredDay && (deadline === null || d <= deadline)
    );
    if (converted) {
      numerator++;
      denominator++;
      continue;
    }
    if (deadline !== null && opts.today && deadline > opts.today) {
      pending++;
      continue;
    }
    denominator++;
  }
  return { numerator, denominator, pending, value: sharePct(numerator, denominator) };
}

/** Antal bolag vars första inträde i `phase` ligger i perioden. */
export function countPhaseEntries(
  rows: readonly PhaseHistoryRow[],
  phase: StartupPhase,
  period?: MetricPeriod
): number {
  const first = new Map<string, string>();
  for (const r of rows) {
    if (r.phase !== phase) continue;
    const day = dayOf(r.entered_at);
    if (!day) continue;
    const prev = first.get(r.startup);
    if (!prev || day < prev) first.set(r.startup, day);
  }
  let n = 0;
  for (const day of first.values()) if (inPeriod(day, period)) n++;
  return n;
}

/**
 * Median antal dagar bolag tillbringat i en fas. Öppna vistelser (utan
 * `exited_at`) räknas till `today`. null när ingen vistelse finns.
 */
export function medianDaysInPhase(
  rows: readonly PhaseHistoryRow[],
  phase: StartupPhase,
  today: string
): number | null {
  const durations: number[] = [];
  const end = parseDateOnlyLocal(today);
  if (!end) return null;
  for (const r of rows) {
    if (r.phase !== phase) continue;
    const start = parseDateOnlyLocal(r.entered_at);
    if (!start) continue;
    const exit = parseDateOnlyLocal(r.exited_at ?? null) ?? end;
    const days = Math.round((exit.getTime() - start.getTime()) / 86_400_000);
    if (days >= 0) durations.push(days);
  }
  if (durations.length === 0) return null;
  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  return durations.length % 2 === 1 ? durations[mid] : Math.round((durations[mid - 1] + durations[mid]) / 2);
}

// ─── Perioder ───────────────────────────────────────────────────────────────

/**
 * Period för de senaste `days` hela dagarna INKLUSIVE idag (t.o.m. i morgon
 * exkl.), plus den lika långa perioden före — så "nya leads senaste veckan"
 * räknar även dagens.
 */
export function trailingPeriods(today: string, days: number): { current: MetricPeriod; previous: MetricPeriod } {
  const end = parseDateOnlyLocal(today);
  if (!end) throw new Error(`Ogiltigt datum: ${today}`);
  const toKey = (offsetDays: number) => {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() + offsetDays);
    return toDateOnly(d);
  };
  return {
    current: { from: toKey(1 - days), to: toKey(1) },
    previous: { from: toKey(1 - 2 * days), to: toKey(1 - days) }
  };
}

/** Kalenderår som period (t.ex. för mål per verksamhetsår). */
export function yearPeriod(year: number): MetricPeriod {
  return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
}
