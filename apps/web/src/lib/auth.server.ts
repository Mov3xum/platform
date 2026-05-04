import 'server-only';
import { cookies } from 'next/headers';
import PocketBase from 'pocketbase';
import type { Role } from '@platform/shared';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8080';
export const AUTH_COOKIE = 'pb_auth';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  roles: Role[];
  tenant: string;
  tenantSlug?: string;
  tenantName?: string;
  linkedStartups: string[];
}

interface CookiePayload {
  token: string;
  model: Record<string, unknown> | null;
}

function readCookiePayload(raw: string | undefined): CookiePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CookiePayload;
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getServerPb(): Promise<PocketBase> {
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);

  const store = await cookies();
  const payload = readCookiePayload(store.get(AUTH_COOKIE)?.value);
  if (payload) {
    pb.authStore.save(payload.token, payload.model as never);
    if (pb.authStore.isValid) {
      try {
        await pb.collection('users').authRefresh({ expand: 'tenant' });
      } catch {
        pb.authStore.clear();
      }
    }
  }

  return pb;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const pb = await getServerPb();
  if (!pb.authStore.isValid || !pb.authStore.model) return null;

  const m = pb.authStore.model as Record<string, unknown> & {
    expand?: { tenant?: { id: string; name: string; slug: string } };
  };

  const tenantId = (m.tenant as string) || '';
  const tenant = m.expand?.tenant;

  return {
    id: m.id as string,
    email: (m.email as string) || '',
    name: (m.display_name as string) || (m.email as string) || '',
    roles: ((m.roles as string[]) || []) as Role[],
    tenant: tenantId,
    tenantSlug: tenant?.slug,
    tenantName: tenant?.name,
    linkedStartups: (m.linked_startups as string[]) || []
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}
