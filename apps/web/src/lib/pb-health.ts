/**
 * Diagnos av PocketBase-adressen (ren klassificering — enhetstestad).
 *
 * Bakgrund (incident 2026-09, produktion): inloggningen svarade
 * "Users-collectionen saknas i PocketBase — har migrationerna körts?" trots att
 * `users` är PocketBases INBYGGDA auth-kollektion (migration 1700000002 bara
 * utökar den) och aldrig kan saknas på en körande instans. Meddelandet
 * triggades på VILKET 404 som helst från SDK:n — och ett 404 uppstår lika
 * gärna när PB-URL:en inte routas till PocketBase alls: Coolifys Traefik-proxy
 * svarar "404 page not found" för en host utan router, och web-appen svarar
 * 404 på `/api/collections/...` om domänen råkar peka på den. Operatören
 * jagade då migrationer i stället för domän-/proxy-konfigurationen.
 *
 * `classifyPbProbe` tolkar svaret från `<PB-url>/api/health` och
 * `describePbProbe` formulerar ett svenskt, åtgärdbart meddelande. IO:t
 * (`probePocketBase`) är ett tunt fetch-omslag utan server-only-imports så
 * modulen kan delas av route handlers, server actions och health-endpointen.
 */

export type PbProbeKind =
  | 'pocketbase' // /api/health svarar PB:s JSON ({ code: 200 })
  | 'proxy_404' // Traefik/Coolify: "404 page not found" — ingen router för hosten
  | 'html' // en HTML-sida (web-appen eller annan tjänst) — inte PB-API:t
  | 'error_status' // 5xx/503 — PB nere eller startar
  | 'not_pocketbase' // svarade, men inte PB:s health-JSON
  | 'unreachable'; // DNS/TLS/anslutning misslyckades

export interface PbProbeInput {
  status: number;
  contentType?: string | null;
  body: string;
}

export interface PbProbeResult {
  kind: PbProbeKind;
  status?: number;
  /** PII-fri orsak (nätverksfelets kod/meddelande, kapat). */
  reason?: string;
}

function looksLikeHtml(body: string, contentType: string): boolean {
  const head = body.slice(0, 300).trimStart().toLowerCase();
  return contentType.includes('text/html') || head.startsWith('<!doctype') || head.startsWith('<html');
}

/** Klassar ett HTTP-svar från `<PB-url>/api/health`. */
export function classifyPbProbe(input: PbProbeInput): PbProbeResult {
  const contentType = (input.contentType || '').toLowerCase();
  const body = input.body || '';
  const { status } = input;

  if (status >= 200 && status < 300) {
    try {
      const json = JSON.parse(body) as { code?: unknown; message?: unknown };
      if (json && typeof json === 'object' && json.code === 200) {
        return { kind: 'pocketbase', status };
      }
    } catch {
      /* inte JSON */
    }
    if (looksLikeHtml(body, contentType)) return { kind: 'html', status };
    return { kind: 'not_pocketbase', status };
  }

  if (status === 404) {
    if (looksLikeHtml(body, contentType)) return { kind: 'html', status };
    if (/404 page not found/i.test(body) || contentType.includes('text/plain')) {
      return { kind: 'proxy_404', status };
    }
    return { kind: 'not_pocketbase', status };
  }

  if (status >= 500) return { kind: 'error_status', status };
  if (looksLikeHtml(body, contentType)) return { kind: 'html', status };
  return { kind: 'not_pocketbase', status };
}

/** Kapar och avidentifierar ett nätverksfel till en kort, loggbar orsak. */
export function summarizeNetworkError(err: unknown): string {
  const e = err as { code?: unknown; name?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } };
  const code = typeof e?.cause?.code === 'string' ? e.cause.code : typeof e?.code === 'string' ? e.code : undefined;
  const name = typeof e?.name === 'string' ? e.name : undefined;
  const message =
    typeof e?.cause?.message === 'string'
      ? e.cause.message
      : typeof e?.message === 'string'
        ? e.message
        : undefined;
  const parts = [code, name === 'AbortError' ? 'timeout' : undefined, message].filter(Boolean) as string[];
  const text = parts.join(': ').replace(/\s+/g, ' ').trim();
  return text.slice(0, 160) || 'okänt nätverksfel';
}

/** Kort, PII-fri sammanfattning för loggar/health-endpoint. */
export function probeSummary(result: PbProbeResult): string {
  switch (result.kind) {
    case 'pocketbase':
      return 'PocketBase svarar (api/health OK)';
    case 'proxy_404':
      return 'proxyn svarar "404 page not found" — ingen router för hosten';
    case 'html':
      return `svarar med en HTML-sida (HTTP ${result.status}) — inte PocketBase-API:t`;
    case 'error_status':
      return `HTTP ${result.status} — PocketBase nere eller startar`;
    case 'not_pocketbase':
      return `HTTP ${result.status} men inte PocketBases health-svar`;
    case 'unreachable':
      return `onåbar (${result.reason || 'nätverksfel'})`;
  }
}

/**
 * Åtgärdbart felmeddelande för inloggningen när PB-SDK:n svarat 404 (eller
 * annat infrastrukturfel) och vi probat `/api/health` för att veta varför.
 */
export function describeLoginInfraError(pbUrl: string, probe: PbProbeResult): string {
  switch (probe.kind) {
    case 'pocketbase':
      return `Users-collectionen saknas i PocketBase (${pbUrl} svarar annars OK) — har migrationerna körts mot just den här instansen?`;
    case 'proxy_404':
      return `PocketBase-adressen ${pbUrl} routas inte till PocketBase: proxyn svarar "404 page not found". Kontrollera i Coolify att domänen ligger under Domains på PocketBase-resursen (inte på web-appen), att resursen är omdeployad efter domänbytet, och att DNS-A-posten pekar på servern.`;
    case 'html':
      return `${pbUrl} svarar med en HTML-sida, inte PocketBase-API:t — domänen pekar troligen på web-appen eller en annan tjänst. Kontrollera Domains på PocketBase-resursen i Coolify och POCKETBASE_URL_<MILJÖ> på web-appen.`;
    case 'error_status':
      return `PocketBase på ${pbUrl} svarar HTTP ${probe.status} — containern är nere eller startar om. Kontrollera PocketBase-resursen i Coolify.`;
    case 'not_pocketbase':
      return `${pbUrl} svarar (HTTP ${probe.status}) men inte som PocketBase — kontrollera att adressen pekar på PocketBase-containern (utan extra sökväg).`;
    case 'unreachable':
      return `Kunde inte nå PocketBase på ${pbUrl} (${probe.reason || 'nätverksfel'}). Kontrollera DNS/A-post, certifikat och POCKETBASE_URL_<MILJÖ>.`;
  }
}

const PROBE_TIMEOUT_MS = 5000;

/** Hämtar `<pbUrl>/api/health` och klassar svaret. Kastar aldrig. */
export async function probePocketBase(pbUrl: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<PbProbeResult> {
  const url = `${pbUrl.replace(/\/+$/, '')}/api/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    const body = (await res.text()).slice(0, 4000);
    return classifyPbProbe({ status: res.status, contentType: res.headers.get('content-type'), body });
  } catch (err) {
    return { kind: 'unreachable', reason: summarizeNetworkError(err) };
  } finally {
    clearTimeout(timer);
  }
}
