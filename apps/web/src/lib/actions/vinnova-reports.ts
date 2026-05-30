'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { saveGeneratedFile } from '@/lib/documents/save';
import { buildVinnovaLagesredovisning, FALLBACK_HOURLY_RATE } from '@/lib/reporting/dataset';
import { renderLagesredovisning } from '@/lib/reporting/export';
import { buildEAidRegister, renderEAidRegister } from '@/lib/reporting/eair';
import type {
  GeneratedFileRef,
  Role,
  ServiceActivityKind,
  ServiceCostType,
  StateAidBasis
} from '@platform/shared';

// Skriv-RBAC: staff (matchar createRule i migrationerna 1700000097–100).
const STAFF_WRITE: Role[] = ['admin', 'incubator_lead', 'coach'];

export type ReportingActionState = { error?: string; ok?: boolean; fileRef?: GeneratedFileRef; downloadUrl?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s);
}

async function tenantHourlyRate(): Promise<number> {
  try {
    const user = await requireUser();
    const pb = await getServerPb();
    const t = await pb.collection('tenants').getOne(user.tenant);
    const rate = (t as { default_hourly_rate_sek?: number }).default_hourly_rate_sek;
    return rate && rate > 0 ? rate : FALLBACK_HOURLY_RATE;
  } catch {
    return FALLBACK_HOURLY_RATE;
  }
}

/**
 * Genererar Vinnovas lägesredovisning för en period, auto-fylld från
 * systemets data, renderar en xlsx och sparar den i användarens Filer.
 */
export async function exportLagesredovisningAction(input: {
  from: string;
  to: string;
}): Promise<ReportingActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_WRITE)) return { error: 'Åtkomst nekad.' };
  if (!validDate(input.from) || !validDate(input.to)) return { error: 'Ogiltigt datumformat (YYYY-MM-DD).' };
  if (input.from > input.to) return { error: 'Från-datum måste vara före till-datum.' };

  const pb = await getServerPb();
  try {
    const rate = await tenantHourlyRate();
    const dataset = await buildVinnovaLagesredovisning(pb, user.tenant, { from: input.from, to: input.to }, {
      hourlyRate: rate
    });
    const rendered = await renderLagesredovisning(dataset, { from: input.from, to: input.to });
    const fileRef = await saveGeneratedFile({
      pb,
      tenant: user.tenant,
      ownerUserId: user.id,
      rendered,
      docKind: 'xlsx'
    });
    revalidatePath('/filer');
    revalidatePath('/rapporter/vinnova');
    return { ok: true, fileRef, downloadUrl: `/api/files/${encodeURIComponent(fileRef.user_file_id)}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte generera rapporten.' };
  }
}

/**
 * Genererar e-AidRegister-underlaget (de minimis-stöd) som xlsx och sparar
 * det i användarens Filer. Valfritt filtrerat på beslutsdatum.
 */
export async function exportEAidRegisterAction(input?: {
  from?: string;
  to?: string;
}): Promise<ReportingActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_WRITE)) return { error: 'Åtkomst nekad.' };
  const from = input?.from && validDate(input.from) ? input.from : undefined;
  const to = input?.to && validDate(input.to) ? input.to : undefined;

  const pb = await getServerPb();
  try {
    const dataset = await buildEAidRegister(pb, user.tenant, { from, to });
    const rendered = await renderEAidRegister(dataset);
    const fileRef = await saveGeneratedFile({
      pb,
      tenant: user.tenant,
      ownerUserId: user.id,
      rendered,
      docKind: 'xlsx'
    });
    revalidatePath('/filer');
    return { ok: true, fileRef, downloadUrl: `/api/files/${encodeURIComponent(fileRef.user_file_id)}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte generera e-AidRegister-underlaget.' };
  }
}

// ─── Datainmatning (matar auto-fyllningen) ───────────────────────────────────

const TIME_KINDS: ServiceActivityKind[] = ['incubation', 'verification', 'admin'];

export async function logServiceTimeAction(input: {
  startup: string;
  activity_kind: ServiceActivityKind;
  hours: number;
  hourly_rate_sek?: number;
  occurred_on: string;
  note?: string;
}): Promise<ReportingActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_WRITE)) return { error: 'Åtkomst nekad.' };
  if (!input.startup) return { error: 'Bolag krävs.' };
  if (!TIME_KINDS.includes(input.activity_kind)) return { error: 'Ogiltig insatstyp.' };
  if (!(input.hours > 0)) return { error: 'Antal timmar måste vara > 0.' };
  if (!validDate(input.occurred_on)) return { error: 'Ogiltigt datum.' };

  const pb = await getServerPb();
  try {
    await pb.collection('service_time_entries').create({
      tenant: user.tenant,
      startup: input.startup,
      user: user.id,
      activity_kind: input.activity_kind,
      hours: input.hours,
      hourly_rate_sek: input.hourly_rate_sek && input.hourly_rate_sek > 0 ? input.hourly_rate_sek : null,
      occurred_on: input.occurred_on,
      note: (input.note || '').slice(0, 500),
      source: 'manual'
    });
    revalidatePath('/rapporter/vinnova');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara tidpost.' };
  }
}

const COST_TYPES: ServiceCostType[] = ['verification', 'external_service', 'other'];

export async function logServiceCostAction(input: {
  startup: string;
  cost_type: ServiceCostType;
  supplier?: string;
  invoice_ref?: string;
  amount_sek: number;
  incurred_on: string;
  allocation_note?: string;
}): Promise<ReportingActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_WRITE)) return { error: 'Åtkomst nekad.' };
  if (!input.startup) return { error: 'Bolag krävs.' };
  if (!COST_TYPES.includes(input.cost_type)) return { error: 'Ogiltig kostnadstyp.' };
  if (!(input.amount_sek >= 0)) return { error: 'Belopp måste vara ≥ 0.' };
  if (!validDate(input.incurred_on)) return { error: 'Ogiltigt datum.' };

  const pb = await getServerPb();
  try {
    await pb.collection('startup_service_costs').create({
      tenant: user.tenant,
      startup: input.startup,
      cost_type: input.cost_type,
      supplier: (input.supplier || '').slice(0, 200),
      invoice_ref: (input.invoice_ref || '').slice(0, 120),
      amount_sek: input.amount_sek,
      incurred_on: input.incurred_on,
      allocation_note: (input.allocation_note || '').slice(0, 500),
      source: 'manual'
    });
    revalidatePath('/rapporter/vinnova');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara kostnad.' };
  }
}

function validRl(v: unknown): boolean {
  return v == null || (typeof v === 'number' && v >= 1 && v <= 9);
}

export async function upsertReadinessAssessmentAction(input: {
  startup: string;
  assessed_at: string;
  crl?: number | null;
  tmrl?: number | null;
  brl?: number | null;
  srl?: number | null;
  criteria_checked_at?: string;
  note?: string;
}): Promise<ReportingActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, [...STAFF_WRITE, 'mentor'])) return { error: 'Åtkomst nekad.' };
  if (!input.startup) return { error: 'Bolag krävs.' };
  if (!validDate(input.assessed_at)) return { error: 'Ogiltigt bedömningsdatum.' };
  for (const v of [input.crl, input.tmrl, input.brl, input.srl]) {
    if (!validRl(v)) return { error: 'Readiness-nivåer måste vara 1–9.' };
  }

  const pb = await getServerPb();
  try {
    await pb.collection('startup_readiness_assessments').create({
      tenant: user.tenant,
      startup: input.startup,
      assessed_at: input.assessed_at,
      crl: input.crl ?? null,
      tmrl: input.tmrl ?? null,
      brl: input.brl ?? null,
      srl: input.srl ?? null,
      criteria_checked_at: validDate(input.criteria_checked_at) ? input.criteria_checked_at : null,
      assessed_by: user.id,
      note: (input.note || '').slice(0, 1000)
    });
    revalidatePath('/rapporter/vinnova');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara bedömning.' };
  }
}

const AID_BASES: StateAidBasis[] = ['art22', 'de_minimis'];

export async function upsertStateAidPeriodAction(input: {
  startup: string;
  basis: StateAidBasis;
  sni_code?: string;
  valid_from: string;
  valid_to?: string;
  note?: string;
}): Promise<ReportingActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_WRITE)) return { error: 'Åtkomst nekad.' };
  if (!input.startup) return { error: 'Bolag krävs.' };
  if (!AID_BASES.includes(input.basis)) return { error: 'Ogiltig statsstödsgrund.' };
  if (!validDate(input.valid_from)) return { error: 'Ogiltigt från-datum.' };
  if (input.valid_to && !validDate(input.valid_to)) return { error: 'Ogiltigt till-datum.' };
  if (input.basis === 'de_minimis' && !input.sni_code)
    return { error: 'SNI-kod krävs vid stöd av mindre betydelse.' };

  const pb = await getServerPb();
  try {
    await pb.collection('startup_state_aid_periods').create({
      tenant: user.tenant,
      startup: input.startup,
      basis: input.basis,
      sni_code: (input.sni_code || '').slice(0, 20),
      valid_from: input.valid_from,
      valid_to: validDate(input.valid_to) ? input.valid_to : null,
      note: (input.note || '').slice(0, 500)
    });
    revalidatePath('/rapporter/vinnova');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte spara statsstödsperiod.' };
  }
}
