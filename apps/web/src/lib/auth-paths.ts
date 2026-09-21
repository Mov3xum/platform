/**
 * Utloggningsendpoint (route handler, `app/api/auth/logout/route.ts`).
 * Används som `action` i vanliga HTML-formulär (`method="post"`) — INTE en
 * server action. Klient- och serverkomponenter kan importera den här filen
 * (ingen 'use server', inga Node-beroenden).
 */
export const LOGOUT_PATH = '/api/auth/logout';
