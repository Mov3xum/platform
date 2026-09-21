import 'server-only';
import type PocketBase from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { getServerPb, requireUser, type SessionUser } from './auth.server';
import { hasRole } from './rbac';
import { escFilter } from './pb-filter';

export interface TenantQuery {
  pb: PocketBase;
  user: SessionUser;
}

// Staff + observer (intern tillsynsroll) har tenant-bred läsning. En ren
// startup_member ska bara se sina egna bolags rader (CLAUDE.md § 21).
const TENANT_WIDE_READ_ROLES = [
  'admin',
  'incubator_lead',
  'coach',
  'mentor',
  'observer'
] as const;

/**
 * Avgör om användaren har tenant-bred läsning (staff eller observer).
 */
export function hasTenantWideRead(user: Pick<SessionUser, 'roles'>): boolean {
  return hasRole(user.roles, [...TENANT_WIDE_READ_ROLES]);
}

/**
 * Defense-in-depth-fragment för bolagsisolering (CLAUDE.md § 21).
 *
 * Returnerar ett PocketBase-filterfragment som begränsar en lista till
 * användarens länkade bolag NÄR användaren är en ren `startup_member` (utan
 * tenant-bred roll). För staff/observer returneras tom sträng (ingen extra
 * begränsning — RLS + tenant-filtret räcker).
 *
 * - `field` är startup-relationens fältnamn på kollektionen (default `startup`;
 *   använd `id` för `startups`-kollektionen själv).
 * - En medlem utan länkade bolag får ett alltid-falskt filter (`<field> = ""`)
 *   så att inga rader läcker.
 * - Alla id:n escapas via `escFilter` (ISO 27001 A.8.9).
 *
 * Detta är ETT KOMPLEMENT till PB:s API-regler (sanna RLS) — inte en ersättning.
 * Det skyddar särskilt superuser-vägar som annars kringgår reglerna.
 */
export function startupScopeFilter(
  user: Pick<SessionUser, 'roles' | 'linkedStartups'>,
  field = 'startup'
): string {
  if (hasTenantWideRead(user)) return '';
  const linked = (user.linkedStartups || []).filter(
    (id) => /^[a-zA-Z0-9_-]{6,64}$/.test(id)
  );
  if (linked.length === 0) {
    // Ingen länkning → läck inget.
    return `${field} = ""`;
  }
  const ors = linked.map((id) => `${field} = "${escFilter(id)}"`);
  return `(${ors.join(' || ')})`;
}

export async function tenantContext(): Promise<TenantQuery> {
  const [pb, user] = await Promise.all([getServerPb(), requireUser()]);
  return { pb, user };
}

interface ListOptions {
  filter?: string;
  sort?: string;
  expand?: string;
  page?: number;
  perPage?: number;
}

function withTenantFilter(tenantId: string, filter?: string, tenantField = 'tenant'): string {
  const base = `${tenantField} = "${tenantId}"`;
  return filter ? `(${base}) && (${filter})` : base;
}

/**
 * List records in a tenant-scoped collection. The collection MUST have a
 * `tenant` field (or a relation path passed via tenantField, e.g. "startup.tenant").
 *
 * Server-side rules also enforce tenant isolation — this is a defense-in-depth
 * convenience that keeps app code from accidentally querying across tenants.
 */
export async function listForTenant<T = Record<string, unknown>>(
  collection: string,
  options: ListOptions & {
    tenantField?: string;
    /**
     * När satt scopas listan dessutom till användarens länkade bolag för rena
     * startup_member (CLAUDE.md § 21). Värdet är startup-relationens fältnamn
     * (t.ex. `startup`, eller `id` för `startups`-kollektionen). Tom/odefinierad
     * = ingen extra scoping (bara tenant-filtret).
     */
    scopeToStartupField?: string;
  } = {}
): Promise<ListResult<T>> {
  const { pb, user } = await tenantContext();
  const {
    tenantField = 'tenant',
    filter,
    sort,
    expand,
    page = 1,
    perPage = 50,
    scopeToStartupField
  } = options;

  let mergedFilter = filter;
  if (scopeToStartupField) {
    const scope = startupScopeFilter(user, scopeToStartupField);
    if (scope) {
      mergedFilter = mergedFilter ? `(${mergedFilter}) && ${scope}` : scope;
    }
  }

  return pb.collection(collection).getList<T>(page, perPage, {
    filter: withTenantFilter(user.tenant, mergedFilter, tenantField),
    sort,
    expand
  });
}

/** Sidstorlek + hårt tak för `listAllForTenant` (robusthet § 10). */
const LIST_ALL_BATCH = 500;
const LIST_ALL_MAX_ROWS = 10_000;

export interface ListAllResult<T> {
  items: T[];
  /** PB:s totala antal matchande rader. */
  total: number;
  /** false när taket LIST_ALL_MAX_ROWS nåddes — anroparen ska visa det. */
  complete: boolean;
}

/**
 * Läser ALLA tenantens rader i en kollektion genom att paginera — inte en
 * enda sida. Bakgrund: `/arshjul` läste `getList(1, 500)`; en tenant med
 * fler än 500 poster (serier ger snabbt 12 rader per aktivitet och år)
 * tappade tyst allt bortom sidan, så nya poster "sparades" men syntes inte.
 * Samma tenant-/medlems-scope som `listForTenant`; reads går via användarens
 * token (RLS § 21). Taket rapporteras via `complete` — aldrig en tyst kapning.
 */
export async function listAllForTenant<T = Record<string, unknown>>(
  collection: string,
  options: Omit<ListOptions, 'page' | 'perPage'> & {
    tenantField?: string;
    scopeToStartupField?: string;
    maxRows?: number;
  } = {}
): Promise<ListAllResult<T>> {
  const maxRows = Math.max(1, Math.min(options.maxRows ?? LIST_ALL_MAX_ROWS, LIST_ALL_MAX_ROWS));
  const items: T[] = [];
  let total = 0;
  for (let page = 1; ; page++) {
    const res = await listForTenant<T>(collection, {
      ...options,
      page,
      perPage: LIST_ALL_BATCH
    });
    total = res.totalItems;
    items.push(...res.items);
    // Stoppvillkor på FAKTISKT antal lästa rader (inte sidnummer × batch) så
    // en instans som klampar perPage lägre än vår batch ändå läser allt.
    if (res.items.length === 0 || items.length >= total) break;
    if (items.length >= maxRows) return { items: items.slice(0, maxRows), total, complete: false };
  }
  return { items, total, complete: true };
}

export async function getOneForTenant<T = Record<string, unknown>>(
  collection: string,
  id: string,
  options: { expand?: string; tenantField?: string } = {}
): Promise<T> {
  const { pb, user } = await tenantContext();
  const { expand, tenantField = 'tenant' } = options;

  const record = await pb.collection(collection).getOne<T>(id, { expand });

  // Defense-in-depth: verify tenant matches even though rules should already enforce it.
  const recordTenant = tenantField.includes('.')
    ? tenantField.split('.').reduce<unknown>((acc, key) => {
        if (acc && typeof acc === 'object' && key in acc) {
          return (acc as Record<string, unknown>)[key];
        }
        return undefined;
      }, record)
    : (record as unknown as Record<string, unknown>)[tenantField];

  if (recordTenant !== user.tenant) {
    throw new Error('Cross-tenant access denied');
  }

  return record;
}
