import 'server-only';
import type { OAuthTokens } from '../../types';

/**
 * Microsoft Graph-klient för kalenderhändelser. Read-only, scope
 * `Calendars.Read`. CLAUDE.md § 10.2: vi loggar aldrig event-bodyn i
 * klartext eller deltagar-listor (PII).
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
    'id,subject,start,end,isAllDay,location,organizer,webLink,isOnlineMeeting,bodyPreview'
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
  const organizer = readOrganizer(r.organizer);
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
    bodyPreview: typeof r.bodyPreview === 'string' ? r.bodyPreview.slice(0, 200) : undefined
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

function readOrganizer(v: unknown): string | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const ea = (v as Record<string, unknown>).emailAddress;
  if (!ea || typeof ea !== 'object') return undefined;
  const name = (ea as Record<string, unknown>).name;
  return typeof name === 'string' ? name : undefined;
}
