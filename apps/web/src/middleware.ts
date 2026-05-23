import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/', '/login', '/register', '/reset-password', '/verify-email'];
const AUTH_COOKIE = 'pb_auth';

/**
 * Content-Security-Policy.
 *
 * I produktion används en nonce-baserad strict-dynamic-policy: varje
 * request får en slumpad nonce som Next.js automatiskt applicerar på sina
 * egna script-taggar (genom att vi sätter CSP-headern på request-headers)
 * och som vi själva sätter på `ThemeScript` via layouten. Det innebär att
 * inline-script utan korrekt nonce blockeras → XSS-injektion kan inte köra
 * godtycklig JS även om den tar sig in i DOM:en (backstop för § XSS-fixarna).
 *
 * I utveckling tillåts unsafe-eval/unsafe-inline eftersom React Fast Refresh
 * kräver det.
 */
function buildCsp(nonce: string | null): string {
  const isProd = process.env.NODE_ENV === 'production';
  const scriptSrc =
    isProd && nonce
      ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
      : `'self' 'unsafe-eval' 'unsafe-inline'`;

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    `script-src ${scriptSrc}`,
    // Next.js + Tailwind injicerar inline-styles; style-injektion är lågrisk.
    `style-src 'self' 'unsafe-inline'`,
    // PocketBase-filer (avatarer/loggor) kan ligga på annan origin, ev. http
    // i staging. Bilder kan inte exekvera kod.
    `img-src 'self' data: blob: https: http:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `manifest-src 'self'`
  ];
  // Hoppa över https-uppgradering på HTTP-staging (sslip.io) — annars
  // bryts subresurser (PB-bilder över http). Samma signal som secure-cookien.
  const allowInsecure = process.env.MOVEXUM_ALLOW_INSECURE_COOKIES === 'true';
  if (isProd && !allowInsecure) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function withSecurityContext(req: NextRequest, nonce: string | null, csp: string): NextResponse {
  const requestHeaders = new Headers(req.headers);
  if (nonce) {
    // Next.js läser nonce från CSP-headern på request och applicerar den på
    // sina egna script-taggar. x-nonce läses av layouten för ThemeScript.
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('Content-Security-Policy', csp);
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProd = process.env.NODE_ENV === 'production';
  const nonce = isProd ? btoa(crypto.randomUUID()) : null;
  const csp = buildCsp(nonce);

  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/reset-password/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/health');

  let res: NextResponse;
  if (isPublic) {
    res = withSecurityContext(req, nonce, csp);
  } else {
    const token = req.cookies.get(AUTH_COOKIE);
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', pathname);
      res = NextResponse.redirect(url);
    } else {
      res = withSecurityContext(req, nonce, csp);
    }
  }

  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/).*)']
};
