import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import {
  createConversation,
  createLead,
  getModuleBySlug,
  listQuestionsForModule
} from '@/lib/compass/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SubmitBody {
  answers: Record<string, string | string[]>;
}

/** Tar emot svaren från ModuleWizard och skapar lead + conversation. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Login krävs' }, { status: 401 });
  }
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const answers = body.answers || {};
  const pb = await getServerPb();
  const mod = await getModuleBySlug(pb, user.tenant, slug);
  if (!mod) {
    return NextResponse.json({ error: 'Modul saknas' }, { status: 404 });
  }
  const questions = await listQuestionsForModule(pb, mod.id);

  // Validera obligatoriska
  for (const q of questions) {
    if (!q.required) continue;
    const v = answers[q.key];
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) {
      return NextResponse.json(
        { error: `Fältet "${q.prompt}" är obligatoriskt.` },
        { status: 400 }
      );
    }
  }

  // Mappa kända fält till lead-schemat (whitelist, inga övriga fält).
  const FIELD_MAP: Record<string, 'name' | 'email' | 'phone' | 'organization' | 'idea_summary' | 'idea_category'> = {
    name: 'name',
    namn: 'name',
    email: 'email',
    epost: 'email',
    phone: 'phone',
    telefon: 'phone',
    organization: 'organization',
    bolag: 'organization',
    idea: 'idea_summary',
    idea_summary: 'idea_summary',
    category: 'idea_category',
    kategori: 'idea_category'
  };

  const leadPayload: Record<string, string> = {};
  for (const [key, raw] of Object.entries(answers)) {
    const field = FIELD_MAP[key];
    if (!field) continue;
    const value = Array.isArray(raw) ? raw.join(', ') : raw;
    if (typeof value === 'string' && value.trim().length > 0) {
      leadPayload[field] = value.trim().slice(0, field === 'idea_summary' ? 4000 : 200);
    }
  }

  const name = leadPayload.name || 'Anonym';
  const lead = await createLead(pb, user.tenant, {
    ...leadPayload,
    name,
    source_key: 'web',
    consent_at: new Date().toISOString()
  });

  if (lead) {
    await createConversation(pb, user.tenant, {
      moduleSlug: slug,
      leadId: lead.id
    });
  }

  return NextResponse.json({ ok: true, leadId: lead?.id });
}
