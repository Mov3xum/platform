import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { transcribeAudio, VoiceError, voiceModel } from '@/lib/ai/voice';
import { logAiUsage } from '@/lib/ai/usage';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { MAX_VOICE_BYTES, validateVoiceClip } from '@platform/shared';
import type { Role } from '@platform/shared';

/**
 * Röstinmatning i chatten (CLAUDE.md § 31). Tar emot ett inspelat ljudklipp,
 * transkriberar det med Voxtral (Mistral, EU) och returnerar TEXTEN — inget
 * mer. Klienten lägger texten i chattrutan där människan läser igenom och
 * skickar den själv (människa-i-loopen, EU AI Act art. 14): en felhörd mening
 * får aldrig tyst utlösa en skrivning.
 *
 * Route handler (inte server action) → inte bunden av next.config:s
 * serverActions.bodySizeLimit, så ett par minuters ljud går igenom (samma
 * mönster som /api/knowledge, § 26.3). Auth-cookien är SameSite=Lax → en
 * cross-site POST saknar cookie (CSRF-skydd, § 17.8).
 *
 * Dataminimering (GDPR § 5): ljudet lagras aldrig — varken här eller hos
 * Mistral (ingen träning, DPA § 10.2). Bara token-utfallet loggas i
 * `ai_usage_events` (PII-fritt, § 9.6).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Samma krets som chatten själv — röst är inte en ny dataväg, bara ett nytt
// sätt att skriva i en yta användaren redan har (§ 16.3, § 21.5).
const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

// Robusthet + kostnadstak (EU AI Act art. 15 / ISO 27001 A.8.x): en trasig
// klient som loopar inspelningar ska inte kunna bränna budgeten.
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX_PER_USER = 40;

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!hasRole(user.roles, STAFF_ROLES)) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }

  const rateKey = `voice:${user.id}`;
  const limited = checkRateLimit(rateKey, RATE_MAX_PER_USER);
  if (limited.blocked) {
    return NextResponse.json(
      { error: 'För många röstinspelningar just nu. Vänta en stund och försök igen.' },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Kunde inte läsa ljudklippet.' }, { status: 400 });
  }

  const entry = form.get('audio');
  if (!(entry instanceof File) || entry.size === 0) {
    return NextResponse.json({ error: 'Ingen inspelning skickades.' }, { status: 400 });
  }
  if (entry.size > MAX_VOICE_BYTES) {
    return NextResponse.json({ error: 'Ljudklippet är för stort.' }, { status: 413 });
  }

  const validation = validateVoiceClip(entry.type, entry.size);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // Varje anrop räknas mot fönstret (inte bara fel) — det är kostnaden vi
  // skyddar, inte ett lösenord.
  recordFailure(rateKey, RATE_WINDOW_MS);

  const buffer = Buffer.from(await entry.arrayBuffer());

  try {
    const result = await transcribeAudio(buffer, validation.mime);

    const pb = await getServerPb();
    await logAiUsage(pb, {
      tenant: user.tenant,
      userId: user.id,
      surface: 'dashboard_chat',
      model: result.model || voiceModel(),
      tokensIn: result.usage.tokensIn,
      tokensOut: result.usage.tokensOut
    });

    return NextResponse.json({ text: result.text, language: result.language });
  } catch (err) {
    if (err instanceof VoiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // PII-fri logg: aldrig ljudet, aldrig transkriptet.
    console.error('[voice] oväntat fel', {
      userId: user.id,
      error: err instanceof Error ? err.message : 'okänt'
    });
    return NextResponse.json(
      { error: 'Kunde inte transkribera inspelningen.' },
      { status: 500 }
    );
  }
}
