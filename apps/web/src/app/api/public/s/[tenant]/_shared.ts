import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { resolveTalentTenant, loadStudentSession, type ResolvedTalentTenant } from '@/lib/talent/public';
import type { StudentProfileRow } from '@/lib/talent/data';

/**
 * Gemensamt för studentsidans publika routes (CLAUDE.md § 54): rate-limit
 * per IP (transient — IP:n lagras aldrig), tenant ur sluggen (superuser,
 * tenant-scope i koden) och studenten ur sessionscookien.
 */
export const runtime = 'nodejs';

export async function gate(
  req: Request,
  tenantSlug: string,
  opts: { key: string; max: number; windowMs?: number; requireSession?: boolean }
): Promise<{ resolved: ResolvedTalentTenant; student: StudentProfileRow | null } | NextResponse> {
  const rlKey = `talent:${opts.key}:${clientIpFromRequest(req)}`;
  if ((await checkRateLimit(rlKey, opts.max)).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar. Försök igen om en stund.' }, { status: 429 });
  }
  await recordFailure(rlKey, opts.windowMs ?? 60 * 1000);
  const resolved = await resolveTalentTenant(tenantSlug);
  if (!resolved) return NextResponse.json({ error: 'Sidan finns inte.' }, { status: 404 });
  const student = await loadStudentSession(resolved);
  if (opts.requireSession && !student) {
    return NextResponse.json({ error: 'Du är inte inloggad — be om en ny inloggningslänk.' }, { status: 401 });
  }
  return { resolved, student };
}

export async function json(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
