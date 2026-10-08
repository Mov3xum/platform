import { NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/auth.server';
import { relativeRedirectInit } from '@/lib/relative-redirect';

/**
 * Utloggning — route handler, inte server action.
 *
 * Utloggningen var tidigare en server action (`logoutAction`) som anropades
 * från kontomenyn i railen. Railen ligger i root-layouten, UTANFÖR sidans
 * `error.tsx`-gräns, så varje fel i action-rundturen (en gammal flik mot en
 * ny deploy → "Failed to find Server Action", ett icke-RSC-svar från proxyn,
 * ett fel i redirect-strömningen) slog ut hela sidan i den globala felvyn
 * "Något gick fel" — och användaren förblev inloggad.
 *
 * Nu är utloggningen en vanlig HTML-formulär-POST hit (samma mönster som
 * inloggningen via `/api/auth/login`): cookien rensas server-side och svaret
 * är en 303 → `/login`, dvs. en hård navigering så att root-layouten läser om
 * cookien. Fungerar utan JS, oberoende av deploy-versionen i fliken, och kan
 * inte hamna i en React-felgräns. Endast POST (ingen GET → ingen logout-CSRF
 * via <img>-taggar); CSP `form-action 'self'` täcker formuläret.
 *
 * `Location` är RELATIV (`/login`), aldrig byggd ur `req.nextUrl` — i
 * standalone-containern är den adressen bind-hosten `http://0.0.0.0:3000`
 * (Next bygger `nextUrl` ur HOSTNAME/PORT, inte ur proxyns Host-header), så
 * redirecten pekade utanför appen och blockerades av `form-action 'self'`:
 * klicket på "Logga ut" gjorde ingenting (incident 2026-09-30). Se
 * `lib/relative-redirect.ts`.
 */
export async function POST(req: Request): Promise<NextResponse> {
  // Logout-CSRF: en auto-postande form på en annan sajt kunde logga ut
  // användaren (cookien behövs inte för att RENSA den, så SameSite skyddar
  // inte). Webbläsare skickar Sec-Fetch-Site; avvisa uttryckligen cross-site.
  if (req.headers.get('sec-fetch-site') === 'cross-site') {
    return new NextResponse(null, { status: 403 });
  }
  // 303 = "See Other": browsern följer med GET oavsett att requesten var POST.
  const res = new NextResponse(null, relativeRedirectInit('/login', 303));
  // Samma path som vid inloggningen ('/'), annars matchar browsern inte cookien.
  res.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    expires: new Date(0)
  });
  return res;
}
