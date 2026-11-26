// SPARK — import av intervjuer från Excel/CSV (CLAUDE.md § 61).
//
// En rad per företag. Kolumnerna är samma frågor som det adaptiva formuläret,
// med fasta svarskategorier — så att intervjuer som görs utanför plattformen
// (t.ex. av Högskolan) går att matcha lika bra som de som matas in här.
// Varje rad blir ETT intervjusvar som går samma väg som formuläret
// (`normalizeSparkInterview`). Ren logik, enhetstestad i spark-import.test.ts.

import {
  SPARK_INTERVIEW_SECTIONS,
  SPARK_ROLE_LABELS,
  SPARK_ROLES,
  normalizeSparkInterview,
  type SparkField,
  type SparkInterviewAnswers,
  type SparkOption,
  type SparkRole
} from './spark';

type ImportScope = 'company' | 'needs' | 'solutions' | 'roles';

interface ImportColumn {
  header: string;
  scope: ImportScope;
  key: string;
  aliases?: readonly string[];
}

export const SPARK_IMPORT_MAX_ROWS = 2000;

/** Kolumnerna i mallen, i intervjuns ordning. Rubriken är det som står i filen. */
export const SPARK_IMPORT_COLUMNS: readonly ImportColumn[] = [
  { header: 'Företag', scope: 'company', key: 'name', aliases: ['företagsnamn', 'namn', 'bolag', 'organisation'] },
  { header: 'Organisationsnummer', scope: 'company', key: 'org_nr', aliases: ['org nr', 'orgnr', 'org.nr', 'organisationsnr'] },
  { header: 'Typ av aktör', scope: 'company', key: 'actor_type', aliases: ['aktörstyp', 'typ'] },
  { header: 'Roller', scope: 'roles', key: 'roles', aliases: ['roll', 'roll i spark'] },
  { header: 'Bransch', scope: 'company', key: 'sector' },
  { header: 'Verksamhet', scope: 'company', key: 'business', aliases: ['huvudsaklig verksamhet'] },
  { header: 'Kommun', scope: 'company', key: 'kommun', aliases: ['ort'] },
  { header: 'Anställda', scope: 'company', key: 'size', aliases: ['antal anställda', 'storlek'] },
  { header: 'Energins betydelse', scope: 'company', key: 'energy_importance' },
  { header: 'Arbetar aktivt med energi', scope: 'company', key: 'energy_work' },
  { header: 'Utvecklingsområden', scope: 'company', key: 'development_areas' },
  { header: 'Behov – rubrik', scope: 'needs', key: 'title', aliases: ['behov', 'utmaning', 'energiutmaning'] },
  { header: 'Behov – beskrivning', scope: 'needs', key: 'description', aliases: ['beskrivning av behov', 'beskrivning av utmaning'] },
  { header: 'Behov – energiområden', scope: 'needs', key: 'areas', aliases: ['energiområden', 'energiområde', 'kategorier'] },
  { header: 'Behov – berörda processer', scope: 'needs', key: 'where' },
  { header: 'Behov – saknar lösning på marknaden', scope: 'needs', key: 'unmet' },
  { header: 'Behov – konsekvenser', scope: 'needs', key: 'consequences' },
  { header: 'Behov – prioritet', scope: 'needs', key: 'priority', aliases: ['prioritet'] },
  { header: 'Behov – tidshorisont', scope: 'needs', key: 'horizon', aliases: ['tidshorisont'] },
  { header: 'Behov – tidigare testat', scope: 'needs', key: 'tried' },
  { header: 'Hinder för energiomställning', scope: 'company', key: 'need_barriers' },
  { header: 'Vill matchas mot lösningar', scope: 'company', key: 'need_matching' },
  { header: 'Tidigare samarbete med startups', scope: 'company', key: 'collab_before' },
  { header: 'Pilotkund', scope: 'company', key: 'pilot_interest', aliases: ['intresse av att vara pilotkund'] },
  { header: 'Har testmiljö', scope: 'company', key: 'has_testbed', aliases: ['testmiljö'] },
  { header: 'Testmiljö – beskrivning', scope: 'company', key: 'testbed_description' },
  { header: 'Testmiljö – energiområden', scope: 'company', key: 'testbed_areas' },
  { header: 'Förutsättningar för test', scope: 'company', key: 'test_conditions' },
  { header: 'Hinder för samverkan', scope: 'company', key: 'collab_barriers' },
  { header: 'Stöd för samverkan', scope: 'company', key: 'collab_support' },
  { header: 'Intresse av akademisamverkan', scope: 'company', key: 'academia_interest' },
  { header: 'Lösning – namn', scope: 'solutions', key: 'name', aliases: ['lösning', 'innovation'] },
  { header: 'Lösning – beskrivning', scope: 'solutions', key: 'description', aliases: ['beskrivning av lösning'] },
  { header: 'Lösning – problem som löses', scope: 'solutions', key: 'problem' },
  { header: 'Lösning – energiområden', scope: 'solutions', key: 'areas' },
  { header: 'Lösning – målbranscher', scope: 'solutions', key: 'target_sectors' },
  { header: 'Lösning – bidrag', scope: 'solutions', key: 'contributions' },
  { header: 'Lösning – mognad', scope: 'solutions', key: 'maturity', aliases: ['mognad', 'utvecklingsstadium'] },
  { header: 'Lösning – TRL', scope: 'solutions', key: 'trl', aliases: ['trl', 'technology readiness level'] },
  { header: 'Lösning – verifierad', scope: 'solutions', key: 'verified' },
  { header: 'Lösning – behöver', scope: 'solutions', key: 'needs' },
  { header: 'Lösning – hinder', scope: 'solutions', key: 'barriers' },
  { header: 'Lösning – andra marknader', scope: 'solutions', key: 'expansion' },
  { header: 'Vill matchas mot behov', scope: 'company', key: 'solution_matching' },
  { header: 'Stödbehov', scope: 'company', key: 'support_needs' },
  { header: 'Saknade kompetenser', scope: 'company', key: 'missing_competence' },
  { header: 'Svårt med finansiering', scope: 'company', key: 'funding_difficulty' },
  { header: 'Behöver hållbarhetsstöd', scope: 'company', key: 'sustainability_support' },
  { header: 'Team och partners', scope: 'company', key: 'team_needs' },
  { header: 'Internationell ambition', scope: 'company', key: 'international' },
  { header: 'Tillgång till stöd', scope: 'company', key: 'support_access' },
  { header: 'Intresse av program', scope: 'company', key: 'program_interest' },
  { header: 'Programmets innehåll', scope: 'company', key: 'program_content' },
  { header: 'Får kontaktas', scope: 'company', key: 'contact_ok', aliases: ['får movexum kontakta'] },
  { header: 'Kontaktperson', scope: 'company', key: 'contact_name' },
  { header: 'Kontaktpersonens roll', scope: 'company', key: 'contact_role' },
  { header: 'E-post', scope: 'company', key: 'contact_email', aliases: ['epost', 'e-postadress', 'mejl'] },
  { header: 'Telefon', scope: 'company', key: 'contact_phone', aliases: ['telefonnummer', 'mobil'] },
  { header: 'Delning', scope: 'company', key: 'sharing', aliases: ['vad får delas'] },
  { header: 'Vill ha information', scope: 'company', key: 'info_ok' },
  { header: 'Vill delta i aktiviteter', scope: 'company', key: 'events_ok' },
  { header: 'Övrigt', scope: 'company', key: 'other', aliases: ['kommentar', 'anteckningar'] }
];

/** Gemener, utan diakriter och skiljetecken — så "Behov – rubrik" och "behov rubrik" blir samma. */
export function normalizeSparkImportToken(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const HEADER_INDEX: Map<string, ImportColumn> = (() => {
  const m = new Map<string, ImportColumn>();
  for (const col of SPARK_IMPORT_COLUMNS) {
    m.set(normalizeSparkImportToken(col.header), col);
    for (const a of col.aliases ?? []) {
      const key = normalizeSparkImportToken(a);
      if (!m.has(key)) m.set(key, col);
    }
  }
  return m;
})();

function fieldFor(col: ImportColumn): SparkField | null {
  for (const s of SPARK_INTERVIEW_SECTIONS) {
    if (col.scope === 'company') {
      const f = s.fields.find((x) => x.key === col.key);
      if (f) return f;
    } else if (s.repeat && s.repeat.key === col.scope) {
      const f = s.repeat.fields.find((x) => x.key === col.key);
      if (f) return f;
    }
  }
  return null;
}

const YES = ['ja', 'j', 'yes', 'y', 'true', '1', 'x', 'sant'];
const NO = ['nej', 'n', 'no', 'false', '0', 'falskt'];
const SYNONYMS: Record<string, readonly string[]> = {
  yes: YES,
  no: NO,
  maybe: ['kanske', 'eventuellt', 'maybe'],
  partly: ['delvis', 'till viss del', 'partly'],
  unknown: ['vet inte', 'vet ej', 'oklart', 'unknown'],
  high: ['hog', 'high'],
  medium: ['medel', 'mellan', 'medium'],
  low: ['lag', 'low'],
  micro: ['1 9', 'mikro'],
  small: ['10 49', 'litet'],
  medium_size: [],
  large: ['250', '250 eller fler', 'stort'],
  lt1: ['inom ett ar', 'inom 1 ar', 'under 1 ar', '1 ar'],
  y1_3: ['1 3 ar', 'inom 1 3 ar'],
  y3_5: ['3 5 ar', 'inom 3 5 ar'],
  gt5: ['mer an 5 ar', 'langre fram an 5 ar', 'over 5 ar']
};

function matchOption(raw: string, options: readonly SparkOption[]): string | null {
  const token = normalizeSparkImportToken(raw);
  if (!token) return null;
  for (const o of options) {
    if (normalizeSparkImportToken(o.id) === token || normalizeSparkImportToken(o.label) === token) return o.id;
  }
  for (const o of options) {
    if ((SYNONYMS[o.id] ?? []).includes(token)) return o.id;
  }
  if (token === '50 249' && options.some((o) => o.id === 'medium')) return 'medium';
  const trl = /^trl ?([1-9])$/.exec(token);
  if (trl && options.some((o) => o.id === trl[1])) return trl[1];
  // "Spillvärme" ska träffa "Spillvärme och värmeåtervinning".
  const loose = options.filter((o) => normalizeSparkImportToken(o.label).startsWith(token) && token.length >= 5);
  return loose.length === 1 ? loose[0].id : null;
}

function splitMulti(raw: string): string[] {
  return raw
    .split(/[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const ROLE_SYNONYMS: Record<SparkRole, readonly string[]> = {
  need_owner: ['behovsagare', 'behov', 'need owner'],
  innovator: ['innovationsaktor', 'innovator', 'losning', 'innovation'],
  testbed: ['testmiljo', 'pilotkund', 'testmiljo pilotkund', 'testbadd']
};

function parseRoles(raw: string): SparkRole[] {
  const out: SparkRole[] = [];
  for (const part of splitMulti(raw.replace(/,/g, ';'))) {
    const token = normalizeSparkImportToken(part);
    for (const r of SPARK_ROLES) {
      const hit = token === r.id || token === normalizeSparkImportToken(SPARK_ROLE_LABELS[r.id]) || ROLE_SYNONYMS[r.id].includes(token);
      if (hit && !out.includes(r.id)) out.push(r.id);
    }
  }
  return out;
}

export interface SparkImportRow {
  /** 1-baserat radnummer i källan (rubrikraden är 1). */
  line: number;
  name: string;
  roles: SparkRole[];
  answers: SparkInterviewAnswers;
}

export interface SparkImportParseResult {
  rows: SparkImportRow[];
  mappedHeaders: string[];
  unmappedHeaders: string[];
  /** PII-fria varningar (radnummer och kolumn, aldrig värden). */
  warnings: string[];
}

/** Tolkar rubrikrad + datarader till intervjusvar. Rader utan företagsnamn hoppas över. */
export function parseSparkImportRows(headers: readonly string[], dataRows: readonly (readonly string[])[]): SparkImportParseResult {
  const cols = headers.map((h) => HEADER_INDEX.get(normalizeSparkImportToken(h)) ?? null);
  const mappedHeaders: string[] = [];
  const unmappedHeaders: string[] = [];
  cols.forEach((c, i) => {
    if (c) mappedHeaders.push(c.header);
    else if ((headers[i] ?? '').trim()) unmappedHeaders.push(headers[i].trim());
  });
  const warnings: string[] = [];
  const rows: SparkImportRow[] = [];
  if (!cols.some((c) => c?.scope === 'company' && c.key === 'name')) {
    warnings.push('Hittade ingen kolumn för företagets namn ("Företag") — kontrollera rubrikraden.');
    return { rows, mappedHeaders, unmappedHeaders, warnings };
  }
  const unknownValues = new Map<string, number[]>();
  const note = (header: string, line: number) => {
    const lines = unknownValues.get(header) ?? [];
    if (!lines.includes(line)) lines.push(line);
    unknownValues.set(header, lines);
  };

  dataRows.slice(0, SPARK_IMPORT_MAX_ROWS).forEach((cells, idx) => {
    const line = idx + 2;
    if (cells.every((c) => !(c ?? '').trim())) return;
    const company: Record<string, string | string[]> = {};
    const need: Record<string, string | string[]> = {};
    const solution: Record<string, string | string[]> = {};
    let roles: SparkRole[] = [];
    cols.forEach((col, i) => {
      if (!col) return;
      const raw = (cells[i] ?? '').trim();
      if (!raw) return;
      if (col.scope === 'roles') {
        roles = parseRoles(raw);
        if (roles.length === 0) note(col.header, line);
        return;
      }
      const field = fieldFor(col);
      if (!field) return;
      const target = col.scope === 'company' ? company : col.scope === 'needs' ? need : solution;
      if (field.type === 'single') {
        const v = matchOption(raw, field.options ?? []);
        if (v) target[field.key] = v;
        else note(col.header, line);
      } else if (field.type === 'multi') {
        const picked: string[] = [];
        for (const part of splitMulti(raw.includes(';') || raw.includes('|') ? raw : raw.replace(/,/g, ';'))) {
          const v = matchOption(part, field.options ?? []);
          if (v) {
            if (!picked.includes(v)) picked.push(v);
          } else note(col.header, line);
        }
        if (picked.length) target[field.key] = picked;
      } else {
        target[field.key] = raw;
      }
    });
    const hasNeed = Boolean(need.title || need.description);
    const hasSolution = Boolean(solution.name || solution.description);
    if (hasNeed && !need.title && typeof need.description === 'string') need.title = need.description.slice(0, 120);
    if (hasSolution && !solution.name && typeof solution.description === 'string') solution.name = solution.description.slice(0, 120);
    // Saknas rollkolumnen härleds rollerna ur vad raden faktiskt innehåller.
    if (roles.length === 0) {
      if (hasNeed) roles.push('need_owner');
      if (hasSolution) roles.push('innovator');
      if (company.has_testbed === 'yes' || company.pilot_interest === 'yes' || company.pilot_interest === 'maybe') roles.push('testbed');
    } else {
      if (hasNeed && !roles.includes('need_owner')) roles.push('need_owner');
      if (hasSolution && !roles.includes('innovator')) roles.push('innovator');
    }
    const result = normalizeSparkInterview({ roles, company, needs: hasNeed ? [need] : [], solutions: hasSolution ? [solution] : [] });
    const name = typeof result.value.company.name === 'string' ? result.value.company.name : '';
    if (!name) {
      warnings.push(`Rad ${line}: företagets namn saknas — raden hoppas över.`);
      return;
    }
    if (!result.ok) {
      warnings.push(`Rad ${line}: ${result.issue.message} Raden hoppas över.`);
      return;
    }
    rows.push({ line, name, roles: result.value.roles, answers: result.value });
  });

  for (const [header, lines] of unknownValues) {
    const shown = lines.slice(0, 8).join(', ');
    warnings.push(`Kolumnen "${header}": värdet kändes inte igen på rad ${shown}${lines.length > 8 ? ` och ${lines.length - 8} till` : ''} — lämnas tomt.`);
  }
  if (dataRows.length > SPARK_IMPORT_MAX_ROWS) warnings.push(`Filen har fler än ${SPARK_IMPORT_MAX_ROWS} rader — resten lästes inte.`);
  return { rows, mappedHeaders, unmappedHeaders, warnings };
}

function csvCell(v: string): string {
  return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const EXAMPLE: Record<string, string> = {
  Företag: 'Exempel Industri AB',
  Organisationsnummer: '556000-0000',
  'Typ av aktör': 'Industriföretag',
  Roller: 'Behovsägare; Testmiljö / pilotkund',
  Bransch: 'Tillverkande industri',
  Kommun: 'Sandviken',
  Anställda: '50–249 anställda',
  'Behov – rubrik': 'Höga effekttoppar i produktionen',
  'Behov – beskrivning': 'Effekttoppar vid uppstart av ugnar ger höga nätavgifter och begränsar utbyggnad.',
  'Behov – energiområden': 'Flexibilitet och effektstyrning; Effektbehov och elnätskapacitet',
  'Behov – prioritet': 'Hög',
  'Behov – tidshorisont': 'Inom 1–3 år',
  'Vill matchas mot lösningar': 'Ja',
  Pilotkund: 'Ja',
  'Har testmiljö': 'Nej',
  'Får kontaktas': 'Ja',
  Delning: 'Anonymt'
};

/** Mallen som intervjuaren fyller i: rubrikrad, en exempelrad och en rad med tillåtna värden. */
export function buildSparkImportTemplateCsv(): string {
  const headers = SPARK_IMPORT_COLUMNS.map((c) => c.header);
  const example = headers.map((h) => EXAMPLE[h] ?? '');
  return [headers.map(csvCell).join(';'), example.map(csvCell).join(';')].join('\r\n') + '\r\n';
}

/** Tillåtna värden per kolumn med fasta svarskategorier — visas bredvid mallen. */
export function sparkImportAllowedValues(): { header: string; multi: boolean; values: string[] }[] {
  const out: { header: string; multi: boolean; values: string[] }[] = [];
  for (const col of SPARK_IMPORT_COLUMNS) {
    if (col.scope === 'roles') {
      out.push({ header: col.header, multi: true, values: SPARK_ROLES.map((r) => SPARK_ROLE_LABELS[r.id]) });
      continue;
    }
    const f = fieldFor(col);
    if (f && (f.type === 'single' || f.type === 'multi') && f.options) {
      out.push({ header: col.header, multi: f.type === 'multi', values: f.options.map((o) => o.label) });
    }
  }
  return out;
}
