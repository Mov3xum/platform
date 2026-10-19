import { NextResponse } from 'next/server';
import { STUDENT_SESSION_TTL_MS } from '@platform/shared';
import { relativeRedirectInit } from '@/lib/relative-redirect';
import { exchangeStudentToken } from '@/lib/talent/students.server';
import { isStudentTokenShape, signStudentSession, studentSessionSecret } from '@/lib/talent/student-session';
import { clearStudentCookie, setStudentCookie } from '@/lib/talent/session-cookie';
import { gate } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Växlar en magisk länk mot en session (POST från bekräftelsesidan — aldrig
 * GET, så mejlskannrar inte loggar in åt studenten), eller loggar ut
 * (`logout=1`). Cookien är HMAC-signerad; inget lagras server-side.
 */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const back = (path: string, res?: NextResponse) => res ?? new NextResponse(null, relativeRedirectInit(path));
  const base = `/s/${encodeURIComponent(tenant)}`;
  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    form = null;
  }
  if (form?.get('logout') === '1') {
    const res = new NextResponse(null, relativeRedirectInit(base));
    clearStudentCookie(res);
    return res;
  }
  const g = await gate(req, tenant, { key: 'session', max: 20 });
  if (g instanceof NextResponse) return g;
  const token = form?.get('t');
  if (!isStudentTokenShape(token)) return back(`${base}/logga-in?fel=lank`);
  const profile = await exchangeStudentToken(g.resolved, token);
  if (!profile) return back(`${base}/logga-in?fel=lank`);
  const secret = studentSessionSecret();
  const value = signStudentSession(profile.id, secret);
  if (!value) {
    console.error('[talent] session secret missing (MOVEXUM_STUDENT_SESSION_SECRET / MOVEXUM_INTEGRATION_KEY)');
    return back(`${base}/logga-in?fel=konfig`);
  }
  const res = new NextResponse(null, relativeRedirectInit(`${base}/jag?klart=1`));
  setStudentCookie(res, req, value, Math.floor(STUDENT_SESSION_TTL_MS / 1000));
  return res;
}
