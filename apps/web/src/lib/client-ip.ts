/**
 * Klientens IP ur proxy-headers — REN modul, enhetstestad. Används för
 * rate-limit-nycklar och (hashad) audit.
 *
 * `X-Forwarded-For` är en lista "klient, proxy1, proxy2 …" där varje proxy
 * LÄGGER TILL adressen den såg. Det VÄNSTRA värdet är därför det som
 * klienten själv kan ha skickat in (spoofbart: en anropare som roterar
 * `X-Forwarded-For: <slump>` nollställer varje per-IP-gräns). Det HÖGRA
 * värdet är det som vår egen (betrodda) edge-proxy lade till = adressen som
 * faktiskt anslöt till den. Vi tar därför det sista värdet. Coolify/Traefik
 * kör en proxy framför containern; utan XFF (container-internt anrop) faller
 * vi på `X-Real-IP` och sist på `unknown`.
 */
export function clientIpFromHeaders(get: (name: string) => string | null | undefined): string {
  const xff = get('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last.slice(0, 64);
  }
  const real = get('x-real-ip');
  if (real && real.trim()) return real.trim().slice(0, 64);
  return 'unknown';
}

/** Bekvämlighet för route handlers (`Request`/`NextRequest`). */
export function clientIpFromRequest(req: { headers: { get(name: string): string | null } }): string {
  return clientIpFromHeaders((n) => req.headers.get(n));
}
