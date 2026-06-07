'use server';

import PocketBase from 'pocketbase';
import { revalidatePath } from 'next/cache';
import { getServerPb, getCurrentUser, requireUser } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { escFilter } from '@/lib/pb-filter';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  normalizeOnboardingModules,
  isOnboardingComplete,
  onboardingProgressPct,
  type OnboardingFlow,
  type OnboardingModule,
  type OnboardingProgress,
  type Role
} from '@platform/shared';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const DELETE_ROLES: Role[] = ['admin', 'incubator_lead'];
const PB_URL = getServerPbUrl();

export interface OnboardingFlowActionState {
  flowId?: string;
  error?: string;
  ok?: boolean;
}

export interface OnboardingProgressActionState {
  ok?: boolean;
  error?: string;
  completed?: boolean;
}

type PbErrorLike = { status?: number };

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as PbErrorLike).status;
  }
  return undefined;
}

// Superuser-fallback (samma mönster som lib/actions/workshops.ts +
// education-documents.ts) — PB v0.23:s rule-eval kan fela för annars behöriga
// skrivningar, och bolagsmedlemmens progress-skrivning sker bara efter att vi
// verifierat medlemskapet i koden.
async function getSuperuserPb(): Promise<PocketBase | null> {
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
  if (!email || !password) {
    console.error('[onboarding] superuser credentials missing');
    return null;
  }
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    return pb;
  } catch {
    console.error('[onboarding] superuser auth failed');
    return null;
  }
}

// Skriv via app-user-klienten först; faller tillbaka på superuser vid 400/403
// (PB v0.23 rule-eval-bugg). Returnerar true om skrivningen lyckades.
async function writeWithFallback(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<unknown>
): Promise<boolean> {
  try {
    await run(pb);
    return true;
  } catch (err) {
    const status = statusOf(err);
    if (status === 400 || status === 403) {
      const su = await getSuperuserPb();
      if (!su) return false;
      try {
        await run(su);
        return true;
      } catch (fallbackErr) {
        console.error('[onboarding] superuser fallback write failed', {
          message: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr ?? '')
        });
        return false;
      }
    }
    console.error('[onboarding] write failed', {
      message: err instanceof Error ? err.message : String(err ?? '')
    });
    return false;
  }
}

// Sätt ETT flöde som default i tenanten och nollställ is_default på alla andra.
// Best-effort per rad; ett misslyckande på en annan rad blockerar inte.
async function applyDefault(pb: PocketBase, tenant: string, flowId: string): Promise<void> {
  let others: { id: string }[] = [];
  try {
    others = await pb.collection(PB_COLLECTIONS.onboardingFlows).getFullList<{ id: string }>({
      filter: `tenant = "${escFilter(tenant)}" && is_default = true && id != "${escFilter(flowId)}"`,
      fields: 'id'
    });
  } catch {
    others = [];
  }
  for (const other of others) {
    await writeWithFallback(pb, (c) =>
      c.collection(PB_COLLECTIONS.onboardingFlows).update(other.id, { is_default: false })
    );
  }
  await writeWithFallback(pb, (c) =>
    c.collection(PB_COLLECTIONS.onboardingFlows).update(flowId, { is_default: true })
  );
}

function revalidateOnboarding(): void {
  revalidatePath('/education/onboarding');
  revalidatePath('/onboarding');
  revalidatePath('/min-oversikt');
}

function parseModules(formData: FormData): OnboardingModule[] | null {
  const raw = String(formData.get('modules_json') || '[]').trim();
  if (raw === '' || raw === '[]') return [];
  try {
    return normalizeOnboardingModules(JSON.parse(raw));
  } catch {
    return null;
  }
}

// ── Staff: bygg / hantera flöden ─────────────────────────────────────────────

export async function createOnboardingFlowAction(
  _prev: OnboardingFlowActionState,
  formData: FormData
): Promise<OnboardingFlowActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };

  const title = String(formData.get('title') || '').trim();
  const intro = String(formData.get('intro') || '').trim();
  const status = String(formData.get('status') || 'draft');
  const makeDefault = formData.get('is_default') === 'on';
  if (!title) return { error: 'Titel är obligatorisk.' };

  const modules = parseModules(formData);
  if (modules === null) return { error: 'Modulerna innehåller ogiltig data.' };

  const pb = await getServerPb();
  const payload: Record<string, unknown> = {
    tenant: user.tenant,
    title,
    intro,
    status: ['draft', 'active', 'archived'].includes(status) ? status : 'draft',
    is_default: false,
    active: true,
    modules,
    created_by: user.id
  };

  let recordId: string | null = null;
  const create = async (client: PocketBase) => {
    const rec = await client.collection(PB_COLLECTIONS.onboardingFlows).create(payload);
    recordId = String(rec.id);
  };
  const created = await writeWithFallback(pb, create);
  if (!created || !recordId) return { error: 'Kunde inte skapa onboarding-flödet.' };

  if (makeDefault) await applyDefault(pb, user.tenant, recordId);

  revalidateOnboarding();
  return { flowId: recordId };
}

export async function updateOnboardingFlowAction(
  flowId: string,
  _prev: OnboardingFlowActionState,
  formData: FormData
): Promise<OnboardingFlowActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };

  const pb = await getServerPb();
  let existing: OnboardingFlow;
  try {
    existing = await pb.collection(PB_COLLECTIONS.onboardingFlows).getOne<OnboardingFlow>(flowId);
  } catch {
    return { error: 'Onboarding-flödet hittades inte.' };
  }
  if (String(existing.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };

  const title = String(formData.get('title') || '').trim();
  const intro = String(formData.get('intro') || '').trim();
  const status = String(formData.get('status') || 'draft');
  const makeDefault = formData.get('is_default') === 'on';
  if (!title) return { error: 'Titel är obligatorisk.' };

  const modules = parseModules(formData);
  if (modules === null) return { error: 'Modulerna innehåller ogiltig data.' };

  const payload: Record<string, unknown> = {
    title,
    intro,
    status: ['draft', 'active', 'archived'].includes(status) ? status : 'draft',
    modules
  };

  const updated = await writeWithFallback(pb, (c) =>
    c.collection(PB_COLLECTIONS.onboardingFlows).update(flowId, payload)
  );
  if (!updated) return { error: 'Kunde inte spara onboarding-flödet.' };

  // makeDefault sätter detta som default; avmarkering tar bort default-status.
  if (makeDefault) {
    await applyDefault(pb, user.tenant, flowId);
  } else if (existing.is_default) {
    await writeWithFallback(pb, (c) =>
      c.collection(PB_COLLECTIONS.onboardingFlows).update(flowId, { is_default: false })
    );
  }

  revalidateOnboarding();
  return { flowId, ok: true };
}

export async function setDefaultOnboardingFlowFormAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, STAFF_ROLES)) return;
  const flowId = String(formData.get('flow_id') || '').trim();
  if (!flowId) return;

  const pb = await getServerPb();
  let flow: OnboardingFlow;
  try {
    flow = await pb.collection(PB_COLLECTIONS.onboardingFlows).getOne<OnboardingFlow>(flowId);
  } catch {
    return;
  }
  if (String(flow.tenant) !== user.tenant) return;

  await applyDefault(pb, user.tenant, flowId);
  revalidateOnboarding();
}

export async function deleteOnboardingFlowFormAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !hasRole(user.roles, DELETE_ROLES)) return;
  const flowId = String(formData.get('flow_id') || '').trim();
  if (!flowId) return;

  const pb = await getServerPb();
  let flow: OnboardingFlow;
  try {
    flow = await pb.collection(PB_COLLECTIONS.onboardingFlows).getOne<OnboardingFlow>(flowId);
  } catch {
    return;
  }
  if (String(flow.tenant) !== user.tenant) return;

  // Progress-rader cascade-raderas av PB (flow-relationen har cascadeDelete).
  await writeWithFallback(pb, (c) =>
    c.collection(PB_COLLECTIONS.onboardingFlows).delete(flowId)
  );
  revalidateOnboarding();
}

export async function listOnboardingFlowsForTenant(): Promise<OnboardingFlow[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const pb = await getServerPb();
  try {
    const res = await pb.collection(PB_COLLECTIONS.onboardingFlows).getList<OnboardingFlow>(1, 200, {
      filter: `tenant = "${escFilter(user.tenant)}"`,
      sort: '-is_default,title'
    });
    return res.items;
  } catch (error) {
    console.error('[onboarding] failed to list flows', {
      tenant: user.tenant,
      error: error instanceof Error ? error.message : error
    });
    return [];
  }
}

// ── Bolag: genomför onboardingen ─────────────────────────────────────────────

// Verifierar att den inloggade får arbeta med given startups onboarding och
// hämtar flöde + bolag. Staff (alla bolag i tenanten) eller länkad medlem.
async function loadFlowAndStartup(
  pb: PocketBase,
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  flowId: string,
  startupId: string
): Promise<{ flow: OnboardingFlow; startupName: string } | { error: string }> {
  let flow: OnboardingFlow;
  try {
    flow = await pb.collection(PB_COLLECTIONS.onboardingFlows).getOne<OnboardingFlow>(flowId);
  } catch {
    return { error: 'Onboarding-flödet hittades inte.' };
  }
  if (String(flow.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };

  const isStaff = hasRole(user.roles, STAFF_ROLES);
  const isLinkedMember =
    hasRole(user.roles, ['startup_member']) && user.linkedStartups.includes(startupId);
  if (!isStaff && !isLinkedMember) return { error: 'Åtkomst nekad.' };

  let startupName = 'Bolaget';
  try {
    const startup = await pb
      .collection('startups')
      .getOne<{ tenant: string; name?: string }>(startupId);
    if (String(startup.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };
    startupName = startup.name || startupName;
  } catch {
    return { error: 'Bolaget hittades inte.' };
  }
  return { flow, startupName };
}

async function findProgress(
  pb: PocketBase,
  tenant: string,
  flowId: string,
  startupId: string
): Promise<OnboardingProgress | null> {
  return pb
    .collection(PB_COLLECTIONS.onboardingProgress)
    .getFirstListItem<OnboardingProgress>(
      `tenant = "${escFilter(tenant)}" && flow = "${escFilter(flowId)}" && startup = "${escFilter(startupId)}"`
    )
    .catch(() => null);
}

export async function saveOnboardingProgressAction(
  flowId: string,
  startupId: string,
  data: { answers: Record<string, unknown> }
): Promise<OnboardingProgressActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!flowId || !startupId) return { error: 'Flöde och bolag krävs.' };

  const pb = await getServerPb();
  const loaded = await loadFlowAndStartup(pb, user, flowId, startupId);
  if ('error' in loaded) return loaded;

  const answers = data.answers && typeof data.answers === 'object' ? data.answers : {};
  const modules = (loaded.flow.modules as OnboardingModule[]) ?? [];
  const now = new Date().toISOString();
  const existing = await findProgress(pb, user.tenant, flowId, startupId);

  const progressMeta = {
    pct: onboardingProgressPct(modules, answers),
    updatedAt: now
  };

  let okWrite: boolean;
  if (existing) {
    // Slutförd onboarding återöppnas inte via "spara" — bevara completed-status.
    const payload: Record<string, unknown> = {
      answers_json: answers,
      progress_json: progressMeta
    };
    okWrite = await writeWithFallback(pb, (c) =>
      c.collection(PB_COLLECTIONS.onboardingProgress).update(existing.id, payload)
    );
  } else {
    const payload: Record<string, unknown> = {
      tenant: user.tenant,
      flow: flowId,
      startup: startupId,
      status: 'in_progress',
      answers_json: answers,
      progress_json: progressMeta,
      started_at: now
    };
    okWrite = await writeWithFallback(pb, (c) =>
      c.collection(PB_COLLECTIONS.onboardingProgress).create(payload)
    );
  }
  if (!okWrite) return { error: 'Kunde inte spara framstegen.' };

  revalidatePath('/onboarding');
  revalidatePath('/min-oversikt');
  return { ok: true };
}

export async function completeOnboardingAction(
  flowId: string,
  startupId: string,
  data: { answers: Record<string, unknown> }
): Promise<OnboardingProgressActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!flowId || !startupId) return { error: 'Flöde och bolag krävs.' };

  const pb = await getServerPb();
  const loaded = await loadFlowAndStartup(pb, user, flowId, startupId);
  if ('error' in loaded) return loaded;

  const answers = data.answers && typeof data.answers === 'object' ? data.answers : {};
  const modules = (loaded.flow.modules as OnboardingModule[]) ?? [];
  if (!isOnboardingComplete(modules, answers)) {
    return { error: 'Alla obligatoriska moment måste slutföras först.' };
  }

  const now = new Date().toISOString();

  // Logga aktivitet (kind='onboarding') så staff ser slutförandet i feeden.
  // Best-effort — ett loggfel ska inte blockera slutförandet.
  let activityId: string | undefined;
  try {
    const activity = await pb.collection('activities').create({
      startup: startupId,
      kind: 'onboarding',
      type: 'task',
      title: `${loaded.startupName} slutförde onboardingen`,
      status: 'done',
      owner: user.id,
      due_date: now.slice(0, 10),
      completed_at: now
    });
    activityId = activity.id;
  } catch (err) {
    console.error('[onboarding] activity log failed', {
      tenant: user.tenant,
      message: err instanceof Error ? err.message : String(err ?? '')
    });
  }

  const existing = await findProgress(pb, user.tenant, flowId, startupId);
  const base: Record<string, unknown> = {
    status: 'completed',
    answers_json: answers,
    progress_json: { pct: 100, updatedAt: now },
    completed_at: now,
    completed_by: user.id
  };
  if (activityId) base.activity = activityId;

  let okWrite: boolean;
  if (existing) {
    okWrite = await writeWithFallback(pb, (c) =>
      c.collection(PB_COLLECTIONS.onboardingProgress).update(existing.id, base)
    );
  } else {
    okWrite = await writeWithFallback(pb, (c) =>
      c.collection(PB_COLLECTIONS.onboardingProgress).create({
        tenant: user.tenant,
        flow: flowId,
        startup: startupId,
        started_at: now,
        ...base
      })
    );
  }
  if (!okWrite) return { error: 'Kunde inte markera onboardingen som slutförd.' };

  revalidatePath('/onboarding');
  revalidatePath('/min-oversikt');
  revalidatePath('/aktivitet');
  revalidatePath(`/startups/${startupId}`);
  return { ok: true, completed: true };
}
