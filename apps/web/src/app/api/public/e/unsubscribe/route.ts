import { NextResponse } from 'next/server';
import type PocketBase from 'pocketbase';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { relativeRedirectInit } from '@/lib/relative-redirect';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { addSuppression } from '@/lib/email/suppression';
import { unsubscribeSecret, verifyUnsubscribeSubject, type UnsubscribeSubject } from '@/lib/unsubscribe-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;

/**
 * Avregistrering från inbjudningar och kampanjer (CLAUDE.md § 53.5, § 55.6).
 *
 * - POST från mejlklientens en-klicksknapp (RFC 8058: `List-Unsubscribe-Post:
 *   List-Unsubscribe=One-Click`, nyckeln i adressen) → 200.
 * - POST från bekräftelsesidan `/e/avregistrera` (nyckeln i formuläret)
 *   → 303 tillbaka till sidan.
 * - GET avregistrerar ALDRIG (mejlskannrar förhandsläser länkar) — den
 *   skickar vidare till bekräftelsesidan.
 *
 * Nyckeln är en HMAC över mottagarposten (`lib/unsubscribe-key.ts`):
 * - kontakt i kontaktboken: `contacts.invite_opt_out` (+ `email_opt_out =
 *   ['all']` för kampanjmejl, `alla=1`) — kan ångras i preferenscentret;
 * - användare, bolag eller gäst i deltagarlistan: adressen läses ur posten
 *   och spärras i `email_suppressions` (reason `unsubscribe`), som varje
 *   utskick kontrollerar oavsett mall. Adressen lagras bara som hash.
 * IP används bara transient för rate-limiten.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get('k') || '';
  const all = url.searchParams.get('alla') === '1';
  const qs = new URLSearchParams({ ...(key ? { k: key } : {}), ...(all ? { alla: '1' } : {}) });
  return new NextResponse(null, relativeRedirectInit(`/e/avregistrera${qs.size ? `?${qs}` : ''}`));
}

type Lookup = { tenant: string; email: string } | null;

/** Adressen + tenanten för en icke-kontakt (superuser — ingen session). PII-fri logg. */
async function lookupAddress(pb: PocketBase, subject: UnsubscribeSubject): Promise<Lookup | 'gone'> {
  const collection = subject.kind === 'user' ? 'users' : subject.kind === 'startup' ? 'startups' : 'event_signups';
  try {
    const row = await pb.collection(collection).getOne<{ tenant?: string; email?: string }>(subject.id, { fields: 'id,tenant,email' });
    if (!row.tenant || !row.email) return null;
    return { tenant: row.tenant, email: row.email };
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return 'gone';
    console.error('[unsubscribe] lookup failed', { kind: subject.kind, status: (err as { status?: number })?.status });
    return null;
  }
}

export async function POST(req: Request) {
  const rlKey = `event-unsubscribe:${clientIpFromRequest(req)}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar.' }, { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);

  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    form = null;
  }
  const oneClick = form?.get('List-Unsubscribe') === 'One-Click';
  const key = new URL(req.url).searchParams.get('k') || String(form?.get('k') ?? '');
  const back = (qs: string) => new NextResponse(null, relativeRedirectInit(`/e/avregistrera?${qs}`));
  const retry = (qs: string) => (oneClick ? NextResponse.json({ error: 'Försök igen senare.' }, { status: 503 }) : back(qs));

  const subject = verifyUnsubscribeSubject(key, unsubscribeSecret());
  if (!subject) return oneClick ? NextResponse.json({ error: 'Ogiltig länk.' }, { status: 400 }) : back('fel=lank');

  const su = await getSuperuserPb();
  if (!su.ok) {
    console.error('[unsubscribe] superuser unavailable');
    return retry('fel=spara');
  }
  // `alla=1` (kampanjmejl, § 55.6): en-klicksavregistrering stänger av ALLA
  // utskick — mottagaren förväntar sig att sluta få mejl. Utan flaggan
  // (inbjudningar, § 53.5) bara eventkategorin. Andra mottagartyper än
  // kontakter har inga kategorier — de avregistreras alltid helt.
  const all = subject.kind !== 'contact' || new URL(req.url).searchParams.get('alla') === '1' || form?.get('alla') === '1';
  const done = () => (oneClick ? new NextResponse('Avregistrerad.', { status: 200 }) : back(all ? 'klart=1&alla=1' : 'klart=1'));

  if (subject.kind === 'contact') {
    try {
      await su.pb.collection('contacts').update(subject.id, {
        invite_opt_out: true,
        invite_opt_out_at: new Date().toISOString(),
        ...(all ? { email_opt_out: ['all'] } : {})
      });
    } catch (err) {
      const status = (err as { status?: number })?.status;
      // Kontakten borttagen ⇒ inget mer att skicka till; behandla som klart.
      if (status !== 404) {
        console.error('[unsubscribe] update failed', status);
        return retry('fel=spara');
      }
    }
    return done();
  }

  const found = await lookupAddress(su.pb, subject);
  if (found === 'gone') return done();
  if (!found) return retry('fel=spara');
  const res = await addSuppression({
    tenant: found.tenant,
    email: found.email,
    reason: 'unsubscribe',
    source: 'unsubscribe_link',
    note: `Avregistrering via mejl (${subject.kind})`
  });
  if (!res.ok) {
    console.error('[unsubscribe] suppression failed', { kind: subject.kind });
    return retry('fel=spara');
  }
  return done();
}
