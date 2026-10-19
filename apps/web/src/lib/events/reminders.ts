import 'server-only';
import type PocketBase from 'pocketbase';
import {
  SEAT_STAGES,
  formatStockholmDateTime,
  inviteReason,
  normalizeEmailDesign,
  normalizeEventRsvpSettings,
  reminderDue,
  renderCampaignEmail,
  type EventRsvpSettings,
  type ReminderKind
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { isEmailConfigured, sendEventInvites, type EventInviteRecipient } from '@/lib/email';
import { listUnsubscribeHeaders, resolveReplyTo, resolveSender } from '@/lib/mail-sender';
import { configuredAppUrl } from '@/lib/app-integrations/app-url';
import { hashRsvpToken, newRsvpToken } from '@/lib/core/write/event-invitations';
import { loadContactsByIds } from '@/lib/events/invite-candidates';
import { recomputeEventCounters } from '@/lib/events/counters';
import { signUnsubscribeKey, unsubscribeSecret } from '@/lib/unsubscribe-key';
import { sendEmailBatch, type OutgoingEmail } from '@/lib/email/send-batch';
import { emailLinkSecret, signCalendarKey } from '@/lib/email/signed-tokens';
import { isSuppressed } from '@/lib/email/suppression';

/**
 * Automatiska påminnelser före ett event (CLAUDE.md § 54.11, Confetti-
 * funktionen "reminders"). Körs av PB-ticken `event_reminder_tick` via
 * `/api/internal/event-reminders` en gång i timmen — utan session, därför
 * superuser, och varje event hanteras för sig (fail-soft).
 *
 * Två påminnelser per event, båda opt-in i eventformuläret:
 * - **unanswered**: till inbjudna som inte svarat (`stage = invited`) N dagar
 *   före — samma inbjudningsmejl som "Skicka igen", med ny svarslänk.
 * - **confirmed**: till dem som tackat ja N dagar före — "Vi ses snart" med
 *   tid, plats, kalenderfil och länk till biljetten (ny token roteras så
 *   länken i påminnelsen är den som gäller).
 *
 * Skickas högst en gång per event och sort (`reminder_*_sent_at`); fönstret
 * stänger när eventet börjar (`reminderDue`). Avregistrerade och spärrade
 * adresser hoppas alltid över. Loggen bär bara antal.
 */

const PAGE = 200;
const MAX_EVENTS_PER_TICK = 25;

interface EventRow {
  id: string;
  tenant: string;
  name?: string;
  starts_at?: string;
  ends_at?: string;
  location?: string;
  description?: string;
  rsvp_settings?: unknown;
  reminder_unanswered_sent_at?: string;
  reminder_confirmed_sent_at?: string;
}

interface SignupRow {
  id: string;
  tenant: string;
  stage?: string;
  email?: string;
  contact?: string;
  user?: string;
  startup?: string;
  name?: string;
  plus_ones?: number;
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

  // Bara kommande event med påminnelser påslagna (json-fältet filtreras i JS —
  // PB kan inte filtrera på nycklar i json portabelt). Fönstret är max 30 dagar.
  const horizon = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000).toISOString();
  let events: EventRow[] = [];
  try {
    events = await pb.collection('incubator_events').getList<EventRow>(1, PAGE, {
      filter: pb.filter('starts_at >= {:now} && starts_at <= {:horizon} && status != "cancelled"', { now: now.toISOString(), horizon }),
      fields: 'id,tenant,name,starts_at,ends_at,location,description,rsvp_settings,reminder_unanswered_sent_at,reminder_confirmed_sent_at',
      sort: 'starts_at'
    }).then((r) => r.items);
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
        const r = await sendReminder(pb, ev, settings, kind, baseUrl);
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

async function loadRows(pb: PocketBase, ev: EventRow, stages: readonly string[]): Promise<SignupRow[]> {
  const rows = await pb.collection('event_signups').getFullList<SignupRow>({
    filter: pb.filter('tenant = {:t} && event = {:e}', { t: ev.tenant, e: ev.id }),
    fields: 'id,tenant,stage,email,contact,user,startup,name,plus_ones'
  });
  return rows.filter((r) => stages.includes(r.stage ?? '') && r.email);
}

/** Avregistrerade kontakter och spärrade adresser får aldrig en påminnelse. */
async function filterReachable(pb: PocketBase, tenant: string, rows: SignupRow[]): Promise<{ rows: SignupRow[]; skipped: number }> {
  const contactIds = [...new Set(rows.map((r) => r.contact).filter((v): v is string => Boolean(v)))];
  let optedOut = new Set<string>();
  if (contactIds.length > 0) {
    const contacts = await loadContactsByIds(pb, tenant, contactIds);
    optedOut = new Set(contacts.filter((c) => c.invite_opt_out === true).map((c) => c.id));
  }
  const out: SignupRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (r.contact && optedOut.has(r.contact)) {
      skipped += 1;
      continue;
    }
    if (await isSuppressed(pb, tenant, r.email!).catch(() => false)) {
      skipped += 1;
      continue;
    }
    out.push(r);
  }
  return { rows: out, skipped };
}

async function rotateToken(pb: PocketBase, rowId: string): Promise<string | null> {
  const token = newRsvpToken();
  try {
    await pb.collection('event_signups').update(rowId, { rsvp_token_hash: hashRsvpToken(token) });
    return token;
  } catch {
    return null;
  }
}

async function sendReminder(
  pb: PocketBase,
  ev: EventRow,
  settings: EventRsvpSettings,
  kind: ReminderKind,
  baseUrl: string
): Promise<{ sent: number; failed: number; skipped: number }> {
  const field = kind === 'unanswered' ? 'reminder_unanswered_sent_at' : 'reminder_confirmed_sent_at';
  // Markera FÖRST (provisoriskt) så två tickar aldrig skickar dubbelt; ett
  // misslyckat utskick återställer stämpeln.
  const stampedAt = new Date().toISOString();
  await pb.collection('incubator_events').update(ev.id, { [field]: stampedAt });
  const revert = () => pb.collection('incubator_events').update(ev.id, { [field]: '' }).catch(() => undefined);

  const all = await loadRows(pb, ev, kind === 'unanswered' ? ['invited'] : SEAT_STAGES);
  const { rows, skipped } = await filterReachable(pb, ev.tenant, all);
  if (rows.length === 0) return { sent: 0, failed: 0, skipped };

  const secret = unsubscribeSecret();
  const when = ev.starts_at ? formatStockholmDateTime(ev.starts_at) || 'Tid meddelas' : 'Tid meddelas';
  let sentIds: string[] = [];
  let failed = 0;

  if (kind === 'unanswered') {
    const recipients: EventInviteRecipient[] = [];
    for (const r of rows) {
      const token = await rotateToken(pb, r.id);
      if (!token) continue;
      const key = r.contact ? signUnsubscribeKey(r.contact, secret) : null;
      recipients.push({
        key: r.id,
        email: r.email!,
        rsvpUrl: `${baseUrl}/e/svar?t=${token}`,
        reason: inviteReason(r),
        unsubscribeUrl: key ? `${baseUrl}/e/avregistrera?k=${key}` : null,
        oneClickUrl: key ? `${baseUrl}/api/public/e/unsubscribe?k=${key}` : null
      });
    }
    try {
      const res = await sendEventInvites(recipients, {
        eventName: ev.name || 'Event',
        when,
        location: ev.location || undefined,
        intro: ev.description ? ev.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600) : undefined,
        reminder: true
      });
      sentIds = res.sent;
      failed = res.failed;
    } catch (err) {
      await revert();
      throw err;
    }
  } else {
    const from = resolveSender(process.env, 'invite');
    const replyTo = resolveReplyTo(process.env);
    const calendarKey = signCalendarKey(ev.id, emailLinkSecret());
    const messages: OutgoingEmail[] = [];
    for (const r of rows) {
      const token = await rotateToken(pb, r.id);
      if (!token) continue;
      const key = r.contact ? signUnsubscribeKey(r.contact, secret) : null;
      const ticketUrl = `${baseUrl}/e/svar?t=${token}&klart=yes`;
      const calendarUrl = calendarKey ? `${baseUrl}/api/public/e/kalender?e=${calendarKey}` : `${baseUrl}/api/public/e/kalender?t=${token}`;
      const first = (r.name || '').trim().split(/\s+/)[0] || '';
      const rendered = renderCampaignEmail({
        subject: `Vi ses snart: ${ev.name || 'Event'}`,
        preheader: `${when}${ev.location ? ` · ${ev.location}` : ''}`,
        blocks: [
          { id: 'h', type: 'heading', text: `Vi ses snart${first ? `, {{förnamn}}` : ''}!` },
          {
            id: 'p',
            type: 'paragraph',
            text: `En påminnelse om att du är anmäld till **${ev.name || 'eventet'}**${
              r.plus_ones ? ` tillsammans med ${r.plus_ones} medföljande` : ''
            }. Här är allt du behöver.`
          },
          { id: 'e', type: 'event_details' },
          { id: 'b', type: 'button', label: 'Visa din biljett', url: ticketUrl, style: 'primary' },
          { id: 'c', type: 'button', label: 'Lägg i kalendern', url: calendarUrl, style: 'secondary' },
          { id: 'q', type: 'paragraph', text: 'Kan du inte komma ändå? Ändra ditt svar via biljettlänken så kan platsen gå till någon annan.' }
        ],
        design: normalizeEmailDesign({ accent: 'morkbla', layout: 'card' }),
        merge: {
          first_name: first,
          name: r.name || '',
          event_name: ev.name || '',
          event_when: when,
          event_location: ev.location || ''
        },
        links: {
          unsubscribe: key ? `${baseUrl}/e/avregistrera?k=${key}` : null,
          preferences: key ? `${baseUrl}/e/installningar?k=${key}` : null,
          calendar: calendarUrl
        },
        reasonText:
          inviteReason(r) === 'contact'
            ? 'Du får påminnelsen eftersom du tackat ja till eventet.'
            : 'Du får påminnelsen eftersom du tackat ja till eventet som del av Movexums program.',
        orgName: 'Movexum'
      });
      messages.push({
        key: r.id,
        from,
        to: r.email!,
        subject: `Vi ses snart: ${ev.name || 'Event'} — ${when}`,
        html: rendered.html,
        text: rendered.text,
        reply_to: replyTo,
        headers: key ? listUnsubscribeHeaders(`${baseUrl}/api/public/e/unsubscribe?k=${key}`) : {},
        tags: [
          { name: 'category', value: 'event_reminder' },
          { name: 'tenant', value: ev.tenant }
        ]
      });
    }
    try {
      const outcomes = await sendEmailBatch(messages);
      sentIds = outcomes.filter((o) => !o.error).map((o) => o.key);
      failed = outcomes.length - sentIds.length;
    } catch (err) {
      await revert();
      throw err;
    }
  }

  if (sentIds.length === 0 && failed > 0) await revert();
  await recomputeEventCounters(pb, ev.tenant, ev.id).catch(() => undefined);
  console.log('[event-reminders] sent', { kind, sent: sentIds.length, failed, skipped });
  return { sent: sentIds.length, failed, skipped };
}
