import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import PocketBase from 'pocketbase';
import type { Role } from '@platform/shared';

const SERVER_PB_URL =
  process.env.POCKETBASE_URL ||
  (process.env.NODE_ENV === 'production' ? 'http://pocketbase:8080' : 'http://localhost:8080');
const PUBLIC_PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || SERVER_PB_URL;
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
  avatarUrl?: string;
  tenantLogoLightUrl?: string;
  tenantLogoDarkUrl?: string;
  disabledModules: string[];
}

interface CookiePayload {
  token: string;
  model: Record<string, unknown> | null;
}

function readCookiePayload(raw: string | undefined): CookiePayload | null {
  if (!raw) return null;
  try {
    let value = raw;
    // New format: payload is URL-encoded before being written to cookie.
    // Keep backward compatibility with old raw JSON cookies.
    if (value.startsWith('%7B')) {
      value = decodeURIComponent(value);
    }
    const parsed = JSON.parse(value) as CookiePayload;
    if (!parsed?.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getServerPb(): Promise<PocketBase> {
  const pb = new PocketBase(SERVER_PB_URL);
  pb.autoCancellation(false);

  const store = await cookies();
  const payload = readCookiePayload(store.get(AUTH_COOKIE)?.value);
  if (payload) {
    pb.authStore.save(payload.token, payload.model as never);
  }

  return pb;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const pb = await getServerPb();
  if (!pb.authStore.isValid || !pb.authStore.model) return null;

  const authModel = pb.authStore.model as Record<string, unknown> & {
    expand?: { tenant?: { id: string; name: string; slug: string } };
  };

  let m = authModel;

  // Refresh from PocketBase to avoid stale cookie model after role/tenant updates.
  // If refresh fails (network/rule issues), fall back to authStore model.
  const authUserId = typeof authModel.id === 'string' ? authModel.id : '';
  if (authUserId) {
    try {
      const fresh = await pb.collection('users').getOne(authUserId, { expand: 'tenant' });
      m = fresh as typeof m;
    } catch {
      // Keep authModel fallback.
    }
  }

  const tenantId = (m.tenant as string) || '';
  const tenant = m.expand?.tenant as (Record<string, unknown> & {
    id: string;
    name: string;
    slug: string;
    disabled_modules?: unknown;
    logo_light?: string;
    logo_dark?: string;
  }) | undefined;

  const avatarFilename = m.avatar as string | undefined;
  const avatarUrl = avatarFilename
    ? `${PUBLIC_PB_URL}/api/files/users/${m.id as string}/${avatarFilename}`
    : undefined;

  const logoLightFilename = tenant?.logo_light;
  const logoDarkFilename = tenant?.logo_dark;
  const tenantLogoLightUrl = logoLightFilename
    ? `${PUBLIC_PB_URL}/api/files/tenants/${tenantId}/${logoLightFilename}`
    : undefined;
  const tenantLogoDarkUrl = logoDarkFilename
    ? `${PUBLIC_PB_URL}/api/files/tenants/${tenantId}/${logoDarkFilename}`
    : undefined;

  // Hämta disabled_modules från tenant + user (user har företräde som extra avstängningar).
  let disabledModules: string[] = [];
  const tenantDisabled = tenant?.disabled_modules;
  const userDisabled = m.disabled_modules;
  const tenantList = Array.isArray(tenantDisabled)
    ? tenantDisabled.filter((v): v is string => typeof v === 'string')
    : [];
  const userList = Array.isArray(userDisabled)
    ? userDisabled.filter((v): v is string => typeof v === 'string')
    : [];
  if (tenantList.length > 0 || userList.length > 0) {
    disabledModules = Array.from(new Set([...tenantList, ...userList]));
  }

  return {
    id: m.id as string,
    email: (m.email as string) || '',
    name: (m.display_name as string) || (m.email as string) || '',
    roles: ((m.roles as string[]) || []) as Role[],
    tenant: tenantId,
    tenantSlug: tenant?.slug,
    tenantName: tenant?.name,
    linkedStartups: (m.linked_startups as string[]) || [],
    avatarUrl,
    tenantLogoLightUrl,
    tenantLogoDarkUrl,
    disabledModules
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}

// Roller som ser staff-skalet (matchar /chatt-sidans staff-check).
const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

/**
 * Öppen-redirect-skydd för `next`-parametern. Tillåter bara interna,
 * absoluta paths — aldrig protokoll-relativa (`//evil.com`) eller externa
 * URL:er. `next` härstammar från en query-param och är användarstyrd.
 */
export function sanitizeInternalPath(path: string | null | undefined): string | null {
  if (!path || !path.startsWith('/')) return null;
  if (path.startsWith('//') || path.startsWith('/\\')) return null;
  return path;
}

/**
 * Vart en användare ska landa efter inloggning. Landar ALLTID direkt på en
 * sida som faktiskt renderar — aldrig på en redirect-shim (`/dashboard`) eller
 * en sida som i sin tur redirectar för den aktuella rollen. En extra
 * server-redirect efter login-actionens egen redirect gör att Next.js
 * client Router Cache återanvänder det gamla utloggade skalet (ingen sidmeny),
 * och logotyplänken i det skalet skickar tillbaka användaren till /login —
 * dvs "utloggad". Genom att landa direkt undviker vi hela kedjan.
 */
export function postLoginPath(roles: Role[], requestedNext?: string | null): string {
  const next = sanitizeInternalPath(requestedNext);
  if (next) return next;
  const isStaff = roles.some((r) => STAFF_ROLES.includes(r));
  if (!isStaff && roles.includes('startup_member')) return '/inkorg';
  return '/chatt';
}
