import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/', '/login', '/reset-password', '/verify-email'];
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
function buildCsp(nonce: string | null, isHttps: boolean): string {
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
    // PocketBase-filer (avatarer/loggor/videos) kan ligga på annan origin, ev.
    // http i staging. Bilder och media kan inte exekvera kod.
    `img-src 'self' data: blob: https: http:`,
    // workshop_media-videos laddas från PocketBase-origin (kan vara extern,
    // ev. http i staging). Utan explicit media-src faller browsern tillbaka
    // på default-src 'self' och blockerar uppspelning.
    `media-src 'self' https: http:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `frame-src 'none'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `manifest-src 'self'`
  ];
  // upgrade-insecure-requests tvingar browsern att uppgradera ALLA subresurser
  // (CSS/JS/fonter/bilder) till https. På en http-serverad deploy (staging utan
  // TLS, sslip.io) finns ingen https-lyssnare → alla subresurser fallerar och
  // sidan blir helt ostylad. Lägg därför bara till direktivet när requesten
  // faktiskt kom in över https. Escape-hatchen behålls för explicit avstängning.
  const allowInsecure = process.env.MOVEXUM_ALLOW_INSECURE_COOKIES === 'true';
  if (isProd && isHttps && !allowInsecure) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function withSecurityContext(req: NextRequest, nonce: string | null, csp: string): NextResponse {
  const requestHeaders = new Headers(req.headers);
  // Exponera den faktiska request-pathen för root-layouten (server component
  // saknar annars tillgång till pathname). Vi sätter ALLTID värdet — och
  // skriver över ev. klient-medskickad x-pathname — så layouten kan avgöra om
  // sidan är en publik, oinloggad yta (t.ex. /m/<slug>) utan att kunna luras.
  requestHeaders.set('x-pathname', req.nextUrl.pathname);
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
  // Bakom Coolify-proxyn rapporterar req.nextUrl.protocol ofta http även vid
  // https → lita på x-forwarded-proto. Saknas signalen antar vi http (säkrare
  // default: hellre utelämna upgrade-insecure-requests än att bryta sidan).
  // Vid kedjade proxies kan headern vara kommaseparerad ("https, http") —
  // första värdet är klientens faktiska protokoll.
  const forwardedProtoRaw =
    req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-protocol');
  const forwardedProto = forwardedProtoRaw
    ? forwardedProtoRaw.split(',')[0]!.trim().toLowerCase()
    : null;
  const isHttps = (forwardedProto ?? req.nextUrl.protocol.replace(':', '')) === 'https';

  // Force-HTTPS (CLAUDE.md § 10.3 A.8.9) — app-nivå-redirect som defense-in-
  // depth ovanpå Coolifys proxy-toggle (infra/SSL.md). Redirecta ENBART när en
  // edge-proxy uttryckligen rapporterat att klienten kom in över http
  // (`x-forwarded-proto: http`). Saknas headern är requesten container-intern
  // (Coolify-healthchecks, PB-hookarnas anrop mot http://moveum-web:3000) och
  // får ALDRIG redirectas — det finns ingen https-lyssnare på docker-nätet.
  // `MOVEXUM_ALLOW_INSECURE_COOKIES=true` stänger av redirecten för en
  // medvetet http-serverad deploy (samma escape-hatch som Secure-cookies och
  // upgrade-insecure-requests). Interna endpoints undantas som extra skydd.
  const allowInsecure = process.env.MOVEXUM_ALLOW_INSECURE_COOKIES === 'true';
  const isInternalPath =
    pathname.startsWith('/api/health') || pathname.startsWith('/api/internal/');
  if (isProd && !allowInsecure && forwardedProto === 'http' && !isInternalPath) {
    const url = req.nextUrl.clone();
    url.protocol = 'https:';
    // Traefik bevarar Host, men respektera x-forwarded-host om proxyn satt den.
    const forwardedHost = req.headers.get('x-forwarded-host');
    if (forwardedHost) url.host = forwardedHost.split(',')[0]!.trim();
    // Explicit port (t.ex. :3000 vid direktaccess via proxy) hör inte hemma
    // på den publika https-URL:en.
    url.port = '';
    // 308 = permanent + bevarar HTTP-metoden (POST förblir POST).
    return NextResponse.redirect(url, 308);
  }

  const csp = buildCsp(nonce, isHttps);

  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/reset-password/') ||
    pathname.startsWith('/_next') ||
    pathname === '/api/auth/login' ||
    pathname.startsWith('/api/health') ||
    // Startupkompassen — publika, oinloggade intag-moduler (quiz/formulär/chatt)
    // och deras anonyma API-flöden.
    pathname === '/m' ||
    pathname.startsWith('/m/') ||
    pathname.startsWith('/api/public/');

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
