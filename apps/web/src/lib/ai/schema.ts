import 'server-only';
import PocketBase from 'pocketbase';
import type PocketBaseType from 'pocketbase';
import { escFilter } from '@/lib/pb-filter';

/**
 * Auto-discovery of PocketBase collections for the AI chat.
 *
 * No manual whitelist needed — when you add a collection in PB-admin it
 * shows up here on the next chat session (within DISCOVERY_TTL_MS). For
 * special cases (PII masks, base filters, custom descriptions), add an
 * entry to COLLECTION_OVERRIDES below.
 *
 * Falls back to a small static list if admin credentials are missing,
 * so chat still works in misconfigured environments.
 */
export interface CollectionField {
  name: string;
  type: string;
}

export interface ExposedCollection {
  name: string;
  description: string;
  /** PB filter path to the tenant relation, e.g. 'tenant' or 'startup.tenant'. Null = unscoped reference data. */
  tenantField: string | null;
  maskedFields: string[];
  baseFilter?: string;
  fields: CollectionField[];
}

const DISCOVERY_TTL_MS = 5 * 60 * 1000;
const ADMIN_AUTH_TTL_MS = 25 * 60 * 1000;
const MAX_RELATION_DEPTH = 3;

/**
 * Collections that are NEVER exposed to the chat, regardless of who set them
 * up in PB-admin. Internal/auth/PII tables.
 *
 * Beyond auth tables we deny:
 *   • contacts                — externa personers detaljer får inte till
 *                               AI-prompten (CLAUDE.md § 15.3).
 *   • compass_*-besökardata   — leads, chatt-sessioner, svar och IP-hash
 *                               (pre-onboarding PII + separat samtycke).
 *   • compass_security_events — säkerhetsaudit (ip_hash, actor).
 *   • agent_actions           — mutationsaudit (before/after-värden kan
 *                               innehålla godtyckligt fältinnehåll).
 *   • *_integrations / connectors — krypterade credentials/OAuth-tokens.
 *
 * Detta är defense-in-depth: själva fältmaskningen nedan fångar PII per
 * fältnamn, men dessa kollektioner hålls helt utanför chatten.
 */
const COLLECTION_DENYLIST = new Set<string>([
  'users',
  'tenants',
  'verification_tokens',
  'pending_signups',
  'contacts',
  'compass_leads',
  'compass_conversations',
  'compass_messages',
  'compass_responses',
  'compass_security_events',
  'agent_actions',
  'tenant_integrations',
  'user_app_integrations',
  'user_mistral_connectors'
]);

/**
 * Field names auto-masked across ALL collections (case-insensitive substring).
 *
 * Utöver direkt-PII (e-post, telefon, personnummer) maskar vi GDPR art. 9
 * särskild kategori (`founder_gender`, `founder_identifies_as`, `gender`),
 * adressfält (PII för enskild firma) samt org-nr och visitor-ip-hash. Detta
 * speglar svartlistan i `lib/ai/context.ts` så att chattens query-verktyg
 * inte kan kringgå den (CLAUDE.md § 9.3, § 10.2).
 */
const PII_FIELD_PATTERNS = [
  'password',
  'tokenkey',
  'token_key',
  'email',
  'person_nr',
  'personnummer',
  'ssn',
  'phone',
  'telefon',
  'mobil',
  'avatar',
  // GDPR art. 9 — särskild kategori
  'gender',
  'identifies_as',
  // PII för enskild firma / pseudonymiserad PII
  'street_address',
  'postal_code',
  'org_nr',
  'ip_hash'
];

/**
 * Per-collection overrides for cases where auto-discovery isn't enough.
 * Anything you set here wins over the auto-inferred values.
 */
const COLLECTION_OVERRIDES: Record<
  string,
  Partial<Pick<ExposedCollection, 'description' | 'tenantField' | 'maskedFields' | 'baseFilter'>>
> = {
  notes: {
    description: 'Anteckningar per bolag — endast icke-konfidentiella',
    baseFilter: 'confidential = false'
  },
  startups: {
    description: 'Idéer och bolag i inkubatorn (namn, fas, IRL-nivå, sektor, status, ägare)'
  },
  startup_team_members: {
    description: 'Teammedlemmar och grundare per bolag (is_founder, role_title, equity_pct)'
  },
  deals: {
    description: 'Investeringsrundor och dealflow (stage, amount, investor, last_activity)'
  },
  milestones: {
    description: 'Milstolpar per bolag (title, category, status, target_date, achieved_at)'
  },
  activities: {
    description: 'Aktiviteter, möten och uppgifter per bolag (type, status, due_date, owner)'
  },
  tasks: {
    description:
      'Uppgifter (kind, status, due_at, owner, länkad startup/kontakt/event). ' +
      'Fritextfältet `details` exkluderas (kan innehålla privata arbetsanteckningar, CLAUDE.md § 15.3).',
    maskedFields: ['details']
  }
};

/**
 * Static fallback used when admin auth is missing / fails. Keeps chat
 * functional in dev / misconfigured environments.
 */
const STATIC_FALLBACK: ExposedCollection[] = [
  {
    name: 'startups',
    description: 'Idéer och bolag i inkubatorn',
    tenantField: 'tenant',
    maskedFields: [
      'person_nr',
      'personnummer',
      'founder_gender',
      'founder_identifies_as',
      'street_address',
      'postal_code',
      'org_nr',
      'phone',
      'email'
    ],
    fields: []
  },
  {
    name: 'startup_team_members',
    description: 'Teammedlemmar och grundare per bolag',
    tenantField: 'startup.tenant',
    maskedFields: ['email', 'person_nr', 'personnummer'],
    fields: []
  },
  {
    name: 'deals',
    description: 'Investeringsrundor och dealflow',
    tenantField: 'tenant',
    maskedFields: [],
    fields: []
  },
  {
    name: 'milestones',
    description: 'Milstolpar per bolag',
    tenantField: 'startup.tenant',
    maskedFields: [],
    fields: []
  },
  {
    name: 'activities',
    description: 'Aktiviteter och uppgifter per bolag',
    tenantField: 'startup.tenant',
    maskedFields: [],
    fields: []
  },
  {
    name: 'notes',
    description: 'Anteckningar per bolag (endast icke-konfidentiella)',
    tenantField: 'startup.tenant',
    maskedFields: [],
    baseFilter: 'confidential = false',
    fields: []
  }
];

interface AdminCacheEntry {
  pb: PocketBaseType;
  expires: number;
}
let adminCache: AdminCacheEntry | null = null;

interface DiscoveryCacheEntry {
  collections: ExposedCollection[];
  expires: number;
}
let discoveryCache: DiscoveryCacheEntry | null = null;

function getServerPbUrl(): string {
  return (
    process.env.POCKETBASE_URL ||
    (process.env.NODE_ENV === 'production' ? 'http://pocketbase:8080' : 'http://localhost:8080')
  );
}

async function getAdminPb(): Promise<PocketBaseType | null> {
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD;
  if (!email || !password) return null;

  const now = Date.now();
  if (adminCache && adminCache.pb.authStore.isValid && now < adminCache.expires) {
    return adminCache.pb;
  }

  const pb = new PocketBase(getServerPbUrl());
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
  } catch (err) {
    console.warn('[schema] superuser auth failed', err);
    return null;
  }
  adminCache = { pb, expires: now + ADMIN_AUTH_TTL_MS };
  return pb;
}

interface RawField {
  name: string;
  type: string;
  collectionId?: string;
}
interface RawCollection {
  id: string;
  name: string;
  type: string;
  system: boolean;
  fields?: RawField[];
  schema?: RawField[];
}

function getCollectionFields(c: RawCollection): RawField[] {
  return c.fields ?? c.schema ?? [];
}

/**
 * Walks relation chains to find the shortest dotted path that ends at
 * the tenants collection. Direct `tenant` relation is preferred. Returns
 * null if no path is found within MAX_RELATION_DEPTH hops.
 */
function inferTenantPath(
  fields: RawField[],
  tenantsId: string,
  collectionsById: Map<string, RawCollection>,
  depth = 0,
  visited: Set<string> = new Set()
): string | null {
  if (depth > MAX_RELATION_DEPTH) return null;

  for (const f of fields) {
    if (f.type === 'relation' && f.collectionId === tenantsId) {
      return f.name;
    }
  }

  for (const f of fields) {
    if (f.type !== 'relation' || !f.collectionId) continue;
    if (visited.has(f.collectionId)) continue;
    const child = collectionsById.get(f.collectionId);
    if (!child || child.system) continue;
    const childPath = inferTenantPath(
      getCollectionFields(child),
      tenantsId,
      collectionsById,
      depth + 1,
      new Set([...visited, f.collectionId])
    );
    if (childPath) return `${f.name}.${childPath}`;
  }

  return null;
}

function autoMaskFields(fields: RawField[]): string[] {
  const masked: string[] = [];
  for (const f of fields) {
    const lower = f.name.toLowerCase();
    if (PII_FIELD_PATTERNS.some((p) => lower.includes(p))) {
      masked.push(f.name);
    }
  }
  return masked;
}

function applyOverrides(c: ExposedCollection): ExposedCollection {
  const ov = COLLECTION_OVERRIDES[c.name];
  if (!ov) return c;
  return {
    ...c,
    description: ov.description ?? c.description,
    tenantField: ov.tenantField !== undefined ? ov.tenantField : c.tenantField,
    maskedFields: ov.maskedFields ?? c.maskedFields,
    baseFilter: ov.baseFilter ?? c.baseFilter
  };
}

async function discoverCollections(): Promise<ExposedCollection[]> {
  const pb = await getAdminPb();
  if (!pb) return STATIC_FALLBACK;

  let raw: RawCollection[];
  try {
    raw = (await pb.collections.getFullList()) as unknown as RawCollection[];
  } catch (err) {
    console.warn('[schema] collections.getFullList failed', err);
    return STATIC_FALLBACK;
  }

  const tenants = raw.find((c) => c.name === 'tenants');
  const tenantsId = tenants?.id;
  const byId = new Map<string, RawCollection>(raw.map((c) => [c.id, c]));

  const exposed: ExposedCollection[] = [];
  for (const c of raw) {
    if (c.system) continue;
    if (c.name.startsWith('_')) continue;
    if (COLLECTION_DENYLIST.has(c.name)) continue;
    if (c.type !== 'base' && c.type !== 'view') continue;

    const fields = getCollectionFields(c);
    const tenantField = tenantsId
      ? inferTenantPath(fields, tenantsId, byId)
      : null;

    const collection: ExposedCollection = {
      name: c.name,
      description: c.name,
      tenantField,
      maskedFields: autoMaskFields(fields),
      fields: fields.map((f) => ({ name: f.name, type: f.type }))
    };
    exposed.push(applyOverrides(collection));
  }

  exposed.sort((a, b) => a.name.localeCompare(b.name));
  return exposed;
}

/**
 * Returns the list of collections the chat is allowed to read.
 * Cached for DISCOVERY_TTL_MS so PB admin isn't hammered.
 */
export async function getExposedCollections(): Promise<ExposedCollection[]> {
  const now = Date.now();
  if (discoveryCache && discoveryCache.expires > now) {
    return discoveryCache.collections;
  }
  const collections = await discoverCollections();
  discoveryCache = { collections, expires: now + DISCOVERY_TTL_MS };
  return collections;
}

export function getExposedCollection(
  collections: ExposedCollection[],
  name: string
): ExposedCollection | undefined {
  return collections.find((c) => c.name === name);
}

export function buildTenantClause(
  collection: ExposedCollection,
  tenantId: string
): string | null {
  if (!collection.tenantField) return null;
  const safeTenant = escFilter(tenantId);
  return `${collection.tenantField} = "${safeTenant}"`;
}

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
 * Builds the schema summary for the system prompt — one line per collection
 * with its description and field names. Used by chat.ts.
 */
export function buildSchemaSummary(collections: ExposedCollection[]): string {
  const lines: string[] = ['Tillgängliga kollektioner i PocketBase:'];
  for (const c of collections) {
    const fieldList = c.fields.length > 0
      ? c.fields.map((f) => f.name).join(', ')
      : '(fält upptäcks live)';
    const scope = c.tenantField ? '' : ' [referensdata, ej tenant-scopad]';
    lines.push(`- ${c.name}${scope}: ${c.description}. Fält: ${fieldList}`);
  }
  return lines.join('\n');
}

/**
 * Manually invalidate the discovery cache (e.g. after a known schema change).
 */
export function invalidateSchemaCache(): void {
  discoveryCache = null;
}
