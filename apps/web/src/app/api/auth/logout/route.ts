import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE } from '@/lib/auth.server';

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
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';

  // 303 = "See Other": browsern följer med GET oavsett att requesten var POST.
  const res = NextResponse.redirect(url, 303);
  // Samma path som vid inloggningen ('/'), annars matchar browsern inte cookien.
  res.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    expires: new Date(0)
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
