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
