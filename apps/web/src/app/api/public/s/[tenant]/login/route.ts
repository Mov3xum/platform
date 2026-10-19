import { NextResponse } from 'next/server';
import { requestOrigin } from '@/lib/request-origin';
import { requestStudentLink } from '@/lib/talent/students.server';
import { gate, json } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mejlar en ny inloggningslänk. Svaret avslöjar aldrig om adressen finns. */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const g = await gate(req, tenant, { key: 'login', max: 8, windowMs: 10 * 60 * 1000 });
  if (g instanceof NextResponse) return g;
  const body = await json(req);
  const origin = (await requestOrigin()) || new URL(req.url).origin;
  const res = await requestStudentLink(g.resolved, body?.email, origin);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 400 });
  return NextResponse.json({ ok: true, notice: res.value.notice });
}
