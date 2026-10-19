import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { relativeRedirectInit } from '@/lib/relative-redirect';
import { confirmSubscription } from '@/lib/email/subscribe.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;

/** Steg 2 i dubbel opt-in (CLAUDE.md § 55.9): POST från bekräftelsesidan skapar kontakten med samtycke. */
export async function POST(req: Request) {
  const rlKey = `newsletter-confirm:${clientIpFromRequest(req)}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar.' }, { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Ogiltig förfrågan.' }, { status: 400 });
  }
  const key = String(form.get('k') ?? '');
  const back = (qs: string) => new NextResponse(null, relativeRedirectInit(`/e/bekrafta?${qs}`));
  const res = await confirmSubscription(key);
  if (!res.ok) return back(res.error === 'lank' ? 'fel=lank' : `k=${encodeURIComponent(key)}&fel=spara`);
  return back('klart=1');
}
