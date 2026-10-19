import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { resolveRsvp } from '@/lib/events/rsvp';
import { emailLinkSecret, verifyCalendarKey } from '@/lib/email/signed-tokens';
import { configuredAppUrl } from '@/lib/app-integrations/app-url';
import { resolveSender, senderAddress } from '@/lib/mail-sender';
import { buildIcs, icsFilename } from '@platform/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 60;

/**
 * Kalenderfil (.ics) för ett event (CLAUDE.md § 54.11) — "Lägg i kalendern"
 * i inbjudan och på svarssidan. Nås med svarslänkens token (`t`) eller den
 * signerade eventnyckeln ur mejlet (`e`); utan giltig nyckel 404. Innehåller
 * bara eventets namn, tid, plats och beskrivning — inga personuppgifter.
 */
export async function GET(req: Request) {
  const rlKey = `event-ics:${clientIpFromRequest(req)}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar.' }, { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);

  const url = new URL(req.url);
  let event: { id: string; name?: string; starts_at?: string; ends_at?: string; location?: string; description?: string } | null = null;
  const token = url.searchParams.get('t');
  if (token) {
    const resolved = await resolveRsvp(token);
    if (resolved) event = resolved.event;
  } else {
    const eventId = verifyCalendarKey(url.searchParams.get('e'), emailLinkSecret());
    const su = eventId ? await getSuperuserPb() : null;
    if (eventId && su?.ok) {
      try {
        event = await su.pb.collection('incubator_events').getOne(eventId, { fields: 'id,name,starts_at,ends_at,location,description' });
      } catch {
        event = null;
      }
    }
  }
  if (!event || !event.starts_at) return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });

  const app = configuredAppUrl() || url.origin;
  const ics = buildIcs({
    uid: `${event.id}@movexum`,
    title: event.name || 'Event',
    description: (event.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    location: event.location || '',
    starts_at: event.starts_at,
    ends_at: event.ends_at ?? null,
    url: token ? `${app}/e/svar?t=${encodeURIComponent(token)}` : undefined,
    organizerName: 'Movexum',
    organizerEmail: senderAddress(resolveSender(process.env, 'invite'))
  });
  if (!ics) return NextResponse.json({ error: 'Eventet saknar giltig tid.' }, { status: 404 });
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${icsFilename(event.name || 'event')}"`,
      'Cache-Control': 'private, no-store'
    }
  });
}
