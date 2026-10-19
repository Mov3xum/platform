import 'server-only';
import { describeResendError } from '@/lib/mail-sender';

/**
 * Batchutskick via Resend (CLAUDE.md § 54.4). `/emails/batch` tar upp till
 * 100 mejl per anrop (vi skickar 50) och svarar med ett id per mejl i samma
 * ordning — id:t sparas på mottagarraden så webhooken (studs/klagomål) kan
 * matchas tillbaka. Avvisas hela batchen (valideringsfel i ETT mejl fäller
 * alla) faller vi tillbaka på enskilda anrop så att ett trasigt mejl inte
 * stoppar de andra. Adresser loggas aldrig.
 */

export interface OutgoingEmail {
  /** Anroparens nyckel (t.ex. mottagarradens id) — returneras i resultatet. */
  key: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  reply_to?: string | null;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}

export interface SendOutcome {
  key: string;
  id?: string;
  error?: string;
}

const API = 'https://api.resend.com';
export const RESEND_BATCH_SIZE = 50;
/** Resends standardgräns är 2 anrop/s — ett andrum mellan batcharna. */
const PAUSE_MS = 600;

function apiKey(): string {
  return (process.env.RESEND_API_KEY ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

function toPayload(m: OutgoingEmail): Record<string, unknown> {
  return {
    from: m.from,
    to: [m.to],
    subject: m.subject,
    html: m.html,
    text: m.text,
    ...(m.reply_to ? { reply_to: m.reply_to } : {}),
    ...(m.headers && Object.keys(m.headers).length > 0 ? { headers: m.headers } : {}),
    ...(m.tags && m.tags.length > 0 ? { tags: m.tags } : {})
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(path: string, body: unknown, key: string): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000)
  });
}

export async function sendOne(m: OutgoingEmail): Promise<SendOutcome> {
  const key = apiKey();
  if (!key) return { key: m.key, error: 'E-posttjänsten är inte konfigurerad (RESEND_API_KEY saknas).' };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await post('/emails', toPayload(m), key);
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { id?: string };
        return { key: m.key, id: typeof data.id === 'string' ? data.id : undefined };
      }
      const reason = describeResendError(res.status, await res.text().catch(() => ''), m.from);
      if (res.status === 429 && attempt === 0) {
        await sleep(1500);
        continue;
      }
      return { key: m.key, error: reason };
    } catch (err) {
      if (attempt === 0) {
        await sleep(800);
        continue;
      }
      return { key: m.key, error: `Kunde inte nå Resend (${err instanceof Error ? err.message : 'nätverksfel'}).` };
    }
  }
  return { key: m.key, error: 'Kunde inte nå Resend.' };
}

/**
 * Skickar alla mejl, i batchar om `RESEND_BATCH_SIZE`. Returnerar ett
 * utfall per mejl i samma ordning som indata.
 */
export async function sendEmailBatch(
  messages: readonly OutgoingEmail[],
  onProgress?: (done: number, total: number) => void | Promise<void>
): Promise<SendOutcome[]> {
  const key = apiKey();
  const out: SendOutcome[] = [];
  if (!key) return messages.map((m) => ({ key: m.key, error: 'E-posttjänsten är inte konfigurerad (RESEND_API_KEY saknas).' }));
  for (let i = 0; i < messages.length; i += RESEND_BATCH_SIZE) {
    const chunk = messages.slice(i, i + RESEND_BATCH_SIZE);
    if (i > 0) await sleep(PAUSE_MS);
    let handled = false;
    try {
      const res = await post('/emails/batch', chunk.map(toPayload), key);
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
        const ids = Array.isArray(body.data) ? body.data : [];
        if (ids.length === chunk.length) {
          chunk.forEach((m, j) => out.push({ key: m.key, id: typeof ids[j]?.id === 'string' ? ids[j]!.id : undefined }));
          handled = true;
        }
      } else if (res.status === 429) {
        await sleep(2000);
      } else {
        // PII-fritt: status + Resends orsak med adresser maskade.
        console.error(`[email] Resend batch error ${res.status}: ${describeResendError(res.status, await res.text().catch(() => ''), chunk[0]!.from)}`);
      }
    } catch (err) {
      console.error('[email] Resend batch request failed', err instanceof Error ? err.message : 'unknown');
    }
    if (!handled) {
      // Reserv: ett mejl i taget så att ett enskilt fel inte stoppar resten.
      for (const m of chunk) {
        out.push(await sendOne(m));
        await sleep(350);
      }
    }
    if (onProgress) await onProgress(Math.min(i + chunk.length, messages.length), messages.length);
  }
  return out;
}
