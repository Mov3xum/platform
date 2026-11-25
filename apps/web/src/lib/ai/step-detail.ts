// Detaljrader för chattens live-aktivitetsspår (§ 17.8). Ren modul (ingen IO)
// så att PII-reglerna kan enhetstestas.
//
// PII-regel: en detalj får bara bestå av SCHEMA-nivå (verktygsnamn, fältnamn,
// aggregat-typ, sortering, radgräns) och RESULTAT-storlek (antal rader/träffar/
// grupper). Aldrig filtervärden, sökfrågor, fältvärden eller summor — de kan
// innehålla namn användaren skrev. Fältnamn som modellen anger släpps bara
// igenom om de ser ut som identifierare, så fri text inte smiter in den vägen.

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,63}(\.[A-Za-z_][A-Za-z0-9_]{0,63}){0,2}$/;
const MAX_FILTER_FIELDS = 4;

const AGG_OP_LABELS: Record<string, string> = {
  count: 'antal',
  sum: 'summa av',
  avg: 'snitt av',
  min: 'minsta',
  max: 'största'
};

function identifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return IDENTIFIER.test(trimmed) ? trimmed : null;
}

/**
 * Fältnamnen ett PocketBase-filter jämför på, t.ex. `date >= "2020-01-01" &&
 * startup.name ~ "x"` → `['date', 'startup.name']`. Strängliteraler tas bort
 * FÖRST så att inget värde kan tolkas som ett fältnamn.
 */
export function filterFields(filter: unknown): string[] {
  if (typeof filter !== 'string' || !filter.trim()) return [];
  const withoutLiterals = filter.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const fields: string[] = [];
  const re = /([A-Za-z_@][A-Za-z0-9_.:]*)\s*\??(?:!=|>=|<=|!~|=|>|<|~)/g;
  for (const match of withoutLiterals.matchAll(re)) {
    const field = identifier(match[1]);
    if (field && !fields.includes(field)) fields.push(field);
  }
  return fields;
}

function filterPart(filter: unknown): string | null {
  const fields = filterFields(filter);
  if (fields.length === 0) {
    return typeof filter === 'string' && filter.trim() ? 'med filter' : null;
  }
  const shown = fields.slice(0, MAX_FILTER_FIELDS).join(', ');
  const more = fields.length > MAX_FILTER_FIELDS ? ` +${fields.length - MAX_FILTER_FIELDS}` : '';
  return `filter på ${shown}${more}`;
}

function sortPart(sort: unknown): string | null {
  if (typeof sort !== 'string' || !sort.trim()) return null;
  const parts = sort
    .split(',')
    .map((s) => s.trim())
    .map((s) => {
      const desc = s.startsWith('-');
      const field = identifier(desc ? s.slice(1) : s.replace(/^\+/, ''));
      return field ? `${field}${desc ? ' ↓' : ''}` : null;
    })
    .filter((s): s is string => s !== null);
  return parts.length > 0 ? `sorterat på ${parts.join(', ')}` : null;
}

function limitPart(limit: unknown, unit: string): string | null {
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? `max ${Math.floor(limit)} ${unit}`
    : null;
}

function join(parts: Array<string | null>): string | undefined {
  const text = parts.filter((p): p is string => !!p).join(' · ');
  return text || undefined;
}

/** Vad steget ska göra, utifrån argumenten — visas när steget startar. */
export function describeStepArgs(tool: string, args: Record<string, unknown>): string | undefined {
  switch (tool) {
    case 'query_collection':
      return join([filterPart(args.filter), sortPart(args.sort), limitPart(args.limit, 'rader')]);
    case 'count_collection':
      return join([filterPart(args.filter) ?? 'alla rader']);
    case 'search_records':
      // Sökfrågan är användarens egna ord → visas aldrig.
      return join(['fritextsökning', limitPart(args.limit, 'träffar')]);
    case 'describe_collection': {
      const field = identifier(args.field);
      return field ? `fält och värden i ${field}` : 'fält och giltiga värden';
    }
    case 'aggregate_collection': {
      const op = typeof args.op === 'string' ? args.op : '';
      const field = identifier(args.field);
      const groupBy = identifier(args.group_by);
      const what =
        op === 'count' || !field
          ? AGG_OP_LABELS.count
          : `${AGG_OP_LABELS[op] ?? op} ${field}`;
      return join([groupBy ? `${what} per ${groupBy}` : what, filterPart(args.filter)]);
    }
    default:
      return undefined;
  }
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function countLabel(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Vad steget gav — visas när steget är klart. Bara storlekar, aldrig värden. */
export function summarizeStepResult(
  tool: string,
  result: { ok: boolean; data?: unknown; error?: string; repeated?: boolean }
): string | undefined {
  if (!result.ok) return 'misslyckades';
  if (result.repeated) return 'samma anrop igen — återanvände resultatet';
  const data = (result.data && typeof result.data === 'object' ? result.data : {}) as Record<string, unknown>;

  switch (tool) {
    case 'query_collection': {
      const total = num(data.total);
      const returned = num(data.returned);
      if (total === null || returned === null) break;
      return total > returned
        ? `${total} träffar, hämtade ${returned}`
        : countLabel(returned, 'rad', 'rader');
    }
    case 'count_collection': {
      const count = num(data.count);
      return count === null ? undefined : `${count} st`;
    }
    case 'describe_collection': {
      const fields = Array.isArray(data.fields) ? data.fields.length : null;
      const distinct = data.distinct_values as { values?: unknown } | undefined;
      const values = Array.isArray(distinct?.values) ? distinct.values.length : null;
      return join([
        fields !== null ? `${fields} fält` : null,
        values !== null ? countLabel(values, 'distinkt värde', 'distinkta värden') : null
      ]);
    }
    case 'aggregate_collection': {
      const total = num(data.total);
      const scanned = num(data.scanned);
      const groups = Array.isArray(data.groups) ? data.groups.length : null;
      const parts = [
        groups !== null ? countLabel(groups, 'grupp', 'grupper') : null,
        total !== null ? `${total} rader` : null,
        data.incomplete === true && scanned !== null ? `ofullständigt — räknade ${scanned}` : null
      ];
      return join(parts);
    }
  }

  // Generiskt: sök-/läsverktyg rapporterar `matched`, annars listlängd.
  const matched = num(data.matched);
  if (matched !== null) return countLabel(matched, 'träff', 'träffar');
  for (const key of ['items', 'results', 'hits']) {
    const list = data[key];
    if (Array.isArray(list)) return countLabel(list.length, 'post', 'poster');
  }
  return undefined;
}

// ── Presentation (delas av live-spåret och persisterade steg i chatten) ──

export interface TrailStep {
  tool?: string;
  label: string;
  detail?: string;
  result?: string;
  ms?: number;
  ok?: boolean;
  running?: boolean;
}

export interface TrailGroup extends TrailStep {
  /** Antal identiska steg i följd som slagits ihop till denna rad. */
  count: number;
}

/**
 * Slår ihop FÄRDIGA steg i följd som är identiska (samma verktyg, etikett och
 * detalj) till en rad med räknare, så spåret inte blir en vägg av likadana
 * rader. Pågående och misslyckade steg slås aldrig ihop.
 */
export function groupTrailSteps(steps: TrailStep[]): TrailGroup[] {
  const groups: TrailGroup[] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    const mergeable =
      last &&
      !last.running &&
      !step.running &&
      last.ok !== false &&
      step.ok !== false &&
      last.tool === step.tool &&
      last.label === step.label &&
      last.detail === step.detail;
    if (mergeable) {
      last.count += 1;
      last.result = step.result ?? last.result;
      if (step.ms !== undefined) last.ms = (last.ms ?? 0) + step.ms;
    } else {
      groups.push({ ...step, count: 1 });
    }
  }
  return groups;
}

/** 320 → "320 ms", 1450 → "1,5 s". */
export function formatStepDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}
