import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { resolveSparkTenant, submitPublicSparkInterview } from '@/lib/spark/public.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tar emot ett företags egen anmälan till SPARK (CLAUDE.md § 61). Publik:
 * rate-limit per IP (transient, IP:n lagras aldrig), tenant ur sluggen,
 * samtycke krävs. Svaren valideras med samma regler som formuläret.
 */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const key = `spark:submit:${clientIpFromRequest(req)}`;
  if ((await checkRateLimit(key, 8)).blocked) {
    return NextResponse.json({ error: 'För många försök. Vänta en stund och försök igen.' }, { status: 429 });
  }
  await recordFailure(key, 10 * 60 * 1000);
  const tenant = await resolveSparkTenant(slug);
  if (!tenant) return NextResponse.json({ error: 'Sidan finns inte.' }, { status: 404 });
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = (await req.json()) as unknown;
    body = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body) return NextResponse.json({ error: 'Ogiltig förfrågan.' }, { status: 400 });
  const res = await submitPublicSparkInterview(tenant, { answers: body.answers, consent: body.consent, via: body.via });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true });
}
