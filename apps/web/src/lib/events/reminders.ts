import 'server-only';
import type PocketBase from 'pocketbase';
import { normalizeEventRsvpSettings, reminderDue, type ReminderKind } from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { isEmailConfigured } from '@/lib/email';
import { configuredAppUrl } from '@/lib/app-integrations/app-url';
import { createSystemCampaign } from '@/lib/core/write/email-campaigns';
import { dispatchCampaign } from '@/lib/email/campaign-dispatch';

/**
 * Automatiska påminnelser före ett event (CLAUDE.md § 54.11). Körs av
 * PB-ticken `event_reminder_tick` via `/api/internal/event-reminders` en gång
 * i timmen — utan session, därför superuser, och varje event hanteras för
 * sig (fail-soft).
 *
 * Varje påminnelse är en SYSTEMKAMPANJ (§ 54.4) — samma mall, renderare,
 * spärrlista och statistik som ett mänskligt utskick, synlig under
 * Marknadsverktyg → Kampanjer:
 * - **unanswered**: mallen "Påminnelse" till gruppen "inbjudna som inte
 *   svarat" N dagar före (ny svarslänk per mottagare).
 * - **confirmed**: mallen "Vi ses snart" till gruppen "anmälda" N dagar före
 *   — tid, plats, biljett (QR) och kalenderfil.
 *
 * Skickas högst en gång per event och sort (`reminder_*_sent_at`); fönstret
 * stänger när eventet börjar (`reminderDue`). Avregistrerade och spärrade
 * adresser hoppas över av kampanjmotorn. Loggen bär bara antal.
 */

const PAGE = 200;
const MAX_EVENTS_PER_TICK = 25;

interface EventRow {
  id: string;
  tenant: string;
  name?: string;
  starts_at?: string;
  rsvp_settings?: unknown;
  reminder_unanswered_sent_at?: string;
  reminder_confirmed_sent_at?: string;
}

export interface ReminderRunResult {
  ok: boolean;
  events: number;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
}

export async function runEventReminders(now = new Date()): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { ok: true, events: 0, sent: 0, failed: 0, skipped: 0, errors: [] };
  if (!isEmailConfigured()) return { ...result, ok: false, errors: ['E-posttjänsten är inte konfigurerad.'] };
  const baseUrl = configuredAppUrl();
  if (!baseUrl) return { ...result, ok: false, errors: ['APP_URL saknas — påminnelser kan inte länka till svarssidan.'] };
  const su = await getSuperuserPb();
  if (!su.ok) return { ...result, ok: false, errors: ['Superuser saknas.'] };
  const pb = su.pb;

  // Bara kommande event (json-fältet filtreras i JS — PB kan inte filtrera på
  // nycklar i json portabelt). Fönstret är max 30 dagar.
  const horizon = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000).toISOString();
  let events: EventRow[] = [];
  try {
    events = await pb
      .collection('incubator_events')
      .getList<EventRow>(1, PAGE, {
        filter: pb.filter('starts_at >= {:now} && starts_at <= {:horizon} && status != "cancelled"', { now: now.toISOString(), horizon }),
        fields: 'id,tenant,name,starts_at,rsvp_settings,reminder_unanswered_sent_at,reminder_confirmed_sent_at',
        sort: 'starts_at'
      })
      .then((r) => r.items);
  } catch (err) {
    return { ...result, ok: false, errors: [`Kunde inte läsa event (${(err as { status?: number })?.status ?? 'fel'}).`] };
  }

  let handled = 0;
  for (const ev of events) {
    const settings = normalizeEventRsvpSettings(ev.rsvp_settings);
    const dueUnanswered = reminderDue({ settings, kind: 'unanswered', starts_at: ev.starts_at, sentAt: ev.reminder_unanswered_sent_at, now });
    const dueConfirmed = reminderDue({ settings, kind: 'confirmed', starts_at: ev.starts_at, sentAt: ev.reminder_confirmed_sent_at, now });
    if (!dueUnanswered && !dueConfirmed) continue;
    if (handled >= MAX_EVENTS_PER_TICK) break;
    handled += 1;
    result.events += 1;
    for (const kind of ['unanswered', 'confirmed'] as ReminderKind[]) {
      if (kind === 'unanswered' && !dueUnanswered) continue;
      if (kind === 'confirmed' && !dueConfirmed) continue;
      try {
        const r = await sendReminder(pb, ev, kind, baseUrl);
        result.sent += r.sent;
        result.failed += r.failed;
        result.skipped += r.skipped;
      } catch (err) {
        result.errors.push(`${kind}: ${err instanceof Error ? err.message : 'okänt fel'}`);
      }
    }
  }
  return result;
}

async function sendReminder(pb: PocketBase, ev: EventRow, kind: ReminderKind, baseUrl: string): Promise<{ sent: number; failed: number; skipped: number }> {
  const field = kind === 'unanswered' ? 'reminder_unanswered_sent_at' : 'reminder_confirmed_sent_at';
  // Markera FÖRST (provisoriskt) så två tickar aldrig skickar dubbelt; ett
  // misslyckat utskick återställer stämpeln.
  await pb.collection('incubator_events').update(ev.id, { [field]: new Date().toISOString() });
  const revert = () => pb.collection('incubator_events').update(ev.id, { [field]: '' }).catch(() => undefined);

  const created = await createSystemCampaign(pb, {
    tenant: ev.tenant,
    templateKey: kind === 'unanswered' ? 'reminder' : 'confirmed_reminder',
    eventId: ev.id,
    eventGroup: kind === 'unanswered' ? 'unanswered' : 'confirmed',
    title: `${kind === 'unanswered' ? 'Påminnelse' : 'Vi ses snart'}: ${ev.name || 'Event'}`.slice(0, 120)
  });
  if (!created.ok) {
    await revert();
    throw new Error(created.error);
  }
  const res = await dispatchCampaign(created.value.id, { baseUrl });
  if (!res.ok) {
    // "Inga mottagare" är inget fel för en påminnelse — gruppen var tom, klart.
    if (/inga mottagare/i.test(res.error)) {
      await pb.collection('email_campaigns').update(created.value.id, { status: 'cancelled', last_error: 'Ingen i mottagargruppen.' }).catch(() => undefined);
      return { sent: 0, failed: 0, skipped: 0 };
    }
    await revert();
    throw new Error(res.error);
  }
  console.log('[event-reminders] sent', { kind, sent: res.sent, failed: res.failed, suppressed: res.suppressed });
  return { sent: res.sent, failed: res.failed, skipped: res.suppressed };
}
