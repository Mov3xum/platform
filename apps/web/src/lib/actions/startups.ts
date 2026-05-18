'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { ALL_PHASES, type StartupPhase } from '@platform/shared';
import { updateStartupField, type StartupWritableField } from '@/lib/core/write';

const ALLOWED_STATUS = ['active', 'alumni', 'paused', 'rejected'] as const;
type Status = (typeof ALLOWED_STATUS)[number];

const ALLOWED_FOUNDER_GENDER = ['kvinna', 'man', 'icke_binar', 'uppger_ej'] as const;
type FounderGenderValue = (typeof ALLOWED_FOUNDER_GENDER)[number];

type ScalarFieldError =
  | 'name'
  | 'phase'
  | 'status'
  | 'irl_level'
  | 'status_completion_pct'
  | 'phone'
  | 'founder_gender'
  | 'company_registered_at'
  | 'contacted_at';

export type StartupFormState = {
  error?: string;
  fieldErrors?: Partial<Record<ScalarFieldError, string>>;
};

// Avtals-fält som har ett bool-fält + ett matchande _at-datum. Om bool är
// false rensas datumet alltid (annars sitter gamla datum kvar i UI-listor).

interface ParsedFields {
  name: string;
  description: string;
  phase: StartupPhase;
  irl_level: number | null;
  status: Status;
  next_step: string;
  tags: string;
  // Bolagslista-fält
  idea_name: string;
  case_type: string;
  status_completion_pct: number | null;
  company_registered_at: string | null;
  contacted_at: string | null;
  phone: string;
  signed_incubator_agreement: boolean;
  signed_incubator_agreement_at: string | null;
  signed_nda: boolean;
  signed_nda_at: string | null;
  founder_gender: FounderGenderValue | '';
  potential_bc_case: boolean;
  founder_identifies_as: string;
  signed_bc_agreement: boolean;
  signed_bc_agreement_at: string | null;
  preliminary_exit: string;
  is_deeptech: boolean;
  meets_excellence_criteria: boolean;
  inflow_source: string;
  approved_state_aid_art22: boolean;
  area: string;
  signed_vinnova_incubation_approval: boolean;
  signed_vinnova_incubation_approval_at: string | null;
  approved_de_minimis: boolean;
  sent_to: string;
  register_notes: string;
  is_regional: boolean;
  signed_partner_agreement: boolean;
  signed_partner_agreement_at: string | null;
}

type ParseResult = { ok: true; data: ParsedFields } | { ok: false; state: StartupFormState };

type PbActionError = {
  message?: string;
  response?: {
    message?: string;
    data?: Record<string, unknown>;
  };
};

function formatStartupActionError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    const pbLike = err as PbActionError;
    const responseMessage = pbLike.response?.message;
    if (responseMessage && responseMessage !== err.message) {
      return `${err.message} (${responseMessage})`;
    }
    return err.message;
  }
  return fallback;
}

function parseDateField(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  return v;
}

function parseBoolField(formData: FormData, name: string): boolean {
  const v = formData.get(name);
  if (v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}

function parseFormData(formData: FormData): ParseResult {
  const name = String(formData.get('name') || '').trim();
  const phase = String(formData.get('phase') || '');
  const status = String(formData.get('status') || 'active');
  const irlRaw = String(formData.get('irl_level') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const next_step = String(formData.get('next_step') || '').trim();
  const tags = String(formData.get('tags') || '').trim();
  const statusPctRaw = String(formData.get('status_completion_pct') || '').trim();
  const phoneRaw = String(formData.get('phone') || '').trim();
  const founderGenderRaw = String(formData.get('founder_gender') || '').trim();

  const fieldErrors: StartupFormState['fieldErrors'] = {};

  if (!name) fieldErrors.name = 'Namn krävs.';
  if (!ALL_PHASES.includes(phase as StartupPhase)) fieldErrors.phase = 'Välj en giltig fas.';
  if (!ALLOWED_STATUS.includes(status as Status)) fieldErrors.status = 'Välj en giltig status.';

  let irl_level: number | null = null;
  if (irlRaw) {
    const n = Number(irlRaw);
    if (!Number.isInteger(n) || n < 1 || n > 9) {
      fieldErrors.irl_level = 'IRL måste vara 1–9.';
    } else {
      irl_level = n;
    }
  }

  let status_completion_pct: number | null = null;
  if (statusPctRaw) {
    const n = Number(statusPctRaw);
    if (!Number.isInteger(n) || n < 0 || n > 100) {
      fieldErrors.status_completion_pct = 'Måste vara heltal 0–100.';
    } else {
      status_completion_pct = n;
    }
  }

  if (phoneRaw && !/^[\d\s+()\-]{1,30}$/.test(phoneRaw)) {
    fieldErrors.phone = 'Ange ett giltigt telefonnummer (max 30 tecken).';
  }

  let founder_gender: FounderGenderValue | '' = '';
  if (founderGenderRaw) {
    if (!(ALLOWED_FOUNDER_GENDER as readonly string[]).includes(founderGenderRaw)) {
      fieldErrors.founder_gender = 'Ogiltigt värde.';
    } else {
      founder_gender = founderGenderRaw as FounderGenderValue;
    }
  }

  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const company_registered_at = parseDateField(
    String(formData.get('company_registered_at') || '')
  );
  if (company_registered_at && !isoDate.test(company_registered_at)) {
    fieldErrors.company_registered_at = 'Ogiltigt datumformat (YYYY-MM-DD).';
  }
  const contacted_at = parseDateField(String(formData.get('contacted_at') || ''));
  if (contacted_at && !isoDate.test(contacted_at)) {
    fieldErrors.contacted_at = 'Ogiltigt datumformat (YYYY-MM-DD).';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, state: { fieldErrors } };
  }

  const textVal = (key: string) => String(formData.get(key) || '').trim();
  const dateVal = (key: string) => parseDateField(String(formData.get(key) || ''));

  // Rensa _at-datum när motsvarande bool är false.
  const buildSigned = (boolKey: string, dateKey: string): [boolean, string | null] => {
    const b = parseBoolField(formData, boolKey);
    const d = dateVal(dateKey);
    return [b, b ? d : null];
  };

  const [signed_incubator_agreement, signed_incubator_agreement_at] = buildSigned(
    'signed_incubator_agreement',
    'signed_incubator_agreement_at'
  );
  const [signed_nda, signed_nda_at] = buildSigned('signed_nda', 'signed_nda_at');
  const [signed_bc_agreement, signed_bc_agreement_at] = buildSigned(
    'signed_bc_agreement',
    'signed_bc_agreement_at'
  );
  const [signed_vinnova_incubation_approval, signed_vinnova_incubation_approval_at] = buildSigned(
    'signed_vinnova_incubation_approval',
    'signed_vinnova_incubation_approval_at'
  );
  const [signed_partner_agreement, signed_partner_agreement_at] = buildSigned(
    'signed_partner_agreement',
    'signed_partner_agreement_at'
  );

  return {
    ok: true,
    data: {
      name,
      description,
      phase: phase as StartupPhase,
      status: status as Status,
      irl_level,
      next_step,
      tags,
      idea_name: textVal('idea_name'),
      case_type: textVal('case_type'),
      status_completion_pct,
      company_registered_at,
      contacted_at,
      phone: phoneRaw,
      signed_incubator_agreement,
      signed_incubator_agreement_at,
      signed_nda,
      signed_nda_at,
      founder_gender,
      potential_bc_case: parseBoolField(formData, 'potential_bc_case'),
      founder_identifies_as: textVal('founder_identifies_as'),
      signed_bc_agreement,
      signed_bc_agreement_at,
      preliminary_exit: textVal('preliminary_exit'),
      is_deeptech: parseBoolField(formData, 'is_deeptech'),
      meets_excellence_criteria: parseBoolField(formData, 'meets_excellence_criteria'),
      inflow_source: textVal('inflow_source'),
      approved_state_aid_art22: parseBoolField(formData, 'approved_state_aid_art22'),
      area: textVal('area'),
      signed_vinnova_incubation_approval,
      signed_vinnova_incubation_approval_at,
      approved_de_minimis: parseBoolField(formData, 'approved_de_minimis'),
      sent_to: textVal('sent_to'),
      register_notes: textVal('register_notes'),
      is_regional: parseBoolField(formData, 'is_regional'),
      signed_partner_agreement,
      signed_partner_agreement_at
    }
  };
}

function toRecordPayload(data: ParsedFields): Record<string, unknown> {
  return {
    name: data.name,
    description: data.description,
    phase: data.phase,
    status: data.status,
    irl_level: data.irl_level ?? null,
    next_step: data.next_step,
    tags: data.tags,
    idea_name: data.idea_name,
    case_type: data.case_type,
    status_completion_pct: data.status_completion_pct ?? null,
    company_registered_at: data.company_registered_at ?? '',
    contacted_at: data.contacted_at ?? '',
    phone: data.phone,
    signed_incubator_agreement: data.signed_incubator_agreement,
    signed_incubator_agreement_at: data.signed_incubator_agreement_at ?? '',
    signed_nda: data.signed_nda,
    signed_nda_at: data.signed_nda_at ?? '',
    founder_gender: data.founder_gender || '',
    potential_bc_case: data.potential_bc_case,
    founder_identifies_as: data.founder_identifies_as,
    signed_bc_agreement: data.signed_bc_agreement,
    signed_bc_agreement_at: data.signed_bc_agreement_at ?? '',
    preliminary_exit: data.preliminary_exit,
    is_deeptech: data.is_deeptech,
    meets_excellence_criteria: data.meets_excellence_criteria,
    inflow_source: data.inflow_source,
    approved_state_aid_art22: data.approved_state_aid_art22,
    area: data.area,
    signed_vinnova_incubation_approval: data.signed_vinnova_incubation_approval,
    signed_vinnova_incubation_approval_at: data.signed_vinnova_incubation_approval_at ?? '',
    approved_de_minimis: data.approved_de_minimis,
    sent_to: data.sent_to,
    register_notes: data.register_notes,
    is_regional: data.is_regional,
    signed_partner_agreement: data.signed_partner_agreement,
    signed_partner_agreement_at: data.signed_partner_agreement_at ?? ''
  };
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

interface PhaseHistoryWriteCtx {
  tenant: string;
  startupId: string;
  fromPhase?: string | null;
  toPhase: string;
  userId: string;
}

async function recordPhaseTransition(ctx: PhaseHistoryWriteCtx): Promise<void> {
  // Fail-soft — phase-history-skrivning får aldrig blockera huvudtransaktionen.
  try {
    const pb = await getServerPb();
    const today = todayIsoDate();
    if (ctx.fromPhase && ctx.fromPhase !== ctx.toPhase) {
      try {
        const last = await pb.collection('startup_phase_history').getFirstListItem(
          `startup = "${ctx.startupId}" && phase = "${ctx.fromPhase}" && (exited_at = '' || exited_at = null)`,
          { sort: '-entered_at' }
        );
        if (last?.id) {
          await pb.collection('startup_phase_history').update(last.id, { exited_at: today });
        }
      } catch {
        // ingen öppen rad att stänga — okej
      }
    }
    await pb.collection('startup_phase_history').create({
      tenant: ctx.tenant,
      startup: ctx.startupId,
      phase: ctx.toPhase,
      entered_at: today,
      created_by: ctx.userId
    });
  } catch (err) {
    console.error('[startups] phase-history write failed', {
      startupId: ctx.startupId,
      message: err instanceof Error ? err.message : 'unknown'
    });
  }
}

export async function createStartupAction(
  _prev: StartupFormState,
  formData: FormData
): Promise<StartupFormState> {
  const user = await requireUser();

  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    return { error: 'Du saknar behörighet att skapa bolag.' };
  }
  if (!user.tenant) {
    return { error: 'Ditt konto saknar tenant-koppling. Kontakta administratör.' };
  }

  const pb = await getServerPb();
  const parsed = parseFormData(formData);
  if (!parsed.ok) return parsed.state;
  const data = parsed.data;

  let createdId: string | undefined;
  try {
    const record = await pb.collection('startups').create({
      tenant: user.tenant,
      ...toRecordPayload(data)
    });
    createdId = record.id;
  } catch (err) {
    return { error: formatStartupActionError(err, 'Kunde inte skapa bolaget.') };
  }

  if (createdId) {
    await recordPhaseTransition({
      tenant: user.tenant,
      startupId: createdId,
      toPhase: data.phase,
      userId: user.id
    });
  }

  revalidatePath('/startups');
  redirect(`/startups/${createdId}`);
}

export async function updateStartupAction(
  id: string,
  _prev: StartupFormState,
  formData: FormData
): Promise<StartupFormState> {
  const user = await requireUser();

  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    return { error: 'Du saknar behörighet att uppdatera bolag.' };
  }

  const pb = await getServerPb();
  const parsed = parseFormData(formData);
  if (!parsed.ok) return parsed.state;
  const data = parsed.data;

  // Skrivvägen går via det delade kärnlagret (lib/core/write). Samma kod
  // anropas av AI-agentens verktyg med actor.kind = 'agent', vilket
  // garanterar att UI och agent följer identiska regler för whitelist,
  // validering och audit (symmetri människa ↔ agent).
  const actor = {
    kind: 'user' as const,
    id: user.id,
    tenant: user.tenant,
    roles: user.roles
  };

  let priorPhase: string | undefined;
  let priorTenant: string | undefined;
  try {
    const existing = await pb.collection('startups').getOne<{ tenant: string; phase: string }>(id, {
      fields: 'id,tenant,phase'
    });
    priorPhase = existing.phase;
    priorTenant = existing.tenant;
  } catch {
    // fortsätt — update får ge sitt eget fel
  }

  const fieldUpdates: Array<{ field: StartupWritableField; value: unknown }> = [
    { field: 'name', value: data.name },
    { field: 'description', value: data.description },
    { field: 'phase', value: data.phase },
    { field: 'status', value: data.status },
    { field: 'irl_level', value: data.irl_level },
    { field: 'next_step', value: data.next_step },
    { field: 'tags', value: data.tags }
  ];

  for (const { field, value } of fieldUpdates) {
    const result = await updateStartupField(pb, actor, {
      startupId: id,
      field,
      value
    });
    if (!result.ok) {
      return { error: result.error };
    }
  }

  if (priorPhase && priorTenant && priorPhase !== data.phase) {
    await recordPhaseTransition({
      tenant: priorTenant,
      startupId: id,
      fromPhase: priorPhase,
      toPhase: data.phase,
      userId: user.id
    });
  }

  revalidatePath('/startups');
  revalidatePath(`/startups/${id}`);
  redirect(`/startups/${id}`);
}

export async function deleteStartupAction(id: string): Promise<{ error?: string }> {
  const user = await requireUser();

  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Du saknar behörighet att radera bolag.' };
  }

  const pb = await getServerPb();

  try {
    const existing = await pb.collection('startups').getOne<{ tenant: string }>(id, {
      fields: 'id,tenant'
    });
    if (existing.tenant !== user.tenant) {
      return { error: 'Åtkomst nekad.' };
    }
    await pb.collection('startups').delete(id);
  } catch (err) {
    return { error: formatStartupActionError(err, 'Kunde inte radera bolaget.') };
  }

  revalidatePath('/startups');
  redirect('/startups');
}

export async function deleteStartupFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('id') || '').trim();
  if (!id) return;
  await deleteStartupAction(id);
}

export type PhaseHistoryActionState = {
  error?: string;
  ok?: boolean;
};

export async function addPhaseHistoryEntryAction(
  startupId: string,
  _prev: PhaseHistoryActionState,
  formData: FormData
): Promise<PhaseHistoryActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    return { error: 'Du saknar behörighet att lägga till fashistorik.' };
  }

  const phase = String(formData.get('phase') || '');
  const entered_at = String(formData.get('entered_at') || '').trim();
  const exited_at = String(formData.get('exited_at') || '').trim();
  const note = String(formData.get('note') || '').trim();

  if (!ALL_PHASES.includes(phase as StartupPhase)) {
    return { error: 'Välj en giltig fas.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entered_at)) {
    return { error: 'Ange ett ingångsdatum (YYYY-MM-DD).' };
  }
  if (exited_at && !/^\d{4}-\d{2}-\d{2}$/.test(exited_at)) {
    return { error: 'Utgångsdatum måste vara YYYY-MM-DD eller tomt.' };
  }
  if (note.length > 500) {
    return { error: 'Notering får vara max 500 tecken.' };
  }

  const pb = await getServerPb();
  let tenantId: string;
  try {
    const startup = await pb.collection('startups').getOne<{ tenant: string }>(startupId, {
      fields: 'id,tenant'
    });
    if (startup.tenant !== user.tenant) {
      return { error: 'Åtkomst nekad.' };
    }
    tenantId = startup.tenant;
  } catch {
    return { error: 'Bolaget hittades inte.' };
  }

  try {
    await pb.collection('startup_phase_history').create({
      tenant: tenantId,
      startup: startupId,
      phase,
      entered_at,
      exited_at: exited_at || '',
      note,
      created_by: user.id
    });
  } catch (err) {
    return { error: formatStartupActionError(err, 'Kunde inte spara fashistorik.') };
  }

  revalidatePath(`/startups/${startupId}`);
  return { ok: true };
}

export async function deletePhaseHistoryEntryAction(formData: FormData): Promise<void> {
  'use server';
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin'])) return;
  const entryId = String(formData.get('id') || '').trim();
  const startupId = String(formData.get('startup_id') || '').trim();
  if (!entryId) return;

  const pb = await getServerPb();
  try {
    const row = await pb.collection('startup_phase_history').getOne<{ tenant: string }>(entryId, {
      fields: 'id,tenant'
    });
    if (row.tenant !== user.tenant) return;
    await pb.collection('startup_phase_history').delete(entryId);
  } catch {
    return;
  }
  if (startupId) revalidatePath(`/startups/${startupId}`);
}
