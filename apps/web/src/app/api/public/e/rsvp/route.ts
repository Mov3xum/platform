import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { resolveRsvp } from '@/lib/events/rsvp';
import { recomputeEventCounters } from '@/lib/events/counters';
import { requestOrigin } from '@/lib/request-origin';
import { isInviteStage, isRsvpAnswer, rsvpOpen, stageForRsvp } from '@platform/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;

/**
 * Tar emot svaret på en inbjudan (CLAUDE.md § 53.5) från den publika
 * bekräftelsesidan `/e/svar`. POST (aldrig GET) så att mejlskannrar som
 * förhandsläser länkar inte svarar åt någon. Token → hash → deltagarrad;
 * tenant härleds ur raden. Ja/nej ändrar bara en rad som fortfarande är
 * inbjuden/anmäld/avböjd — en närvarande eller antagen nedgraderas aldrig.
 * Avregistrering sätter `contacts.invite_opt_out`. IP används bara
 * transient för rate-limiten.
 */
export async function POST(req: Request) {
  const rlKey = `event-rsvp:${clientIpFromRequest(req)}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar. Försök igen om en stund.' }, { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Ogiltig förfrågan.' }, { status: 400 });
  }
  const token = form.get('t');
  const answer = form.get('svar');
  // Bakom proxyn är req.url containerns interna adress — gå tillbaka via den
  // publika originen (konfigurerad app-URL eller proxy-headers).
  const origin = (await requestOrigin()) || new URL(req.url).origin;
  const back = (qs: string) => NextResponse.redirect(new URL(`/e/svar?${qs}`, origin), 303);
  if (!isRsvpAnswer(answer)) return back('fel=svar');

  const resolved = await resolveRsvp(token);
  if (!resolved) return back('fel=lank');
  const { pb, signup, event } = resolved;
  if (!rsvpOpen(event, new Date(), answer)) return back('fel=stangd');

  const now = new Date().toISOString();
  try {
    if (isInviteStage(signup.stage) || signup.stage === 'signup') {
      await pb.collection('event_signups').update(signup.id, { stage: stageForRsvp(answer), responded_at: now });
    }
    if (answer === 'unsubscribe' && signup.contact) {
      const contact = await pb.collection('contacts').getOne<{ id: string; tenant?: string }>(signup.contact, { fields: 'id,tenant' });
      if (contact.tenant === signup.tenant) {
        await pb.collection('contacts').update(contact.id, { invite_opt_out: true, invite_opt_out_at: now });
      }
    }
  } catch (err) {
    console.error('[rsvp] update failed', (err as { status?: number })?.status);
    return back('fel=spara');
  }
  await recomputeEventCounters(pb, signup.tenant, event.id);
  return back(`klart=${answer}`);
}
