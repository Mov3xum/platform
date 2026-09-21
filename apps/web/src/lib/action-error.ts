/**
 * Klienthjälpare för KASTADE fel från server actions.
 *
 * Next.js byter id på alla server actions vid varje deploy. En flik som
 * laddades FÖRE deployen anropar då gamla id:n → servern svarar 404 och
 * klienten kastar `UnrecognizedActionError: Server Action "…" was not found
 * on the server` (i stället för att returnera `{ error }`). Utan hantering
 * blir det en obehandlad promise-rejection: chatten ser ut att "låsa sig" —
 * upptagen-flaggor nollas aldrig och inget felmeddelande visas.
 *
 * Modulen är klient-säker (inga server-imports) och delas av alla klient-
 * komponenter som anropar server actions direkt.
 */

export const STALE_DEPLOYMENT_MESSAGE =
  'Plattformen har uppdaterats sedan sidan laddades. Ladda om sidan (Ctrl/Cmd + R) och försök igen.';

/** True när felet beror på att klientens build är äldre än serverns. */
export function isStaleDeploymentError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message || '';
  return (
    err.name === 'UnrecognizedActionError' ||
    /was not found on the server/i.test(msg) ||
    /failed to find server action/i.test(msg)
  );
}

/**
 * Översätter ett kastat action-fel till ett användbart svenskt meddelande.
 * Stale-deploy får ett tydligt "ladda om"-besked; allt annat får den
 * medskickade fallbacken (interna feltexter läcker inte till UI:t).
 */
export function actionErrorMessage(err: unknown, fallback: string): string {
  return isStaleDeploymentError(err) ? STALE_DEPLOYMENT_MESSAGE : fallback;
}
