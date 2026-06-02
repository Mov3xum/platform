/**
 * Öppen-redirect-skydd (säkerhetsgranskning 2026-06, M2/F1).
 *
 * `next`-parametern styr vart vi skickar användaren efter inloggning. Den får
 * BARA peka på en intern path — annars kan en länk som
 * `/login?next=https://evil.example` (eller `//evil.example`,
 * `/\evil.example`) 307-redirecta offret bort från sajten (phishing).
 *
 * Ren, IO-fri och delad av `LoginPage` (server component) och
 * `loginAction` (server action) så att exakt samma regel gäller på båda
 * ställen. Tillåter bara en path som börjar med ett ENKELT `/` och inte
 * inleder ett protokoll-relativt (`//`) eller back-slash-trick (`/\`).
 */
export function sanitizeNextPath(
  next: unknown,
  fallback = '/dashboard'
): string {
  if (typeof next !== 'string') return fallback;
  if (!next.startsWith('/')) return fallback;
  if (next.startsWith('//')) return fallback;
  if (next.startsWith('/\\')) return fallback;
  return next;
}
