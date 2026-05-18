'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  createLead,
  getLead,
  logSecurity,
  updateLead
} from '@/lib/compass/store';
import { marketScanLead, reviewLead, scoreLead } from '@/lib/compass/chat';
import {
  LEAD_STATUS_ORDER,
  type LeadStatus
} from '@/lib/compass/types';

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;

function isLeadStatus(v: unknown): v is LeadStatus {
  return typeof v === 'string' && (LEAD_STATUS_ORDER as readonly string[]).includes(v);
}

export async function updateLeadStatusAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Forbidden');
  }

  const id = String(formData.get('id') || '');
  const status = formData.get('status');
  if (!id || !isLeadStatus(status)) {
    throw new Error('Invalid input');
  }

  const pb = await getServerPb();
  const previous = await getLead(pb, user.tenant, id);
  if (!previous) {
    throw new Error('Not found');
  }
  await updateLead(pb, user.tenant, id, { status });
  await logSecurity(pb, user.tenant, {
    actor: user.id,
    kind: status === 'accepted' ? 'module_publish' : 'role_change',
    subject: id,
    meta: { from: previous.status, to: status }
  });

  revalidatePath('/inflode');
  revalidatePath('/inflode/leads');
  revalidatePath(`/inflode/leads/${id}`);
}

export async function updateLeadNotesAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  const notes = String(formData.get('notes') || '').slice(0, 8000);
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  await updateLead(pb, user.tenant, id, { notes });
  revalidatePath(`/inflode/leads/${id}`);
}

export async function rescoreLeadAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  const lead = await getLead(pb, user.tenant, id);
  if (!lead) throw new Error('Not found');

  const { score, reasoning } = await scoreLead({
    name: lead.name ?? null,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    organization: lead.organization ?? null,
    idea_summary: lead.idea_summary ?? null,
    idea_category: lead.idea_category ?? null
  });
  await updateLead(pb, user.tenant, id, { score, score_reasoning: reasoning });

  revalidatePath(`/inflode/leads/${id}`);
}

export async function deleteLeadAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  const lead = await getLead(pb, user.tenant, id);
  if (!lead) {
    redirect('/inflode/leads');
  }
  try {
    await pb.collection('compass_leads').delete(id);
  } catch {
    // ignore — RLS-fel returnerar 404, vilket inte är hjälpsamt här
  }
  await logSecurity(pb, user.tenant, {
    actor: user.id,
    kind: 'lead_delete',
    subject: id,
    meta: { name: lead.name }
  });

  revalidatePath('/inflode');
  revalidatePath('/inflode/leads');
  redirect('/inflode/leads');
}

export async function createManualLeadAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Forbidden');
  }
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim() || undefined;
  const phone = String(formData.get('phone') || '').trim() || undefined;
  const organization = String(formData.get('organization') || '').trim() || undefined;
  const idea = String(formData.get('idea_summary') || '').trim() || undefined;
  const source = String(formData.get('source_key') || 'call');
  if (!name) {
    throw new Error('Namn saknas');
  }

  const pb = await getServerPb();
  const lead = await createLead(pb, user.tenant, {
    name,
    email,
    phone,
    organization,
    idea_summary: idea,
    source_key: source
  });
  if (!lead) {
    throw new Error('Kunde inte skapa lead');
  }

  revalidatePath('/inflode');
  revalidatePath('/inflode/leads');
  redirect(`/inflode/leads/${lead.id}`);
}

/* ────────────────────────────────────────────────────────────────────
   AI-granskning & omvärldsanalys
   ──────────────────────────────────────────────────────────────────── */

function leadToExtractedData(lead: {
  name?: string;
  email?: string;
  phone?: string;
  organization?: string;
  idea_summary?: string;
  idea_category?: string;
}) {
  return {
    name: lead.name ?? null,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    organization: lead.organization ?? null,
    idea_summary: lead.idea_summary ?? null,
    idea_category: lead.idea_category ?? null
  };
}

export async function runAiReviewAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Invalid input');
  const pb = await getServerPb();
  const lead = await getLead(pb, user.tenant, id);
  if (!lead) throw new Error('Not found');

  const review = await reviewLead(leadToExtractedData(lead));
  await updateLead(pb, user.tenant, id, { ai_review: review });
  revalidatePath(`/inflode/leads/${id}`);
}

export async function runMarketScanAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Invalid input');
  const pb = await getServerPb();
  const lead = await getLead(pb, user.tenant, id);
  if (!lead) throw new Error('Not found');

  const scan = await marketScanLead(leadToExtractedData(lead));
  await updateLead(pb, user.tenant, id, { market_scan: scan });
  revalidatePath(`/inflode/leads/${id}`);
}

/* ────────────────────────────────────────────────────────────────────
   Konvertera lead → startup
   ──────────────────────────────────────────────────────────────────── */

export async function convertLeadToStartupAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    throw new Error('Forbidden — bara staff kan konvertera leads till bolag.');
  }
  const id = String(formData.get('id') || '');
  const overrideName = String(formData.get('name') || '').trim();
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  const lead = await getLead(pb, user.tenant, id);
  if (!lead) throw new Error('Not found');
  if (lead.converted_startup) {
    redirect(`/startups/${lead.converted_startup}`);
  }

  const name = overrideName || lead.organization || lead.name || 'Nytt bolag';
  const description = lead.idea_summary || '';
  const tags = (lead.tags || []).join(', ');

  let createdId: string | undefined;
  try {
    const record = await pb.collection('startups').create({
      tenant: user.tenant,
      name,
      description,
      phase: 'inflode',
      status: 'active',
      next_step: lead.ai_review?.next_steps?.[0] || 'Boka uppstartsmöte med Movexum.',
      tags
    });
    createdId = record.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Kunde inte skapa bolaget.';
    throw new Error(`Konvertering misslyckades: ${msg}`);
  }

  await updateLead(pb, user.tenant, id, {
    status: 'accepted',
    converted_startup: createdId,
    converted_at: new Date().toISOString()
  });

  await logSecurity(pb, user.tenant, {
    actor: user.id,
    kind: 'module_publish',
    subject: id,
    meta: { event: 'lead_converted', startup: createdId, name }
  });

  revalidatePath('/inflode');
  revalidatePath('/inflode/leads');
  revalidatePath(`/inflode/leads/${id}`);
  revalidatePath('/startups');
  redirect(`/startups/${createdId}`);
}

/* ────────────────────────────────────────────────────────────────────
   Module CRUD — staff hanterar intag-flöden
   ──────────────────────────────────────────────────────────────────── */

const FLOW_TYPES = ['chat', 'wizard', 'quiz'] as const;
const ADMIN_ROLES = ['admin', 'incubator_lead'] as const;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function createModuleAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...ADMIN_ROLES])) {
    throw new Error('Forbidden');
  }
  const name = String(formData.get('name') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const slugRaw = String(formData.get('slug') || '').trim();
  const flowType = String(formData.get('flow_type') || 'chat');
  const publicEnabled = formData.get('public_url_enabled') === 'on';
  const isActive = formData.get('is_active') === 'on';

  if (!name) throw new Error('Modul måste ha ett namn');
  if (!FLOW_TYPES.includes(flowType as (typeof FLOW_TYPES)[number])) {
    throw new Error('Ogiltig flow_type');
  }

  const slug = slugify(slugRaw || name);
  if (!slug) throw new Error('Slug kunde inte genereras');

  const pb = await getServerPb();
  let createdSlug = slug;
  try {
    const rec = await pb.collection('compass_modules').create({
      tenant: user.tenant,
      slug: createdSlug,
      name,
      description,
      flow_type: flowType,
      is_active: isActive,
      public_url_enabled: publicEnabled,
      sort_order: 999
    });
    createdSlug = rec.slug;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Okänt fel';
    throw new Error(`Kunde inte skapa modul: ${msg}`);
  }

  await logSecurity(pb, user.tenant, {
    actor: user.id,
    kind: isActive ? 'module_publish' : 'module_unpublish',
    subject: createdSlug,
    meta: { event: 'module_created', name, flow_type: flowType }
  });

  revalidatePath('/inflode');
  revalidatePath('/inflode/admin/modules');
  redirect(`/inflode/admin/modules/${createdSlug}`);
}

export async function updateModuleAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...ADMIN_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  // Verifiera tenant
  const existing = await pb.collection('compass_modules').getOne(id);
  if (existing.tenant !== user.tenant) throw new Error('Forbidden');

  const patch: Record<string, unknown> = {
    name: String(formData.get('name') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    target_audience: String(formData.get('target_audience') || '').trim(),
    intro_message: String(formData.get('intro_message') || '').trim(),
    success_message: String(formData.get('success_message') || '').trim(),
    redirect_url: String(formData.get('redirect_url') || '').trim(),
    theme_color: String(formData.get('theme_color') || '').trim(),
    system_prompt: String(formData.get('system_prompt') || '').trim(),
    consent_note: String(formData.get('consent_note') || '').trim(),
    is_active: formData.get('is_active') === 'on',
    public_url_enabled: formData.get('public_url_enabled') === 'on'
  };
  const flow = String(formData.get('flow_type') || '');
  if (FLOW_TYPES.includes(flow as (typeof FLOW_TYPES)[number])) {
    patch.flow_type = flow;
  }
  const model = String(formData.get('model') || '');
  if (model) patch.model = model;

  try {
    await pb.collection('compass_modules').update(id, patch);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Okänt fel';
    throw new Error(`Kunde inte uppdatera modul: ${msg}`);
  }

  await logSecurity(pb, user.tenant, {
    actor: user.id,
    kind: patch.is_active ? 'module_publish' : 'module_unpublish',
    subject: existing.slug,
    meta: { event: 'module_updated', name: patch.name }
  });

  revalidatePath('/inflode');
  revalidatePath('/inflode/admin/modules');
  revalidatePath(`/inflode/admin/modules/${existing.slug}`);
}

export async function deleteModuleAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...ADMIN_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  const existing = await pb.collection('compass_modules').getOne(id);
  if (existing.tenant !== user.tenant) throw new Error('Forbidden');

  try {
    await pb.collection('compass_modules').delete(id);
  } catch {
    // ignore
  }
  await logSecurity(pb, user.tenant, {
    actor: user.id,
    kind: 'module_unpublish',
    subject: existing.slug,
    meta: { event: 'module_deleted' }
  });
  revalidatePath('/inflode');
  revalidatePath('/inflode/admin/modules');
  redirect('/inflode/admin/modules');
}

/* ────────────────────────────────────────────────────────────────────
   Question CRUD — för wizard/quiz-moduler
   ──────────────────────────────────────────────────────────────────── */

const INPUT_TYPES = ['short_text', 'long_text', 'choice', 'multi_choice', 'scale', 'email', 'phone'] as const;

export async function addQuestionAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...ADMIN_ROLES])) {
    throw new Error('Forbidden');
  }
  const moduleId = String(formData.get('module_id') || '');
  const moduleSlug = String(formData.get('module_slug') || '');
  const key = slugify(String(formData.get('key') || ''));
  const prompt = String(formData.get('prompt') || '').trim();
  const helpText = String(formData.get('help_text') || '').trim();
  const inputType = String(formData.get('input_type') || 'short_text');
  const required = formData.get('required') === 'on';
  const choicesRaw = String(formData.get('choices') || '').trim();

  if (!moduleId || !key || !prompt) throw new Error('Modul, nyckel och fråga krävs');
  if (!INPUT_TYPES.includes(inputType as (typeof INPUT_TYPES)[number])) {
    throw new Error('Ogiltig input_type');
  }

  let choices: { value: string; label: string }[] | undefined;
  if (choicesRaw && (inputType === 'choice' || inputType === 'multi_choice')) {
    choices = choicesRaw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => {
        const [value, ...rest] = l.split('|').map((s) => s.trim());
        return { value: slugify(value || l), label: rest.join('|').trim() || value };
      });
  }

  const pb = await getServerPb();
  // Verify module ownership
  const mod = await pb.collection('compass_modules').getOne(moduleId);
  if (mod.tenant !== user.tenant) throw new Error('Forbidden');

  try {
    await pb.collection('compass_questions').create({
      module: moduleId,
      key,
      prompt,
      help_text: helpText || undefined,
      input_type: inputType,
      required,
      choices,
      sort_order: Date.now() % 1_000_000
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Okänt fel';
    throw new Error(`Kunde inte skapa fråga: ${msg}`);
  }

  revalidatePath(`/inflode/admin/modules/${moduleSlug}`);
}

export async function deleteQuestionAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...ADMIN_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  const moduleSlug = String(formData.get('module_slug') || '');
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  try {
    await pb.collection('compass_questions').delete(id);
  } catch {
    // ignore
  }
  revalidatePath(`/inflode/admin/modules/${moduleSlug}`);
}
