import { NextResponse, type NextRequest } from 'next/server';
import PocketBase from 'pocketbase';
import { AUTH_COOKIE } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { checkRateLimit, clearFailures, recordFailure } from '@/lib/rate-limit';

type PbError = {
  status?: number;
  message?: string;
  data?: { data?: Record<string, { message?: string }>; message?: string };
};

const PB_URL = getServerPbUrl();

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_PER_ACCOUNT = 8;
const LOGIN_MAX_PER_IP = 40;

function shouldUseSecureCookie(req: NextRequest): boolean {
  if (process.env.MOVEXUM_ALLOW_INSECURE_COOKIES === 'true') return false;
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '');
  return proto === 'https';
}

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

function sanitizeNextPath(nextPath: string): string {
  if (nextPath.startsWith('/') && !nextPath.startsWith('//') && !nextPath.startsWith('/\\')) {
    return nextPath;
  }
  return '/dashboard';
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

  const ip = getClientIp(req);
  const accountKey = `login:acct:${ip}:${email.toLowerCase()}`;
  const ipKey = `login:ip:${ip}`;

  const acctLimit = checkRateLimit(accountKey, LOGIN_MAX_PER_ACCOUNT);
  const ipLimit = checkRateLimit(ipKey, LOGIN_MAX_PER_IP);
  if (acctLimit.blocked || ipLimit.blocked) {
    const retryMin = Math.ceil(Math.max(acctLimit.retryAfterSec, ipLimit.retryAfterSec) / 60);
    return NextResponse.json(
      { error: `För många inloggningsförsök. Försök igen om ca ${retryMin} min.` },
      { status: 429 }
    );
  }

  const pb = new PocketBase(PB_URL);

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
      recordFailure(accountKey, LOGIN_WINDOW_MS);
      recordFailure(ipKey, LOGIN_WINDOW_MS);
    }

    if (e.status === 400) {
      return NextResponse.json({ error: 'Fel e-post eller lösenord.' }, { status: 400 });
    }
    if (e.status === 403) {
      return NextResponse.json({ error: 'Kontot är ej verifierat eller saknar behörighet.' }, { status: 403 });
    }
    if (e.status === 404) {
      return NextResponse.json(
        { error: 'Users-collectionen saknas i PocketBase — har migrationerna körts?' },
        { status: 500 }
      );
    }
    if (!e.status) {
      return NextResponse.json(
        { error: `Kunde inte nå PocketBase (${PB_URL}). Kontrollera POCKETBASE_URL/NEXT_PUBLIC_POCKETBASE_URL.` },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: e.data?.message || e.message || 'Inloggning misslyckades. Försök igen.' },
      { status: 500 }
    );
  }

  clearFailures(accountKey);
  clearFailures(ipKey);

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
