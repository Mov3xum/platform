/**
 * Utloggningsendpoint (route handler, `app/api/auth/logout/route.ts`).
 * Används som `action` i vanliga HTML-formulär (`method="post"`) — INTE en
 * server action. Klient- och serverkomponenter kan importera den här filen
 * (ingen 'use server', inga Node-beroenden).
 */
export const LOGOUT_PATH = '/api/auth/logout';

/**
 * Presentationslägen (helskärm för projektorn, § 30.5 / § 42): root-layouten
 * tar bort railen för exakt dessa sökvägar. RBAC ligger kvar i respektive
 * page.tsx — bara ramen tas bort.
 */
export const PRESENTATION_PATHS: readonly string[] = ['/arshjul/presentation', '/mal/presentation'];

export function isPresentationPath(pathname: string): boolean {
  return PRESENTATION_PATHS.includes(pathname);
}
