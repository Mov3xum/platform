import { NextResponse, type NextRequest } from 'next/server';
import PocketBase from 'pocketbase';
import { AUTH_COOKIE } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { describeLoginInfraError, probePocketBase, probeSummary } from '@/lib/pb-health';
import { checkRateLimit, clearFailures, recordFailure } from '@/lib/rate-limit';
import { clientIpFromRequest } from '@/lib/client-ip';
import { sanitizeAppPath } from '@/lib/relative-redirect';

type PbError = {
  status?: number;
  message?: string;
  data?: { data?: Record<string, { message?: string }>; message?: string };
};

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_ACCOUNT = 8;
const LOGIN_MAX_PER_IP = 40;
const LOGIN_MAX_PER_EMAIL = 20;

function shouldUseSecureCookie(req: NextRequest): boolean {
  if (process.env.MOVEXUM_ALLOW_INSECURE_COOKIES === 'true') return false;
  // Kedjade proxies ger "https, http" — första värdet är klientens protokoll
  // (samma tolkning som middleware:n; utan split tappades Secure tyst).
  const raw = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
  return raw.split(',')[0]!.trim().toLowerCase() === 'https';
}

// Öppen-redirect-skydd: delad sanering (kontrolltecken/backslash/tab-bypass,
// origin-kontroll) — inte bara en prefixkontroll.
function sanitizeNextPath(nextPath: string): string {
  return sanitizeAppPath(nextPath, '/dashboard');
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { email?: string; password?: string; next?: string } = {};
  try {
    body = (await req.json()) as { email?: string; password?: string; next?: string };
  } catch {
    return NextResponse.json({ error: 'Ogiltig request-body.' }, { status: 400 });
  }

  const email = String(body.email || '').trim();
  const password = String(body.password || '');
  const nextPath = sanitizeNextPath(String(body.next || '/dashboard'));

  if (!email || !password) {
    return NextResponse.json({ error: 'E-post och lösenord krävs.' }, { status: 400 });
  }

  const ip = clientIpFromRequest(req);
  const emailKey = email.toLowerCase();
  const accountKey = `login:acct:${ip}:${emailKey}`;
  const ipKey = `login:ip:${ip}`;
  // Per e-post OAVSETT IP — annars nollställs kontospärren genom att rotera
  // adressen (distribuerad brute force mot ett konto).
  const emailOnlyKey = `login:email:${emailKey}`;

  const [acctLimit, ipLimit, emailLimit] = await Promise.all([
    checkRateLimit(accountKey, LOGIN_MAX_PER_ACCOUNT),
    checkRateLimit(ipKey, LOGIN_MAX_PER_IP),
    checkRateLimit(emailOnlyKey, LOGIN_MAX_PER_EMAIL)
  ]);
  if (acctLimit.blocked || ipLimit.blocked || emailLimit.blocked) {
    const retryMin = Math.ceil(
      Math.max(acctLimit.retryAfterSec, ipLimit.retryAfterSec, emailLimit.retryAfterSec) / 60
    );
    return NextResponse.json(
      { error: `För många inloggningsförsök. Försök igen om ca ${retryMin} min.` },
      { status: 429 }
    );
  }

  const pbUrl = getServerPbUrl();
  const pb = new PocketBase(pbUrl);

  try {
    await pb.collection('users').authWithPassword(email, password, { expand: 'tenant' });
  } catch (err: unknown) {
    const e = err as PbError;
    console.error('[api/auth/login] PocketBase auth failed', {
      status: e.status,
      message: e.message,
      data: e.data
    });

    if (e.status === 400 || e.status === 403) {
      await Promise.all([
        recordFailure(accountKey, LOGIN_WINDOW_MS),
        recordFailure(ipKey, LOGIN_WINDOW_MS),
        recordFailure(emailOnlyKey, LOGIN_WINDOW_MS)
      ]);
    }

    if (e.status === 400) {
      return NextResponse.json({ error: 'Fel e-post eller lösenord.' }, { status: 400 });
    }
    if (e.status === 403) {
      return NextResponse.json({ error: 'Kontot är ej verifierat eller saknar behörighet.' }, { status: 403 });
    }
    // 404 betyder INTE nödvändigtvis att `users` saknas (den är PB:s inbyggda
    // auth-kollektion): Coolifys proxy svarar 404 för en host utan router och
    // web-appen svarar 404 på /api/collections/… om domänen pekar fel. Proba
    // /api/health och säg vad adressen faktiskt är (lib/pb-health.ts).
    if (e.status === 404 || !e.status || e.status >= 500) {
      const probe = await probePocketBase(pbUrl);
      console.error('[api/auth/login] PocketBase probe', { pbUrl, kind: probe.kind, summary: probeSummary(probe) });
      return NextResponse.json(
        { error: describeLoginInfraError(pbUrl, probe) },
        { status: probe.kind === 'pocketbase' && e.status === 404 ? 500 : 503 }
      );
    }
    return NextResponse.json(
      { error: e.data?.message || e.message || 'Inloggning misslyckades. Försök igen.' },
      { status: 500 }
    );
  }

  await Promise.all([clearFailures(accountKey), clearFailures(ipKey), clearFailures(emailOnlyKey)]);

  const model = pb.authStore.model as Record<string, unknown> | null;
  const expandTenant =
    (model?.expand as { tenant?: { id: string; name: string; slug: string } } | undefined)?.tenant;

  const compactModel = model
    ? {
        id: model.id,
        email: model.email,
        collectionId: model.collectionId,
        collectionName: model.collectionName,
        verified: model.verified,
        tenant: model.tenant,
        roles: model.roles,
        display_name: model.display_name,
        avatar: model.avatar,
        linked_startups: model.linked_startups,
        disabled_modules: model.disabled_modules,
        enabled_modules: model.enabled_modules,
        expand: expandTenant
          ? { tenant: { id: expandTenant.id, name: expandTenant.name, slug: expandTenant.slug } }
          : undefined
      }
    : null;

  const payload = encodeURIComponent(
    JSON.stringify({
      token: pb.authStore.token,
      model: compactModel
    })
  );

  const res = NextResponse.json({ success: true, redirectTo: nextPath });
  res.cookies.set(AUTH_COOKIE, payload, {
    httpOnly: true,
    secure: shouldUseSecureCookie(req),
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 14
  });

  return res;
}
