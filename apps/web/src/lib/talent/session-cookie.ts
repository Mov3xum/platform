import 'server-only';
import type { NextResponse } from 'next/server';
import { STUDENT_SESSION_COOKIE } from './student-session';

function isHttps(req: Request): boolean {
  if (process.env.MOVEXUM_ALLOW_INSECURE_COOKIES === 'true') return false;
  const raw = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
  return raw.split(',')[0]!.trim().toLowerCase() === 'https';
}

/** Sätter studentens sessionscookie (httpOnly, SameSite=Lax, Secure över https — § 10.3). */
export function setStudentCookie(res: NextResponse, req: Request, value: string, maxAgeSec: number): void {
  res.cookies.set(STUDENT_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(req),
    path: '/',
    maxAge: maxAgeSec
  });
}

export function clearStudentCookie(res: NextResponse): void {
  res.cookies.set(STUDENT_SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0, expires: new Date(0) });
}
