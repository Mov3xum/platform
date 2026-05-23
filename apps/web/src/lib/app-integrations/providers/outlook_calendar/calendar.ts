import 'server-only';
import type { OAuthTokens } from '../../types';

/**
 * Microsoft Graph-klient för kalenderhändelser. Read-only, scope
 * `Calendars.Read` (täcker redan attendees — inget nytt scope behövs).
 *
 * CLAUDE.md § 10.2 / § 14: vi loggar/lagrar aldrig event-bodyn eller
 * deltagar-listor i klartext. Deltagar-/organisatörs-e-post LÄSES dock
 * transient (i minnet, per request) för att matcha möten mot redan
 * samtyckta `contacts` på bolagskortet — de persisteras aldrig och når
 * aldrig AI-kontexten.
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export interface OutlookEvent {
  id: string;
  subject: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  isAllDay: boolean;
  location?: string;
  organizer?: string;
  webLink?: string;
  isOnline?: boolean;
  bodyPreview?: string;
  // Transient PII — endast för CRM-matchning, aldrig persisterad/loggad.
  organizerEmail?: string;
  attendeeEmails?: string[];
}

/**
 * Hämtar händelser inom ett tidsfönster från användarens primära
 * kalender via `/me/calendarView`. `calendarView` expanderar
 * återkommande händelser till individuella förekomster (vilket är
 * vad UI:t vill ha).
 *
 * @param tokens   Färska tokens (anropare ska köra getActiveTokens först).
 * @param from     ISO-tidsstämpel (inklusive).
 * @param to       ISO-tidsstämpel (exklusive).
 * @param timezone IANA-zon t.ex. "Europe/Stockholm" — returnerade
 *                 tider levereras i denna zon från Graph.
 */
export async function fetchCalendarEvents(args: {
  tokens: OAuthTokens;
  from: Date;
  to: Date;
  timezone?: string;
}): Promise<OutlookEvent[]> {
  const url = new URL(`${GRAPH_BASE}/me/calendarView`);
  url.searchParams.set('startDateTime', args.from.toISOString());
  url.searchParams.set('endDateTime', args.to.toISOString());
  url.searchParams.set('$top', '50');
  url.searchParams.set('$orderby', 'start/dateTime');
  url.searchParams.set(
    '$select',
    'id,subject,start,end,isAllDay,location,organizer,webLink,isOnlineMeeting,bodyPreview,attendees'
  );

  const headers: Record<string, string> = {
    authorization: `Bearer ${args.tokens.access_token}`,
    accept: 'application/json'
  };
  if (args.timezone) {
    headers['Prefer'] = `outlook.timezone="${args.timezone}"`;
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Microsoft Graph svarade ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { value?: unknown[] };
  const events = Array.isArray(json.value) ? json.value : [];
  return events.map(toEvent).filter((e): e is OutlookEvent => e !== null);
}

function toEvent(raw: unknown): OutlookEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  const subject = typeof r.subject === 'string' ? r.subject : '(utan ämne)';
  const start = readDateTime(r.start);
  const end = readDateTime(r.end);
  if (!id || !start || !end) return null;
  const location = readLocation(r.location);
  const organizer = readOrganizerName(r.organizer);
  const organizerEmail = readOrganizerEmail(r.organizer);
  const attendeeEmails = readAttendeeEmails(r.attendees);
  return {
    id,
    subject,
    start,
    end,
    isAllDay: r.isAllDay === true,
    location,
    organizer,
    webLink: typeof r.webLink === 'string' ? r.webLink : undefined,
    isOnline: r.isOnlineMeeting === true,
    bodyPreview: typeof r.bodyPreview === 'string' ? r.bodyPreview.slice(0, 200) : undefined,
    organizerEmail,
    attendeeEmails
  };
}

function readDateTime(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  const dt = (v as Record<string, unknown>).dateTime;
  return typeof dt === 'string' ? dt : null;
}

function readLocation(v: unknown): string | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const dn = (v as Record<string, unknown>).displayName;
  return typeof dn === 'string' && dn.length > 0 ? dn : undefined;
}

function readEmailAddress(v: unknown): { name?: string; address?: string } {
  if (!v || typeof v !== 'object') return {};
  const ea = (v as Record<string, unknown>).emailAddress;
  if (!ea || typeof ea !== 'object') return {};
  const rec = ea as Record<string, unknown>;
  return {
    name: typeof rec.name === 'string' ? rec.name : undefined,
    address: typeof rec.address === 'string' ? rec.address : undefined
  };
}

function readOrganizerName(v: unknown): string | undefined {
  return readEmailAddress(v).name;
}

function readOrganizerEmail(v: unknown): string | undefined {
  const addr = readEmailAddress(v).address;
  return addr ? addr.toLowerCase() : undefined;
}

function readAttendeeEmails(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const a of v) {
    const addr = readEmailAddress(a).address;
    if (addr) out.push(addr.toLowerCase());
  }
  return out;
}
