// Ren, server-/React-fri logik för Vinnovas lägesredovisning (excellent
// inkubator). Delas av rapportmotorn (apps/web/src/lib/reporting) och
// enhetstestas (reporting.test.ts). Inga beroenden utöver typer.
//
// Se docs/reporting/vinnova-tillvaxtverket-djupanalys.md för bakgrund.

import type {
  ReadinessAxis,
  ServiceActivityKind,
  ServiceCostType,
  StateAidBasis,
  VinnovaFocus
} from './index';

// ─── Programperiod & etiketter ───────────────────────────────────────────────

/** Programperiodens start (kvalitetsstämpel 1 juli 2025 – 30 juni 2029). */
export const PROGRAM_START = '2025-07-01';
export const PROGRAM_END = '2029-06-30';

export const VINNOVA_FOCUS_LABELS: Record<VinnovaFocus, string> = {
  agro: 'Agro (från jord till bord)',
  industriell_teknik: 'Industriell teknik (material, nano, produktion, rymd, säkerhet)',
  life_science: 'Life Science (e-hälsa, biotech, pharma, medtech)',
  miljo_energi: 'Miljö & energi',
  mjukvara_ict: 'Mjukvara / ICT',
  upplevelseindustri: 'Upplevelseindustri (turism, outdoor, spel, musik, underhållning)',
  ovrigt: 'Övrigt'
};

export const STATE_AID_BASIS_LABELS: Record<StateAidBasis, string> = {
  art22: 'Artikel 22',
  de_minimis: 'Stöd av mindre betydelse'
};

export const READINESS_AXIS_LABELS: Record<ReadinessAxis, string> = {
  crl: 'CRL (Customer Readiness Level)',
  tmrl: 'TMRL (Team Readiness Level)',
  brl: 'BRL (Business Readiness Level)',
  srl: 'SRL (Sustainability Readiness Level)'
};

// Kanoniska rubriker per nivå (1–9) enligt KTH IRL, från Vinnova-mallens
// flik "Beroende rulllistor". Index 0 är tomt så nivå N nås direkt.
export const READINESS_SCALE: Record<ReadinessAxis, string[]> = {
  crl: [
    '',
    'Hypothesizing on possible needs in market.',
    'Identified specific needs in market.',
    'First market feedback established.',
    'Confirmed problem/needs from several customers or users',
    'Established interest for product and relations with target customers',
    'Benefits of the product confirmed through partnerships or first customer testing.',
    'Customers in extended product testing or first test sales',
    'First products sold and increased structured sales efforts.',
    'Widespread product sales that scale.'
  ],
  tmrl: [
    '',
    'Little insight into the need for a team (typically an individual). Lack of necessary competencies/resources.',
    'Insight and first idea on necessary competencies or external resources (e.g. partners).',
    'A few of necessary competencies/resources are present. Defined needed competencies/resources (and plan for finding).',
    'A champion is present. Several needed competencies in place. Initiated plan for recruiting or securing additional key resources.',
    'Initial founding team with main needed competencies. Team agrees on ownership and roles and has aligned goals.',
    'Complementary, diverse and committed team with all necessary competencies/resources incl. both business and tech.',
    'Team and culture is fully in place and proactively developed. Updated plan for building necessary team on longer term.',
    'Management and CEO in place. Professional use of board/advisors. Activated plan and recruitment for building long term team.',
    'High performing, well-structured team and organization that is maintained and performs over time.'
  ],
  brl: [
    '',
    'Hypothesizing on possible business concept. Little knowledge or insight into market and competition.',
    'First possible business concept described (e.g. NABC). Identified overall market and some competitors/alternatives.',
    'Draft of business model in canvas (excl. revenues/costs). Described market potential and complete competitive overview.',
    'First version of full business model in canvas (incl. revenues/costs). First projections to show economic viability and market potential.',
    'Parts of business model tested on market and canvas updated. First version of revenue model incl. pricing hypotheses. Verified competitive position/uniqueness through market feedback.',
    'Full business model incl. pricing verified on customers (by test sales).',
    'Product/market fit and customers payment willingness demonstrated. Attractive revenue vs cost projections (validated by data and sales).',
    'Sales and metrics show business model holds and can scale. Business model is fine-tuned to explore more revenue options.',
    'Business model is final and is scaling with growing recurring revenues that results in a profitable and sustainable business.'
  ],
  srl: [
    '',
    'None or very low awareness of how sustainability affects the planned business',
    'Some awareness of how sustainability affects the planned business',
    'A first description of value creation and the need for sustainability to be integrated into the business idea / business model.',
    'Business concept with embedded sustainability hypothesis is tested/validated against potential customers/users.',
    'Sustainability is set in the business model and is tested/validated against potential customers/users',
    'Sustainability is rooted in the entire team and is ingrained into the entire business.',
    'Monitoring, reporting and communication on sustainability outcomes and impact are implemented.',
    'The business model and operations are fine-tuned based on monitoring and evaluation using sustainability metrics in order to prepare for scaling/growth.',
    "The sustainability strategy contributes to competitiveness and revenue growth and makes a proven contribution to relevant parts of the UN's sustainable development goals"
  ]
};

/** Formaterar en RL-cell som Vinnova ("CRL 7. Customers in extended…"). */
export function formatReadinessCell(axis: ReadinessAxis, level: number | undefined | null): string {
  if (level == null || level < 1 || level > 9) return '';
  const prefix = axis.toUpperCase();
  return `${prefix} ${level}. ${READINESS_SCALE[axis][level]}`;
}

// ─── Parsning av Vinnova-mallens textceller (för Excel-import) ────────────────

/**
 * Extraherar readiness-nivån (1–9) ur en cell som "CRL 7. ...", "SRL4. ..."
 * eller "TMRL 5. ...". Tar första heltalet 1–9. Tom/ogiltig → null.
 */
export function parseReadinessLevel(cell: string | undefined | null): number | null {
  if (!cell) return null;
  const m = String(cell).match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 9 ? n : null;
}

/** Mappar Vinnovas affärsinriktnings-etikett (frisktext) → enum, eller null. */
export function mapVinnovaFocus(label: string | undefined | null): VinnovaFocus | null {
  if (!label) return null;
  const s = String(label).toLowerCase();
  if (s.includes('agro')) return 'agro';
  if (s.includes('industriell')) return 'industriell_teknik';
  if (s.includes('life science') || s.includes('biotech') || s.includes('medtech')) return 'life_science';
  if (s.includes('miljö') || s.includes('miljo') || s.includes('energi')) return 'miljo_energi';
  if (s.includes('mjukvara') || s.includes('ict')) return 'mjukvara_ict';
  if (s.includes('upplevelse') || s.includes('turism')) return 'upplevelseindustri';
  if (s.includes('övrigt') || s.includes('ovrigt') || s.includes('annat')) return 'ovrigt';
  return null;
}

/** Mappar statsstödsgrundens etikett (frisktext) → enum, eller null. */
export function mapStateAidBasis(label: string | undefined | null): StateAidBasis | null {
  if (!label) return null;
  const s = String(label).toLowerCase();
  if (s.includes('mindre betydelse') || s.includes('de minimis')) return 'de_minimis';
  if (s.includes('artikel 22') || s.includes('art. 22') || s.includes('gber')) return 'art22';
  return null;
}

// ─── Datum-hjälpare (date-only, inga tidszoner) ──────────────────────────────

/** Normaliserar en ISO-/PB-datumsträng till 'YYYY-MM-DD' (eller null). */
export function dateOnly(value: string | undefined | null): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (s.length < 10) return null;
  return s.slice(0, 10);
}

/** Inklusiv jämförelse: ligger `d` i [from, to]? Tom to = öppet uppåt. */
export function inWindow(d: string | null, from: string, to: string | null): boolean {
  if (!d) return false;
  if (d < from) return false;
  if (to != null && d > to) return false;
  return true;
}

export interface PeriodWindow {
  from: string; // 'YYYY-MM-DD' inklusive
  to: string; // 'YYYY-MM-DD' inklusive
}

/** Skärningen av två fönster, eller null om de inte överlappar. */
export function intersect(a: PeriodWindow, b: PeriodWindow): PeriodWindow | null {
  const from = a.from > b.from ? a.from : b.from;
  const to = a.to < b.to ? a.to : b.to;
  return from <= to ? { from, to } : null;
}

// ─── Beräkningsinput (rena dataformer, oberoende av PB) ──────────────────────

export interface TimeEntryCalc {
  activity_kind: ServiceActivityKind;
  hours: number;
  hourly_rate_sek?: number | null;
  occurred_on: string;
}

export interface ServiceCostCalc {
  cost_type: ServiceCostType;
  amount_sek: number;
  incurred_on: string;
}

export interface ReadinessCalc {
  assessed_at: string;
  crl?: number | null;
  tmrl?: number | null;
  brl?: number | null;
  srl?: number | null;
  criteria_checked_at?: string | null;
}

export interface StateAidPeriodCalc {
  basis: StateAidBasis;
  sni_code?: string | null;
  valid_from: string;
  valid_to?: string | null;
}

export interface StartupCalc {
  id: string;
  name: string;
  org_nr?: string | null;
  status?: string | null;
  vinnova_focus?: VinnovaFocus | null;
  sni_code?: string | null;
  state_aid_start_at?: string | null;
  vinnova_funding_end_at?: string | null;
}

export interface LagesredovisningInput {
  startup: StartupCalc;
  timeEntries: TimeEntryCalc[];
  costs: ServiceCostCalc[];
  readiness: ReadinessCalc[];
  stateAidPeriods: StateAidPeriodCalc[];
}

export interface BuildOptions {
  reportPeriod: PeriodWindow;
  /** Default PROGRAM_START. */
  programStart?: string;
  /** Fallback-timpris när posten saknar eget. */
  fallbackRate: number;
}

// ─── Värdeberäkning ──────────────────────────────────────────────────────────

export function timeEntryValue(e: TimeEntryCalc, fallbackRate: number): number {
  const rate = e.hourly_rate_sek != null && e.hourly_rate_sek > 0 ? e.hourly_rate_sek : fallbackRate;
  return (e.hours || 0) * rate;
}

interface ServiceTotals {
  inkubator: number; // internt (tid) + externt (external_service-kostnader)
  verifiering: number; // externa verifieringskostnader + ev. verifieringstid
  summa: number;
}

function totalsForWindow(
  entries: TimeEntryCalc[],
  costs: ServiceCostCalc[],
  win: PeriodWindow,
  fallbackRate: number
): ServiceTotals {
  let inkubator = 0;
  let verifiering = 0;
  for (const e of entries) {
    if (!inWindow(dateOnly(e.occurred_on), win.from, win.to)) continue;
    const v = timeEntryValue(e, fallbackRate);
    if (e.activity_kind === 'incubation') inkubator += v;
    else if (e.activity_kind === 'verification') verifiering += v;
    // 'admin' räknas inte med
  }
  for (const c of costs) {
    if (!inWindow(dateOnly(c.incurred_on), win.from, win.to)) continue;
    const v = c.amount_sek || 0;
    if (c.cost_type === 'external_service') inkubator += v;
    else if (c.cost_type === 'verification') verifiering += v;
    // 'other' räknas inte med
  }
  return { inkubator, verifiering, summa: round2(inkubator + verifiering) };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─── Senaste readiness-bedömning ─────────────────────────────────────────────

export function latestReadiness(readiness: ReadinessCalc[]): ReadinessCalc | null {
  if (!readiness.length) return null;
  return [...readiness].sort((a, b) =>
    (dateOnly(b.assessed_at) || '').localeCompare(dateOnly(a.assessed_at) || '')
  )[0];
}

// ─── Radbyggare ──────────────────────────────────────────────────────────────

export interface LagesredovisningRow {
  startupId: string;
  name: string;
  org_nr: string;
  state_aid_start_at: string;
  vinnova_focus: VinnovaFocus | null;
  vinnova_focus_label: string;
  basis: StateAidBasis | null;
  basis_label: string;
  sni_code: string;
  period: ServiceTotals;
  accumulated: ServiceTotals;
  criteria_checked_at: string;
  crl: number | null;
  tmrl: number | null;
  brl: number | null;
  srl: number | null;
  crl_cell: string;
  tmrl_cell: string;
  brl_cell: string;
  srl_cell: string;
  vinnova_funding_end_at: string;
}

/**
 * Bygger en eller flera lägesredovisningsrader för ett bolag. Ett bolag ger
 * flera rader om det växlat statsstödsgrund (Art.22 ↔ de minimis) under
 * perioden — exakt vad Vinnova-mallens instruktion kräver. Tid/kostnad
 * fördelas på rätt grund utifrån när de inföll.
 */
export function buildLagesredovisningRows(
  input: LagesredovisningInput,
  opts: BuildOptions
): LagesredovisningRow[] {
  const programStart = opts.programStart || PROGRAM_START;
  const { reportPeriod, fallbackRate } = opts;
  const accWindow: PeriodWindow = { from: programStart, to: reportPeriod.to };
  const r = latestReadiness(input.readiness);

  const base = {
    startupId: input.startup.id,
    name: input.startup.name,
    org_nr: input.startup.org_nr || '',
    state_aid_start_at: dateOnly(input.startup.state_aid_start_at) || '',
    vinnova_focus: input.startup.vinnova_focus || null,
    vinnova_focus_label: input.startup.vinnova_focus
      ? VINNOVA_FOCUS_LABELS[input.startup.vinnova_focus]
      : '',
    criteria_checked_at: dateOnly(r?.criteria_checked_at) || '',
    crl: r?.crl ?? null,
    tmrl: r?.tmrl ?? null,
    brl: r?.brl ?? null,
    srl: r?.srl ?? null,
    crl_cell: formatReadinessCell('crl', r?.crl),
    tmrl_cell: formatReadinessCell('tmrl', r?.tmrl),
    brl_cell: formatReadinessCell('brl', r?.brl),
    srl_cell: formatReadinessCell('srl', r?.srl),
    vinnova_funding_end_at: dateOnly(input.startup.vinnova_funding_end_at) || ''
  };

  // Statsstödsperioder som överlappar rapportperioden.
  const overlapping = input.stateAidPeriods.filter((p) => {
    const from = dateOnly(p.valid_from);
    const to = dateOnly(p.valid_to);
    if (!from) return false;
    return inOverlap(from, to, reportPeriod);
  });

  if (overlapping.length === 0) {
    // Ingen explicit statsstödsperiod → en rad för hela rapportperioden.
    return [
      {
        ...base,
        basis: null,
        basis_label: '',
        sni_code: input.startup.sni_code || '',
        period: totalsForWindow(input.timeEntries, input.costs, reportPeriod, fallbackRate),
        accumulated: totalsForWindow(input.timeEntries, input.costs, accWindow, fallbackRate)
      }
    ];
  }

  return overlapping.map((p) => {
    const from = dateOnly(p.valid_from) as string;
    const to = dateOnly(p.valid_to);
    const basisRange: PeriodWindow = { from, to: to || reportPeriod.to };
    const accBasisRange: PeriodWindow = { from, to: to || accWindow.to };
    const periodWin = intersect(reportPeriod, basisRange) || reportPeriod;
    const accWin = intersect(accWindow, accBasisRange) || accWindow;
    return {
      ...base,
      basis: p.basis,
      basis_label: STATE_AID_BASIS_LABELS[p.basis],
      sni_code: p.sni_code || input.startup.sni_code || '',
      period: totalsForWindow(input.timeEntries, input.costs, periodWin, fallbackRate),
      accumulated: totalsForWindow(input.timeEntries, input.costs, accWin, fallbackRate)
    };
  });
}

function inOverlap(from: string, to: string | null, period: PeriodWindow): boolean {
  if (from > period.to) return false;
  if (to != null && to < period.from) return false;
  return true;
}

// ─── Datakvalitetskontroll (SOC 2 Processing Integrity) ──────────────────────

export type IssueSeverity = 'error' | 'warning';

export interface DataQualityIssue {
  startupId: string;
  name: string;
  field: string;
  severity: IssueSeverity;
  message: string;
}

/**
 * Flaggar saknad/inkonsekvent data per rad. `error` blockerar export till
 * `sent`; `warning` informerar bara. Människa-i-loopen (CLAUDE.md §10).
 */
export function validateRow(row: LagesredovisningRow): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const push = (field: string, severity: IssueSeverity, message: string) =>
    issues.push({ startupId: row.startupId, name: row.name, field, severity, message });

  if (!row.org_nr) push('org_nr', 'error', 'Org-nr saknas (krävs i lägesredovisningen).');
  if (row.basis === 'de_minimis' && !row.sni_code)
    push('sni_code', 'error', 'SNI-kod krävs vid stöd av mindre betydelse (e-AidRegister).');
  if (!row.vinnova_focus) push('vinnova_focus', 'warning', 'Affärsinriktning (Vinnova-enum) saknas.');
  if (!row.state_aid_start_at)
    push('state_aid_start_at', 'warning', 'Datum då bolaget började ta emot statsstöd saknas.');
  if (row.crl == null && row.tmrl == null && row.brl == null && row.srl == null)
    push('readiness', 'warning', 'Ingen readiness-bedömning (CRL/TMRL/BRL/SRL) registrerad.');
  if (!row.criteria_checked_at)
    push('criteria_checked_at', 'warning', 'Datum för senaste målgruppskontroll saknas.');
  if (row.period.summa === 0)
    push('period', 'warning', 'Inga levererade tjänster (0 kr) registrerade för perioden.');
  return issues;
}

export interface LagesredovisningResult {
  rows: LagesredovisningRow[];
  issues: DataQualityIssue[];
  totals: ServiceTotals;
  accumulatedTotals: ServiceTotals;
}

/** Bygger alla rader + aggregat + samlade datakvalitetsflaggor. */
export function buildLagesredovisning(
  inputs: LagesredovisningInput[],
  opts: BuildOptions
): LagesredovisningResult {
  const rows: LagesredovisningRow[] = [];
  for (const input of inputs) rows.push(...buildLagesredovisningRows(input, opts));

  const issues = rows.flatMap(validateRow);
  const sum = (sel: (r: LagesredovisningRow) => ServiceTotals): ServiceTotals => {
    const t = rows.reduce(
      (acc, row) => {
        const s = sel(row);
        acc.inkubator += s.inkubator;
        acc.verifiering += s.verifiering;
        return acc;
      },
      { inkubator: 0, verifiering: 0 }
    );
    return { inkubator: round2(t.inkubator), verifiering: round2(t.verifiering), summa: round2(t.inkubator + t.verifiering) };
  };
  return {
    rows,
    issues,
    totals: sum((r) => r.period),
    accumulatedTotals: sum((r) => r.accumulated)
  };
}
