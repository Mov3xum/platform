// Portföljkartan på Översikt (/hem, CLAUDE.md § 37.7) — ren modul, enhetstestad.
//
// Varje bolag i ett program blir en punkt: IRL lodrätt (1–9), programmet som
// band vågrätt och — inom bandet — tiden sedan bolaget skrevs in i programmet.
// Alumner, pausade och avböjda bolag visas inte. Ingen IO, ingen PII (bolag,
// inte personer).

import type { StartupPhase } from './index';

/** Programmen i kartans ordning. Alumni och paus ingår aldrig. */
export const PORTFOLIO_MAP_PHASES = [
  'inflode',
  'lead',
  'boost_chamber',
  'incubation',
  'prescale',
  'acceleration'
] as const;
export type PortfolioMapPhase = (typeof PORTFOLIO_MAP_PHASES)[number];

export const PORTFOLIO_MAP_PHASE_LABEL: Record<PortfolioMapPhase, string> = {
  inflode: 'Inflöde',
  lead: 'Lead',
  boost_chamber: 'Boost Chamber',
  incubation: 'Incubation',
  prescale: 'Prescale',
  acceleration: 'Acceleration'
};

/** Band som alltid ritas; `inflode` bara när det finns bolag där. */
const ALWAYS_SHOWN: readonly PortfolioMapPhase[] = ['lead', 'boost_chamber', 'incubation', 'prescale', 'acceleration'];

/** Relationsstatusar som tar bort ett bolag från kartan oavsett fas. */
const EXCLUDED_STATUSES: readonly string[] = ['alumni', 'rejected', 'paused'];

/** Tidsaxelns minsta och största längd i månader (per band). */
export const PORTFOLIO_MAP_MIN_MONTHS = 12;
export const PORTFOLIO_MAP_MAX_MONTHS = 48;

export function isPortfolioMapPhase(phase: unknown): phase is PortfolioMapPhase {
  return (PORTFOLIO_MAP_PHASES as readonly string[]).includes(String(phase ?? ''));
}

/** Visas bolaget på kartan? Bara bolag i ett program, aldrig alumner. */
export function isOnPortfolioMap(phase: unknown, status?: unknown): boolean {
  if (!isPortfolioMapPhase(phase)) return false;
  return !EXCLUDED_STATUSES.includes(String(status ?? ''));
}

/** "YYYY-MM-DD" ur ett PocketBase-/ISO-datum; null när det inte går att tolka. */
export function portfolioDateKey(value: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * Månader mellan två datumnycklar (en decimal). Ett datum i framtiden ger 0 —
 * ett bolag har aldrig varit inskrivet i negativ tid.
 */
export function monthsBetween(fromKey: string, toKey: string): number {
  const days = dayNumber(toKey) - dayNumber(fromKey);
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.round((days / 30.4375) * 10) / 10;
}

export interface PortfolioMapStartupInput {
  id: string;
  name?: string | null;
  phase?: string | null;
  status?: string | null;
  /** Bolagskortets sammanfattande IRL — reserv när ingen KTH-bedömning finns. */
  irl_level?: number | null;
  intagsdatum?: string | null;
  created?: string | null;
  owner?: string | null;
  coaches?: readonly string[] | string | null;
}

export interface PortfolioMapPhaseEntry {
  startup?: string | null;
  phase?: string | null;
  entered_at?: string | null;
}

/** Varifrån inskrivningsdatumet kommer. */
export type PortfolioSinceSource = 'phase' | 'intake' | 'created';

export interface PortfolioMapPoint {
  id: string;
  name: string;
  phase: PortfolioMapPhase;
  /** Index i `bands`. */
  band: number;
  irl: number;
  /** `kth` = senaste KTH IRL-bedömningen, `reserve` = bolagskortets `irl_level`. */
  irlSource: 'kth' | 'reserve';
  /** Månader sedan inskrivning; null när inget datum finns. */
  months: number | null;
  since: string | null;
  sinceSource: PortfolioSinceSource | null;
  /** Den inloggade är coach eller ägare. */
  mine: boolean;
}

export interface PortfolioMapBand {
  phase: PortfolioMapPhase;
  /** Bolag i programmet (även de som saknar IRL). */
  count: number;
  /** Bolag som ritas (har IRL). */
  plotted: number;
  /** Median av de ritade bolagens IRL; null utan ritade bolag. */
  medianIrl: number | null;
}

export interface PortfolioMapData {
  bands: PortfolioMapBand[];
  points: PortfolioMapPoint[];
  /** Bolag i program (kartans underlag). */
  total: number;
  /** Bolag utan IRL — räknas men ritas inte. */
  missingIrl: number;
  /** Ritade bolag utan inskrivningsdatum (ligger vid bandets vänsterkant). */
  missingSince: number;
  /** Ritade bolag vars tid räknas från att de lades in i systemet. */
  approxSince: number;
  /** Tidsaxelns längd per band, i månader. */
  maxMonths: number;
  hasMine: boolean;
}

function coachList(value: PortfolioMapStartupInput['coaches']): readonly string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return typeof value === 'string' && value ? [value] : [];
}

function validIrl(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  // PocketBase lagrar 0 för ett tomt tal — 0 är "ej bedömd", aldrig en nivå.
  return Number.isFinite(n) && n >= 1 && n <= 9 ? n : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m * 10) / 10;
}

/**
 * Bygger kartans underlag. `irlByStartup` kommer ur `irlAverageByStartup`
 * (samma KTH-rad som bolagskortets radar). Inskrivningen är den senaste
 * raden i fashistoriken för bolagets NUVARANDE fas; saknas den används
 * intagsdatum och sist datumet då bolaget lades in i systemet.
 */
export function buildPortfolioMap(input: {
  startups: readonly PortfolioMapStartupInput[];
  irlByStartup: ReadonlyMap<string, number>;
  phaseEntries: readonly PortfolioMapPhaseEntry[];
  /** Dagens datum, "YYYY-MM-DD" (svensk tid). */
  today: string;
  userId?: string | null;
}): PortfolioMapData {
  const entered = new Map<string, string>();
  for (const e of input.phaseEntries) {
    const key = portfolioDateKey(e?.entered_at);
    if (!e?.startup || !e.phase || !key) continue;
    const k = `${e.startup}:${e.phase}`;
    const prev = entered.get(k);
    if (!prev || key > prev) entered.set(k, key);
  }

  const onMap = input.startups.filter((s) => s?.id && isOnPortfolioMap(s.phase, s.status));
  const counts = new Map<PortfolioMapPhase, number>();
  for (const s of onMap) counts.set(s.phase as PortfolioMapPhase, (counts.get(s.phase as PortfolioMapPhase) ?? 0) + 1);

  const phases = PORTFOLIO_MAP_PHASES.filter((p) => ALWAYS_SHOWN.includes(p) || (counts.get(p) ?? 0) > 0);
  const bandIndex = new Map(phases.map((p, i) => [p, i]));

  const points: PortfolioMapPoint[] = [];
  let missingIrl = 0;
  let missingSince = 0;
  let approxSince = 0;
  for (const s of onMap) {
    const phase = s.phase as PortfolioMapPhase;
    const kth = input.irlByStartup.get(s.id);
    const irl = validIrl(kth) ?? validIrl(s.irl_level);
    if (irl === null) {
      missingIrl += 1;
      continue;
    }
    let since = entered.get(`${s.id}:${phase}`) ?? null;
    let sinceSource: PortfolioSinceSource | null = since ? 'phase' : null;
    if (!since) {
      since = portfolioDateKey(s.intagsdatum);
      if (since) sinceSource = 'intake';
    }
    if (!since) {
      since = portfolioDateKey(s.created);
      if (since) sinceSource = 'created';
    }
    if (!since) missingSince += 1;
    if (sinceSource === 'created') approxSince += 1;
    points.push({
      id: s.id,
      name: String(s.name ?? '').trim() || '(namnlöst bolag)',
      phase,
      band: bandIndex.get(phase) ?? 0,
      irl: Math.round(irl * 10) / 10,
      irlSource: validIrl(kth) !== null ? 'kth' : 'reserve',
      months: since ? monthsBetween(since, input.today) : null,
      since,
      sinceSource,
      mine: !!input.userId && (s.owner === input.userId || coachList(s.coaches).includes(input.userId))
    });
  }
  points.sort((a, b) => a.band - b.band || (a.months ?? -1) - (b.months ?? -1) || a.id.localeCompare(b.id));

  const longest = points.reduce((max, p) => Math.max(max, p.months ?? 0), 0);
  const maxMonths = Math.min(
    PORTFOLIO_MAP_MAX_MONTHS,
    Math.max(PORTFOLIO_MAP_MIN_MONTHS, Math.ceil(longest / 6) * 6)
  );

  return {
    bands: phases.map((phase) => {
      const inBand = points.filter((p) => p.phase === phase);
      return {
        phase,
        count: counts.get(phase) ?? 0,
        plotted: inBand.length,
        medianIrl: median(inBand.map((p) => p.irl))
      };
    }),
    points,
    total: onMap.length,
    missingIrl,
    missingSince,
    approxSince,
    maxMonths,
    hasMine: points.some((p) => p.mine)
  };
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export interface PortfolioMapLayoutOptions {
  width: number;
  height: number;
  /** Marginaler runt ritytan (y-etiketter till vänster, bandnamn nedtill). */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Luft mellan bandets kant och dess tidsaxel. */
  bandPad: number;
  radius: number;
}

export interface PortfolioMapDot extends PortfolioMapPoint {
  x: number;
  y: number;
}

export interface PortfolioMapBandLayout extends PortfolioMapBand {
  /** Bandets yttre kanter. */
  x0: number;
  x1: number;
  /** Tidsaxelns början (0 mån) och slut (`maxMonths`). */
  t0: number;
  t1: number;
  medianY: number | null;
}

export interface PortfolioMapLayout {
  dots: PortfolioMapDot[];
  bands: PortfolioMapBandLayout[];
  /** Stödlinjer för IRL. */
  ticks: { irl: number; y: number }[];
  plotTop: number;
  plotBottom: number;
}

export const PORTFOLIO_MAP_IRL_TICKS = [1, 3, 5, 7, 9] as const;

/**
 * Räknar ut pixelpositioner. Punkter som hamnar ovanpå varandra flyttas
 * isär i sidled inom sitt band (några pixlar motsvarar dagar på tidsaxeln),
 * i andra hand i höjdled — deterministiskt, så samma data ger samma bild.
 */
export function layoutPortfolioMap(data: PortfolioMapData, opts: PortfolioMapLayoutOptions): PortfolioMapLayout {
  const plotTop = opts.top;
  const plotBottom = opts.height - opts.bottom;
  const plotH = Math.max(1, plotBottom - plotTop);
  const n = Math.max(1, data.bands.length);
  const bandW = Math.max(1, (opts.width - opts.left - opts.right) / n);
  const yOf = (irl: number) => plotTop + ((9 - Math.min(9, Math.max(1, irl))) / 8) * plotH;

  const bands: PortfolioMapBandLayout[] = data.bands.map((b, i) => {
    const x0 = opts.left + bandW * i;
    const x1 = x0 + bandW;
    const pad = Math.min(opts.bandPad, bandW / 3);
    return {
      ...b,
      x0,
      x1,
      t0: x0 + pad,
      t1: x1 - pad,
      medianY: b.medianIrl === null ? null : yOf(b.medianIrl)
    };
  });

  const min = opts.radius * 2 + 1.5;
  const placed: PortfolioMapDot[] = [];
  for (const p of data.points) {
    const band = bands[p.band] ?? bands[0];
    const share = p.months === null ? 0 : Math.min(1, p.months / Math.max(1, data.maxMonths));
    const baseX = band.t0 + share * (band.t1 - band.t0);
    const baseY = yOf(p.irl);
    const lo = band.x0 + opts.radius + 1;
    const hi = band.x1 - opts.radius - 1;
    const free = (x: number, y: number) => placed.every((q) => Math.hypot(q.x - x, q.y - y) >= min);
    let x = baseX;
    let y = baseY;
    let found = free(x, y);
    for (let ring = 1; ring <= 10 && !found; ring++) {
      for (const dy of [0, -1, 1]) {
        for (const dx of [1, -1]) {
          const cx = baseX + dx * ring * min * (dy === 0 ? 1 : 0.5);
          const cy = baseY + dy * Math.ceil(ring / 3) * min * 0.87;
          if (cx < lo || cx > hi || cy < plotTop || cy > plotBottom) continue;
          if (free(cx, cy)) {
            x = cx;
            y = cy;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    placed.push({ ...p, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }

  return {
    dots: placed,
    bands,
    ticks: PORTFOLIO_MAP_IRL_TICKS.map((irl) => ({ irl, y: yOf(irl) })),
    plotTop,
    plotBottom
  };
}

/** "8 mån", "1 år 2 mån", "under 1 mån" — för tooltip och skärmläsare. */
export function formatMonthsSv(months: number | null): string {
  if (months === null) return 'okänd tid';
  const whole = Math.floor(months);
  if (whole < 1) return 'under 1 mån';
  if (whole < 12) return `${whole} mån`;
  const years = Math.floor(whole / 12);
  const rest = whole % 12;
  return rest ? `${years} år ${rest} mån` : `${years} år`;
}
