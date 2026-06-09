'use server';

import PocketBase from 'pocketbase';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { getSuperuserPb } from '@/lib/integrations/credentials';
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
import { ALL_PHASES, validateWorkshopMediaFile, type StartupPhase } from '@platform/shared';

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;
const CONVERT_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

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
    redirect('/inflode/leads/new?error=missing_name');
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
    redirect('/inflode/leads/new?error=creation_failed');
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

// Default-fas vid konvertering: leadet kliver in i inkubatorns första
// riktiga fas. Staff kan välja en annan fas i konverteringsformuläret.
const DEFAULT_CONVERT_PHASE: StartupPhase = 'lead';

/**
 * Skriv en fashistorik-rad för det nyskapade bolaget. Fail-soft — får aldrig
 * blockera själva konverteringen (speglar createStartupAction i
 * lib/actions/startups.ts).
 */
async function writeInitialPhaseHistory(
  pb: Awaited<ReturnType<typeof getServerPb>>,
  tenant: string,
  startupId: string,
  phase: StartupPhase,
  userId: string
): Promise<void> {
  try {
    await pb.collection('startup_phase_history').create({
      tenant,
      startup: startupId,
      phase,
      entered_at: new Date().toISOString().slice(0, 10),
      created_by: userId
    });
  } catch (err) {
    console.error('[compass] phase-history write failed on convert', {
      startupId,
      message: err instanceof Error ? err.message : 'unknown'
    });
  }
}

export async function convertLeadToStartupAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...CONVERT_ROLES])) {
    throw new Error('Forbidden — bara staff kan konvertera leads till bolag.');
  }
  const id = String(formData.get('id') || '');
  const overrideName = String(formData.get('name') || '').trim();
  const phaseRaw = String(formData.get('phase') || '').trim();
  const coachId = String(formData.get('coach') || '').trim();
  if (!id) throw new Error('Invalid input');

  const phase: StartupPhase = ALL_PHASES.includes(phaseRaw as StartupPhase)
    ? (phaseRaw as StartupPhase)
    : DEFAULT_CONVERT_PHASE;

  const pb = await getServerPb();
  const lead = await getLead(pb, user.tenant, id);
  if (!lead) throw new Error('Not found');
  if (lead.converted_startup) {
    redirect(`/startups/${lead.converted_startup}`);
  }

  // Coachen måste tillhöra samma tenant (defense-in-depth utöver PB-reglerna).
  let coaches: string[] = [];
  if (coachId) {
    try {
      const coach = await pb
        .collection('users')
        .getOne<{ tenant: string }>(coachId, { fields: 'id,tenant' });
      if (coach.tenant === user.tenant) coaches = [coachId];
    } catch {
      coaches = [];
    }
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
      phase,
      status: 'active',
      next_step: lead.ai_review?.next_steps?.[0] || 'Boka uppstartsmöte med Movexum.',
      tags,
      ...(coaches.length > 0 ? { coaches } : {})
    });
    createdId = record.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Kunde inte skapa bolaget.';
    throw new Error(`Konvertering misslyckades: ${msg}`);
  }

  await writeInitialPhaseHistory(pb, user.tenant, createdId, phase, user.id);

  await updateLead(pb, user.tenant, id, {
    status: 'accepted',
    converted_startup: createdId,
    converted_at: new Date().toISOString()
  });

  await logSecurity(pb, user.tenant, {
    actor: user.id,
    kind: 'module_publish',
    subject: id,
    meta: { event: 'lead_converted', startup: createdId, name, phase }
  });

  revalidatePath('/inflode');
  revalidatePath('/inflode/leads');
  revalidatePath(`/inflode/leads/${id}`);
  revalidatePath('/startups');
  revalidatePath('/startups/inkubator');
  revalidatePath('/startups/inflode');
  redirect(`/startups/${createdId}`);
}

/**
 * Avslå en lead. Sätter status = 'declined' och kan spara en kort motivering
 * i de interna anteckningarna (konfidentiellt, exkluderas från AI). Mänskligt
 * beslut — sker aldrig automatiskt (EU AI Act art. 14, CLAUDE.md § 3).
 */
export async function declineLeadAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...CONVERT_ROLES])) {
    throw new Error('Forbidden — bara staff kan avslå leads.');
  }
  const id = String(formData.get('id') || '');
  const reason = String(formData.get('reason') || '').trim().slice(0, 1000);
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  const lead = await getLead(pb, user.tenant, id);
  if (!lead) throw new Error('Not found');

  const stamp = new Date().toLocaleDateString('sv-SE');
  const note = reason
    ? `${lead.notes ? `${lead.notes}\n\n` : ''}Avslag (${stamp}): ${reason}`
    : lead.notes;

  await updateLead(pb, user.tenant, id, {
    status: 'declined',
    ...(reason ? { notes: note } : {})
  });

  await logSecurity(pb, user.tenant, {
    actor: user.id,
    kind: 'role_change',
    subject: id,
    meta: { event: 'lead_declined', from: lead.status }
  });

  revalidatePath('/inflode');
  revalidatePath('/inflode/leads');
  revalidatePath(`/inflode/leads/${id}`);
  revalidatePath('/startups/inflode');
}

/* ────────────────────────────────────────────────────────────────────
   Module CRUD — staff hanterar intag-flöden
   ──────────────────────────────────────────────────────────────────── */

const FLOW_TYPES = ['chat', 'wizard', 'quiz'] as const;
// Startupkompassen hanteras av admin, coach och incubator_lead.
const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as { status?: number }).status;
  }
  return undefined;
}

// Skriv via app-user-klienten först; faller tillbaka på superuser vid 400/403
// (PB v0.23.4:s rule-eval-bugg, CLAUDE.md § 21.3 — annars behöriga staff-
// skrivningar nekas tyst → server-actionen kastade 500). Samma mönster som
// lib/actions/onboarding.ts + education-documents.ts. Roll + tenant verifieras
// ALLTID i server-actionen INNAN detta anropas — superusern är en robusthets-
// fallback, inte behörighetsgränsen.
async function writeWithFallback<T>(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<T>
): Promise<T> {
  try {
    return await run(pb);
  } catch (err) {
    const status = statusOf(err);
    if (status === 400 || status === 403) {
      const su = await getSuperuserPb();
      if (su.ok) return run(su.pb);
    }
    throw err;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function toErrorCode(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  if (/public_slug|unique|upptagen/.test(msg)) return 'public_slug_taken';
  if (/missing.+collection|not found|404/.test(msg)) return 'collections_missing';
  if (/forbidden|401|403/.test(msg)) return 'forbidden';
  return 'create_failed';
}

export async function createModuleAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) {
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
  if (!slug) {
    redirect('/inflode/admin/modules/new?error=slug_invalid');
  }
  const publicSlugRaw = slugify(String(formData.get('public_slug') || '') || slug);

  const pb = await getServerPb();
  let createdSlug = slug;
  // public_slug är GLOBALT unik (migration 1700000108). Vi kan inte läsa andra
  // tenants moduler med användartoken, så vi försöker den rena sluggen och
  // faller tillbaka på ett suffix om DB:n nekar pga unik-konflikt.
  async function createWith(publicSlug: string) {
    return writeWithFallback(pb, (client) =>
      client.collection('compass_modules').create({
        tenant: user.tenant,
        slug: createdSlug,
        public_slug: publicSlug,
        name,
        description,
        flow_type: flowType,
        is_active: isActive,
        public_url_enabled: publicEnabled,
        // Nya moduler skapar lead som default (steg 4-valet, migration 1700000125).
        create_lead: true,
        sort_order: 999
      })
    );
  }
  try {
    let rec;
    try {
      rec = await createWith(publicSlugRaw);
    } catch {
      rec = await createWith(`${publicSlugRaw}-${Math.random().toString(36).slice(2, 6)}`);
    }
    createdSlug = rec.slug;
  } catch (err) {
    const code = toErrorCode(err);
    redirect(`/inflode/admin/modules/new?error=${code}`);
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
  if (!hasRole(user.roles, [...MANAGE_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  // Verifiera tenant
  const existing = await pb.collection('compass_modules').getOne(id);
  if (existing.tenant !== user.tenant) throw new Error('Forbidden');

  const maxExchangesRaw = String(formData.get('max_exchanges') || '').trim();
  const maxExchanges = Number(maxExchangesRaw);

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
    // Startupkompassen — publik sida + chat-persona
    hero_eyebrow: String(formData.get('hero_eyebrow') || '').trim().slice(0, 120),
    welcome_title: String(formData.get('welcome_title') || '').trim().slice(0, 200),
    welcome_body: String(formData.get('welcome_body') || '').trim().slice(0, 4000),
    chat_persona: String(formData.get('chat_persona') || '').trim().slice(0, 4000),
    max_exchanges: Number.isFinite(maxExchanges) && maxExchanges >= 0 ? Math.min(maxExchanges, 100) : 0,
    require_email: formData.get('require_email') === 'on',
    require_phone: formData.get('require_phone') === 'on',
    require_organization: formData.get('require_organization') === 'on',
    // Steg 4: "Skapa lead i Startupkompassen när modulen slutförs".
    create_lead: formData.get('create_lead') === 'on',
    notify_emails: String(formData.get('notify_emails') || '').trim().slice(0, 1000),
    is_active: formData.get('is_active') === 'on',
    public_url_enabled: formData.get('public_url_enabled') === 'on'
  };

  // Publik slug (global unik). Bara sätt om angiven — tom lämnar oförändrad.
  const publicSlug = slugify(String(formData.get('public_slug') || ''));
  if (publicSlug) patch.public_slug = publicSlug;

  // Nästa modul i kedjan (migration 1700000124). Tom = nollställ (avsluta
  // flödet). En satt relation måste peka på en ANNAN modul i SAMMA tenant —
  // klienten är aldrig säkerhetsgränsen (CLAUDE.md § 10.5 punkt 7).
  const nextModuleRaw = String(formData.get('next_module') || '').trim();
  if (!nextModuleRaw) {
    patch.next_module = '';
  } else if (nextModuleRaw === id) {
    throw new Error('En modul kan inte kedjas till sig själv.');
  } else {
    // Läs målmodulen med användartoken först; PB v0.23.4 kan TYST neka
    // view-regeln (roll mot multi-value-fält, CLAUDE.md § 21.3) vilket fick
    // kedje-sparandet att fela med "kunde inte hittas" för behörig staff →
    // superuser-fallback. Tenant-likheten verifieras EXPLICIT oavsett klient.
    let target: { tenant?: string } | null = null;
    try {
      target = await pb.collection('compass_modules').getOne(nextModuleRaw);
    } catch {
      const su = await getSuperuserPb();
      if (su.ok) {
        try {
          target = await su.pb.collection('compass_modules').getOne(nextModuleRaw);
        } catch {
          target = null;
        }
      }
    }
    if (!target) {
      throw new Error('Vald nästa modul kunde inte hittas.');
    }
    if (target.tenant !== user.tenant) {
      throw new Error('Nästa modul tillhör en annan tenant.');
    }
    patch.next_module = nextModuleRaw;
  }

  // Quiz-resultatprofiler skickas som JSON från ResultBucketsEditor.
  const bucketsRaw = String(formData.get('result_buckets') || '').trim();
  if (bucketsRaw) {
    try {
      const parsed = JSON.parse(bucketsRaw);
      if (Array.isArray(parsed)) patch.result_buckets = parsed;
    } catch {
      throw new Error('Ogiltigt format på resultatprofiler (kunde inte tolka JSON).');
    }
  }

  const flow = String(formData.get('flow_type') || '');
  if (FLOW_TYPES.includes(flow as (typeof FLOW_TYPES)[number])) {
    patch.flow_type = flow;
  }
  const model = String(formData.get('model') || '');
  if (model) patch.model = model;

  // Omslagsbild (hero_image): ladda upp en ny bild, eller rensa den befintliga.
  // serverActions.bodySizeLimit är 32 MB → en bild på upp till 15 MB ryms.
  const heroImage = formData.get('hero_image');
  const removeHero = formData.get('remove_hero_image') === 'on';
  if (heroImage instanceof File && heroImage.size > 0) {
    const check = validateWorkshopMediaFile(
      { type: heroImage.type, size: heroImage.size },
      'image'
    );
    if (!check.ok) throw new Error(check.error);
    // Node/undici-gotcha (samma som /api/education/media): materialisera till
    // Buffer och slå om i en ny File innan vidaresändning till PocketBase, annars
    // kan filen skickas med tom body.
    const buffer = Buffer.from(await heroImage.arrayBuffer());
    patch.hero_image = new File([buffer], heroImage.name || `omslag-${Date.now()}`, {
      type: heroImage.type || 'application/octet-stream'
    });
  } else if (removeHero) {
    patch.hero_image = null;
  }

  try {
    await writeWithFallback(pb, (c) => c.collection('compass_modules').update(id, patch));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Okänt fel';
    // PB unik-index-fel på public_slug → vänligt meddelande.
    if (/public_slug|unique/i.test(msg)) {
      throw new Error('Den publika länken (slug) är upptagen — välj en annan.');
    }
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
  if (!hasRole(user.roles, [...MANAGE_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  const existing = await pb.collection('compass_modules').getOne(id);
  if (existing.tenant !== user.tenant) throw new Error('Forbidden');

  try {
    await writeWithFallback(pb, (c) => c.collection('compass_modules').delete(id));
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

/**
 * Tolkar svarsalternativ för en quiz-/formulärfråga. EN rad per val, EN poäng
 * per val:
 *
 *   värde | etikett | poäng
 *
 * `poäng` är frivillig (default ingen poäng = 0 i summeringen). Poängen summeras
 * server-side (`scoreQuiz`) och totalen jämförs mot resultatprofilernas
 * `min`/`max`-intervall (`resolveBucket`). Inga hinkar, multi-hinkar eller
 * branching i inmatningen — det höll vi enkelt med avsikt.
 */
function parseQuestionChoices(raw: string):
  | { value: string; label: string; score?: number }[]
  | undefined {
  if (!raw) return undefined;

  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const parts = l.split('|').map((s) => s.trim());
      const value = parts[0];
      const label = parts[1] || value;
      const choice: { value: string; label: string; score?: number } = {
        value: slugify(value || l),
        label
      };

      const score = Number(parts[2]);
      if (parts[2] !== undefined && parts[2] !== '' && Number.isFinite(score)) {
        choice.score = score;
      }

      return choice;
    });
}

type ParsedChoice = {
  value: string;
  label: string;
  score?: number;
  buckets?: Record<string, number>;
};

/** Normaliserar en hink-/profilnyckel till ett säkert, kort format. */
function normalizeBucketKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Tolkar svarsalternativ från den visuella fråge-editorn (`QuestionsManager`).
 * Klienten skickar en JSON-array med `{ value, label, score?, buckets? }` —
 * `buckets` = poäng per resultatprofil (topp-hink-läge, t.ex.
 * `{ green: 2, yellow: 0, red: 0 }`). Allt valideras/saneras här server-side;
 * klienten är aldrig säkerhetsgränsen (CLAUDE.md § 10.5 punkt 7). Tomma/0-poäng
 * utelämnas så lagringen hålls minimal.
 */
function parseChoicesJson(raw: string): ParsedChoice[] | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;

  const out: ParsedChoice[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const label = String(rec.label ?? rec.value ?? '').trim().slice(0, 200);
    const value = slugify(String(rec.value ?? rec.label ?? ''));
    if (!value || !label) continue;

    const choice: ParsedChoice = { value, label };

    if (rec.buckets && typeof rec.buckets === 'object' && !Array.isArray(rec.buckets)) {
      const buckets: Record<string, number> = {};
      for (const [k, v] of Object.entries(rec.buckets as Record<string, unknown>)) {
        const key = normalizeBucketKey(k);
        const n = Number(v);
        if (key && Number.isFinite(n) && n !== 0) buckets[key] = n;
      }
      if (Object.keys(buckets).length > 0) choice.buckets = buckets;
    }

    const score = Number(rec.score);
    if (rec.score !== undefined && rec.score !== '' && Number.isFinite(score) && score !== 0) {
      choice.score = score;
    }

    out.push(choice);
  }
  return out;
}

/**
 * Härleder valen för en fråga: föredrar den strukturerade `choices_json` från
 * den visuella editorn, faller annars tillbaka på det äldre
 * `värde | etikett | poäng`-textfältet (bakåtkompatibelt). Returnerar undefined
 * för fråge-typer utan val.
 */
function resolveChoices(formData: FormData, inputType: string): ParsedChoice[] | undefined {
  if (inputType !== 'choice' && inputType !== 'multi_choice') return undefined;
  const jsonRaw = String(formData.get('choices_json') || '').trim();
  if (jsonRaw) return parseChoicesJson(jsonRaw);
  const choicesRaw = String(formData.get('choices') || '').trim();
  return choicesRaw ? parseQuestionChoices(choicesRaw) : undefined;
}

export async function addQuestionAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) {
    throw new Error('Forbidden');
  }
  const moduleId = String(formData.get('module_id') || '');
  const moduleSlug = String(formData.get('module_slug') || '');
  const key = slugify(String(formData.get('key') || ''));
  const prompt = String(formData.get('prompt') || '').trim();
  const helpText = String(formData.get('help_text') || '').trim();
  const inputType = String(formData.get('input_type') || 'short_text');
  const required = formData.get('required') === 'on';

  if (!moduleId || !key || !prompt) throw new Error('Modul, nyckel och fråga krävs');
  if (!INPUT_TYPES.includes(inputType as (typeof INPUT_TYPES)[number])) {
    throw new Error('Ogiltig input_type');
  }

  // Val + poäng från den visuella editorn (`choices_json`) eller det äldre
  // textfältet. `buckets` ger poäng per resultatprofil; totalen avgör vinnande
  // profil (`scoreQuiz`/`resolveBucket`, packages/shared/compass-quiz.ts).
  const choices = resolveChoices(formData, inputType);

  const pb = await getServerPb();
  // Verify module ownership
  const mod = await pb.collection('compass_modules').getOne(moduleId);
  if (mod.tenant !== user.tenant) throw new Error('Forbidden');

  try {
    await writeWithFallback(pb, (c) =>
      c.collection('compass_questions').create({
        module: moduleId,
        key,
        prompt,
        help_text: helpText || undefined,
        input_type: inputType,
        required,
        choices,
        sort_order: Date.now() % 1_000_000
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Okänt fel';
    throw new Error(`Kunde inte skapa fråga: ${msg}`);
  }

  revalidatePath(`/inflode/admin/modules/${moduleSlug}`);
}

export async function updateQuestionAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  const moduleId = String(formData.get('module_id') || '');
  const moduleSlug = String(formData.get('module_slug') || '');
  const key = slugify(String(formData.get('key') || ''));
  const prompt = String(formData.get('prompt') || '').trim();
  const helpText = String(formData.get('help_text') || '').trim();
  const inputType = String(formData.get('input_type') || 'short_text');
  const required = formData.get('required') === 'on';

  if (!id || !moduleId || !key || !prompt) throw new Error('Modul, nyckel och fråga krävs');
  if (!INPUT_TYPES.includes(inputType as (typeof INPUT_TYPES)[number])) {
    throw new Error('Ogiltig input_type');
  }

  const choices = resolveChoices(formData, inputType);

  const pb = await getServerPb();
  const mod = await pb.collection('compass_modules').getOne(moduleId);
  if (mod.tenant !== user.tenant) throw new Error('Forbidden');

  try {
    await writeWithFallback(pb, (c) =>
      c.collection('compass_questions').update(id, {
        module: moduleId,
        key,
        prompt,
        help_text: helpText || undefined,
        input_type: inputType,
        required,
        choices
      })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Okänt fel';
    throw new Error(`Kunde inte uppdatera fråga: ${msg}`);
  }

  revalidatePath(`/inflode/admin/modules/${moduleSlug}`);
}

export async function deleteQuestionAction(formData: FormData) {
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) {
    throw new Error('Forbidden');
  }
  const id = String(formData.get('id') || '');
  const moduleSlug = String(formData.get('module_slug') || '');
  if (!id) throw new Error('Invalid input');

  const pb = await getServerPb();
  try {
    await writeWithFallback(pb, (c) => c.collection('compass_questions').delete(id));
  } catch {
    // ignore
  }
  revalidatePath(`/inflode/admin/modules/${moduleSlug}`);
}
