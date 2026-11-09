// Deltagarlistan för ett event (`event_signups`, CLAUDE.md § 15.2 + § 47.5).
//
// Enda källan för stegens ordning, etiketter och vilka steg som betyder att
// personen faktiskt DELTOG. Räknarna på `incubator_events`, eventsidans tratt
// och utvärderingsutskicket (bara till närvarande) läser alla härifrån, så
// "närvarande" aldrig betyder olika saker på olika ställen. Ren logik,
// enhetstestad (`event-participants.test.ts`).

import type { EventSignupStage, EventType } from './index';

/** Eventtyper — måste spegla select-värdena på `incubator_events.type` (1700000032). */
export const EVENT_TYPES: readonly EventType[] = [
  'pitch',
  'conference',
  'matching',
  'hack',
  'mingle',
  'workshop',
  'other'
];

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  pitch: 'Pitch',
  conference: 'Konferens',
  matching: 'Matching',
  hack: 'Hackathon',
  mingle: 'Mingel',
  workshop: 'Workshop',
  other: 'Annat'
};

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Inbjudans steg (§ 53.5) — före tratten. En inbjuden som tackar ja blir
 * `signup`; ett nej blir `declined`. Ingen av dem räknas som anmäld.
 */
export const EVENT_INVITE_STAGES: readonly EventSignupStage[] = ['invited', 'declined', 'waitlist'];

/** Steg i tratten (allt utom inbjudans steg). */
export type EventFunnelStage = Exclude<EventSignupStage, 'invited' | 'declined' | 'waitlist'>;

/** Trattens ordning — ett senare steg innebär alla tidigare. */
export const EVENT_SIGNUP_STAGES: readonly EventFunnelStage[] = [
  'signup',
  'attended',
  'meeting',
  'application',
  'admitted'
];

/** Alla steg i den ordning de visas i listor och val. */
export const EVENT_ALL_SIGNUP_STAGES: readonly EventSignupStage[] = [
  'invited',
  'declined',
  'waitlist',
  'signup',
  'attended',
  'meeting',
  'application',
  'admitted'
];

export const EVENT_SIGNUP_STAGE_LABEL: Record<EventSignupStage, string> = {
  invited: 'Inbjuden',
  declined: 'Avböjt',
  waitlist: 'Väntelista',
  signup: 'Anmäld',
  attended: 'Närvarande',
  meeting: 'Möte bokat',
  application: 'Ansökan',
  admitted: 'Antagen'
};

/** Steg som betyder att personen var på plats (närvarande eller längre). */
export const EVENT_ATTENDED_STAGES: readonly EventSignupStage[] = [
  'attended',
  'meeting',
  'application',
  'admitted'
];

const LEAD_STAGES: readonly EventSignupStage[] = ['meeting', 'application', 'admitted'];

export function isEventSignupStage(value: unknown): value is EventSignupStage {
  return typeof value === 'string' && (EVENT_ALL_SIGNUP_STAGES as readonly string[]).includes(value);
}

export function isInviteStage(stage: unknown): boolean {
  return typeof stage === 'string' && (EVENT_INVITE_STAGES as readonly string[]).includes(stage);
}

export function isAttendedStage(stage: unknown): boolean {
  return typeof stage === 'string' && (EVENT_ATTENDED_STAGES as readonly string[]).includes(stage);
}

export interface EventSignupCounters {
  signups_count: number;
  attended_count: number;
  leads_count: number;
  admitted_count: number;
}

/**
 * Räknarna som denormaliseras på `incubator_events`. Inbjudna och avböjda
 * räknas inte som anmälda; okända steg räknas bara som anmälda.
 */
export function eventSignupCounters(
  rows: ReadonlyArray<{ stage?: string | null }>
): EventSignupCounters {
  let signups = 0;
  let attended = 0;
  let leads = 0;
  let admitted = 0;
  for (const r of rows) {
    if (isInviteStage(r.stage)) continue;
    signups += 1;
    if (isAttendedStage(r.stage)) attended += 1;
    if (typeof r.stage === 'string' && (LEAD_STAGES as readonly string[]).includes(r.stage)) leads += 1;
    if (r.stage === 'admitted') admitted += 1;
  }
  return {
    signups_count: signups,
    attended_count: attended,
    leads_count: leads,
    admitted_count: admitted
  };
}

/** Kumulativ tratt: antal som nått minst varje steg, i `EVENT_SIGNUP_STAGES`-ordning. */
export function eventSignupFunnel(
  rows: ReadonlyArray<{ stage?: string | null }>
): { stage: EventFunnelStage; count: number }[] {
  const reached = EVENT_SIGNUP_STAGES.map(() => 0);
  for (const r of rows) {
    const idx = EVENT_SIGNUP_STAGES.indexOf(r.stage as EventFunnelStage);
    for (let i = 0; i <= idx; i++) reached[i] += 1;
  }
  return EVENT_SIGNUP_STAGES.map((stage, i) => ({ stage, count: reached[i] }));
}
