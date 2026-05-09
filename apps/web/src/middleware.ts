import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/', '/login', '/register', '/reset-password', '/verify-email'];
const AUTH_COOKIE = 'pb_auth';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/reset-password/') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/health');

  if (isPublic) {
    return NextResponse.next();
  }

  const token = req.cookies.get(AUTH_COOKIE);
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/).*)']
};
