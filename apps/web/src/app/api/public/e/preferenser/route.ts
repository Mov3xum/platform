import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { relativeRedirectInit } from '@/lib/relative-redirect';
import { savePreferences } from '@/lib/email/preferences.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;

/** Sparar valen från preferenscentret (CLAUDE.md § 54.9). POST, aldrig GET. */
export async function POST(req: Request) {
  const rlKey = `email-prefs:${clientIpFromRequest(req)}`;
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
  const back = (qs: string) => new NextResponse(null, relativeRedirectInit(`/e/installningar?${qs}`));
  const res = await savePreferences(key, form);
  if (!res.ok) return back(`k=${encodeURIComponent(key)}&fel=${res.error}`);
  return back('klart=1');
}
