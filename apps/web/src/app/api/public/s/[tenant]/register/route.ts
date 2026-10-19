import { NextResponse } from 'next/server';
import { requestOrigin } from '@/lib/request-origin';
import { registerStudent } from '@/lib/talent/students.server';
import { gate, json } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Registrerar en studentprofil och mejlar en bekräftelselänk (CLAUDE.md § 54). */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const g = await gate(req, tenant, { key: 'register', max: 5, windowMs: 10 * 60 * 1000 });
  if (g instanceof NextResponse) return g;
  const body = await json(req);
  if (!body) return NextResponse.json({ error: 'Ogiltig förfrågan.' }, { status: 400 });
  const origin = (await requestOrigin()) || new URL(req.url).origin;
  const res = await registerStudent(g.resolved, body, { origin, consent: body.consent === true });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 400 });
  return NextResponse.json({ ok: true, notice: res.value.notice });
}
