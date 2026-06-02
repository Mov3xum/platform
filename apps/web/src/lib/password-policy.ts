/**
 * Versionerad lösenordspolicy (säkerhetsgranskning 2026-06, M11).
 *
 * Tidigare förlitade vi oss på PocketBase-defaulten (8 tecken) implicit och
 * upprepade `length < 8` på flera ställen. Policyn samlas nu på ETT ställe så
 * att den är konsekvent, testbar och lätt att skärpa. NIST 800-63B
 * rekommenderar längd framför komplexitetsregler → vi sätter ett rejält
 * minimum (12) och ett tak (för att undvika DoS via mycket långa bcrypt-indata)
 * men ingen påtvingad teckenklass-komplexitet.
 *
 * Ren och IO-fri → enhetstestbar.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

/** Returnerar ett felmeddelande (sv) om lösenordet inte uppfyller policyn, annars null. */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Lösenord saknas.';
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Lösenordet får vara högst ${MAX_PASSWORD_LENGTH} tecken.`;
  }
  return null;
}
