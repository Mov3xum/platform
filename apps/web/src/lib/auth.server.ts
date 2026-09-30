import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import PocketBase from 'pocketbase';
import { resolveUserModules, type Role } from '@platform/shared';
import { getPublicPbUrl, getServerPbUrl } from '@/lib/pb-url';
import { parseAuthCookie, USERS_COLLECTION_NAME, type ParsedAuthCookie } from '@/lib/session-token';

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
  /** Effektiv allow-lista över moduler i sidofältet (§ 36.3). */
  enabledModules: string[];
}

/**
 * Sessionsmodell (härdad 2026-09-30, CLAUDE.md § 10.3 "Sessionsvalidering").
 *
 * Cookien `pb_auth` bär `{ token, model }`. `model` är en OSIGNERAD kopia av
 * användarposten och kan redigeras av den som har webbläsaren (DevTools) —
 * httpOnly hindrar bara JS. Tidigare: (1) identiteten togs ur `model.id`, och
 * eftersom `users.viewRule` låter alla i tenanten läsa varandra kunde ett
 * redigerat `model.id` + egen giltig token ge en ANNAN användares roller i
 * sessionen; (2) när PB-uppslaget misslyckades föll koden tillbaka på
 * cookiens `model` → påhittade roller (t.ex. `admin`) gällde i alla server-
 * actions som gör superuser-fallback efter en `hasRole`-kontroll (§ 21.3).
 *
 * Nu: identiteten kommer ur TOKENENS payload (`parseAuthCookie`), posten läses
 * ALLTID färskt från PocketBase med samma token (PB verifierar signaturen), och
 * varje fel — 401/403/404 (ogiltig/återkallad token, raderad användare), 5xx
 * eller nätverksfel — ger `null` (fail-closed, SOC 2 § 10.4: degraderat läge
 * felar tydligt). Cookiens `model` används ALDRIG för sessionen. Resultatet
 * cachas per request (`react.cache`) så layout, sida och skal delar ETT
 * PB-anrop.
 */

const readAuthCookie = cache(async (): Promise<ParsedAuthCookie | null> => {
  const store = await cookies();
  return parseAuthCookie(store.get(AUTH_COOKIE)?.value);
});

export async function getServerPb(): Promise<PocketBase> {
  const pb = new PocketBase(SERVER_PB_URL);
  pb.autoCancellation(false);

  const session = await readAuthCookie();
  if (session) {
    // Bara token + id ur payloaden — cookiens `model` är otillförlitlig.
    pb.authStore.save(session.token, {
      id: session.userId,
      collectionName: USERS_COLLECTION_NAME
    } as never);
  }

  return pb;
}

type FreshUserRecord = Record<string, unknown> & {
  id: string;
  expand?: {
    tenant?: Record<string, unknown> & {
      id: string;
      name: string;
      slug: string;
      logo_light?: string;
      logo_dark?: string;
    };
  };
};

/**
 * Verifierar sessionen mot PocketBase. `null` vid varje fel — aldrig en
 * gissning ur cookien. Loggen är PII-fri (status, aldrig id/e-post/token).
 */
const loadVerifiedUser = cache(async (): Promise<FreshUserRecord | null> => {
  const session = await readAuthCookie();
  if (!session) return null;

  const pb = new PocketBase(SERVER_PB_URL);
  pb.autoCancellation(false);
  pb.authStore.save(session.token, { id: session.userId, collectionName: USERS_COLLECTION_NAME } as never);

  try {
    const fresh = await pb
      .collection(USERS_COLLECTION_NAME)
      .getOne<FreshUserRecord>(session.userId, { expand: 'tenant' });
    // Defense-in-depth: posten måste vara exakt tokenens subjekt.
    if (!fresh || fresh.id !== session.userId) return null;
    return fresh;
  } catch (err) {
    const status = (err as { status?: number }).status ?? 0;
    // 401/403/404 = ogiltig/återkallad token eller raderad användare → tyst
    // utloggad. Övrigt (PB nere/nätverk) loggas — men sessionen ges ändå
    // aldrig ur cookien.
    if (status === 0 || status >= 500) {
      console.error('[auth] session verification failed', { status });
    }
    return null;
  }
});

export async function getCurrentUser(): Promise<SessionUser | null> {
  const m = await loadVerifiedUser();
  if (!m) return null;

  const tenantId = (m.tenant as string) || '';
  const tenant = m.expand?.tenant;

  const avatarFilename = m.avatar as string | undefined;
  const avatarUrl = avatarFilename
    ? `${PUBLIC_PB_URL}/api/files/users/${m.id}/${avatarFilename}`
    : undefined;

  const logoLightFilename = tenant?.logo_light;
  const logoDarkFilename = tenant?.logo_dark;
  const tenantLogoLightUrl = logoLightFilename
    ? `${PUBLIC_PB_URL}/api/files/tenants/${tenantId}/${logoLightFilename}`
    : undefined;
  const tenantLogoDarkUrl = logoDarkFilename
    ? `${PUBLIC_PB_URL}/api/files/tenants/${tenantId}/${logoDarkFilename}`
    : undefined;

  // Modulåtkomst per användare (§ 36.3): allow-listan `enabled_modules` är
  // sanningen; saknas den (konto före migration 1700000144) gäller allt
  // rollen tillåter minus ev. legacy `disabled_modules` på användaren.
  // Tenantens gamla globala `disabled_modules` läses INTE längre.
  const roles = (Array.isArray(m.roles) ? (m.roles as string[]) : []) as Role[];
  const enabledModules = resolveUserModules({
    roles,
    stored: m.enabled_modules,
    legacyDisabled: m.disabled_modules
  });

  return {
    id: m.id,
    email: (m.email as string) || '',
    name: (m.display_name as string) || (m.email as string) || '',
    roles,
    tenant: tenantId,
    tenantSlug: tenant?.slug,
    tenantName: tenant?.name,
    linkedStartups: Array.isArray(m.linked_startups) ? (m.linked_startups as string[]) : [],
    avatarUrl,
    tenantLogoLightUrl,
    tenantLogoDarkUrl,
    enabledModules
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}
