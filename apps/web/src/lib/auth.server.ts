import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import PocketBase from 'pocketbase';
import type { Role } from '@platform/shared';
import { getPublicPbUrl, getServerPbUrl } from '@/lib/pb-url';

const SERVER_PB_URL = getServerPbUrl();
const PUBLIC_PB_URL = getPublicPbUrl();
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

/**
 * Superuser-autentiserad PocketBase-klient. Används BARA efter att RBAC
 * (tenant + roll/ägare) redan verifierats i koden — koden är
 * säkerhetsgränsen, inte PB-regeln. Behövs för skrivningar mot kollektioner
 * vars updateRule jämför mot en relation (t.ex. `tenant`/`startup.tenant`),
 * eftersom PB v0.23:s rule-eval har en bugg som annars tyst nekar
 * skrivningen → drag-and-drop-kort hoppar tillbaka i boarden. Returnerar
 * `null` om credentials saknas/auth failar (anroparen failar då tydligt).
 */
export async function getSuperuserPb(): Promise<PocketBase | null> {
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
  const password =
    process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
  if (!email || !password) {
    console.error('[auth.server] superuser credentials missing');
    return null;
  }
  const pb = new PocketBase(SERVER_PB_URL);
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    return pb;
  } catch {
    console.error('[auth.server] superuser auth failed');
    return null;
  }
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
