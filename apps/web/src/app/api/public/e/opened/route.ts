import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { resolveRsvp } from '@/lib/events/rsvp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;

/**
 * Noterar att mottagaren öppnat sin personliga svarslänk (CLAUDE.md § 53.5).
 * Anropas med POST av `/e/svar` i webbläsaren — inte vid GET, så att
 * mejlskannrar som förhandsläser länken inte räknas som öppningar. Sätter
 * bara `invite_opened_at` första gången; tenant härleds ur raden. Ingen IP
 * eller user agent lagras (IP används bara transient för rate-limiten).
 * Svarar alltid 204 — sidan ska aldrig påverkas av utfallet.
 */
export async function POST(req: Request) {
  const done = new NextResponse(null, { status: 204 });
  const rlKey = `event-opened:${clientIpFromRequest(req)}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) return done;
  await recordFailure(rlKey, WINDOW_MS);

  let token: unknown = null;
  try {
    token = (await req.formData()).get('t');
  } catch {
    return done;
  }
  const resolved = await resolveRsvp(token);
  if (!resolved || resolved.signup.invite_opened_at) return done;
  try {
    await resolved.pb
      .collection('event_signups')
      .update(resolved.signup.id, { invite_opened_at: new Date().toISOString() });
  } catch (err) {
    console.error('[invite-opened] update failed', (err as { status?: number })?.status);
  }
  return done;
}
