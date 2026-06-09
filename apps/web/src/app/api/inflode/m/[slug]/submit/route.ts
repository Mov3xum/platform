import { NextResponse } from 'next/server';
import { getCurrentUser, getServerPb } from '@/lib/auth.server';
import {
  createConversation,
  createLead,
  getModuleBySlug,
  listQuestionsForModule
} from '@/lib/compass/store';
import {
  attachAiSummary,
  buildSubmissionEntries,
  moduleWantsLead,
  parseContactPreference
} from '@/lib/compass/lead-capture';
import type { Attribution } from '@/lib/compass/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SubmitBody {
  answers: Record<string, string | string[]>;
  attribution?: Attribution;
  contact_preference?: string;
}

function pickString(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.slice(0, max);
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

  // Attribution — whitelist + längdgränser, ingen blind genomgång.
  const attr = body.attribution || {};
  const attribution: Record<string, string> = {};
  const utmSource = pickString(attr.utm_source, 100);
  if (utmSource) attribution.utm_source = utmSource;
  const utmMedium = pickString(attr.utm_medium, 100);
  if (utmMedium) attribution.utm_medium = utmMedium;
  const utmCampaign = pickString(attr.utm_campaign, 100);
  if (utmCampaign) attribution.utm_campaign = utmCampaign;
  const utmTerm = pickString(attr.utm_term, 100);
  if (utmTerm) attribution.utm_term = utmTerm;
  const utmContent = pickString(attr.utm_content, 200);
  if (utmContent) attribution.utm_content = utmContent;
  const referrerUrl = pickString(attr.referrer_url, 500);
  if (referrerUrl) attribution.referrer_url = referrerUrl;

  // Steg 4-valet: modulen kan vara konfigurerad att INTE skapa lead.
  if (!moduleWantsLead(mod)) {
    return NextResponse.json({ ok: true });
  }

  const name = leadPayload.name || 'Anonym';
  const lead = await createLead(pb, user.tenant, {
    ...leadPayload,
    ...attribution,
    name,
    source_key: 'web',
    landing_module: slug,
    contact_preference: parseContactPreference(body.contact_preference),
    consent_at: new Date().toISOString()
  });

  // Hård lead-garanti (CLAUDE.md § 23.6) — fela högt i stället för tyst tapp.
  if (!lead) {
    return NextResponse.json(
      { error: 'Svaren kunde inte sparas som lead. Se serverloggen för grundorsaken.' },
      { status: 500 }
    );
  }

  await createConversation(pb, user.tenant, {
    moduleSlug: slug,
    leadId: lead.id
  });

  // AI-sammanställning av det inskickade (best-effort — blockerar aldrig).
  const entries = buildSubmissionEntries(questions, answers);
  await attachAiSummary(pb, user.tenant, lead, entries, mod.name);

  return NextResponse.json({ ok: true, leadId: lead.id });
}
