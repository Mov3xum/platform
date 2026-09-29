// ── AI-minnets kategorier (migration 1700000155) ────────────────────────────
// CLAUDE.md § 16.4. Det tvärsessions-minne chatten bygger upp av personalens
// korrigeringar (`agent_memory`) växer fritt över tid. För att /installningar/
// ai-minne ska ge överblick även med hundratals noteringar grupperas de i en
// FAST, liten kategoritaxonomi (samma mönster som file-topics.ts /
// competences.ts): varje notering hör till exakt EN kategori.
//
// Kategorin sätts av chatten (`memory_write`, valfri parameter) eller av en
// människa i UI:t. Saknas den (äldre rader, agenten glömde) härleds en
// kategori DETERMINISTISKT ur nyckel + innehåll (`inferAgentMemoryCategory`) —
// ingen AI-inferens, bara nyckelord — och märks som härledd i UI:t tills en
// människa bekräftar. Ingen PII: kategorin är metadata om vilken SORTS regel
// noteringen är.
//
// Lägg ALDRIG till en kategori här utan att även utöka select-värdena i en ny
// migration (fältet `agent_memory.category` är en PB-select) samt spegla i
// scripts/setup-via-api.mjs.

export type AgentMemoryCategory =
  | 'terminologi'
  | 'datatolkning'
  | 'arbetssatt'
  | 'bolag'
  | 'portfolj'
  | 'processer'
  | 'ovrigt';

export interface AgentMemoryCategoryDef {
  id: AgentMemoryCategory;
  /** Visningsnamn i UI (svenska). */
  label: string;
  /** Kort beskrivning — visas i UI:t och matas till chatten som ledtråd. */
  description: string;
  /** Nyckelord (gemener) för den deterministiska härledningen. */
  keywords: string[];
  /** Ikonnamn i proto/Icon. */
  icon: string;
}

/** Fallback-kategorin när inget nyckelord träffar. */
export const DEFAULT_AGENT_MEMORY_CATEGORY: AgentMemoryCategory = 'ovrigt';

/**
 * Källan av sanning. Ordningen styr renderingen på AI-minne-sidan (övrigt
 * sist) och prioriteten vid härledning: den FÖRSTA kategorin med flest
 * nyckelordsträffar vinner.
 */
export const AGENT_MEMORY_CATEGORIES: readonly AgentMemoryCategoryDef[] = [
  {
    id: 'terminologi',
    label: 'Terminologi & definitioner',
    description:
      'Vad ord betyder hos er: "rundor" = investeringar, "bidrag" = grants, vilket bolag som heter vad.',
    keywords: [
      'terminologi',
      'definition',
      'betyder',
      'menas',
      'avses',
      'kallas',
      'heter',
      'begrepp',
      'skillnad',
      'synonym',
      'ordlista'
    ],
    icon: 'doc'
  },
  {
    id: 'datatolkning',
    label: 'Datatolkning & regler',
    description:
      'Hur data ska läsas och räknas: vilka fält/typer som ingår, vad som exkluderas, filter och beräkningsregler.',
    keywords: [
      'räkna',
      'räknas',
      'inkludera',
      'exkludera',
      'filter',
      'filtrera',
      'fält',
      'kollektion',
      'collection',
      'type =',
      'status =',
      'summera',
      'aggregera',
      'beräkn',
      'tolka',
      'query',
      'enum'
    ],
    icon: 'graph'
  },
  {
    id: 'arbetssatt',
    label: 'Arbetssätt & preferenser',
    description:
      'Hur personalen vill att chatten svarar och arbetar: format, språk, ton, vad som alltid ska tas med eller undvikas.',
    keywords: [
      'preferens',
      'föredrar',
      'vill ha',
      'svara',
      'format',
      'tabell',
      'punktlista',
      'kortfattat',
      'ton',
      'språk',
      'alltid',
      'aldrig fråga',
      'bekräfta',
      'presentera',
      'rubrik',
      'rapportformat'
    ],
    icon: 'gear'
  },
  {
    id: 'bolag',
    label: 'Bolagsfakta',
    description:
      'Bestående fakta om enskilda bolag: namnbyten, ägarförhållanden på bolagsnivå, vad bolaget gör, särskilda omständigheter.',
    keywords: [
      'bolaget',
      'bolag ',
      ' ab',
      'ab:',
      'ab)',
      'startup',
      'företaget',
      'grundades',
      'bytte namn',
      'namnbyte',
      'numera',
      'tidigare hette',
      'verksamhet'
    ],
    icon: 'briefcase'
  },
  {
    id: 'portfolj',
    label: 'Portfölj & omvärld',
    description:
      'Observationer över hela portföljen och omvärlden: trender, återkommande mönster, finansiärer, pågående trådar.',
    keywords: [
      'portfölj',
      'portfolio',
      'trend',
      'mönster',
      'vanliga',
      'återkommande',
      'omvärld',
      'finansiär',
      'bidragskällor',
      'vinnova',
      'almi',
      'region',
      'marknad',
      'bransch',
      'sektor',
      'pågående'
    ],
    icon: 'globe'
  },
  {
    id: 'processer',
    label: 'Processer & rutiner',
    description:
      'Hur Movexum arbetar internt: intag, faser, möten, ansvar, rutiner och deadlines.',
    keywords: [
      'process',
      'rutin',
      'intag',
      'inflöde',
      'fas ',
      'faser',
      'boost chamber',
      'onboarding',
      'workshop',
      'möte',
      'ansvarar',
      'ansvarig',
      'deadline',
      'kvartal',
      'årshjul',
      'checklista',
      'steg för steg'
    ],
    icon: 'flow'
  },
  {
    id: 'ovrigt',
    label: 'Övrigt',
    description: 'Noteringar som inte passar in i någon av kategorierna ovan.',
    keywords: [],
    icon: 'more'
  }
];

export const AGENT_MEMORY_CATEGORY_IDS: readonly AgentMemoryCategory[] =
  AGENT_MEMORY_CATEGORIES.map((c) => c.id);

const BY_ID: ReadonlyMap<AgentMemoryCategory, AgentMemoryCategoryDef> = new Map(
  AGENT_MEMORY_CATEGORIES.map((c) => [c.id, c])
);

export function isAgentMemoryCategory(value: unknown): value is AgentMemoryCategory {
  return typeof value === 'string' && BY_ID.has(value as AgentMemoryCategory);
}

export function getAgentMemoryCategory(id: AgentMemoryCategory): AgentMemoryCategoryDef {
  return BY_ID.get(id) ?? (BY_ID.get(DEFAULT_AGENT_MEMORY_CATEGORY) as AgentMemoryCategoryDef);
}

/** Etikett för en kategori (fallback: Övrigt). */
export function agentMemoryCategoryLabel(id: string | null | undefined): string {
  return isAgentMemoryCategory(id)
    ? getAgentMemoryCategory(id).label
    : getAgentMemoryCategory(DEFAULT_AGENT_MEMORY_CATEGORY).label;
}

/**
 * Normaliserar ett godtyckligt värde (formulär, tool-argument) till en giltig
 * kategori. Tolererar skiftläge, mellanslag och några svenska alias
 * ("terminologi & definitioner" → `terminologi`). Okänt → `null`, så
 * anroparen kan välja mellan att avvisa eller härleda — aldrig tyst `ovrigt`.
 */
export function normalizeAgentMemoryCategory(value: unknown): AgentMemoryCategory | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  if (isAgentMemoryCategory(raw)) return raw;
  const folded = raw
    .replace(/ö/g, 'o')
    .replace(/ä/g, 'a')
    .replace(/å/g, 'a')
    .replace(/[^a-z]+/g, '_');
  let start = 0;
  let end = folded.length;
  while (start < end && folded.charCodeAt(start) === 95) start += 1;
  while (end > start && folded.charCodeAt(end - 1) === 95) end -= 1;
  const normalized = folded.slice(start, end);
  if (isAgentMemoryCategory(normalized)) return normalized;
  for (const def of AGENT_MEMORY_CATEGORIES) {
    const label = def.label.toLowerCase();
    if (raw === label) return def.id;
    // "Terminologi & definitioner" → första ordet räcker ("terminologi").
    const head = label.split(/[^a-zåäö]+/)[0];
    if (head && (raw === head || normalized === head.replace(/ö/g, 'o').replace(/ä/g, 'a').replace(/å/g, 'a'))) {
      return def.id;
    }
  }
  return null;
}

/**
 * Deterministisk härledning av kategori ur nyckel + innehåll (ingen AI).
 * Nyckeln väger dubbelt eftersom den är personalens/agentens egna rubrik.
 * Vid lika många träffar vinner den kategori som kommer först i taxonomin.
 * Ingen träff → `ovrigt`.
 */
export function inferAgentMemoryCategory(
  key: string | null | undefined,
  content: string | null | undefined
): AgentMemoryCategory {
  const k = ` ${(key ?? '').toLowerCase().replace(/[_/\-]+/g, ' ')} `;
  const c = ` ${(content ?? '').toLowerCase()} `;
  let best: AgentMemoryCategory = DEFAULT_AGENT_MEMORY_CATEGORY;
  let bestScore = 0;
  for (const def of AGENT_MEMORY_CATEGORIES) {
    if (def.id === DEFAULT_AGENT_MEMORY_CATEGORY) continue;
    let score = 0;
    for (const kw of def.keywords) {
      const needle = kw.toLowerCase();
      if (k.includes(needle)) score += 2;
      if (c.includes(needle)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = def.id;
    }
  }
  return best;
}

/** Var kategorin kommer ifrån — styr "härledd"-märkningen i UI:t. */
export type AgentMemoryCategorySource = 'stored' | 'inferred';

export interface AgentMemoryCategorized {
  category: AgentMemoryCategory;
  categorySource: AgentMemoryCategorySource;
}

/**
 * Löser kategorin för en rad: lagrat giltigt värde vinner, annars härleds den.
 */
export function resolveAgentMemoryCategory(row: {
  category?: unknown;
  key?: string | null;
  content?: string | null;
}): AgentMemoryCategorized {
  const stored = normalizeAgentMemoryCategory(row.category);
  if (stored) return { category: stored, categorySource: 'stored' };
  return {
    category: inferAgentMemoryCategory(row.key, row.content),
    categorySource: 'inferred'
  };
}

export interface AgentMemoryCategoryGroup<T> {
  category: AgentMemoryCategoryDef;
  items: T[];
}

/**
 * Grupperar noteringar per kategori i taxonomins ordning; tomma kategorier
 * utelämnas. Ordningen INOM en grupp bevaras från indata (sidan sorterar på
 * senast uppdaterad).
 */
export function groupAgentMemoryByCategory<T extends { category: AgentMemoryCategory }>(
  items: readonly T[]
): AgentMemoryCategoryGroup<T>[] {
  const buckets = new Map<AgentMemoryCategory, T[]>();
  for (const it of items) {
    const id = isAgentMemoryCategory(it.category) ? it.category : DEFAULT_AGENT_MEMORY_CATEGORY;
    const list = buckets.get(id);
    if (list) list.push(it);
    else buckets.set(id, [it]);
  }
  return AGENT_MEMORY_CATEGORIES.filter((c) => buckets.has(c.id)).map((c) => ({
    category: c,
    items: buckets.get(c.id) as T[]
  }));
}

/** Antal per kategori (bara kategorier med minst en notering). */
export function countAgentMemoryByCategory<T extends { category: AgentMemoryCategory }>(
  items: readonly T[]
): Partial<Record<AgentMemoryCategory, number>> {
  const out: Partial<Record<AgentMemoryCategory, number>> = {};
  for (const it of items) {
    const id = isAgentMemoryCategory(it.category) ? it.category : DEFAULT_AGENT_MEMORY_CATEGORY;
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/**
 * Enkel fritextfiltrering över nyckel + innehåll (gemener, alla ord måste
 * träffa). Ren klientlogik för sök-rutan på AI-minne-sidan.
 */
export function matchesAgentMemoryQuery(
  item: { key: string; content: string; scopeLabel?: string },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${item.key}\n${item.content}\n${item.scopeLabel ?? ''}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}
