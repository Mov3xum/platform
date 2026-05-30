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
// startup_member ska bara se sina egna bolags rader (CLAUDE.md § 20).
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
 * Defense-in-depth-fragment för bolagsisolering (CLAUDE.md § 20).
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
     * startup_member (CLAUDE.md § 20). Värdet är startup-relationens fältnamn
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
