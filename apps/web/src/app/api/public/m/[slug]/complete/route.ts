import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { isSurveyModule } from '@platform/shared';
import { AiBudgetExceededError, assertWithinAiBudget } from '@/lib/ai/budget.server';
import { logAiUsage } from '@/lib/ai/usage';
import { sendChatSummaryEmail } from '@/lib/email';
import { isValidChatSessionToken } from '@/lib/compass/chat-lead';
import { summarizeChatForVisitor } from '@/lib/compass/chat';
import { buildChatSummaryPdf, summaryAnswersFromEntries } from '@/lib/compass/chat-summary';
import { closingQuestions, missingClosingField } from '@/lib/compass/completion';
import {
  buildSubmissionEntries,
  finalizeLead,
  moduleWantsLead,
  parseContactPreference
} from '@/lib/compass/lead-capture';
import { notifyNewInflow } from '@/lib/compass/notify';
import { getPublicModuleQuestions, mapAnswersToLead, pickAttribution, resolvePublicModule } from '@/lib/compass/public';
import { findConversationBySession, listMessages, patchConversation } from '@/lib/compass/store';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import type { Attribution } from '@/lib/compass/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 10;

interface CompleteBody {
  sessionToken?: string;
  answers?: Record<string, string | string[]>;
  contact?: { name?: unknown; email?: unknown; phone?: unknown; organization?: unknown };
  contact_preference?: string;
  /** Besökaren bad om sammanfattningen per e-post (till adressen i `contact.email`). */
  send_summary?: boolean;
  attribution?: Attribution;
  consent?: boolean;
}

function cleanContact(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

/**
 * Chattens avslutssteg (§ 23.10): obligatoriska frågor + kontaktfält fylls i
 * EFTER samtalet (precis som i formulär/quiz), leadet slutförs, en
 * sammanfattning till besökaren genereras (laddas ned som PDF via
 * /summary-pdf och/eller mejlas) och inflödesnotisen går först nu — ett
 * slutfört samtal, inte en första tur.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ip = clientIpFromRequest(req);
  const rlKey = `compass-pub-complete:${ip}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) {
    return NextResponse.json({ error: 'För många förfrågningar. Försök igen om en stund.' }, { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);

  let body: CompleteBody;
  try {
    body = (await req.json()) as CompleteBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!isValidChatSessionToken(body.sessionToken)) {
    return NextResponse.json({ error: 'Ogiltig session. Ladda om sidan.' }, { status: 400 });
  }

  const resolved = await resolvePublicModule(slug);
  if (!resolved) return NextResponse.json({ error: 'Modul saknas eller är inte publik.' }, { status: 404 });
  const { pb, module, tenant } = resolved;
  if (module.flow_type !== 'chat' || isSurveyModule(module)) {
    return NextResponse.json({ error: 'Modulen är inte en chatt.' }, { status: 400 });
  }
  if (module.consent_note && body.consent !== true) {
    return NextResponse.json({ error: 'Samtycke krävs.' }, { status: 400 });
  }

  const questions = await getPublicModuleQuestions(pb, module.id);
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const contact = {
    name: cleanContact(body.contact?.name, 200),
    email: cleanContact(body.contact?.email, 254),
    phone: cleanContact(body.contact?.phone, 50),
    organization: cleanContact(body.contact?.organization, 200)
  };
  // Klienten är aldrig gränsen — samma kontroll som i avslutsformuläret.
  const missing = missingClosingField({
    questions,
    answers,
    contact,
    requirements: {
      requireEmail: module.require_email,
      requirePhone: module.require_phone,
      requireOrganization: module.require_organization
    }
  });
  if (missing) return NextResponse.json({ error: missing }, { status: 400 });
  if (body.send_summary && !contact.email) {
    return NextResponse.json({ error: 'Ange en e-postadress för att få sammanfattningen skickad.' }, { status: 400 });
  }

  const conversation = await findConversationBySession(pb, tenant, slug, body.sessionToken);
  if (!conversation) {
    return NextResponse.json({ error: 'Samtalet hittades inte. Ladda om sidan och försök igen.' }, { status: 404 });
  }
  const history = (await listMessages(pb, conversation.id)).filter(
    (m): m is { role: 'user' | 'assistant'; content: string } => m.role !== 'system'
  );
  const closingEntries = buildSubmissionEntries(closingQuestions(questions), answers);

  // Sammanfattning till besökaren (best-effort; fallback = sista assistentsvaret).
  let summary: string | null = null;
  try {
    await assertWithinAiBudget(pb, tenant);
    const res = await summarizeChatForVisitor(history, closingEntries, module.name);
    if (res.usage) {
      await logAiUsage(pb, {
        tenant,
        surface: 'suggestions',
        model: res.usage.model,
        tokensIn: res.usage.tokensIn,
        tokensOut: res.usage.tokensOut
      });
    }
    summary = res.summary;
  } catch (err) {
    if (!(err instanceof AiBudgetExceededError)) {
      console.error('[compass] visitor summary failed', { status: (err as { status?: number })?.status });
    }
  }
  if (!summary) {
    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
    summary = lastAssistant?.content.trim() || 'Tack för samtalet! Movexum återkommer gärna om nästa steg.';
  }
  const summaryAnswers = summaryAnswersFromEntries(closingEntries);
  // Sammanfattningen + avslutssvaren bor på konversationen (staff-only RLS)
  // så PDF-nedladdningen bygger på SERVERNS data, aldrig klientens text.
  await patchConversation(pb, conversation.id, {
    status: 'completed',
    extracted_data: { visitor_summary: summary, closing_answers: summaryAnswers }
  });

  let leadId: string | undefined;
  if (moduleWantsLead(module)) {
    const mapped = mapAnswersToLead(answers);
    const finalized = await finalizeLead(pb, tenant, {
      moduleSlug: slug,
      sessionToken: body.sessionToken,
      fields: {
        ...mapped,
        name: contact.name || mapped.name,
        email: contact.email || mapped.email,
        phone: contact.phone || mapped.phone,
        organization: contact.organization || mapped.organization,
        contact_preference: parseContactPreference(body.contact_preference),
        ai_summary: summary,
        ...pickAttribution(body.attribution),
        source_key: 'ai-chat',
        source_detail: `AI-chatt via ${module.name}`,
        landing_module: slug,
        consent_at: new Date().toISOString()
      }
    });
    if (!finalized) {
      return NextResponse.json(
        { error: 'Dina uppgifter kunde inte sparas just nu. Försök igen om en stund.' },
        { status: 500 }
      );
    }
    leadId = finalized.lead.id;
    await notifyNewInflow(module, finalized.lead);
  }

  let emailed = false;
  let emailError: string | undefined;
  if (body.send_summary && contact.email) {
    try {
      const pdf = await buildChatSummaryPdf({
        moduleName: module.name,
        summary,
        answers: summaryAnswers,
        accent: module.theme_color
      });
      await sendChatSummaryEmail(contact.email, {
        moduleName: module.name,
        summary,
        answers: summaryAnswers,
        pdf
      });
      emailed = true;
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Sammanfattningen kunde inte skickas.';
      console.error('[compass] summary email failed', { status: (err as { status?: number })?.status });
    }
  }

  return NextResponse.json({ ok: true, leadId, summary, emailed, emailError });
}
