import 'server-only';
import type PocketBase from 'pocketbase';

/**
 * Whitelist of PocketBase collections that the AI chat is allowed to read.
 *
 * Adding a new collection: append one entry below.
 * Adding a new field to an existing collection: no code change needed —
 * fields are auto-discovered from a sample record.
 *
 * Internal/auth collections (users, _authOrigins, _superusers, tenants etc.)
 * are intentionally excluded.
 */
export interface ExposedCollection {
  /** PocketBase collection name */
  name: string;
  /** Short Swedish description shown to the model */
  description: string;
  /**
   * Path to the tenant relation, used for hard-coded tenant scoping.
   * Use 'tenant' for direct relations, or dot-paths like 'startup.tenant'
   * for indirect ones. Set to null only for tenant-less reference data.
   */
  tenantField: string | null;
  /** Field names to strip from results (PII / secrets) */
  maskedFields: string[];
  /** Optional always-applied filter (e.g. 'confidential = false') */
  baseFilter?: string;
}

export const EXPOSED_COLLECTIONS: ExposedCollection[] = [
  {
    name: 'startups',
    description: 'Idéer och bolag i inkubatorn (namn, fas, IRL-nivå, sektor, status, ägare)',
    tenantField: 'tenant',
    maskedFields: ['person_nr', 'personnummer']
  },
  {
    name: 'startup_team_members',
    description: 'Teammedlemmar och grundare per bolag (is_founder, role_title, equity_pct)',
    tenantField: 'startup.tenant',
    maskedFields: ['email', 'person_nr', 'personnummer']
  },
  {
    name: 'deals',
    description: 'Investeringsrundor och dealflow (stage, amount, investor, last_activity)',
    tenantField: 'tenant',
    maskedFields: []
  },
  {
    name: 'investors',
    description: 'Investerare och fonder',
    tenantField: 'tenant',
    maskedFields: []
  },
  {
    name: 'milestones',
    description: 'Milstolpar per bolag (title, category, status, target_date, achieved_at)',
    tenantField: 'startup.tenant',
    maskedFields: []
  },
  {
    name: 'activities',
    description: 'Aktiviteter, möten och uppgifter per bolag (type, status, due_date, owner)',
    tenantField: 'startup.tenant',
    maskedFields: []
  },
  {
    name: 'notes',
    description: 'Anteckningar per bolag — endast icke-konfidentiella',
    tenantField: 'startup.tenant',
    maskedFields: [],
    baseFilter: 'confidential = false'
  },
  {
    name: 'agreements',
    description: 'Avtal kopplade till bolag',
    tenantField: 'startup.tenant',
    maskedFields: []
  },
  {
    name: 'missions',
    description: 'Uppdrag/insatser (issuer, recipients, status, due_date, type)',
    tenantField: 'tenant',
    maskedFields: []
  },
  {
    name: 'partners',
    description: 'Partnerorganisationer i ekosystemet',
    tenantField: 'tenant',
    maskedFields: []
  },
  {
    name: 'partner_engagements',
    description: 'Interaktioner och leveranser från partners',
    tenantField: 'tenant',
    maskedFields: []
  },
  {
    name: 'workshops',
    description: 'Workshops och utbildningstillfällen',
    tenantField: 'tenant',
    maskedFields: []
  },
  {
    name: 'workshop_assignments',
    description: 'Workshopsuppgifter kopplade till bolag/deltagare',
    tenantField: 'workshop.tenant',
    maskedFields: []
  },
  {
    name: 'workshop_runs',
    description: 'Genomförda workshop-körningar och resultat',
    tenantField: 'workshop.tenant',
    maskedFields: []
  },
  {
    name: 'events',
    description: 'Events och tillställningar',
    tenantField: 'tenant',
    maskedFields: []
  },
  {
    name: 'event_signups',
    description: 'Anmälningar till events',
    tenantField: 'event.tenant',
    maskedFields: ['email']
  },
  {
    name: 'reports',
    description: 'Rapporter (kvartalsrapporter, sammanställningar)',
    tenantField: 'tenant',
    maskedFields: []
  },
  {
    name: 'alumni',
    description: 'Alumni-bolag som lämnat aktivt program',
    tenantField: 'tenant',
    maskedFields: []
  },
  {
    name: 'strategies',
    description: 'Strategidokument per bolag',
    tenantField: 'startup.tenant',
    maskedFields: []
  },
  {
    name: 'strategy_revisions',
    description: 'Revisioner av strategidokument',
    tenantField: 'strategy.startup.tenant',
    maskedFields: []
  },
  {
    name: 'sprint_x_checkins',
    description: 'Sprint X check-ins per bolag (4 axlar: funding/intl/sustain/team)',
    tenantField: 'startup.tenant',
    maskedFields: []
  },
  {
    name: 'tools',
    description: 'AI/template-verktyg som finns i verktygslådan',
    tenantField: null,
    maskedFields: []
  },
  {
    name: 'tool_runs',
    description: 'Körningar av verktyg (status, kostnad, resultat)',
    tenantField: 'tenant',
    maskedFields: []
  }
];

const SAMPLE_FIELDS_CACHE = new Map<string, { fields: string[]; expires: number }>();
const FIELDS_CACHE_TTL_MS = 5 * 60 * 1000;

export function getExposedCollection(name: string): ExposedCollection | undefined {
  return EXPOSED_COLLECTIONS.find((c) => c.name === name);
}

/**
 * Builds the tenant scope clause for a collection. Always wrapped in parens
 * so it composes safely with model-supplied filters.
 */
export function buildTenantClause(
  collection: ExposedCollection,
  tenantId: string
): string | null {
  if (!collection.tenantField) return null;
  const safeTenant = tenantId.replace(/"/g, '\\"');
  return `${collection.tenantField} = "${safeTenant}"`;
}

/**
 * Combines tenant clause + base filter + model filter into one PocketBase
 * filter string. Each part is wrapped in parens so operator precedence
 * cannot escape the tenant scope.
 */
export function composeFilter(
  collection: ExposedCollection,
  tenantId: string,
  modelFilter?: string
): string {
  const parts: string[] = [];
  const tenantClause = buildTenantClause(collection, tenantId);
  if (tenantClause) parts.push(`(${tenantClause})`);
  if (collection.baseFilter) parts.push(`(${collection.baseFilter})`);
  const trimmed = (modelFilter ?? '').trim();
  if (trimmed) parts.push(`(${trimmed})`);
  return parts.join(' && ');
}

/**
 * Strips PII / masked fields from a single record.
 */
export function maskRecord(
  record: Record<string, unknown>,
  collection: ExposedCollection
): Record<string, unknown> {
  if (collection.maskedFields.length === 0) return record;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (collection.maskedFields.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Discovers field names by sampling one record from the collection.
 * Cached per collection name for 5 minutes. Returns ['<unknown>'] if the
 * collection is empty (in which case the model still gets a hint).
 */
async function discoverFields(
  pb: PocketBase,
  collection: ExposedCollection,
  tenantId: string
): Promise<string[]> {
  const cacheKey = `${collection.name}:${tenantId}`;
  const cached = SAMPLE_FIELDS_CACHE.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.fields;

  try {
    const filter = composeFilter(collection, tenantId);
    const result = await pb.collection(collection.name).getList(1, 1, {
      filter: filter || undefined,
      fields: '*'
    });
    const sample = result.items[0];
    let fields: string[];
    if (!sample) {
      fields = ['(tom kollektion)'];
    } else {
      fields = Object.keys(sample).filter(
        (k) => !collection.maskedFields.includes(k) && !k.startsWith('collection')
      );
    }
    SAMPLE_FIELDS_CACHE.set(cacheKey, { fields, expires: Date.now() + FIELDS_CACHE_TTL_MS });
    return fields;
  } catch {
    return ['(kunde ej introspekteras)'];
  }
}

/**
 * Builds a markdown-ish schema summary for the system prompt.
 * Auto-discovers field names per collection so new fields show up
 * without code changes.
 */
export async function buildSchemaSummary(
  pb: PocketBase,
  tenantId: string
): Promise<string> {
  const lines: string[] = ['Tillgängliga kollektioner i PocketBase:'];
  await Promise.all(
    EXPOSED_COLLECTIONS.map(async (c) => {
      const fields = await discoverFields(pb, c, tenantId);
      lines.push(`- ${c.name}: ${c.description}. Fält: ${fields.join(', ')}`);
    })
  );
  return lines.join('\n');
}
