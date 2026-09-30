/**
 * Appens publika origin och OAuth-callback-URL — delad av authorize-steget
 * (server action) och callback-routen, så `redirect_uri` är IDENTISK i båda
 * (RFC 6749 § 4.1.3 kräver exakt matchning vid token-växlingen).
 *
 * Callback-routen härledde tidigare `redirect_uri` ur `request.url`, som i
 * standalone-containern är bind-adressen `http://0.0.0.0:3000` (se
 * `lib/relative-redirect.ts`) — aldrig den publika domänen som authorize-
 * steget skickade. Ingen 'use server' här: en vanlig modul, importerbar från
 * både actions och route handlers.
 */
export function publicAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000').replace(
    /\/$/,
    ''
  );
}

export function appIntegrationCallbackUrl(slug: string): string {
  return `${publicAppUrl()}/api/app-integrations/${encodeURIComponent(slug)}/callback`;
}
