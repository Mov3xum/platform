import 'server-only';
import { SEAT_STAGES } from '@platform/shared';
import { resolveRsvp } from '@/lib/events/rsvp';
import { recomputeEventCounters } from '@/lib/events/counters';

export type CheckInResult =
  | { ok: true; already: boolean; name: string; plusOnes: number; diet: string; stage: string; checkedInAt: string }
  | { ok: false; reason: 'lank' | 'fel_event' | 'tenant' | 'spara' };

/**
 * Incheckning vid dörren (CLAUDE.md § 55.11): personalen skannar gästens
 * QR-kod (svarslänkens token) på sin inloggade telefon. Token → deltagarrad
 * via superuser (som svarssidan), men BARA för en rad i personalens egen
 * tenant och för det event sidan tillhör — annars nekas. Idempotent: en
 * redan incheckad gäst rapporteras som sådan. En gäst som inte svarat
 * (eller svarat nej/väntelista) checkas in ändå — hen står ju i dörren.
 * Senare steg (möte, ansökan, antagen) nedgraderas aldrig.
 */
export async function checkInByToken(input: { token: unknown; eventId: string; tenant: string }): Promise<CheckInResult> {
  const resolved = await resolveRsvp(input.token);
  if (!resolved) return { ok: false, reason: 'lank' };
  const { pb, signup, event } = resolved;
  if (signup.tenant !== input.tenant) return { ok: false, reason: 'tenant' };
  if (event.id !== input.eventId) return { ok: false, reason: 'fel_event' };
  const base = { name: signup.name || 'Gäst', plusOnes: signup.plus_ones ?? 0, diet: signup.diet ?? '' };
  if (signup.checked_in_at) {
    return { ok: true, already: true, stage: signup.stage, checkedInAt: signup.checked_in_at, ...base };
  }
  const now = new Date().toISOString();
  const promote = !SEAT_STAGES.includes(signup.stage) || signup.stage === 'signup';
  try {
    await pb.collection('event_signups').update(signup.id, {
      checked_in_at: now,
      ...(promote ? { stage: 'attended' } : {})
    });
  } catch (err) {
    console.error('[checkin] update failed', (err as { status?: number })?.status);
    return { ok: false, reason: 'spara' };
  }
  await recomputeEventCounters(pb, signup.tenant, event.id).catch(() => undefined);
  return { ok: true, already: false, stage: promote ? 'attended' : signup.stage, checkedInAt: now, ...base };
}
