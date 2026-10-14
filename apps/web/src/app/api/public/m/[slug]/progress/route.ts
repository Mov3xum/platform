import { NextResponse } from 'next/server';
import { clientIpFromRequest } from '@/lib/client-ip';
import { isSurveyModule } from '@platform/shared';
import { moduleWantsLead } from '@/lib/compass/lead-capture';
import { isValidChatSessionToken } from '@/lib/compass/chat-lead';
import { progressNote } from '@/lib/compass/completion';
import { mapAnswersToLead, pickAttribution, resolvePublicModule } from '@/lib/compass/public';
import {
  createConversation,
  createLead,
  findConversationBySession,
  getLead,
  patchConversation,
  updateLead
} from '@/lib/compass/store';
import { checkRateLimit, recordFailure } from '@/lib/rate-limit';
import type { Attribution } from '@/lib/compass/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_WINDOW = 60;

interface ProgressBody {
  sessionToken?: string;
  /** `progress` = besökaren gick vidare ett steg; `abandon` = pagehide-beacon. */
  event?: 'progress' | 'abandon';
  answers?: Record<string, string | string[]>;
  step?: number;
  total?: number;
  attribution?: Attribution;
  consent?: boolean;
}

const FLOW_LABEL: Record<string, string> = { quiz: 'quizet', wizard: 'formuläret', chat: 'chatten' };

/**
 * Genomförandestatus (§ 23.10). `progress`: formulär/quiz upsertar ett
 * PÅGÅENDE lead per session så ett avbrutet flöde syns i Startupkompassen
 * med det som hann svaras (slutförandet via /submit resp. /quiz-result
 * uppgraderar SAMMA lead till slutfört). `abandon`: ett pågående lead (alla
 * flödestyper) markeras avbrutet. Tenant härleds från modulen; inget skapas
 * för enkäter eller moduler utan lead-val. Best-effort: svarar alltid 200 så
 * flödet aldrig stannar på statusbokföring.
 */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ip = clientIpFromRequest(req);
  const rlKey = `compass-pub-progress:${ip}`;
  if ((await checkRateLimit(rlKey, MAX_PER_WINDOW)).blocked) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  await recordFailure(rlKey, WINDOW_MS);

  let body: ProgressBody;
  try {
    body = (await req.json()) as ProgressBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!isValidChatSessionToken(body.sessionToken)) {
    return NextResponse.json({ error: 'Ogiltig session.' }, { status: 400 });
  }
  const event = body.event === 'abandon' ? 'abandon' : 'progress';

  const resolved = await resolvePublicModule(slug);
  if (!resolved) return NextResponse.json({ ok: false }, { status: 404 });
  const { pb, module, tenant } = resolved;
  if (isSurveyModule(module) || !moduleWantsLead(module)) return NextResponse.json({ ok: true });
  if (module.consent_note && body.consent !== true && event === 'progress') {
    return NextResponse.json({ error: 'Samtycke krävs.' }, { status: 400 });
  }

  const existing = await findConversationBySession(pb, tenant, slug, body.sessionToken);

  if (event === 'abandon') {
    if (!existing?.lead) return NextResponse.json({ ok: true });
    const lead = await getLead(pb, tenant, existing.lead);
    if (lead && lead.completion !== 'completed') {
      await updateLead(pb, tenant, lead.id, { completion: 'abandoned' });
      await patchConversation(pb, existing.id, { status: 'abandoned' });
    }
    return NextResponse.json({ ok: true });
  }

  // progress — bara formulär/quiz (chatten bokför per tur i chat-routen).
  if (module.flow_type === 'chat') return NextResponse.json({ ok: true });
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
  const step = Number.isFinite(body.step) ? Number(body.step) : 0;
  const total = Number.isFinite(body.total) ? Number(body.total) : 0;
  const note = progressNote({ step, total, flow: FLOW_LABEL[module.flow_type] || 'modulen' });
  const mapped = mapAnswersToLead(answers);
  const fields = {
    ...mapped,
    name: mapped.name || 'Anonym',
    idea_summary: mapped.idea_summary || `${module.flow_type === 'quiz' ? 'Quiz' : 'Formulär'} "${module.name}" (ej slutfört)`,
    notes: note,
    completion: 'in_progress' as const
  };

  if (existing?.lead) {
    await updateLead(pb, tenant, existing.lead, fields);
    await patchConversation(pb, existing.id, { status: 'active' });
    return NextResponse.json({ ok: true });
  }
  const lead = await createLead(pb, tenant, {
    ...fields,
    ...pickAttribution(body.attribution),
    source_key: 'web',
    landing_module: slug,
    consent_at: new Date().toISOString()
  });
  if (!lead) return NextResponse.json({ ok: false });
  if (existing) await patchConversation(pb, existing.id, { lead: lead.id, status: 'active' });
  else await createConversation(pb, tenant, { moduleSlug: slug, sessionToken: body.sessionToken, leadId: lead.id });
  return NextResponse.json({ ok: true });
}
