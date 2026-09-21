// Tidshälsning i svensk tid.
//
// Servern (Coolify-container på UpCloud) kör i UTC, så `new Date().getHours()`
// ger fel tid på dygnet för en användare i Sverige — "God morgon" mitt på dagen.
// Plattformen är svensk: hälsningen ska följa Europe/Stockholm, oavsett var
// servern står eller vilken tidszon processen har. Ren logik, inga beroenden.

export const SWEDISH_TIMEZONE = 'Europe/Stockholm';

/** Timme (0–23) på väggklockan i svensk tid för ett givet ögonblick. */
export function stockholmHour(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: SWEDISH_TIMEZONE,
    hour: 'numeric',
    hourCycle: 'h23'
  }).formatToParts(at);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const n = Number.parseInt(hour, 10);
  // "24" kan förekomma i vissa ICU-versioner för midnatt trots h23.
  return Number.isFinite(n) ? n % 24 : 0;
}

/** Hälsning utifrån en väggklocketimme (0–23). */
export function greetingForHour(hour: number): string {
  if (hour < 5) return 'God natt';
  if (hour < 10) return 'God morgon';
  if (hour < 13) return 'God förmiddag';
  if (hour < 17) return 'God eftermiddag';
  return 'God kväll';
}

/** Hälsning i svensk tid för ett givet ögonblick (default: nu). */
export function swedishGreeting(at: Date = new Date()): string {
  return greetingForHour(stockholmHour(at));
}
