import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Tidssäker jämförelse av delade hemligheter (t.ex. `MOVEXUM_SCHEDULE_SECRET`).
 * Båda värdena hashas först så att jämförelsen alltid sker över lika långa
 * buffertar — en längdkontroll före jämförelsen läcker annars hemlighetens
 * längd (A.8.24).
 */
export function secretsEqual(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = createHash('sha256').update(provided, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
