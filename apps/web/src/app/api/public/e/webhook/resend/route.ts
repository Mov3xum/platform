import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { verifyWebhookSignature } from '@/lib/email/webhook-signature';
import { handleProviderEvent, type ProviderEvent } from '@/lib/email/webhook-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 600;

/**
 * Webhook från Resend (CLAUDE.md § 54.1): leveranser, studsar, klagomål.
 * Signaturen (Svix, `RESEND_WEBHOOK_SECRET` på web-appen i Coolify)
 * verifieras INNAN något läses — en oautentiserad POST kan annars spärra
 * godtyckliga adresser. Payloaden är DATA och loggas aldrig rått. Svarar
 * 200 även för händelsetyper vi inte hanterar (Resend försöker annars igen).
 * Konfigurera i Resend → Webhooks: `https://<app>/api/public/e/webhook/resend`
 * med händelserna delivered, bounced, complained, delivery_delayed.
 */
export async function POST(req: Request) {
  const secret = (process.env.RESEND_WEBHOOK_SECRET ?? '').trim();
  if (!secret) return NextResponse.json({ error: 'RESEND_WEBHOOK_SECRET saknas.' }, { status: 503 });

  const rlKey = `email-webhook:${clientIpFromRequest(req)}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar.' }, { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);

  const body = await req.text();
  if (body.length > 200_000) return NextResponse.json({ error: 'För stor payload.' }, { status: 413 });
  const verdict = verifyWebhookSignature(
    secret,
    { id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature') },
    body
  );
  if (!verdict.ok) {
    console.warn('[email-webhook] rejected', { reason: verdict.reason });
    return NextResponse.json({ error: 'Ogiltig signatur.' }, { status: 401 });
  }

  let event: ProviderEvent;
  try {
    event = JSON.parse(body) as ProviderEvent;
  } catch {
    return NextResponse.json({ error: 'Body måste vara JSON.' }, { status: 400 });
  }
  try {
    const outcome = await handleProviderEvent(event);
    return NextResponse.json({ ok: true, handled: outcome.handled, type: outcome.type });
  } catch (err) {
    // Superuser saknas eller PB nere: 503 så Resend försöker igen senare.
    console.error('[email-webhook] failed', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Försök igen senare.' }, { status: 503 });
  }
}
