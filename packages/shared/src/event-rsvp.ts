// Svarssidan för inbjudningar — gästfrågor, maxantal, väntelista, kalenderfil
// och påminnelser (CLAUDE.md § 55.11, det viktigaste från Confetti). Ren,
// IO-fri logik som delas av eventformuläret, den publika svarssidan,
// påminnelse-ticken och incheckningen.
//
// GDPR § 5: kost/allergi kan vara hälsouppgift (art. 9). Fältet är därför
// frivilligt, visas bara när eventet uttryckligen frågar, cappas hårt,
// når aldrig AI (`event_signups` är denylistad) och raderas med eventet.

import { eventEffectiveEndMs } from './event-time';

export interface EventRsvpSettings {
  /** Max antal medföljande gäster per svar (0 = frågan ställs inte). */
  plus_ones_max: number;
  /** Fråga om kost/allergi. */
  ask_diet: boolean;
  /** Egen fråga till gästen (tom = ingen). */
  custom_question: string;
  /** Maxantal platser inkl. medföljande (0 = obegränsat). */
  capacity: number;
  /** Erbjud väntelista när det är fullt. */
  waitlist: boolean;
  /** Påminn dem som inte svarat N dagar före (0 = av). */
  remind_unanswered_days: number;
  /** Påminn dem som tackat ja N dagar före (0 = av). */
  remind_confirmed_days: number;
}

export const DEFAULT_EVENT_RSVP_SETTINGS: EventRsvpSettings = {
  plus_ones_max: 0,
  ask_diet: false,
  custom_question: '',
  capacity: 0,
  waitlist: true,
  remind_unanswered_days: 0,
  remind_confirmed_days: 0
};

export const RSVP_PLUS_ONES_HARD_MAX = 10;
export const RSVP_TEXT_MAX = 300;
export const RSVP_REMINDER_MAX_DAYS = 30;

function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Normaliserar `incubator_events.rsvp_settings` (json). Saknat/okänt ⇒ default. */
export function normalizeEventRsvpSettings(raw: unknown): EventRsvpSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_EVENT_RSVP_SETTINGS;
  return {
    plus_ones_max: int(r.plus_ones_max, 0, RSVP_PLUS_ONES_HARD_MAX, d.plus_ones_max),
    ask_diet: r.ask_diet === true || r.ask_diet === 'on' || r.ask_diet === 'true',
    custom_question: cleanText(r.custom_question, 200),
    capacity: int(r.capacity, 0, 100000, d.capacity),
    waitlist: r.waitlist === undefined ? d.waitlist : r.waitlist === true || r.waitlist === 'on' || r.waitlist === 'true',
    remind_unanswered_days: int(r.remind_unanswered_days, 0, RSVP_REMINDER_MAX_DAYS, d.remind_unanswered_days),
    remind_confirmed_days: int(r.remind_confirmed_days, 0, RSVP_REMINDER_MAX_DAYS, d.remind_confirmed_days)
  };
}

export function rsvpAsksAnything(s: EventRsvpSettings): boolean {
  return s.plus_ones_max > 0 || s.ask_diet || Boolean(s.custom_question);
}

export interface RsvpAnswers {
  plus_ones: number;
  diet: string;
  custom_answer: string;
}

/** Gästens svar ur formuläret — bara det eventet faktiskt frågar om sparas. */
export function parseRsvpAnswers(settings: EventRsvpSettings, form: Record<string, unknown>): RsvpAnswers {
  return {
    plus_ones: settings.plus_ones_max > 0 ? int(form.plus_ones, 0, settings.plus_ones_max, 0) : 0,
    diet: settings.ask_diet ? cleanText(form.diet, RSVP_TEXT_MAX) : '',
    custom_answer: settings.custom_question ? cleanText(form.custom_answer, RSVP_TEXT_MAX) : ''
  };
}

/** Steg som tar en plats: tackat ja eller längre i tratten. Väntelista/avböjt/inbjuden tar ingen. */
export const SEAT_STAGES: readonly string[] = ['signup', 'attended', 'meeting', 'application', 'admitted'];

export function eventSeatsTaken(rows: ReadonlyArray<{ stage?: string | null; plus_ones?: number | null }>): number {
  let n = 0;
  for (const r of rows) {
    if (!SEAT_STAGES.includes(r.stage ?? '')) continue;
    n += 1 + Math.max(0, Math.trunc(r.plus_ones ?? 0));
  }
  return n;
}

/**
 * Får svaret plats? `wanting` = 1 + medföljande. `alreadyHolding` = platser
 * gästen redan tar (ändrar hen sitt svar räknas de inte två gånger).
 */
export function eventHasRoom(settings: EventRsvpSettings, taken: number, wanting: number, alreadyHolding = 0): boolean {
  if (settings.capacity <= 0) return true;
  return taken - alreadyHolding + wanting <= settings.capacity;
}

export function eventSeatsLeft(settings: EventRsvpSettings, taken: number): number | null {
  if (settings.capacity <= 0) return null;
  return Math.max(0, settings.capacity - taken);
}

// ── Kalenderfil (.ics) ─────────────────────────────────────────────────────

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** RFC 5545: rader viks vid 75 oktetter (vi viker på tecken — tillräckligt för svenska). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    out.push(rest.slice(0, 73));
    rest = ' ' + rest.slice(73);
  }
  out.push(rest);
  return out.join('\r\n');
}

export interface IcsEventInput {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  /** ISO-tidpunkter. Saknas slut sätts eventets effektiva slut. */
  starts_at: string;
  ends_at?: string | null;
  url?: string;
  organizerName?: string;
  organizerEmail?: string;
  /** För deterministiska tester. */
  now?: Date;
}

/** En .ics-fil med ett VEVENT. Null om starttiden inte går att tolka. */
export function buildIcs(input: IcsEventInput): string | null {
  const start = new Date(input.starts_at);
  if (Number.isNaN(start.getTime())) return null;
  const endMs = eventEffectiveEndMs({ starts_at: input.starts_at, ends_at: input.ends_at ?? undefined });
  const end = endMs !== null && endMs > start.getTime() ? new Date(endMs) : new Date(start.getTime() + 60 * 60 * 1000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Movexum//Plattformen//SV',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsEscape(input.uid)}`,
    `DTSTAMP:${icsDate(input.now ?? new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(input.title.trim() || 'Event')}`
  ];
  if (input.description?.trim()) lines.push(`DESCRIPTION:${icsEscape(input.description.trim().slice(0, 2000))}`);
  if (input.location?.trim()) lines.push(`LOCATION:${icsEscape(input.location.trim())}`);
  if (input.url && /^https?:\/\//.test(input.url)) lines.push(`URL:${input.url}`);
  if (input.organizerEmail && /^[^\s@]+@[^\s@]+$/.test(input.organizerEmail)) {
    lines.push(`ORGANIZER;CN=${icsEscape(input.organizerName || 'Movexum')}:mailto:${input.organizerEmail}`);
  }
  lines.push('STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Filnamn utan konstiga tecken: "Frukosttraff.ics". */
export function icsFilename(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'event'}.ics`;
}

// ── Påminnelser ────────────────────────────────────────────────────────────

export type ReminderKind = 'unanswered' | 'confirmed';

/**
 * Ska påminnelsen skickas nu? Fönstret öppnar `days` dygn före start och
 * stänger vid start; redan skickad (`sentAt`) ⇒ nej. En påminnelse som
 * missats (t.ex. tick nere) skickas så fort ticken är igång igen — men aldrig
 * efter att eventet börjat.
 */
export function reminderDue(input: {
  settings: EventRsvpSettings;
  kind: ReminderKind;
  starts_at: string | null | undefined;
  sentAt: string | null | undefined;
  now: Date;
}): boolean {
  const days = input.kind === 'unanswered' ? input.settings.remind_unanswered_days : input.settings.remind_confirmed_days;
  if (days <= 0 || input.sentAt || !input.starts_at) return false;
  const start = Date.parse(input.starts_at);
  if (Number.isNaN(start)) return false;
  const opens = start - days * 24 * 60 * 60 * 1000;
  const now = input.now.getTime();
  return now >= opens && now < start;
}

/** Var incheckningen (QR-koden i bekräftelsen) pekar — en inloggad staff-sida. */
export function checkInPath(eventId: string, token: string): string {
  return `/inflode/events/${encodeURIComponent(eventId)}/incheckning?t=${encodeURIComponent(token)}`;
}
