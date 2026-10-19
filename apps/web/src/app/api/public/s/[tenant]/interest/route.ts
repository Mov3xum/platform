import { NextResponse } from 'next/server';
import { applyToNeed, respondToInterest } from '@/lib/talent/students.server';
import { gate, json } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Studenten söker ett behov (`needId` + `message`) eller svarar på ett intresse (`interestId` + `answer`). */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const g = await gate(req, tenant, { key: 'interest', max: 30, requireSession: true });
  if (g instanceof NextResponse) return g;
  const body = await json(req);
  if (!body) return NextResponse.json({ error: 'Ogiltig förfrågan.' }, { status: 400 });
  const student = g.student!;
  if (typeof body.needId === 'string') {
    const res = await applyToNeed(g.resolved, student, body.needId, body.message);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 400 });
    return NextResponse.json({ ok: true, status: res.value.status });
  }
  if (typeof body.interestId === 'string' && (body.answer === 'accept' || body.answer === 'decline' || body.answer === 'withdraw')) {
    const res = await respondToInterest(g.resolved, student, body.interestId, body.answer);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 400 });
    return NextResponse.json({ ok: true, status: res.value.status });
  }
  return NextResponse.json({ error: 'Ogiltig förfrågan.' }, { status: 400 });
}
