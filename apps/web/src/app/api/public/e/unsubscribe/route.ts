import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { relativeRedirectInit } from '@/lib/relative-redirect';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { unsubscribeSecret, verifyUnsubscribeKey } from '@/lib/unsubscribe-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;

/**
 * Avregistrering från inbjudningar (CLAUDE.md § 53.5).
 *
 * - POST från mejlklientens en-klicksknapp (RFC 8058: `List-Unsubscribe-Post:
 *   List-Unsubscribe=One-Click`, nyckeln i adressen) → 200.
 * - POST från bekräftelsesidan `/e/avregistrera` (nyckeln i formuläret)
 *   → 303 tillbaka till sidan.
 * - GET avregistrerar ALDRIG (mejlskannrar förhandsläser länkar) — den
 *   skickar vidare till bekräftelsesidan.
 *
 * Nyckeln är en HMAC över kontaktens id (`lib/unsubscribe-key.ts`); bara
 * `contacts.invite_opt_out` sätts. IP används bara transient för rate-limiten.
 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('k') || '';
  const qs = new URLSearchParams(key ? { k: key } : {});
  return new NextResponse(null, relativeRedirectInit(`/e/avregistrera${qs.size ? `?${qs}` : ''}`));
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

  const contactId = verifyUnsubscribeKey(key, unsubscribeSecret());
  if (!contactId) return oneClick ? NextResponse.json({ error: 'Ogiltig länk.' }, { status: 400 }) : back('fel=lank');

  const su = await getSuperuserPb();
  if (!su.ok) {
    console.error('[unsubscribe] superuser unavailable');
    return oneClick ? NextResponse.json({ error: 'Försök igen senare.' }, { status: 503 }) : back('fel=spara');
  }
  // `alla=1` (kampanjmejl, § 55.9): en-klicksavregistrering stänger av ALLA
  // utskick — mottagaren förväntar sig att sluta få mejl. Utan flaggan
  // (inbjudningar, § 53.5) bara eventkategorin.
  const all = new URL(req.url).searchParams.get('alla') === '1' || form?.get('alla') === '1';
  try {
    await su.pb.collection('contacts').update(contactId, {
      invite_opt_out: true,
      invite_opt_out_at: new Date().toISOString(),
      ...(all ? { email_opt_out: ['all'] } : {})
    });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    // Kontakten borttagen ⇒ inget mer att skicka till; behandla som klart.
    if (status !== 404) {
      console.error('[unsubscribe] update failed', status);
      return oneClick ? NextResponse.json({ error: 'Försök igen senare.' }, { status: 503 }) : back('fel=spara');
    }
  }
  return oneClick ? new NextResponse('Avregistrerad.', { status: 200 }) : back(all ? 'klart=1&alla=1' : 'klart=1');
}
