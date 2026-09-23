import 'server-only';
import type PocketBase from 'pocketbase';
import {
  DEFAULT_PROCUREMENT_RULES,
  normalizeCalloffTemplate,
  normalizeProcurementCriteria,
  stockholmDateKey,
  type CalloffStatus,
  type CalloffTemplate,
  type ProcurementCalloffLike,
  type ProcurementCriterion,
  type ProcurementLike,
  type ProcurementRule,
  type ProcurementStatus
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';

/**
 * Enda läsvägen för upphandlingsmodulen (§ 39). Reads går via den
 * inkommande klienten (användarens token → RLS § 21); fail-soft mot ett
 * ännu inte migrerat schema (tom lista, aldrig krasch). Kollektionerna
 * adresseras på NAMN (§ 30.4 p. 1).
 */

export const PROCUREMENTS = 'procurements';
export const CALLOFFS = 'procurement_calloffs';
export const RULES = 'procurement_rules';
export const DOCUMENTS = 'procurement_documents';

export interface ProcurementRow extends ProcurementLike {
  tenant: string;
  procedure?: string | null;
  diarienummer?: string | null;
  description?: string | null;
  extension_option_months?: number | null;
  estimated_value_sek?: number | null;
  estimated_calloffs?: number | null;
  evaluation_criteria?: unknown;
  calloff_template?: unknown;
  agreement?: string | null;
  responsible?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created?: string;
  updated?: string;
}

export interface CalloffRow extends ProcurementCalloffLike {
  tenant: string;
  status: CalloffStatus;
  amount_sek?: number | null;
  movexum_share_pct?: number | null;
  state_aid_relevant?: boolean | null;
  evaluation_scores?: unknown;
  evaluation_summary?: string | null;
  evaluated_by?: string | null;
  notes?: string | null;
  created?: string;
  expand?: { startup?: { id: string; name?: string } };
}

export function todayKey(): string {
  return stockholmDateKey(new Date());
}

export function criteriaOf(p: Pick<ProcurementRow, 'evaluation_criteria'>): ProcurementCriterion[] {
  return normalizeProcurementCriteria(p.evaluation_criteria);
}

export function templateOf(p: Pick<ProcurementRow, 'calloff_template'>): CalloffTemplate {
  return normalizeCalloffTemplate(p.calloff_template);
}

export interface ProcurementDocumentRow {
  id: string;
  tenant: string;
  procurement?: string | null;
  title?: string | null;
  file: string;
  filename?: string | null;
  mime?: string | null;
  size_bytes?: number | null;
  char_count?: number | null;
  redacted?: boolean | null;
  analysis?: unknown;
  analysis_model?: string | null;
  analyzed_at?: string | null;
  uploaded_by?: string | null;
  created?: string;
}

export async function listProcurementDocuments(
  pb: PocketBase,
  tenantId: string,
  procurementId: string
): Promise<ProcurementDocumentRow[]> {
  try {
    return await pb.collection(DOCUMENTS).getFullList<ProcurementDocumentRow>({
      filter: tenantFilter(pb, tenantId, 'procurement = {:p}', { p: procurementId }),
      sort: '-created',
      fields: 'id,tenant,procurement,title,file,filename,mime,size_bytes,char_count,redacted,analysis_model,analyzed_at,created',
      batch: 100
    });
  } catch {
    return [];
  }
}

export async function getProcurementDocument(
  pb: PocketBase,
  tenantId: string,
  id: string
): Promise<ProcurementDocumentRow | null> {
  try {
    const row = await pb.collection(DOCUMENTS).getOne<ProcurementDocumentRow>(id);
    if (String(row.tenant) !== tenantId) return null;
    return row;
  } catch {
    return null;
  }
}

function tenantFilter(pb: PocketBase, tenantId: string, extra?: string, params: Record<string, unknown> = {}) {
  return pb.filter(`tenant = {:tenant}${extra ? ` && (${extra})` : ''}`, { tenant: tenantId, ...params });
}

export async function listProcurements(pb: PocketBase, tenantId: string): Promise<ProcurementRow[]> {
  try {
    const res = await pb.collection(PROCUREMENTS).getFullList<ProcurementRow>({
      filter: tenantFilter(pb, tenantId),
      sort: '-created',
      batch: 200
    });
    return res.map(normalizeProcurement);
  } catch {
    return [];
  }
}

export async function getProcurement(pb: PocketBase, tenantId: string, id: string): Promise<ProcurementRow | null> {
  try {
    const row = await pb.collection(PROCUREMENTS).getOne<ProcurementRow>(id);
    if (String(row.tenant) !== tenantId) return null;
    return normalizeProcurement(row);
  } catch {
    return null;
  }
}

export async function listCalloffs(
  pb: PocketBase,
  tenantId: string,
  opts: { procurementId?: string; startupId?: string } = {}
): Promise<CalloffRow[]> {
  const parts: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.procurementId) {
    parts.push('procurement = {:p}');
    params.p = opts.procurementId;
  }
  if (opts.startupId) {
    parts.push('startup = {:s}');
    params.s = opts.startupId;
  }
  try {
    const res = await pb.collection(CALLOFFS).getFullList<CalloffRow>({
      filter: tenantFilter(pb, tenantId, parts.join(' && ') || undefined, params),
      sort: '-started_at,-created',
      expand: 'startup',
      batch: 200
    });
    return res.map(normalizeCalloff);
  } catch {
    return [];
  }
}

export async function getCalloff(pb: PocketBase, tenantId: string, id: string): Promise<CalloffRow | null> {
  try {
    const row = await pb.collection(CALLOFFS).getOne<CalloffRow>(id, { expand: 'startup' });
    if (String(row.tenant) !== tenantId) return null;
    return normalizeCalloff(row);
  } catch {
    return null;
  }
}

export interface ProcurementRuleRow extends ProcurementRule {
  tenant: string;
  created_by?: string | null;
}

export async function listProcurementRules(pb: PocketBase, tenantId: string): Promise<ProcurementRuleRow[]> {
  try {
    const res = await pb.collection(RULES).getFullList<ProcurementRuleRow>({
      filter: tenantFilter(pb, tenantId),
      sort: 'scope,anchor,offset_days',
      batch: 200
    });
    return res.map((r) => ({
      ...r,
      procurement: r.procurement || null,
      offset_days: Number(r.offset_days ?? 0),
      active: r.active !== false
    }));
  } catch {
    return [];
  }
}

/**
 * Materialiserar standardreglerna för tenanten första gången modulen
 * används (ingen regel finns alls). Idempotent: en tenant som medvetet
 * raderat alla regler får dem INTE tillbaka — bara en tom OCH aldrig seedad
 * tenant… vilket vi inte kan skilja på, så vi seedar bara när listan är tom
 * och markerar via `created_by = null`. Skrivningen provas med användarens
 * token, sedan superuser (§ 21.3-fallback); rollen (staff) är redan
 * verifierad av anroparen.
 */
export async function ensureProcurementRules(
  pb: PocketBase,
  tenantId: string,
  actorId: string
): Promise<ProcurementRuleRow[]> {
  const existing = await listProcurementRules(pb, tenantId);
  // Bara tenant-breda regler räknas: upphandlingsspecifika regler (ur ett
  // uppladdat underlag) betyder inte att standardreglerna finns.
  if (existing.some((r) => !r.procurement)) return existing;
  const create = async (client: PocketBase) => {
    for (const rule of DEFAULT_PROCUREMENT_RULES) {
      await client.collection(RULES).create({ ...rule, tenant: tenantId, created_by: actorId });
    }
  };
  try {
    await create(pb);
  } catch {
    try {
      const su = await getSuperuserPb();
      if (su.ok) await create(su.pb);
    } catch (err) {
      console.error('[procurements] default rules seed failed', {
        tenant: tenantId,
        error: err instanceof Error ? err.message : err
      });
      return [];
    }
  }
  return listProcurementRules(pb, tenantId);
}

function normalizeProcurement(row: ProcurementRow): ProcurementRow {
  return {
    ...row,
    status: (row.status || 'planning') as ProcurementStatus,
    tender_deadline: dateOnly(row.tender_deadline),
    contract_start: dateOnly(row.contract_start),
    contract_end: dateOnly(row.contract_end),
    is_excellence_activity: Boolean(row.is_excellence_activity)
  };
}

function normalizeCalloff(row: CalloffRow): CalloffRow {
  return {
    ...row,
    status: (row.status || 'planned') as CalloffStatus,
    startup: row.startup || null,
    startup_name: row.expand?.startup?.name ?? row.startup_name ?? null,
    started_at: dateOnly(row.started_at),
    ends_at: dateOnly(row.ends_at),
    milestone_1_due: dateOnly(row.milestone_1_due),
    milestone_1_approved_at: dateOnly(row.milestone_1_approved_at),
    milestone_2_due: dateOnly(row.milestone_2_due),
    milestone_2_approved_at: dateOnly(row.milestone_2_approved_at),
    final_report_received_at: dateOnly(row.final_report_received_at),
    evaluated_at: dateOnly(row.evaluated_at),
    evaluation_score: typeof row.evaluation_score === 'number' ? row.evaluation_score : null
  };
}

export function dateOnly(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
