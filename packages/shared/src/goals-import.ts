/**
 * Import av mål från Excel/CSV till Mål & verksamhetsplan (CLAUDE.md § 42) —
 * ren, IO-fri tolkning. En rad = ett mål, eller ett mål + en indikator; flera
 * rader med samma mål (fokusområde + titel) slås ihop till ETT mål med flera
 * indikatorer. Rubriker matchas mot svenska/engelska alias, värden mot både
 * nyckel och etikett ("Inflöde och varumärke" ⇒ `inflode_varumarke`,
 * "Personligt" ⇒ `personal`, "Beräknas ur data" ⇒ `computed`).
 *
 * Varningar är PII-fria (radnummer, aldrig cellvärden). Skrivningen sker i
 * skrivlagret (`importGoals`) som kör exakt samma validering som UI:t.
 */

import {
  GOAL_FOCUS_AREAS,
  GOAL_FOCUS_AREA_LABELS,
  GOAL_INDICATOR_SOURCES,
  GOAL_INDICATOR_SOURCE_LABELS,
  GOAL_INDICATOR_UNITS,
  GOAL_INDICATOR_UNIT_LABELS,
  GOAL_KINDS,
  GOAL_KIND_LABELS,
  GOAL_OWNER_TEAMS,
  GOAL_OWNER_TEAM_LABELS,
  GOAL_DESCRIPTION_MAX,
  GOAL_COMMENT_MAX,
  GOAL_LEVELS,
  GOAL_LEVEL_LABELS,
  GOAL_STATUSES,
  GOAL_STATUS_LABELS,
  GOAL_SUBTEAM_MAX,
  GOAL_TARGET_TEXT_MAX,
  GOAL_TITLE_MAX,
  type GoalFocusArea,
  type GoalLevel,
  type GoalStatus,
  type GoalIndicatorSource,
  type GoalIndicatorUnit,
  type GoalKind,
  type GoalOwnerTeam
} from './goals';
import { METRIC_DEFINITIONS, METRIC_KEYS, type MetricKey } from './metrics';

export const GOAL_IMPORT_FIELDS = [
  'focus_area',
  'kind',
  'level',
  'title',
  'description',
  'parent',
  'owner_team',
  'owner_email',
  'responsible',
  'indicator',
  'source',
  'metric_key',
  'target',
  'unit',
  'status_q1',
  'status_q2',
  'status_q3',
  'status_q4',
  'status_comment'
] as const;
export type GoalImportField = (typeof GOAL_IMPORT_FIELDS)[number];

export const GOAL_IMPORT_FIELD_LABELS: Record<GoalImportField, string> = {
  focus_area: 'Fokusområde',
  kind: 'Måltyp',
  level: 'Nivå',
  title: 'Mål',
  description: 'Beskrivning',
  parent: 'Överliggande mål',
  owner_team: 'Team',
  owner_email: 'Ägare (e-post)',
  responsible: 'Ansvarig',
  indicator: 'Indikator',
  source: 'Mätkälla',
  metric_key: 'Metrik',
  target: 'Måltal',
  unit: 'Enhet',
  status_q1: 'Status Q1',
  status_q2: 'Status Q2',
  status_q3: 'Status Q3',
  status_q4: 'Status Q4',
  status_comment: 'Kommentar'
};

/** Kolumnerna i mallen (CSV) — samma ordning som verksamhetsplanens Excel. */
const TEMPLATE_FIELDS: readonly GoalImportField[] = [
  'focus_area',
  'kind',
  'level',
  'title',
  'description',
  'parent',
  'owner_team',
  'responsible',
  'indicator',
  'source',
  'metric_key',
  'target',
  'unit',
  'status_q1',
  'status_q2',
  'status_q3',
  'status_q4',
  'status_comment'
];

const HEADER_ALIASES: Record<string, GoalImportField> = {
  fokusområde: 'focus_area',
  fokusomrade: 'focus_area',
  område: 'focus_area',
  omrade: 'focus_area',
  'focus area': 'focus_area',
  focus_area: 'focus_area',
  area: 'focus_area',
  objective: 'focus_area',
  'övergripande mål - objective': 'focus_area',
  'övergripande mål': 'focus_area',
  måltyp: 'kind',
  maltyp: 'kind',
  typ: 'kind',
  kind: 'kind',
  type: 'kind',
  nivå: 'level',
  niva: 'level',
  level: 'level',
  'key result nivå': 'level',
  'key result niva': 'level',
  målnivå: 'level',
  mål: 'title',
  mal: 'title',
  titel: 'title',
  title: 'title',
  goal: 'title',
  målformulering: 'title',
  'key result': 'title',
  'key results': 'title',
  nyckelresultat: 'title',
  beskrivning: 'description',
  description: 'description',
  'beskrivning och definition av målet': 'description',
  'överliggande mål': 'parent',
  'overliggande mal': 'parent',
  'bidrar till': 'parent',
  'parent goal': 'parent',
  parent: 'parent',
  team: 'owner_team',
  'ägande team': 'owner_team',
  'agande team': 'owner_team',
  ansvarigt: 'owner_team',
  'ansvarigt team': 'owner_team',
  owner_team: 'owner_team',
  ägare: 'owner_email',
  agare: 'owner_email',
  owner: 'owner_email',
  medarbetare: 'owner_email',
  person: 'owner_email',
  'e-post': 'owner_email',
  epost: 'owner_email',
  email: 'owner_email',
  'ägare (e-post)': 'owner_email',
  ansvarig: 'responsible',
  'ansvarig roll': 'responsible',
  'ansvarig person': 'responsible',
  responsible: 'responsible',
  indikator: 'indicator',
  indicator: 'indicator',
  nyckeltal: 'indicator',
  kpi: 'indicator',
  mätetal: 'indicator',
  matetal: 'indicator',
  mätkälla: 'source',
  matkalla: 'source',
  källa: 'source',
  kalla: 'source',
  source: 'source',
  metrik: 'metric_key',
  metric: 'metric_key',
  metric_key: 'metric_key',
  måltal: 'target',
  maltal: 'target',
  målvärde: 'target',
  malvarde: 'target',
  target: 'target',
  mål2026: 'target',
  enhet: 'unit',
  unit: 'unit',
  'status q1': 'status_q1',
  'status q2': 'status_q2',
  'status q3': 'status_q3',
  'status q4': 'status_q4',
  q1: 'status_q1',
  q2: 'status_q2',
  q3: 'status_q3',
  q4: 'status_q4',
  kommentar: 'status_comment',
  comment: 'status_comment',
  'kommentar om resultatet': 'status_comment',
  'kommentar om resultat': 'status_comment'
};

/**
 * Rubriker som börjar på ett känt prefix ("Målvärde 2026", "Status Q3 (sept)",
 * "Beskrivning av …"). Längsta prefix först så "key result nivå" vinner över
 * "key result".
 */
const HEADER_PREFIXES: ReadonlyArray<[string, GoalImportField]> = [
  ['beskrivning', 'description'],
  ['övergripande mål', 'focus_area'],
  ['överliggande', 'parent'],
  ['key result nivå', 'level'],
  ['key result niva', 'level'],
  ['ansvarig roll', 'responsible'],
  ['ansvarig person', 'responsible'],
  ['ansvarigt team', 'owner_team'],
  ['målvärde', 'target'],
  ['malvarde', 'target'],
  ['måltal', 'target'],
  ['status q1', 'status_q1'],
  ['status q2', 'status_q2'],
  ['status q3', 'status_q3'],
  ['status q4', 'status_q4'],
  ['kommentar', 'status_comment']
];

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normKey(s: string): string {
  return norm(s).replace(/[\s-]+/g, '_');
}

function headerField(h: string): GoalImportField | null {
  const v = norm(h).replace(/\s*[-–—]\s*/g, ' - ');
  const exact = HEADER_ALIASES[v] ?? HEADER_ALIASES[norm(h)] ?? HEADER_ALIASES[normKey(h)];
  if (exact) return exact;
  for (const [prefix, field] of HEADER_PREFIXES) if (v.startsWith(prefix)) return field;
  return null;
}

/** Mappar en rubrikrad till fält (null = okänd kolumn, ignoreras). Ett fält används högst en gång (första kolumnen vinner). */
export function mapGoalImportHeaders(headers: readonly string[]): Array<GoalImportField | null> {
  const seen = new Set<GoalImportField>();
  return headers.map((h) => {
    const f = headerField(String(h ?? ''));
    if (!f || seen.has(f)) return null;
    seen.add(f);
    return f;
  });
}

/**
 * Var rubrikraden står: verksamhetsplanens flikar har ofta en titelrad
 * ("Teamnivå - Coacher") före rubrikerna. Första raden bland de tio första
 * som har en mål-kolumn och minst en annan känd kolumn; -1 om ingen finns.
 */
export function findGoalImportHeaderRow(rows: readonly (readonly string[])[]): number {
  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i++) {
    const mapped = mapGoalImportHeaders(rows[i].map((c) => String(c ?? '')));
    if (mapped.includes('title') && mapped.filter(Boolean).length >= 2) return i;
  }
  return -1;
}

function matchVocab<T extends string>(raw: string, keys: readonly T[], labels: Record<T, string>, extra: Record<string, T> = {}): T | null {
  const v = norm(raw);
  if (!v) return null;
  const k = normKey(raw);
  for (const key of keys) if (k === key || v === norm(labels[key])) return key;
  if (extra[v]) return extra[v];
  // Tolerant: cellen innehåller etiketten, eller etiketten börjar med cellen (≥ 4 tecken).
  for (const key of keys) {
    const label = norm(labels[key]);
    if (v.length >= 4 && (label.includes(v) || v.includes(label))) return key;
  }
  return null;
}

export function parseGoalFocusAreaValue(raw: string): GoalFocusArea | null {
  const direct = matchFocusExact(raw);
  if (direct) return direct;
  // Formuleringar i verksamhetsplanen: "Stärka varumärke & inflöde",
  // "Utveckla tematisk accelerator med spets" — nyckelord i cellen.
  const v = norm(raw);
  if (/varumärke|varumarke|inflöde|inflode/.test(v)) return 'inflode_varumarke';
  if (/partner|finansier/.test(v)) return 'partner_finansiering';
  if (/kundvärde|kundvarde|kvalitetssäkr|kvalitetssakr/.test(v)) return 'kundvarde_kvalitet';
  if (/organisatorisk|digitalis/.test(v)) return 'organisation_digitalisering';
  if (/accelerator/.test(v)) return 'tematisk_accelerator';
  if (/^projekt/.test(v)) return 'projekt';
  return null;
}

function matchFocusExact(raw: string): GoalFocusArea | null {
  return matchVocab(raw, GOAL_FOCUS_AREAS, GOAL_FOCUS_AREA_LABELS, {
    partner: 'partner_finansiering',
    finansiering: 'partner_finansiering',
    inflöde: 'inflode_varumarke',
    inflode: 'inflode_varumarke',
    varumärke: 'inflode_varumarke',
    kundvärde: 'kundvarde_kvalitet',
    kundvarde: 'kundvarde_kvalitet',
    kvalitet: 'kundvarde_kvalitet',
    organisation: 'organisation_digitalisering',
    digitalisering: 'organisation_digitalisering',
    accelerator: 'tematisk_accelerator',
    tematisk: 'tematisk_accelerator'
  });
}

export function parseGoalKindValue(raw: string): GoalKind | null {
  return matchVocab(raw, GOAL_KINDS, GOAL_KIND_LABELS, {
    övergripande: 'overall',
    overgripande: 'overall',
    gemensamt: 'overall',
    organisation: 'overall',
    verksamhet: 'overall',
    personligt: 'personal',
    personlig: 'personal',
    eget: 'personal',
    individuellt: 'personal'
  });
}

export function parseGoalOwnerTeamValue(raw: string): GoalOwnerTeam | null {
  return matchVocab(raw, GOAL_OWNER_TEAMS, GOAL_OWNER_TEAM_LABELS, {
    ledning: 'ledning',
    ledningsgruppen: 'ledning',
    marknad: 'marknad',
    marknadsteamet: 'marknad',
    projekt: 'projekt',
    projektgruppen: 'projekt',
    coach: 'coach',
    coacher: 'coach',
    coachgruppen: 'coach',
    alla: 'gemensamt',
    gemensam: 'gemensamt'
  });
}

export function parseGoalSourceValue(raw: string): GoalIndicatorSource | null {
  return matchVocab(raw, GOAL_INDICATOR_SOURCES, GOAL_INDICATOR_SOURCE_LABELS, {
    beräknad: 'computed',
    beraknad: 'computed',
    beräknas: 'computed',
    data: 'computed',
    automatisk: 'computed',
    manuell: 'manual',
    manuellt: 'manual',
    bedömning: 'manual',
    enkät: 'survey',
    enkat: 'survey'
  });
}

export function parseGoalUnitValue(raw: string): GoalIndicatorUnit | null {
  return matchVocab(raw, GOAL_INDICATOR_UNITS, GOAL_INDICATOR_UNIT_LABELS, {
    st: 'count',
    antal: 'count',
    '%': 'pct',
    procent: 'pct',
    andel: 'pct',
    dagar: 'days',
    dag: 'days',
    'ja/nej': 'bool',
    ja: 'bool',
    bool: 'bool'
  });
}

const METRIC_LABELS = Object.fromEntries(METRIC_KEYS.map((k) => [k, METRIC_DEFINITIONS[k].label])) as Record<MetricKey, string>;

/** Metrik på nyckel eller etikett — bara tenant-mått (personliga mått kan inte vara verksamhetsmål). */
export function parseGoalMetricValue(raw: string): MetricKey | null {
  const key = matchVocab(raw, METRIC_KEYS, METRIC_LABELS);
  return key && METRIC_DEFINITIONS[key].scope === 'tenant' ? key : null;
}

/** Nivåvärden: "Organisationsnivå", "Teamnivå", "Projektnivå", "Projektindikatorer", "Personligt mål". */
export function parseGoalLevelValue(raw: string): GoalLevel | null {
  const key = matchVocab(raw, GOAL_LEVELS, GOAL_LEVEL_LABELS);
  if (key) return key;
  const v = norm(raw);
  if (!v) return null;
  if (/projektindikator|project indicator|project_indicator/.test(v)) return 'project_indicator';
  if (/projekt|project/.test(v)) return 'project';
  if (/personlig|individ|personal/.test(v)) return 'personal';
  if (/organisation|organization|verksamhet/.test(v)) return 'organisation';
  if (/team/.test(v)) return 'team';
  return null;
}

/** Statusvärden: "I fas", "Försenad", "Klar", "Ej startad", "Risk" (även nycklar). */
export function parseGoalStatusValue(raw: string): GoalStatus | null {
  const key = matchVocab(raw, GOAL_STATUSES, GOAL_STATUS_LABELS);
  if (key) return key;
  const v = norm(raw);
  if (!v) return null;
  if (/^(i fas|ok|on track|grön|gron)/.test(v)) return 'on_track';
  if (/^(risk|röd|rod|at risk)/.test(v)) return 'risk';
  if (/^(försen|forsen|sen|delayed|gul)/.test(v)) return 'delayed';
  if (/^(ej start|inte start|not started|ej påbörj|ej paborj)/.test(v)) return 'not_started';
  if (/^(klar|done|uppnått|uppnatt|avklarad|genomförd|genomford)/.test(v)) return 'done';
  return null;
}

/**
 * Team-cellen: ett känt team ("Coacher", "Marknad", "Ledningsgrupp") eller ett
 * projekt/delteam ("Sprint-X 2 - Kapital", "EOI", "GSAI") — det senare blir
 * Projektgrupp med cellen som delteam, så att det går att filtrera på.
 */
export function parseGoalTeamCell(raw: string): { team: GoalOwnerTeam; subteam: string | null } | null {
  const v = raw.replace(/\s+/g, ' ').trim();
  if (!v) return null;
  const known = parseGoalOwnerTeamValue(v);
  if (known) return { team: known, subteam: null };
  return { team: 'projekt', subteam: v.slice(0, GOAL_SUBTEAM_MAX) };
}

function parseTarget(raw: string): number | null | undefined {
  const s = raw.trim().replace(/\s/g, '').replace('%', '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export interface ParsedTargetCell {
  target: number | null;
  unit: GoalIndicatorUnit | null;
  /** Målvärdet i ord när talet inte säger allt ("Över 40%", "Ökning med 12 st …", "TBD"). */
  text: string | null;
}

/**
 * Målvärde som verksamhetsplanen skriver det: "Ja" (ja/nej-mål), "25", "75%",
 * "50 st", "Över 40%", "4 (på skalan 1-5)", "TBD", "Ökning med 12 st i BC och
 * 5 st ink/acc Tot 17". Ett ensamt tal blir måltal; flera tal eller inget tal
 * ⇒ inget måltal (vi gissar inte vilket tal som är målet) och texten sparas.
 */
export function parseGoalTargetCell(raw: string): ParsedTargetCell {
  const v = raw.replace(/\s+/g, ' ').trim();
  if (!v) return { target: null, unit: null, text: null };
  const n = norm(v);
  if (/^(ja|yes|nej|no)$/.test(n)) return { target: null, unit: 'bool', text: null };
  const numbers = v.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const isPct = v.includes('%') || /procent/.test(n);
  const simple = /^[\d\s.,]+\s*(%|st|procent|stycken)?$/i.test(v);
  const text = simple ? null : v.slice(0, GOAL_TARGET_TEXT_MAX);
  if (numbers.length !== 1) return { target: null, unit: isPct ? 'pct' : 'count', text };
  const target = Number(numbers[0].replace(',', '.'));
  return { target: Number.isFinite(target) ? target : null, unit: isPct ? 'pct' : 'count', text };
}

export interface GoalImportStatus {
  quarter: 1 | 2 | 3 | 4;
  status: GoalStatus;
}

export interface GoalImportIndicator {
  line: number;
  label: string;
  source: GoalIndicatorSource;
  metric_key: MetricKey | null;
  target: number | null;
  /** Målvärdet i ord (verksamhetsplanens "Målvärde 2026" när det inte är ett rent tal). */
  target_text?: string | null;
  unit: GoalIndicatorUnit;
  /** Kvartalsstatus ur Status Q1–Q4 (importeras bara där ingen status redan rapporterats). */
  statuses?: GoalImportStatus[];
  /** Kommentar om resultatet — läggs på det senaste rapporterade kvartalet. */
  comment?: string | null;
}

export interface GoalImportGoal {
  /** Första radnumret i källan (bladets egna radnummer, rubrikraden räknas). */
  line: number;
  /** Var raden står i filen, t.ex. "Teamnivå Coacher rad 5" — används i varningar. */
  ref?: string;
  focus_area: GoalFocusArea;
  kind: GoalKind;
  level?: GoalLevel | null;
  title: string;
  description: string | null;
  owner_team: GoalOwnerTeam;
  subteam?: string | null;
  /** Personliga mål: ägarens e-post (matchas mot Movexum-personal i skrivlagret). */
  owner_email: string | null;
  /** Ansvarig som namn eller e-post (matchas mot Movexum-personal i skrivlagret). */
  responsible?: string | null;
  /** Titeln på det överliggande målet (matchas mot årets mål efter importen). */
  parent_title?: string | null;
  indicators: GoalImportIndicator[];
}

export interface GoalImportParseResult {
  goals: GoalImportGoal[];
  mappedFields: GoalImportField[];
  unmappedHeaders: string[];
  /** Blad som lästes (bara när filen har flera). */
  sheets?: string[];
  /** PII-fria varningar (radnummer, inte värden). */
  warnings: string[];
}

export const GOAL_IMPORT_MAX_ROWS = 2000;

function goalKey(area: GoalFocusArea, kind: GoalKind, title: string, owner: string | null): string {
  return `${area}|${kind}|${title.trim().toLowerCase()}|${owner ?? ''}`;
}

const STATUS_FIELDS: ReadonlyArray<[GoalImportField, 1 | 2 | 3 | 4]> = [
  ['status_q1', 1],
  ['status_q2', 2],
  ['status_q3', 3],
  ['status_q4', 4]
];

export interface GoalImportSheet {
  name: string;
  rows: readonly (readonly string[])[];
}

/**
 * Tolkar ett eller flera blad (verksamhetsplanens Excel har ett blad per team).
 * Rubrikraden letas upp per blad (`findGoalImportHeaderRow`). Samma mål
 * (fokusområde + titel + typ, för personliga även ägare) slås ihop även över
 * blad. Varningar är PII-fria: blad + radnummer, aldrig cellvärden.
 */
export function parseGoalImportSheets(sheets: readonly GoalImportSheet[]): GoalImportParseResult {
  const multi = sheets.filter((sh) => sh.rows.some((r) => r.some((c) => String(c ?? '').trim()))).length > 1;
  const state = newParseState();
  const usedSheets: string[] = [];
  for (const sheet of sheets) {
    const rows = sheet.rows;
    if (!rows.some((r) => r.some((c) => String(c ?? '').trim()))) continue;
    const headerIdx = findGoalImportHeaderRow(rows);
    if (headerIdx < 0) {
      state.warnings.push(`${multi ? `Bladet "${sheet.name}"` : 'Filen'}: hittade ingen rubrikrad med en mål-kolumn — hoppas över.`);
      continue;
    }
    usedSheets.push(sheet.name);
    parseIntoState(state, rows[headerIdx].map((c) => String(c ?? '')), rows.slice(headerIdx + 1), {
      firstLine: headerIdx + 2,
      label: multi ? sheet.name : null
    });
  }
  if (usedSheets.length === 0 && state.goals.length === 0 && !state.warnings.length) {
    state.warnings.push('Hittade ingen kolumn för mål/titel — kontrollera rubrikraden.');
  }
  return finishState(state, multi ? usedSheets : undefined);
}

/**
 * Tolkar rubrikrad + datarader till mål med indikatorer. Rader utan
 * fokusområde eller titel hoppas över med varning (ett tomt fokusområde
 * ärver närmast föregående rad — Excel-listor har ofta sammanslagna celler).
 */
export function parseGoalImportRows(headers: readonly string[], dataRows: readonly (readonly string[])[]): GoalImportParseResult {
  const state = newParseState();
  parseIntoState(state, headers, dataRows, { firstLine: 2, label: null });
  return finishState(state);
}

interface ParseState {
  goals: GoalImportGoal[];
  byKey: Map<string, GoalImportGoal>;
  mapped: Set<GoalImportField>;
  unmapped: string[];
  warnings: string[];
  rowsRead: number;
  truncated: boolean;
}

function newParseState(): ParseState {
  return { goals: [], byKey: new Map(), mapped: new Set(), unmapped: [], warnings: [], rowsRead: 0, truncated: false };
}

function finishState(state: ParseState, sheets?: string[]): GoalImportParseResult {
  if (state.truncated) {
    state.warnings.push(`Filen har fler än ${GOAL_IMPORT_MAX_ROWS} rader — bara de första ${GOAL_IMPORT_MAX_ROWS} lästes.`);
  }
  return {
    goals: state.goals,
    mappedFields: GOAL_IMPORT_FIELDS.filter((f) => state.mapped.has(f)),
    unmappedHeaders: [...new Set(state.unmapped)],
    ...(sheets ? { sheets } : {}),
    warnings: state.warnings
  };
}

function parseIntoState(
  state: ParseState,
  headers: readonly string[],
  dataRows: readonly (readonly string[])[],
  opts: { firstLine: number; label: string | null }
): void {
  const map = mapGoalImportHeaders(headers);
  const mapped = new Set<GoalImportField>();
  map.forEach((f, i) => {
    if (f) {
      mapped.add(f);
      state.mapped.add(f);
    } else if ((headers[i] ?? '').trim()) state.unmapped.push(headers[i].trim());
  });
  const where = (line: number) => (opts.label ? `Bladet "${opts.label}" rad ${line}` : `Rad ${line}`);
  const warn = (line: number, msg: string) => state.warnings.push(`${where(line)}: ${msg}`);
  if (!mapped.has('title')) {
    state.warnings.push(`${opts.label ? `Bladet "${opts.label}": h` : 'H'}ittade ingen kolumn för mål/titel — kontrollera rubrikraden.`);
    return;
  }
  if (!mapped.has('focus_area')) {
    state.warnings.push(
      `${opts.label ? `Bladet "${opts.label}": h` : 'H'}ittade ingen kolumn för fokusområde — varje rad behöver ett av Movexums fokusområden.`
    );
    return;
  }

  let prevArea: GoalFocusArea | null = null;
  let prevGoal: GoalImportGoal | null = null;
  for (let idx = 0; idx < dataRows.length; idx++) {
    if (state.rowsRead >= GOAL_IMPORT_MAX_ROWS) {
      state.truncated = true;
      return;
    }
    const cells = dataRows[idx];
    const line = idx + opts.firstLine;
    const get = (f: GoalImportField): string => {
      const i = map.indexOf(f);
      return i >= 0 ? String(cells[i] ?? '').trim() : '';
    };
    const allEmpty = cells.every((c) => !String(c ?? '').trim());
    if (allEmpty) continue;
    state.rowsRead++;

    const titleRaw = get('title').slice(0, GOAL_TITLE_MAX);
    const indicatorRaw = get('indicator').slice(0, GOAL_TITLE_MAX);

    // Nivå + team läses före fokusområdet: ett projektmål ("Sprint-X 2.0",
    // "EOI") har projektet som Objective i stället för ett fokusområde.
    const levelRaw = get('level');
    let level = levelRaw ? parseGoalLevelValue(levelRaw) : null;
    if (levelRaw && !level) warn(line, 'okänd nivå — lämnas tom.');
    const teamRaw = get('owner_team');
    const teamCell = teamRaw ? parseGoalTeamCell(teamRaw) : null;

    const areaRaw = get('focus_area');
    let area: GoalFocusArea | null = areaRaw ? parseGoalFocusAreaValue(areaRaw) : prevArea;
    let areaAsSubteam: string | null = null;
    if (areaRaw && !area) {
      const projectRow = level === 'project' || level === 'project_indicator' || teamCell?.team === 'projekt';
      if (projectRow && titleRaw) {
        area = 'projekt';
        areaAsSubteam = areaRaw.replace(/\s+/g, ' ').trim().slice(0, GOAL_SUBTEAM_MAX);
      } else {
        warn(line, 'okänt fokusområde — hoppas över.');
        continue;
      }
    }

    // Rad utan titel men med indikator ⇒ indikator på föregående mål.
    let goal: GoalImportGoal | null = null;
    if (!titleRaw) {
      if (indicatorRaw && prevGoal) goal = prevGoal;
      else {
        warn(line, 'saknar mål/titel — hoppas över.');
        continue;
      }
    } else {
      if (!area) {
        warn(line, 'saknar fokusområde — hoppas över.');
        continue;
      }
      const kindRaw = get('kind');
      let kind: GoalKind | null = kindRaw ? parseGoalKindValue(kindRaw) : level === 'personal' ? 'personal' : 'overall';
      if (!kind) {
        warn(line, 'okänd måltyp (övergripande/personligt) — hoppas över.');
        continue;
      }
      if (level === 'personal' && kind !== 'personal') {
        warn(line, 'nivån Personligt mål gör målet personligt.');
        kind = 'personal';
      }
      if (kind === 'personal') level = 'personal';
      else if (level === 'personal') level = null;
      const ownerRaw = get('owner_email').toLowerCase();
      const owner = ownerRaw && ownerRaw.includes('@') ? ownerRaw : null;
      const responsibleRaw = get('responsible').replace(/\s+/g, ' ').slice(0, 120) || null;
      if (kind === 'personal' && !owner && !responsibleRaw) {
        warn(line, 'personligt mål utan ägarens e-post — importören blir ägare.');
      }
      if (kind === 'overall' && owner && !responsibleRaw) {
        warn(line, 'ägare anges bara för personliga mål — ignoreras.');
      }
      if (teamRaw && !teamCell) warn(line, 'okänt team — "Gemensamt" används.');
      const team = teamCell?.team ?? (area === 'projekt' ? 'projekt' : 'gemensamt');
      const subteam = teamCell?.subteam ?? (area === 'projekt' ? areaAsSubteam : null);
      const description = get('description').slice(0, GOAL_DESCRIPTION_MAX) || null;
      const parentRaw = get('parent').replace(/\s+/g, ' ').slice(0, GOAL_TITLE_MAX);
      const parentTitle = parentRaw && parentRaw.toLowerCase() !== titleRaw.toLowerCase() ? parentRaw : null;
      // Personligt mål utan e-post: ägaren matchas på ansvarig (namn/e-post) i skrivlagret.
      const ownerKey = kind === 'personal' ? (owner ?? (responsibleRaw ? responsibleRaw.toLowerCase() : null)) : null;
      const key = goalKey(area, kind, titleRaw, ownerKey);
      goal = state.byKey.get(key) ?? null;
      if (!goal) {
        goal = {
          line,
          ...(opts.label ? { ref: where(line) } : {}),
          focus_area: area,
          kind,
          level,
          title: titleRaw,
          description,
          owner_team: team,
          subteam,
          owner_email: kind === 'personal' ? owner : null,
          responsible: responsibleRaw,
          parent_title: parentTitle,
          indicators: []
        };
        state.byKey.set(key, goal);
        state.goals.push(goal);
      } else {
        if (!goal.description && description) goal.description = description;
        if (!goal.parent_title && parentTitle) goal.parent_title = parentTitle;
      }
      prevArea = area;
      prevGoal = goal;
    }

    // Kvartalsstatus + kommentar för raden.
    const statuses: GoalImportStatus[] = [];
    for (const [field, quarter] of STATUS_FIELDS) {
      const raw = get(field);
      if (!raw) continue;
      const status = parseGoalStatusValue(raw);
      if (status) statuses.push({ quarter, status });
      else warn(line, `okänd status för Q${quarter} — hoppas över.`);
    }
    let commentRaw = get('status_comment').slice(0, GOAL_COMMENT_MAX) || null;
    const targetRaw = get('target');
    if (commentRaw && statuses.length === 0 && titleRaw) {
      // Ingen kvartalsstatus att fästa kommentaren på — den hamnar i beskrivningen.
      const prefix = goal.description ? `${goal.description}\n\n` : '';
      goal.description = `${prefix}Kommentar: ${commentRaw}`.slice(0, GOAL_DESCRIPTION_MAX);
      commentRaw = null;
    }

    if (indicatorRaw) {
      const sourceRaw = get('source');
      const metricRaw = get('metric_key');
      const metric = metricRaw ? parseGoalMetricValue(metricRaw) : null;
      let source: GoalIndicatorSource | null = sourceRaw ? parseGoalSourceValue(sourceRaw) : metric ? 'computed' : 'manual';
      if (!source) {
        warn(line, 'okänd mätkälla — indikatorn tolkas som manuell bedömning.');
        source = 'manual';
      }
      if (source === 'survey') {
        warn(line, 'enkätindikatorer kopplas till en enkätmodul i /mal — importeras som manuell bedömning.');
        source = 'manual';
      }
      if (source === 'activities') {
        warn(line, 'aktivitetsindikatorer får sitt mått i /mal — importeras som manuell bedömning.');
        source = 'manual';
      }
      if (source === 'computed' && !metric) {
        warn(line, 'beräknad indikator utan känd metrik — importeras som manuell bedömning.');
        source = 'manual';
      }
      const parsedTarget = parseGoalTargetCell(targetRaw);
      const plain = parseTarget(targetRaw);
      const target = plain === undefined ? parsedTarget.target : plain;
      if (plain === undefined && parsedTarget.target === null && !parsedTarget.text && parsedTarget.unit !== 'bool') {
        warn(line, 'måltalet är inte ett tal — lämnas tomt.');
      }
      const unitRaw = get('unit');
      const unit =
        source === 'computed' && metric ? METRIC_DEFINITIONS[metric].unit : unitRaw ? parseGoalUnitValue(unitRaw) : parsedTarget.unit;
      if (unitRaw && !parseGoalUnitValue(unitRaw) && source !== 'computed') warn(line, 'okänd enhet — "Antal" används.');
      const dupe = goal.indicators.some((i) => i.label.toLowerCase() === indicatorRaw.toLowerCase());
      if (dupe) {
        warn(line, 'indikatorn finns redan på målet — hoppas över.');
      } else {
        goal.indicators.push({
          line,
          label: indicatorRaw,
          source,
          metric_key: source === 'computed' ? metric : null,
          target: target ?? null,
          target_text: parsedTarget.text,
          unit: unit ?? (target === null || target === undefined ? 'bool' : 'count'),
          ...(statuses.length ? { statuses } : {}),
          ...(commentRaw ? { comment: commentRaw } : {})
        });
      }
    } else if (titleRaw && (targetRaw || statuses.length > 0 || commentRaw)) {
      // Verksamhetsplanens rader har målvärde + status per kvartal men ingen
      // separat indikatorkolumn: målet får EN manuell indikator med samma namn,
      // så att målvärdet och statusen har någonstans att bo.
      const parsedTarget = parseGoalTargetCell(targetRaw);
      if (!goal.indicators.some((i) => i.label.toLowerCase() === titleRaw.toLowerCase())) {
        goal.indicators.push({
          line,
          label: titleRaw,
          source: 'manual',
          metric_key: null,
          target: parsedTarget.target,
          target_text: parsedTarget.text,
          unit: parsedTarget.unit ?? 'bool',
          ...(statuses.length ? { statuses } : {}),
          ...(commentRaw ? { comment: commentRaw } : {})
        });
      }
    }
  }
}

/** Mall (rubrikrad + exempelrader) som CSV — semikolon för svensk Excel. */
export function buildGoalImportTemplateCsv(): string {
  const header = TEMPLATE_FIELDS.map((f) => GOAL_IMPORT_FIELD_LABELS[f]);
  const rows = [
    ['Inflöde och varumärke', 'Övergripande', 'Organisationsnivå', '50 kvalificerade leads under året', 'Fler inflöden via Startupkompassen', '', 'Marknadsteam', '', 'Nya leads', 'Beräknas ur data', 'Nya leads', '50', '', 'I fas', 'I fas', '', '', ''],
    ['Inflöde och varumärke', 'Övergripande', 'Teamnivå', 'Konverteringsgrad lead till BC', '', '50 kvalificerade leads under året', 'Marknadsteam', '', '', '', '', '50%', '', 'I fas', 'Försenad', 'Risk', '', 'Kommentar om resultatet'],
    ['Projektmål', 'Övergripande', 'Projektnivå', 'Antal svenska bolag i projektet', '', '', 'Sprint-X 2 - Internationalisering', '', '', '', '', '10', '', 'Ej startad', '', '', '', ''],
    ['Organisatorisk utveckling och digitalisering', 'Personligt', 'Personligt mål', 'Genomföra 12 coachsamtal per kvartal', '', '', 'Coachgrupp', 'fornamn.efternamn@movexum.se', 'Coachsamtal per kvartal', 'Manuell bedömning', '', '12', 'Antal', '', '', '', '', '']
  ];
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}
