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
  GOAL_TITLE_MAX,
  type GoalFocusArea,
  type GoalIndicatorSource,
  type GoalIndicatorUnit,
  type GoalKind,
  type GoalOwnerTeam
} from './goals';
import { METRIC_DEFINITIONS, METRIC_KEYS, type MetricKey } from './metrics';

export const GOAL_IMPORT_FIELDS = [
  'focus_area',
  'kind',
  'title',
  'description',
  'owner_team',
  'owner_email',
  'indicator',
  'source',
  'metric_key',
  'target',
  'unit'
] as const;
export type GoalImportField = (typeof GOAL_IMPORT_FIELDS)[number];

export const GOAL_IMPORT_FIELD_LABELS: Record<GoalImportField, string> = {
  focus_area: 'Fokusområde',
  kind: 'Måltyp',
  title: 'Mål',
  description: 'Beskrivning',
  owner_team: 'Team',
  owner_email: 'Ägare (e-post)',
  indicator: 'Indikator',
  source: 'Mätkälla',
  metric_key: 'Metrik',
  target: 'Måltal',
  unit: 'Enhet'
};

const HEADER_ALIASES: Record<string, GoalImportField> = {
  fokusområde: 'focus_area',
  fokusomrade: 'focus_area',
  område: 'focus_area',
  omrade: 'focus_area',
  'focus area': 'focus_area',
  focus_area: 'focus_area',
  area: 'focus_area',
  måltyp: 'kind',
  maltyp: 'kind',
  typ: 'kind',
  kind: 'kind',
  type: 'kind',
  mål: 'title',
  mal: 'title',
  titel: 'title',
  title: 'title',
  goal: 'title',
  målformulering: 'title',
  beskrivning: 'description',
  description: 'description',
  kommentar: 'description',
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
  unit: 'unit'
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normKey(s: string): string {
  return norm(s).replace(/[\s-]+/g, '_');
}

/** Mappar en rubrikrad till fält (null = okänd kolumn, ignoreras). */
export function mapGoalImportHeaders(headers: readonly string[]): Array<GoalImportField | null> {
  return headers.map((h) => HEADER_ALIASES[norm(h)] ?? HEADER_ALIASES[normKey(h)] ?? null);
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

function parseTarget(raw: string): number | null | undefined {
  const s = raw.trim().replace(/\s/g, '').replace('%', '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export interface GoalImportIndicator {
  line: number;
  label: string;
  source: GoalIndicatorSource;
  metric_key: MetricKey | null;
  target: number | null;
  unit: GoalIndicatorUnit;
}

export interface GoalImportGoal {
  /** Första radnumret i källan (rubrikraden är 1). */
  line: number;
  focus_area: GoalFocusArea;
  kind: GoalKind;
  title: string;
  description: string | null;
  owner_team: GoalOwnerTeam;
  /** Personliga mål: ägarens e-post (matchas mot Movexum-personal i skrivlagret). */
  owner_email: string | null;
  indicators: GoalImportIndicator[];
}

export interface GoalImportParseResult {
  goals: GoalImportGoal[];
  mappedFields: GoalImportField[];
  unmappedHeaders: string[];
  /** PII-fria varningar (radnummer, inte värden). */
  warnings: string[];
}

export const GOAL_IMPORT_MAX_ROWS = 2000;

function goalKey(area: GoalFocusArea, kind: GoalKind, title: string, owner: string | null): string {
  return `${area}|${kind}|${title.trim().toLowerCase()}|${owner ?? ''}`;
}

/**
 * Tolkar rubrikrad + datarader till mål med indikatorer. Rader utan
 * fokusområde eller titel hoppas över med varning (ett tomt fokusområde
 * ärver närmast föregående rad — Excel-listor har ofta sammanslagna celler).
 */
export function parseGoalImportRows(headers: readonly string[], dataRows: readonly (readonly string[])[]): GoalImportParseResult {
  const map = mapGoalImportHeaders(headers);
  const mapped = new Set<GoalImportField>();
  const unmapped: string[] = [];
  map.forEach((f, i) => {
    if (f) mapped.add(f);
    else if ((headers[i] ?? '').trim()) unmapped.push(headers[i].trim());
  });
  const warnings: string[] = [];
  const goals: GoalImportGoal[] = [];
  const byKey = new Map<string, GoalImportGoal>();
  if (!mapped.has('title')) {
    warnings.push('Hittade ingen kolumn för mål/titel — kontrollera rubrikraden.');
    return { goals, mappedFields: [...mapped], unmappedHeaders: unmapped, warnings };
  }
  if (!mapped.has('focus_area')) {
    warnings.push('Hittade ingen kolumn för fokusområde — varje rad behöver ett av Movexums fem fokusområden.');
    return { goals, mappedFields: [...mapped], unmappedHeaders: unmapped, warnings };
  }

  let prevArea: GoalFocusArea | null = null;
  let prevGoal: GoalImportGoal | null = null;
  dataRows.slice(0, GOAL_IMPORT_MAX_ROWS).forEach((cells, idx) => {
    const line = idx + 2;
    const get = (f: GoalImportField): string => {
      const i = map.indexOf(f);
      return i >= 0 ? String(cells[i] ?? '').trim() : '';
    };
    const allEmpty = cells.every((c) => !String(c ?? '').trim());
    if (allEmpty) return;

    const areaRaw = get('focus_area');
    let area = areaRaw ? parseGoalFocusAreaValue(areaRaw) : prevArea;
    if (areaRaw && !area) {
      warnings.push(`Rad ${line}: okänt fokusområde — hoppas över.`);
      return;
    }
    const titleRaw = get('title').slice(0, GOAL_TITLE_MAX);
    const indicatorRaw = get('indicator').slice(0, GOAL_TITLE_MAX);

    // Rad utan titel men med indikator ⇒ indikator på föregående mål.
    let goal: GoalImportGoal | null = null;
    if (!titleRaw) {
      if (indicatorRaw && prevGoal) goal = prevGoal;
      else {
        warnings.push(`Rad ${line}: saknar mål/titel — hoppas över.`);
        return;
      }
    } else {
      if (!area) {
        warnings.push(`Rad ${line}: saknar fokusområde — hoppas över.`);
        return;
      }
      const kindRaw = get('kind');
      const kind = kindRaw ? parseGoalKindValue(kindRaw) : 'overall';
      if (!kind) {
        warnings.push(`Rad ${line}: okänd måltyp (övergripande/personligt) — hoppas över.`);
        return;
      }
      const ownerRaw = get('owner_email').toLowerCase();
      const owner = ownerRaw && ownerRaw.includes('@') ? ownerRaw : null;
      if (kind === 'personal' && !owner) {
        warnings.push(`Rad ${line}: personligt mål utan ägarens e-post — importören blir ägare.`);
      }
      if (kind === 'overall' && owner) {
        warnings.push(`Rad ${line}: ägare anges bara för personliga mål — ignoreras.`);
      }
      const teamRaw = get('owner_team');
      const team = teamRaw ? parseGoalOwnerTeamValue(teamRaw) : 'gemensamt';
      if (!team) warnings.push(`Rad ${line}: okänt team — "Gemensamt" används.`);
      const description = get('description').slice(0, GOAL_DESCRIPTION_MAX) || null;
      const key = goalKey(area, kind, titleRaw, kind === 'personal' ? owner : null);
      goal = byKey.get(key) ?? null;
      if (!goal) {
        goal = {
          line,
          focus_area: area,
          kind,
          title: titleRaw,
          description,
          owner_team: team ?? 'gemensamt',
          owner_email: kind === 'personal' ? owner : null,
          indicators: []
        };
        byKey.set(key, goal);
        goals.push(goal);
      } else if (!goal.description && description) {
        goal.description = description;
      }
      prevArea = area;
      prevGoal = goal;
    }
    if (!area) area = goal.focus_area;

    if (indicatorRaw) {
      const sourceRaw = get('source');
      const metricRaw = get('metric_key');
      const metric = metricRaw ? parseGoalMetricValue(metricRaw) : null;
      let source: GoalIndicatorSource | null = sourceRaw ? parseGoalSourceValue(sourceRaw) : metric ? 'computed' : 'manual';
      if (!source) {
        warnings.push(`Rad ${line}: okänd mätkälla — indikatorn tolkas som manuell bedömning.`);
        source = 'manual';
      }
      if (source === 'survey') {
        warnings.push(`Rad ${line}: enkätindikatorer kopplas till en enkätmodul i /mal — importeras som manuell bedömning.`);
        source = 'manual';
      }
      if (source === 'computed' && !metric) {
        warnings.push(`Rad ${line}: beräknad indikator utan känd metrik — importeras som manuell bedömning.`);
        source = 'manual';
      }
      const target = parseTarget(get('target'));
      if (target === undefined) warnings.push(`Rad ${line}: måltalet är inte ett tal — lämnas tomt.`);
      const unitRaw = get('unit');
      const unit = source === 'computed' && metric ? METRIC_DEFINITIONS[metric].unit : unitRaw ? parseGoalUnitValue(unitRaw) : null;
      if (unitRaw && !unit && source !== 'computed') warnings.push(`Rad ${line}: okänd enhet — "Antal" används.`);
      const dupe = goal.indicators.some((i) => i.label.toLowerCase() === indicatorRaw.toLowerCase());
      if (dupe) {
        warnings.push(`Rad ${line}: indikatorn finns redan på målet — hoppas över.`);
      } else {
        goal.indicators.push({
          line,
          label: indicatorRaw,
          source,
          metric_key: source === 'computed' ? metric : null,
          target: target ?? null,
          unit: unit ?? (target === null || target === undefined ? 'bool' : 'count')
        });
      }
    }
  });
  if (dataRows.length > GOAL_IMPORT_MAX_ROWS) {
    warnings.push(`Filen har fler än ${GOAL_IMPORT_MAX_ROWS} rader — bara de första ${GOAL_IMPORT_MAX_ROWS} lästes.`);
  }
  return { goals, mappedFields: [...mapped], unmappedHeaders: unmapped, warnings };
}

/** Mall (rubrikrad + exempelrader) som CSV — semikolon för svensk Excel. */
export function buildGoalImportTemplateCsv(): string {
  const header = GOAL_IMPORT_FIELDS.map((f) => GOAL_IMPORT_FIELD_LABELS[f]);
  const rows = [
    ['Inflöde och varumärke', 'Övergripande', '50 kvalificerade leads under året', 'Fler inflöden via Startupkompassen', 'Marknadsteam', '', 'Nya leads', 'Beräknas ur data', 'Nya leads', '50', ''],
    ['Kundvärde och kvalitetssäkring', 'Övergripande', 'Kundnöjdhet 4 av 5', '', 'Coachgrupp', '', 'Kundnöjdhet', 'Manuell bedömning', '', '4', 'Antal'],
    ['Organisatorisk utveckling och digitalisering', 'Personligt', 'Genomföra 12 coachsamtal per kvartal', '', 'Coachgrupp', 'fornamn.efternamn@movexum.se', 'Coachsamtal per kvartal', 'Manuell bedömning', '', '12', 'Antal']
  ];
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n') + '\r\n';
}
