import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { transcribeAudio, VoiceError, voiceModel } from '@/lib/ai/voice';
import { logAiUsage } from '@/lib/ai/usage';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import {
  MEETING_COLLECTION,
  loadOwnedMeeting,
  meetingWriteWithFallback
} from '@/lib/meetings/access';
import {
  MAX_MEETING_SEGMENTS,
  MAX_VOICE_BYTES,
  normalizeMeetingSegments,
  validateVoiceClip,
  type MeetingSegment
} from '@platform/shared';
import type { Role } from '@platform/shared';

/**
 * Mötesläge (CLAUDE.md § 34): tar emot ETT inspelat mötessegment (~90 s),
 * transkriberar det med Voxtral (Mistral, EU) och appendar TEXTEN på det
 * pågående mötets `meeting_transcripts`-rad. Ljudet är transient — det lagras
 * aldrig, varken här eller hos Mistral (§ 31-principen oförändrad).
 *
 * Route handler (inte server action) → inte bunden av serverActions.
 * bodySizeLimit (§ 18.2-mönstret). Auth-cookien är SameSite=Lax → cross-site
 * POST saknar cookie (CSRF-skydd, § 17.8). Ägar-verifiering i kod ovanpå
 * kollektionens strikt ägaren-bara RLS (defense-in-depth).
 *
 * Personnummer saneras INNAN texten lagras (§ 15.6-regexen) — deltagare säger
 * personnummer högt i möten.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

// Sekventiell klient laddar upp ~1 segment/90 s; 40/5 min lämnar rejäl
// marginal för retries men stoppar en skenande klient (kostnadstak, § 10).
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX_PER_USER = 40;

export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Ej inloggad.' }, { status: 401 });
  if (!hasRole(user.roles, STAFF_ROLES)) {
    return NextResponse.json({ error: 'Åtkomst nekad.' }, { status: 403 });
  }

  const rateKey = `meeting-segment:${user.id}`;
  const limited = checkRateLimit(rateKey, RATE_MAX_PER_USER);
  if (limited.blocked) {
    return NextResponse.json(
      { error: 'För många segment just nu. Vänta en stund och försök igen.' },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSec) } }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Kunde inte läsa segmentet.' }, { status: 400 });
  }

  const meetingId = String(form.get('meetingId') || '').trim();
  const segmentIndex = Number(form.get('segmentIndex'));
  const entry = form.get('audio');
  if (!meetingId) {
    return NextResponse.json({ error: 'meetingId saknas.' }, { status: 400 });
  }
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= MAX_MEETING_SEGMENTS) {
    return NextResponse.json({ error: 'Ogiltigt segmentindex.' }, { status: 400 });
  }
  if (!(entry instanceof File) || entry.size === 0) {
    return NextResponse.json({ error: 'Ingen inspelning skickades.' }, { status: 400 });
  }
  if (entry.size > MAX_VOICE_BYTES) {
    return NextResponse.json({ error: 'Segmentet är för stort.' }, { status: 413 });
  }
  const validation = validateVoiceClip(entry.type, entry.size);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const pb = await getServerPb();

  // Ägar-verifierad läsning med superuser-fallback (§ 21.3 — PB v0.23.4 kan
  // tyst neka en behörig ägare även på view-regeln; ägar-/tenant-checken i
  // loadOwnedMeeting är den hårda gränsen).
  const meeting = await loadOwnedMeeting(pb, meetingId, user);
  if (!meeting) {
    return NextResponse.json({ error: 'Mötet hittades inte.' }, { status: 404 });
  }
  if (meeting.status !== 'recording') {
    return NextResponse.json({ error: 'Mötet är inte längre i inspelningsläge.' }, { status: 409 });
  }

  const existing = normalizeMeetingSegments(meeting.segments);
  if (existing.length >= MAX_MEETING_SEGMENTS) {
    return NextResponse.json({ error: 'Mötet har nått maxlängden.' }, { status: 409 });
  }

  // Varje anrop räknas mot fönstret — det är kostnaden vi skyddar.
  recordFailure(rateKey, RATE_WINDOW_MS);

  const buffer = Buffer.from(await entry.arrayBuffer());

  let text = '';
  let model = voiceModel();
  try {
    const result = await transcribeAudio(buffer, validation.mime);
    text = sanitizePersonnummer(result.text);
    model = result.model || model;
    await logAiUsage(pb, {
      tenant: user.tenant,
      userId: user.id,
      surface: 'dashboard_chat',
      model,
      tokensIn: result.usage.tokensIn,
      tokensOut: result.usage.tokensOut
    });
  } catch (err) {
    // Tystnad i ett mötessegment är normalt (ingen pratade på 90 s) — det är
    // INTE ett fel: registrera ett tomt segment så luck-detekteringen inte
    // felmarkerar det som bortfall.
    if (err instanceof VoiceError && err.status === 422) {
      text = '';
    } else if (err instanceof VoiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    } else {
      console.error('[meeting-segment] oväntat fel', {
        userId: user.id,
        error: err instanceof Error ? err.message : 'okänt'
      });
      return NextResponse.json({ error: 'Kunde inte transkribera segmentet.' }, { status: 500 });
    }
  }

  const segment: MeetingSegment = {
    index: segmentIndex,
    text,
    at: new Date().toISOString()
  };
  const updated = [...existing.filter((s) => s.index !== segmentIndex), segment];

  try {
    // Superuser-fallback vid tyst regel-nekande (400/403/404, § 21.3) — utan
    // den transkriberas segmentet hos Voxtral men kan inte sparas, och mötet
    // slutar som ett tomt transkript. Ägaren är redan verifierad ovan.
    await meetingWriteWithFallback(pb, (client) =>
      client.collection(MEETING_COLLECTION).update(meetingId, { segments: updated })
    );
  } catch (err) {
    console.error('[meeting-segment] kunde inte spara segmentet', {
      userId: user.id,
      error: err instanceof Error ? err.message : 'okänt'
    });
    return NextResponse.json({ error: 'Kunde inte spara segmentet.' }, { status: 500 });
  }

  return NextResponse.json({ text, segmentIndex });
}
