import { NextResponse } from 'next/server';
import { deleteOwnStudentProfile, setStudentSelfStatus, updateStudentProfile } from '@/lib/talent/students.server';
import { clearStudentCookie } from '@/lib/talent/session-cookie';
import { gate, json } from '../_shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Studentens egen profil: uppdatera, pausa/aktivera, förläng samtycket, ta bort (art. 17). */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const g = await gate(req, tenant, { key: 'profile', max: 30, requireSession: true });
  if (g instanceof NextResponse) return g;
  const body = await json(req);
  if (!body) return NextResponse.json({ error: 'Ogiltig förfrågan.' }, { status: 400 });
  const student = g.student!;
  switch (body.action) {
    case 'update': {
      const res = await updateStudentProfile(g.resolved, student, typeof body.profile === 'object' && body.profile ? (body.profile as Record<string, unknown>) : {});
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 400 });
      return NextResponse.json({ ok: true });
    }
    case 'pause':
    case 'resume':
    case 'extend': {
      const res = await setStudentSelfStatus(g.resolved, student, body.action);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 400 });
      return NextResponse.json({ ok: true });
    }
    case 'delete': {
      const res = await deleteOwnStudentProfile(g.resolved, student);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status ?? 400 });
      const out = NextResponse.json({ ok: true });
      clearStudentCookie(out);
      return out;
    }
    default:
      return NextResponse.json({ error: 'Okänd åtgärd.' }, { status: 400 });
  }
}
