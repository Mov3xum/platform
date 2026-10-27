/**
 * Användarlogg — ren, enhetstestad logik (CLAUDE.md § 36.4).
 *
 * "Senast aktiv" bygger på `users.last_active_at`, som servern stämplar med
 * grov upplösning (ett hjärtslag högst var tionde minut per konto) vid varje
 * inloggat anrop, samt `users.last_login_at`/`login_count` som stämplas vid
 * inloggning. Ingen sidvisning loggas, ingen IP, ingen user agent — bara NÄR
 * kontot senast var i plattformen. Modulen är IO-fri så servern, admin-UI:t
 * och testerna delar exakt samma tolkning.
 */

/** Hur ofta `last_active_at` skrivs om per konto (dataminimering + skrivlast). */
export const ACTIVITY_HEARTBEAT_MS = 10 * 60 * 1000;

/** "Aktiv nu" = senaste hjärtslaget ligger inom ett hjärtslagsfönster + marginal. */
export const ONLINE_WINDOW_MS = ACTIVITY_HEARTBEAT_MS + 5 * 60 * 1000;

/** Konton utan aktivitet så här länge räknas som inaktiva i filtret. */
export const INACTIVE_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ActivityPresence = 'online' | 'today' | 'week' | 'month' | 'inactive' | 'never';

/** Tolkar ett PB-datum (ISO eller "YYYY-MM-DD HH:mm:ss.SSSZ"); null för tomt/ogiltigt. */
export function parseActivityDate(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = new Date(value.includes('T') ? value : value.replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Ska servern skriva ett nytt hjärtslag? Ja när stämpeln saknas eller är
 * äldre än `ACTIVITY_HEARTBEAT_MS`. En stämpel i framtiden (klockskev mellan
 * containrar) räknas som färsk så den inte skrivs om i onödan.
 */
export function shouldTouchActivity(lastActiveAt: unknown, now: number): boolean {
  const last = parseActivityDate(lastActiveAt);
  if (last === null) return true;
  return now - last >= ACTIVITY_HEARTBEAT_MS;
}

export function activityPresence(lastActiveAt: unknown, now: number): ActivityPresence {
  const last = parseActivityDate(lastActiveAt);
  if (last === null) return 'never';
  const diff = Math.max(0, now - last);
  if (diff <= ONLINE_WINDOW_MS) return 'online';
  if (diff < DAY_MS) return 'today';
  if (diff < 7 * DAY_MS) return 'week';
  if (diff < INACTIVE_AFTER_DAYS * DAY_MS) return 'month';
  return 'inactive';
}

export function isInactiveUser(lastActiveAt: unknown, now: number): boolean {
  const p = activityPresence(lastActiveAt, now);
  return p === 'never' || p === 'inactive';
}

/**
 * Kort svensk etikett för raden i användarlistan. Relativ text för färska
 * stämplar, datum för äldre — samma trappa som `relativeTimeSv` på startsidan.
 */
export function activityLabel(lastActiveAt: unknown, now: number): string {
  const last = parseActivityDate(lastActiveAt);
  if (last === null) return 'Aldrig inloggad';
  const presence = activityPresence(lastActiveAt, now);
  if (presence === 'online') return 'Aktiv nu';
  const diff = Math.max(0, now - last);
  const min = Math.round(diff / 60000);
  if (min < 60) return `Aktiv för ${min} min sedan`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `Aktiv för ${hrs} tim sedan`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'Aktiv igår';
  if (days < 7) return `Aktiv för ${days} dagar sedan`;
  const d = new Date(last);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return `Senast aktiv ${d.toLocaleDateString('sv-SE', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'Europe/Stockholm'
  })}`;
}

export interface LoginSummary {
  total: number;
  last30d: number;
  last90d: number;
}

/** Räknar inloggningar ur händelselistan (created-tidsstämplar) mot nu. */
export function summarizeLogins(createdAts: readonly unknown[], now: number, total?: number): LoginSummary {
  let last30d = 0;
  let last90d = 0;
  for (const value of createdAts) {
    const ms = parseActivityDate(value);
    if (ms === null) continue;
    const age = now - ms;
    if (age < 30 * DAY_MS) last30d++;
    if (age < 90 * DAY_MS) last90d++;
  }
  return { total: typeof total === 'number' && total >= createdAts.length ? total : createdAts.length, last30d, last90d };
}

/** Sorterar användare med senast aktiv först; aldrig inloggade sist, namn som sekundär ordning. */
export function compareByLastActive<T extends { lastActiveAt: string | null; name: string }>(a: T, b: T): number {
  const am = parseActivityDate(a.lastActiveAt);
  const bm = parseActivityDate(b.lastActiveAt);
  if (am === null && bm === null) return a.name.localeCompare(b.name, 'sv');
  if (am === null) return 1;
  if (bm === null) return -1;
  if (am !== bm) return bm - am;
  return a.name.localeCompare(b.name, 'sv');
}
