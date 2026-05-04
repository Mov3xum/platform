import 'server-only';
import type PocketBase from 'pocketbase';
import type { ListResult, RecordModel } from 'pocketbase';
import { getServerPb, requireUser, type SessionUser } from './auth.server';

export interface TenantQuery {
  pb: PocketBase;
  user: SessionUser;
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
export async function listForTenant<T extends RecordModel = RecordModel>(
  collection: string,
  options: ListOptions & { tenantField?: string } = {}
): Promise<ListResult<T>> {
  const { pb, user } = await tenantContext();
  const { tenantField = 'tenant', filter, sort, expand, page = 1, perPage = 50 } = options;

  return pb.collection(collection).getList<T>(page, perPage, {
    filter: withTenantFilter(user.tenant, filter, tenantField),
    sort,
    expand
  });
}

export async function getOneForTenant<T extends RecordModel = RecordModel>(
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
