/**
 * Avsändare och leveranshuvuden för utgående mejl (CLAUDE.md § 53.5).
 *
 * Mejlen ska komma från Movexums egen domän, verifierad i Resend (SPF, DKIM
 * och DMARC på domänen) — annars hamnar inbjudningar i skräpposten.
 * Adressen konfigureras i Coolify, aldrig i kod:
 * - `RESEND_FROM_EMAIL` — alla mejl (t.ex. `Movexum <noreply@movexum.se>`)
 * - `RESEND_INVITE_FROM_EMAIL` — inbjudningar och enkäter (t.ex.
 *   `Movexum Event <event@movexum.se>`), annars `RESEND_FROM_EMAIL`
 * - `RESEND_REPLY_TO` — svarsadress (t.ex. `hej@movexum.se`); en riktig
 *   adress att svara till förbättrar leveransen jämfört med enbart noreply.
 * Ett ogiltigt värde ignoreras (standardavsändaren används) — ett
 * felskrivet env-värde får aldrig stoppa mejlen. Ren modul, enhetstestad.
 */

export const DEFAULT_SENDER = 'Movexum <noreply@movexum.se>';

const ADDRESS = /^[^\s<>@"]+@[^\s<>@"]+\.[a-z]{2,}$/i;

/** `Namn <adress>` eller bara `adress`. Null om värdet inte är en giltig avsändare. */
export function parseSender(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > 200 || /[\r\n]/.test(value)) return null;
  const named = /^([^<>"@]{1,80})\s*<([^<>]+)>$/.exec(value);
  if (named) {
    const name = named[1]!.trim();
    const addr = named[2]!.trim();
    return name && ADDRESS.test(addr) ? `${name} <${addr}>` : null;
  }
  return ADDRESS.test(value) ? value : null;
}

/** Själva adressen ur en avsändare (`Namn <a@b.se>` → `a@b.se`). */
export function senderAddress(sender: string): string {
  const m = /<([^<>]+)>$/.exec(sender);
  return (m ? m[1]! : sender).trim().toLowerCase();
}

export function resolveSender(env: Record<string, string | undefined>, kind: 'default' | 'invite'): string {
  const base = parseSender(env.RESEND_FROM_EMAIL) ?? DEFAULT_SENDER;
  return kind === 'invite' ? (parseSender(env.RESEND_INVITE_FROM_EMAIL) ?? base) : base;
}

export function resolveReplyTo(env: Record<string, string | undefined>): string | null {
  const v = parseSender(env.RESEND_REPLY_TO);
  return v ? senderAddress(v) : null;
}

/**
 * RFC 2369/8058-huvuden för en-klicksavregistrering. Bara https-adresser
 * (mejlklienterna kräver det för en-klick).
 */
export function listUnsubscribeHeaders(url: string | null | undefined): Record<string, string> {
  if (!url || !/^https:\/\/[^\s<>]+$/.test(url)) return {};
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  };
}

/** E-postadresser i fritext (Resends felmeddelanden kan innehålla kontoägarens adress). */
function maskEmails(text: string): string {
  return text.replace(/[^\s<>@"'(),;:]+@[^\s<>@"'(),;:]+\.[a-z]{2,}/gi, '[e-post]');
}

/**
 * Översätter ett avvisat Resend-anrop till en begriplig, PII-fri orsak — så
 * personalen ser VARFÖR mejlen inte gick (overifierad domän, fel nyckel,
 * testläge) i stället för bara "misslyckades". `body` är svarstexten
 * (`{ name, message, statusCode }`); adresser maskas alltid.
 */
export function describeResendError(status: number, body: string, from: string): string {
  let name = '';
  let message = '';
  try {
    const parsed = JSON.parse(body) as { name?: unknown; message?: unknown };
    if (typeof parsed.name === 'string') name = parsed.name;
    if (typeof parsed.message === 'string') message = parsed.message;
  } catch {
    message = body;
  }
  const raw = maskEmails(message.replace(/\s+/g, ' ').trim()).slice(0, 240);
  const lower = `${name} ${message}`.toLowerCase();
  const domain = senderAddress(from).split('@')[1] ?? '';

  if (status === 401 || /missing_api_key|invalid_api_key|api key is invalid/.test(lower)) {
    return 'Resend avvisade API-nyckeln (RESEND_API_KEY är fel, ofullständig eller återkallad). Klistra in nyckeln på nytt på web-appen i Coolify och deploya om.';
  }
  if (/testing emails|own email address/.test(lower)) {
    return 'Resend-kontot är i testläge och får bara skicka till kontoägarens egen adress. Verifiera avsändardomänen under Domains i Resend.';
  }
  if (/domain is not verified|not verified|verify a domain|domain.*not found/.test(lower)) {
    return `Avsändardomänen ${domain || '(okänd)'} är inte verifierad i Resend. Lägg till och verifiera den under Domains i Resend, eller sätt RESEND_FROM_EMAIL/RESEND_INVITE_FROM_EMAIL till en adress på en verifierad domän.`;
  }
  if (status === 403 && /restricted_api_key|permission|not allowed/.test(lower)) {
    return 'API-nyckeln saknar behörighet att skicka mejl. Skapa en nyckel med "Sending access" i Resend.';
  }
  if (status === 422 || /invalid_from_address|validation_error/.test(lower)) {
    return `Resend godtog inte mejlet${raw ? `: ${raw}` : ''}. Kontrollera avsändaradressen (${maskEmails(from)}).`;
  }
  if (status === 429 || /rate_limit|daily_quota|monthly_quota/.test(lower)) {
    return 'Resend begränsar utskicken just nu (för många mejl eller kvoten är slut). Vänta en stund och försök igen.';
  }
  return `Resend svarade ${status}${raw ? `: ${raw}` : ''}.`;
}
