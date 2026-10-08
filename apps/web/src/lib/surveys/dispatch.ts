import 'server-only';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { sendSurveyInvites } from '@/lib/email';
import { collectSurveyRecipients } from '@platform/shared';
import { toSurvey, type Survey } from './store';

// Utskick av enkät till eventets deltagare (CLAUDE.md § 47.5). Delad kärna
// för BÅDE staffs "Skicka nu" och cron-vägen (/api/internal/send-survey).
// Körs med superuser eftersom cron saknar användarsession; därför verifieras
// tenant-likhet mellan enkät och event uttryckligen. Deltagarnas e-post läses
// TRANSIENT (aldrig lagrad på enkäten, aldrig loggad) — bara antal skrivs.

export type DispatchResult =
  | { ok: true; sent: number; failed: number; recipients: number }
  | { ok: false; error: string };

export async function dispatchSurveyInvites(
  surveyId: string,
  opts: { baseUrl?: string; force?: boolean } = {}
): Promise<DispatchResult> {
  const su = await getSuperuserPb();
  if (!su.ok) return { ok: false, error: 'Superuser-credentials saknas — kan inte skicka.' };
  const pb = su.pb;

  let survey: Survey;
  try {
    survey = toSurvey(await pb.collection('surveys').getOne(surveyId));
  } catch {
    return { ok: false, error: 'Enkäten hittades inte.' };
  }
  if (survey.link_kind !== 'event' || !survey.link_id) {
    return { ok: false, error: 'Bara enkäter kopplade till ett event kan skickas till deltagare.' };
  }
  if (!survey.is_active) {
    return { ok: false, error: 'Enkäten är stängd — öppna den innan utskick.' };
  }
  if (survey.sent_at && !opts.force) {
    return { ok: false, error: 'Enkäten är redan utskickad.' };
  }
  // Länkens origin i mejlet: en konfigurerad app-URL vinner alltid — då kan
  // ett manipulerat `send_base_url` aldrig skicka mottagarna till en annan
  // domän (phishing via plattformens avsändare). Utan env används staffs egen
  // request-origin, sparad när utskicket schemalades.
  const configured = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim();
  const baseUrl = (configured || opts.baseUrl || survey.send_base_url || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+$/.test(baseUrl)) {
    return { ok: false, error: 'Ingen giltig adress för enkätlänken (send_base_url saknas).' };
  }

  // Eventet — tenant-likhet är den hårda gränsen (superuser bypassar RLS).
  let eventName = '';
  try {
    const ev = await pb
      .collection('incubator_events')
      .getOne<{ tenant?: string; name?: string }>(survey.link_id, { fields: 'id,tenant,name' });
    if (String(ev.tenant ?? '') !== survey.tenant) {
      return { ok: false, error: 'Eventet tillhör en annan organisation.' };
    }
    eventName = ev.name || '';
  } catch {
    return { ok: false, error: 'Eventet som enkäten följer upp finns inte längre.' };
  }

  let signups: { email?: string }[] = [];
  try {
    signups = await pb.collection('event_signups').getFullList<{ email?: string }>({
      filter: pb.filter('event = {:e} && tenant = {:t}', { e: survey.link_id, t: survey.tenant }),
      fields: 'id,email'
    });
  } catch {
    return { ok: false, error: 'Kunde inte läsa deltagarlistan.' };
  }
  const recipients = collectSurveyRecipients(signups);
  if (recipients.length === 0) {
    // Inget att skicka — men markera så cron inte försöker varje timme.
    await pb.collection('surveys').update(survey.id, { send_at: '', sent_at: new Date().toISOString(), sent_count: 0 }).catch(() => undefined);
    return { ok: true, sent: 0, failed: 0, recipients: 0 };
  }

  const url = `${baseUrl}/u/${encodeURIComponent(survey.public_slug)}?utm_source=event`;
  const { sent, failed } = await sendSurveyInvites(recipients, {
    title: survey.welcome_title || survey.name,
    url,
    eventName,
    intro: survey.welcome_body || undefined
  });

  try {
    await pb.collection('surveys').update(survey.id, {
      send_at: '',
      sent_at: new Date().toISOString(),
      sent_count: (survey.sent_count || 0) + sent
    });
  } catch (err) {
    console.error('[surveys] could not record dispatch', (err as { status?: number })?.status);
  }
  return { ok: true, sent, failed, recipients: recipients.length };
}
