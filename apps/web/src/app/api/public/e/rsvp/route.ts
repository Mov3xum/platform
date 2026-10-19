import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { loadSeatsTaken, resolveRsvp } from '@/lib/events/rsvp';
import { recomputeEventCounters } from '@/lib/events/counters';
import { requestOrigin } from '@/lib/request-origin';
import {
  SEAT_STAGES,
  eventHasRoom,
  isInviteStage,
  isRsvpAnswer,
  parseRsvpAnswers,
  rsvpOpen,
  stageForRsvp
} from '@platform/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;

/**
 * Tar emot svaret på en inbjudan (CLAUDE.md § 53.5, § 54.11) från den
 * publika bekräftelsesidan `/e/svar`. POST (aldrig GET) så att mejlskannrar
 * som förhandsläser länkar inte svarar åt någon. Token → hash → deltagarrad;
 * tenant härleds ur raden. Ja/nej ändrar bara en rad som fortfarande är
 * inbjuden/anmäld/avböjd/på väntelista — en närvarande eller antagen
 * nedgraderas aldrig. Gästfrågorna (medföljande, kost, egen fråga) sparas
 * bara om eventet ställer dem; är det fullt hamnar svaret på väntelistan.
 * Avregistrering sätter `contacts.invite_opt_out`. IP används bara transient.
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
  const { pb, signup, event, settings } = resolved;
  if (!rsvpOpen(event, new Date(), answer)) return back('fel=stangd');
  const tokenQs = `t=${encodeURIComponent(String(token))}`;

  const now = new Date().toISOString();
  const answers = parseRsvpAnswers(settings, Object.fromEntries(form.entries()));
  try {
    const changeable = isInviteStage(signup.stage) || signup.stage === 'signup';
    if (changeable) {
      let stage = stageForRsvp(answer);
      let waitlisted = false;
      if (answer === 'yes' && settings.capacity > 0) {
        const taken = await loadSeatsTaken(pb, signup.tenant, event.id);
        const holding = SEAT_STAGES.includes(signup.stage) ? 1 + (signup.plus_ones ?? 0) : 0;
        if (!eventHasRoom(settings, taken, 1 + answers.plus_ones, holding)) {
          if (!settings.waitlist) return back(`${tokenQs}&fel=fullt`);
          stage = 'waitlist' as typeof stage;
          waitlisted = true;
        }
      }
      // Ett svar kräver att länken öppnats — även utan JS (§ 53.5).
      await pb.collection('event_signups').update(signup.id, {
        stage,
        responded_at: now,
        plus_ones: answer === 'yes' ? answers.plus_ones : 0,
        diet: answer === 'yes' ? answers.diet : '',
        custom_answer: answer === 'yes' ? answers.custom_answer : '',
        ...(signup.invite_opened_at ? {} : { invite_opened_at: now })
      });
      if (waitlisted) {
        await recomputeEventCounters(pb, signup.tenant, event.id);
        return back(`${tokenQs}&klart=waitlist`);
      }
    }
    if (answer === 'unsubscribe' && signup.contact) {
      const contact = await pb.collection('contacts').getOne<{ id: string; tenant?: string }>(signup.contact, { fields: 'id,tenant' });
      if (contact.tenant === signup.tenant) {
        await pb.collection('contacts').update(contact.id, { invite_opt_out: true, invite_opt_out_at: now });
      }
    }
  } catch (err) {
    console.error('[rsvp] update failed', (err as { status?: number })?.status);
    return back(`${tokenQs}&fel=spara`);
  }
  await recomputeEventCounters(pb, signup.tenant, event.id);
  // Ja-svaret behåller token i adressen så sidan kan visa biljett + kalender.
  return back(answer === 'yes' ? `${tokenQs}&klart=yes` : `klart=${answer}`);
}
