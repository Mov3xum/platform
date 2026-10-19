import 'server-only';
import { promises as dns } from 'node:dns';
import { resolveReplyTo, resolveSender, senderAddress } from '@/lib/mail-sender';
import { isEmailConfigured, resendKeyLooksValid } from '@/lib/email';

/**
 * Driftstatus för leveransbarhet (CLAUDE.md § 54.10) — det som avgör om
 * mejlen når inkorgen: verifierad avsändardomän i Resend (SPF/DKIM), DMARC-
 * post i DNS, svarsadress, webhook-hemlighet och klicklänkarnas hemlighet.
 * Läser Resends `/domains` med API-nyckeln (bara status, inga värden som
 * lämnar servern) och slår upp `_dmarc.<domän>` TXT. Allt fail-soft: en
 * tjänst som inte svarar visas som "okänt", aldrig som fel på plattformen.
 */

export interface DomainStatus {
  domain: string;
  /** Resends status: `verified` | `pending` | `failed` | `not_started` | `unknown` | `missing` */
  status: string;
  /** Resends region (bör vara eu-west-1 för EU-suveränitet). */
  region: string;
}

export interface DmarcStatus {
  domain: string;
  record: string | null;
  /** `none` | `quarantine` | `reject` | null */
  policy: string | null;
  hasReporting: boolean;
}

export interface DeliverabilityStatus {
  emailConfigured: boolean;
  keyFormatOk: boolean;
  sender: string;
  inviteSender: string;
  replyTo: string | null;
  senderDomain: string;
  inviteDomain: string;
  domains: DomainStatus[];
  domainsError?: string;
  dmarc: DmarcStatus[];
  webhookSecretSet: boolean;
  linkSecretSet: boolean;
  appUrlSet: boolean;
  checkedAt: string;
}

function apiKey(): string {
  return (process.env.RESEND_API_KEY ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
}

async function resendDomains(): Promise<{ domains: DomainStatus[]; error?: string }> {
  const key = apiKey();
  if (!key) return { domains: [], error: 'RESEND_API_KEY saknas.' };
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store'
    });
    if (!res.ok) {
      if (res.status === 401) return { domains: [], error: 'Resend avvisade API-nyckeln.' };
      if (res.status === 403) return { domains: [], error: 'API-nyckeln saknar läsbehörighet (skapa en nyckel med "Full access" för att se domänstatus).' };
      return { domains: [], error: `Resend svarade ${res.status}.` };
    }
    const body = (await res.json()) as { data?: Array<{ name?: unknown; status?: unknown; region?: unknown }> };
    const list = Array.isArray(body.data) ? body.data : [];
    return {
      domains: list.map((d) => ({
        domain: typeof d.name === 'string' ? d.name : '',
        status: typeof d.status === 'string' ? d.status : 'unknown',
        region: typeof d.region === 'string' ? d.region : ''
      }))
    };
  } catch {
    return { domains: [], error: 'Kunde inte nå Resend.' };
  }
}

export async function lookupDmarc(domain: string): Promise<DmarcStatus> {
  const empty: DmarcStatus = { domain, record: null, policy: null, hasReporting: false };
  if (!domain || !/^[a-z0-9.-]+$/i.test(domain)) return empty;
  // Avsändardomänen kan vara en underdomän (mail.movexum.se): DMARC gäller
  // då från underdomänen eller organisationsdomänen.
  const candidates = [domain];
  const parts = domain.split('.');
  if (parts.length > 2) candidates.push(parts.slice(-2).join('.'));
  for (const d of candidates) {
    try {
      const txt = await dns.resolveTxt(`_dmarc.${d}`);
      const record = txt.map((chunks) => chunks.join('')).find((r) => /^v=DMARC1/i.test(r));
      if (record) {
        const policy = /;\s*p=([a-z]+)/i.exec(record)?.[1]?.toLowerCase() ?? null;
        return { domain: d, record, policy, hasReporting: /rua=/i.test(record) };
      }
    } catch {
      /* ingen post på den nivån */
    }
  }
  return empty;
}

export async function loadDeliverabilityStatus(): Promise<DeliverabilityStatus> {
  const sender = resolveSender(process.env, 'default');
  const inviteSender = resolveSender(process.env, 'invite');
  const senderDomain = senderAddress(sender).split('@')[1] ?? '';
  const inviteDomain = senderAddress(inviteSender).split('@')[1] ?? '';
  const domainsToCheck = [...new Set([senderDomain, inviteDomain].filter(Boolean))];
  const [domainsRes, dmarc] = await Promise.all([resendDomains(), Promise.all(domainsToCheck.map(lookupDmarc))]);
  const known = new Map(domainsRes.domains.map((d) => [d.domain.toLowerCase(), d]));
  // Avsändardomänen kan vara en underdomän av en verifierad domän i Resend.
  const domains: DomainStatus[] = domainsToCheck.map((d) => {
    const hit = known.get(d.toLowerCase()) ?? [...known.values()].find((k) => d.toLowerCase().endsWith(`.${k.domain.toLowerCase()}`));
    return hit ? { ...hit, domain: d } : { domain: d, status: domainsRes.error ? 'unknown' : 'missing', region: '' };
  });
  return {
    emailConfigured: isEmailConfigured(),
    keyFormatOk: resendKeyLooksValid(),
    sender,
    inviteSender,
    replyTo: resolveReplyTo(process.env),
    senderDomain,
    inviteDomain,
    domains,
    ...(domainsRes.error ? { domainsError: domainsRes.error } : {}),
    dmarc,
    webhookSecretSet: Boolean((process.env.RESEND_WEBHOOK_SECRET ?? '').trim()),
    linkSecretSet: Boolean(process.env.MOVEXUM_UNSUBSCRIBE_SECRET || process.env.MOVEXUM_INTEGRATION_KEY),
    appUrlSet: Boolean((process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim()),
    checkedAt: new Date().toISOString()
  };
}
