import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { relativeRedirectInit } from '@/lib/relative-redirect';
import { requestOrigin } from '@/lib/request-origin';
import { startSubscription } from '@/lib/email/subscribe.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

/** Steg 1 i dubbel opt-in (CLAUDE.md § 54.9): skicka bekräftelsemejlet. */
export async function POST(req: Request) {
  const rlKey = `newsletter-subscribe:${clientIpFromRequest(req)}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) {
    return NextResponse.json({ error: 'För många försök. Vänta en stund.' }, { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Ogiltig förfrågan.' }, { status: 400 });
  }
  const org = String(form.get('org') ?? '');
  const back = (qs: string) => new NextResponse(null, relativeRedirectInit(`/e/prenumerera?${qs}`));
  // Honungsfälla: robotar fyller i det dolda fältet — svara som om det lyckades.
  if (String(form.get('website') ?? '')) return back(`org=${encodeURIComponent(org)}&skickat=1`);
  const origin = (await requestOrigin()) || new URL(req.url).origin;
  const res = await startSubscription({
    email: form.get('email'),
    name: form.get('name'),
    organization: form.get('organization'),
    org,
    baseUrl: origin
  });
  if (!res.ok) return back(`org=${encodeURIComponent(org)}&fel=${encodeURIComponent(res.error)}`);
  return back(`org=${encodeURIComponent(org)}&skickat=1`);
}
