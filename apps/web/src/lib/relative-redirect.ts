/**
 * Redirect från en route handler till en sida i SAMMA app — med relativ
 * `Location`, aldrig en absolut URL byggd ur requesten.
 *
 * Bakgrund (incident 2026-09-30, "Logga ut gör ingenting"): utloggnings-
 * routen svarade `303` med `Location` byggd ur `req.nextUrl.clone()`. I
 * standalone-containern (Dockerfile: `HOSTNAME=0.0.0.0`, `PORT=3000`) bygger
 * Next `nextUrl`/`request.url` ur bind-adressen — INTE ur proxyns Host-header
 * — så redirecten pekade på `http://0.0.0.0:3000/login`. Webbläsaren kan inte
 * nå den adressen, och CSP:ns `form-action 'self'` blockerar dessutom
 * formulärets redirect till en annan origin → klicket "gjorde ingenting".
 * Samma fel fanns i OAuth-callbackarna (`new URL(path, request.url)`).
 *
 * En relativ `Location` (RFC 9110 § 10.2.2) löses av webbläsaren mot den
 * origin som requesten faktiskt gick till — rätt oavsett proxy, port eller
 * protokoll, och alltid `'self'` för CSP. Ren modul (ingen Next-import) så
 * den kan enhetstestas; routarna gör `new NextResponse(null, init)`.
 */

export const DEFAULT_REDIRECT_STATUS = 303;

/**
 * Tillåter bara en sökväg inom appen: börjar med exakt ett `/` (inte `//`
 * eller `/\`, som webbläsare tolkar som protokollrelativ extern adress) och
 * innehåller inget schema. Allt annat avvisas — en redirect får aldrig kunna
 * styras ut från appen (open redirect).
 */
export function assertAppPath(path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) {
    throw new Error(`Redirect-mål måste vara en sökväg inom appen, fick "${String(path)}".`);
  }
  // Kontrolltecken och backslash: WHATWG-URL-parsern STRIPPAR tab/radbrytning
  // ("/\t/evil.example" → "//evil.example") och tolkar "\" som "/", så en
  // prefixkontroll räcker inte (tab-bypass, 2026-09-30).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(path)) {
    throw new Error('Redirect-mål får inte innehålla kontrolltecken eller backslash.');
  }
  // Sista ordet: parsa som webbläsaren gör och kräv att origin är oförändrad.
  const parsed = new URL(path, 'http://app.invalid');
  if (parsed.origin !== 'http://app.invalid' || !parsed.pathname.startsWith('/')) {
    throw new Error('Redirect-mål lämnar appen.');
  }
  return path;
}

/**
 * `ResponseInit` för `new NextResponse(null, init)` / `new Response(null, init)`:
 * status 303 (POST → GET-navigering) som default, relativ `Location`,
 * `Cache-Control: no-store` så ingen mellanliggande cache sparar en redirect
 * som hör till en session.
 */
export function relativeRedirectInit(
  path: string,
  status: 302 | 303 | 307 | 308 = DEFAULT_REDIRECT_STATUS
): { status: number; headers: Record<string, string> } {
  return {
    status,
    headers: {
      Location: assertAppPath(path),
      'Cache-Control': 'no-store'
    }
  };
}

/**
 * Icke-kastande variant för värden som kommer från klienten (t.ex.
 * `/login?next=…`): en giltig app-sökväg returneras som den är, allt annat
 * blir `fallback` (öppen-redirect-skydd).
 */
export function sanitizeAppPath(path: unknown, fallback: string): string {
  if (typeof path !== 'string') return fallback;
  try {
    return assertAppPath(path);
  } catch {
    return fallback;
  }
}
