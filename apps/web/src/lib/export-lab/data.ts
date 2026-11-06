import 'server-only';
import type PocketBase from 'pocketbase';
import {
  isExportAssessmentStatus,
  isExportCompanyStatus,
  isExportUploadStage,
  normalizeExportPlan,
  normalizeExportProfile,
  normalizeExportSufficiency,
  normalizeExportUpdateDelta,
  normalizeIrlProfile,
  type ExportAssessmentStatus,
  type ExportAssessmentType,
  type ExportCompanyStatus,
  type ExportGapSeverity,
  type ExportGapStatus,
  type ExportJobType,
  type ExportPlan,
  type ExportProfile,
  type ExportSufficiency,
  type ExportUpdateDelta,
  type ExportUploadStage,
  type IrlProfile
} from '@platform/shared';

/**
 * Enda läsvägen för Export Lab (CLAUDE.md § 58). Reads går via den inkommande
 * klienten (användarens token → RLS § 21: export_* är staff/observer-only).
 * Fail-soft mot ett ännu inte migrerat schema (tomma listor + `error`).
 * Kollektionerna adresseras på NAMN (§ 30.4 p. 1). Visningsnamn — aldrig e-post.
 */

export const EXPORT_ASSESSMENTS = 'export_assessments';
export const EXPORT_GAP_QUESTIONS = 'export_gap_questions';
export const EXPORT_MARKET_REVIEWS = 'export_market_reviews';
export const EXPORT_UPDATE_EVENTS = 'export_update_events';
export const EXPORT_DOCUMENTS = 'export_documents';
export const EXPORT_AI_JOBS = 'export_ai_jobs';

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

interface UserRef {
  id: string;
  display_name?: string;
}
function nameOf(ref: UserRef | undefined): string | null {
  if (!ref) return null;
  const n = (ref.display_name ?? '').trim();
  return n || 'Kollega';
}

export interface ExportStartupRow {
  id: string;
  name: string;
  phase?: string;
  industri?: string;
  city?: string;
  website?: string;
  status?: string;
  irl_level?: number;
  export_ambition_text?: string;
  export_desired_markets?: string;
  export_status?: string;
  export_assigned_to?: string;
  expand?: { export_assigned_to?: UserRef };
}

export interface ExportCompany {
  id: string;
  name: string;
  phase: string;
  industry: string;
  city: string;
  website: string;
  startupStatus: string;
  ambitionText: string;
  desiredMarkets: string;
  status: ExportCompanyStatus | null;
  assignedTo: string | null;
  assignedToName: string | null;
}

const STARTUP_FIELDS = 'id,name,phase,industri,city,website,status,export_ambition_text,export_desired_markets,export_status,export_assigned_to,expand.export_assigned_to.id,expand.export_assigned_to.display_name';

export function rowToExportCompany(row: ExportStartupRow): ExportCompany {
  return {
    id: row.id,
    name: row.name,
    phase: row.phase ?? '',
    industry: row.industri ?? '',
    city: row.city ?? '',
    website: row.website ?? '',
    startupStatus: row.status ?? '',
    ambitionText: row.export_ambition_text ?? '',
    desiredMarkets: row.export_desired_markets ?? '',
    status: isExportCompanyStatus(row.export_status) ? row.export_status : null,
    assignedTo: row.export_assigned_to || null,
    assignedToName: nameOf(row.expand?.export_assigned_to)
  };
}

interface AssessmentRow {
  id: string;
  startup: string;
  version: number;
  type: string;
  status: string;
  framework_version?: string;
  profile?: unknown;
  sufficiency?: unknown;
  plan?: unknown;
  update_delta?: unknown;
  irl_snapshot?: unknown;
  information_quality_score?: number;
  model_name?: string;
  prompt_version?: string;
  input_hash?: string;
  previous_assessment?: string;
  created_by?: string;
  completed_at?: string;
  created?: string;
  expand?: { created_by?: UserRef };
}

export interface ExportAssessment {
  id: string;
  startup: string;
  version: number;
  type: ExportAssessmentType;
  status: ExportAssessmentStatus;
  frameworkVersion: string;
  profile: ExportProfile | null;
  sufficiency: ExportSufficiency | null;
  plan: ExportPlan | null;
  updateDelta: ExportUpdateDelta | null;
  /** IRL-profilen som gällde när steget kördes (transparens). */
  irlSnapshot: IrlProfile | null;
  informationQualityScore: number | null;
  modelName: string;
  promptVersion: string;
  /** Hash av AI-underlaget — eller ett pågående analys-lease (`analysis-lease:…`). */
  inputHash: string;
  previousAssessment: string | null;
  createdBy: string | null;
  createdByName: string | null;
  completedAt: string | null;
  createdAt: string;
}

function present(v: unknown): boolean {
  return v !== null && v !== undefined && !(typeof v === 'object' && Object.keys(v as object).length === 0);
}

export function rowToExportAssessment(row: AssessmentRow): ExportAssessment {
  const score = typeof row.information_quality_score === 'number' ? row.information_quality_score : null;
  const irl = present(row.irl_snapshot) ? normalizeIrlProfile(row.irl_snapshot) : null;
  return {
    id: row.id,
    startup: row.startup,
    version: Number(row.version) || 0,
    type: row.type === 'update' ? 'update' : 'initial',
    status: isExportAssessmentStatus(row.status) ? row.status : 'failed',
    frameworkVersion: row.framework_version ?? '',
    profile: present(row.profile) ? normalizeExportProfile(row.profile) : null,
    sufficiency: present(row.sufficiency) ? normalizeExportSufficiency(row.sufficiency) : null,
    plan: present(row.plan) ? normalizeExportPlan(row.plan) : null,
    updateDelta: present(row.update_delta) ? normalizeExportUpdateDelta(row.update_delta) : null,
    irlSnapshot: irl && Object.keys(irl).length ? irl : null,
    informationQualityScore: score,
    modelName: row.model_name ?? '',
    promptVersion: row.prompt_version ?? '',
    inputHash: row.input_hash ?? '',
    previousAssessment: row.previous_assessment || null,
    createdBy: row.created_by || null,
    createdByName: nameOf(row.expand?.created_by),
    completedAt: row.completed_at || null,
    createdAt: row.created || ''
  };
}

interface GapRow {
  id: string;
  assessment: string;
  target_code: string;
  question: string;
  missing_information?: string;
  severity: string;
  status: string;
  answer_text?: string;
  created?: string;
}
export interface ExportGapQuestion {
  id: string;
  assessment: string;
  targetCode: string;
  question: string;
  missingInformation: string;
  severity: ExportGapSeverity;
  status: ExportGapStatus;
  answerText: string;
  createdAt: string;
}
export function rowToExportGap(row: GapRow): ExportGapQuestion {
  return {
    id: row.id,
    assessment: row.assessment,
    targetCode: row.target_code,
    question: row.question,
    missingInformation: row.missing_information ?? '',
    severity: row.severity === 'required' ? 'required' : 'recommended',
    status: row.status === 'answered' ? 'answered' : row.status === 'not_available' ? 'not_available' : 'open',
    answerText: row.answer_text ?? '',
    createdAt: row.created || ''
  };
}

interface ReviewRow {
  id: string;
  assessment: string;
  market_code: string;
  country?: string;
  original_priority: string;
  new_priority: string;
  comment?: string;
  created?: string;
  expand?: { created_by?: UserRef };
}
export interface ExportMarketReview {
  id: string;
  assessment: string;
  marketCode: string;
  country: string;
  originalPriority: string;
  newPriority: string;
  comment: string;
  createdByName: string | null;
  createdAt: string;
}

interface UpdateEventRow {
  id: string;
  startup: string;
  assessment?: string;
  narrative?: string;
  created?: string;
  expand?: { created_by?: UserRef };
}
export interface ExportUpdateEvent {
  id: string;
  assessment: string | null;
  narrative: string;
  createdByName: string | null;
  createdAt: string;
}

interface DocumentRow {
  id: string;
  startup: string;
  assessment?: string;
  update_event?: string;
  gap_question?: string;
  upload_stage: string;
  original_name: string;
  mime?: string;
  size_bytes?: number;
  file?: string;
  extracted_text?: string;
  extraction_status?: string;
  extraction_warning?: string;
  created?: string;
  expand?: { uploaded_by?: UserRef };
}
export interface ExportDocument {
  id: string;
  assessment: string | null;
  updateEvent: string | null;
  gapQuestion: string | null;
  stage: ExportUploadStage;
  name: string;
  mime: string;
  sizeBytes: number | null;
  file: string;
  hasText: boolean;
  charCount: number;
  extractionStatus: string;
  extractionWarning: string;
  uploadedByName: string | null;
  createdAt: string;
}
export function rowToExportDocument(row: DocumentRow): ExportDocument {
  return {
    id: row.id,
    assessment: row.assessment || null,
    updateEvent: row.update_event || null,
    gapQuestion: row.gap_question || null,
    stage: isExportUploadStage(row.upload_stage) ? row.upload_stage : 'full_information',
    name: row.original_name,
    mime: row.mime ?? '',
    sizeBytes: typeof row.size_bytes === 'number' ? row.size_bytes : null,
    file: row.file ?? '',
    hasText: (row.extracted_text ?? '').trim().length > 0,
    charCount: (row.extracted_text ?? '').length,
    extractionStatus: row.extraction_status ?? '',
    extractionWarning: row.extraction_warning ?? '',
    uploadedByName: nameOf(row.expand?.uploaded_by),
    createdAt: row.created || ''
  };
}

interface JobRow {
  id: string;
  assessment?: string;
  job_type: string;
  status: string;
  model_name?: string;
  prompt_version?: string;
  error?: string;
  completed_at?: string;
  created?: string;
}
export interface ExportJob {
  id: string;
  assessment: string | null;
  jobType: ExportJobType;
  status: string;
  modelName: string;
  promptVersion: string;
  error: string;
  completedAt: string | null;
  createdAt: string;
}

export interface ReadResult<T> {
  items: T[];
  error?: string;
}

function readError(err: unknown, what: string): string {
  const status = (err as { status?: number })?.status;
  if (status === 404) return `${what} saknas — kör migration 1700000210.`;
  return `${what} kunde inte läsas just nu.`;
}

/** Bolagen i Export Lab = startups med exportstatus eller någon analysversion, plus övriga aktiva (för att starta). */
export async function listExportCompanies(
  pb: PocketBase,
  tenantId: string
): Promise<ReadResult<ExportCompany> & { latest: Map<string, ExportAssessment>; latestComplete: Map<string, ExportAssessment> }> {
  const latest = new Map<string, ExportAssessment>();
  const latestComplete = new Map<string, ExportAssessment>();
  let items: ExportCompany[] = [];
  let error: string | undefined;
  try {
    const rows = await pb.collection('startups').getFullList<ExportStartupRow>({
      filter: pb.filter('tenant = {:t}', { t: tenantId }),
      sort: 'name',
      fields: STARTUP_FIELDS,
      expand: 'export_assigned_to'
    });
    items = rows.map(rowToExportCompany);
  } catch (err) {
    return { items: [], latest, latestComplete, error: readError(err, 'Bolagslistan') };
  }
  try {
    const rows = await pb.collection(EXPORT_ASSESSMENTS).getFullList<AssessmentRow>({
      filter: pb.filter('tenant = {:t}', { t: tenantId }),
      sort: '-version',
      fields: 'id,startup,version,type,status,information_quality_score,plan,completed_at,created,model_name'
    });
    for (const row of rows) {
      const a = rowToExportAssessment(row);
      if (!latest.has(row.startup)) latest.set(row.startup, a);
      if (a.status === 'complete' && a.plan && !latestComplete.has(row.startup)) latestComplete.set(row.startup, a);
    }
  } catch (err) {
    error = readError(err, 'Analyserna');
  }
  return { items, latest, latestComplete, error };
}

export async function getExportCompany(pb: PocketBase, tenantId: string, startupId: string): Promise<ExportCompany | null> {
  if (!ID_RE.test(startupId)) return null;
  try {
    const row = await pb.collection('startups').getFirstListItem<ExportStartupRow>(pb.filter('id = {:id} && tenant = {:t}', { id: startupId, t: tenantId }), {
      expand: 'export_assigned_to'
    });
    return rowToExportCompany(row);
  } catch {
    return null;
  }
}

export async function listExportAssessments(pb: PocketBase, tenantId: string, startupId: string): Promise<ReadResult<ExportAssessment>> {
  try {
    const rows = await pb.collection(EXPORT_ASSESSMENTS).getFullList<AssessmentRow>({
      filter: pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId }),
      sort: '-version',
      expand: 'created_by'
    });
    return { items: rows.map(rowToExportAssessment) };
  } catch (err) {
    return { items: [], error: readError(err, 'Analyserna') };
  }
}

export function latestCompletePlan(items: readonly ExportAssessment[]): ExportAssessment | null {
  return [...items].sort((a, b) => b.version - a.version).find((a) => a.status === 'complete' && a.plan) ?? null;
}

export function activeInitialExportAssessment(items: readonly ExportAssessment[]): ExportAssessment | null {
  return [...items].sort((a, b) => b.version - a.version).find((a) => a.type === 'initial' && a.status !== 'failed') ?? null;
}

export async function getExportAssessment(pb: PocketBase, tenantId: string, id: string): Promise<ExportAssessment | null> {
  if (!ID_RE.test(id)) return null;
  try {
    const row = await pb.collection(EXPORT_ASSESSMENTS).getFirstListItem<AssessmentRow>(pb.filter('id = {:id} && tenant = {:t}', { id, t: tenantId }));
    return rowToExportAssessment(row);
  } catch {
    return null;
  }
}

function assessmentFilter(tenantId: string, assessmentIds: readonly string[]): { filter: string; params: Record<string, string> } {
  const ids = assessmentIds.slice(0, 40);
  const params: Record<string, string> = { t: tenantId };
  ids.forEach((id, i) => {
    params[`a${i}`] = id;
  });
  return { filter: `tenant = {:t} && (${ids.map((_, i) => `assessment = {:a${i}}`).join(' || ')})`, params };
}

export async function listExportGapQuestions(pb: PocketBase, tenantId: string, assessmentIds: readonly string[]): Promise<ReadResult<ExportGapQuestion>> {
  if (assessmentIds.length === 0) return { items: [] };
  try {
    const f = assessmentFilter(tenantId, assessmentIds);
    const rows = await pb.collection(EXPORT_GAP_QUESTIONS).getFullList<GapRow>({ filter: pb.filter(f.filter, f.params), sort: 'created' });
    return { items: rows.map(rowToExportGap) };
  } catch (err) {
    return { items: [], error: readError(err, 'Kompletteringsfrågorna') };
  }
}

export async function getExportGapQuestion(pb: PocketBase, tenantId: string, id: string): Promise<ExportGapQuestion | null> {
  if (!ID_RE.test(id)) return null;
  try {
    const row = await pb.collection(EXPORT_GAP_QUESTIONS).getFirstListItem<GapRow>(pb.filter('id = {:id} && tenant = {:t}', { id, t: tenantId }));
    return rowToExportGap(row);
  } catch {
    return null;
  }
}

export async function listExportMarketReviews(pb: PocketBase, tenantId: string, assessmentIds: readonly string[]): Promise<ReadResult<ExportMarketReview>> {
  if (assessmentIds.length === 0) return { items: [] };
  try {
    const f = assessmentFilter(tenantId, assessmentIds);
    const rows = await pb.collection(EXPORT_MARKET_REVIEWS).getFullList<ReviewRow>({ filter: pb.filter(f.filter, f.params), sort: 'created', expand: 'created_by' });
    return {
      items: rows.map((r) => ({
        id: r.id,
        assessment: r.assessment,
        marketCode: r.market_code,
        country: r.country ?? '',
        originalPriority: r.original_priority,
        newPriority: r.new_priority,
        comment: r.comment ?? '',
        createdByName: nameOf(r.expand?.created_by),
        createdAt: r.created || ''
      }))
    };
  } catch (err) {
    return { items: [], error: readError(err, 'Marknadsbesluten') };
  }
}

export async function listExportUpdateEvents(pb: PocketBase, tenantId: string, startupId: string): Promise<ReadResult<ExportUpdateEvent>> {
  try {
    const rows = await pb.collection(EXPORT_UPDATE_EVENTS).getFullList<UpdateEventRow>({
      filter: pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId }),
      sort: '-created',
      expand: 'created_by'
    });
    return { items: rows.map((r) => ({ id: r.id, assessment: r.assessment || null, narrative: r.narrative ?? '', createdByName: nameOf(r.expand?.created_by), createdAt: r.created || '' })) };
  } catch (err) {
    return { items: [], error: readError(err, 'Uppdateringarna') };
  }
}

export async function listExportDocuments(pb: PocketBase, tenantId: string, startupId: string, opts: { withText?: boolean } = {}): Promise<ReadResult<ExportDocument & { text?: string }>> {
  try {
    const rows = await pb.collection(EXPORT_DOCUMENTS).getFullList<DocumentRow>({
      filter: pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId }),
      sort: '-created',
      fields: 'id,startup,assessment,update_event,gap_question,upload_stage,original_name,mime,size_bytes,file,extraction_status,extraction_warning,uploaded_by,created,extracted_text,expand.uploaded_by.id,expand.uploaded_by.display_name',
      expand: 'uploaded_by'
    });
    return { items: rows.map((r) => (opts.withText ? { ...rowToExportDocument(r), text: (r.extracted_text ?? '').slice(0, 20000) } : rowToExportDocument(r))) };
  } catch (err) {
    return { items: [], error: readError(err, 'Dokumenten') };
  }
}

export interface ExportDocumentText {
  id: string;
  name: string;
  stage: ExportUploadStage;
  text: string;
  assessment: string | null;
  updateEvent: string | null;
  gapQuestion: string | null;
  createdAt: string;
}

/** Alla dokument med sin text — det som matas till modellen. */
export async function listExportDocumentTexts(pb: PocketBase, tenantId: string, startupId: string): Promise<ExportDocumentText[]> {
  const rows = await pb.collection(EXPORT_DOCUMENTS).getFullList<DocumentRow>({
    filter: pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId }),
    sort: 'created',
    fields: 'id,original_name,upload_stage,extracted_text,assessment,update_event,gap_question,created'
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.original_name,
    stage: isExportUploadStage(r.upload_stage) ? r.upload_stage : 'full_information',
    text: (r.extracted_text ?? '').trim(),
    assessment: r.assessment || null,
    updateEvent: r.update_event || null,
    gapQuestion: r.gap_question || null,
    createdAt: r.created || ''
  }));
}

export async function getExportDocument(pb: PocketBase, tenantId: string, id: string): Promise<(ExportDocument & { startup: string }) | null> {
  if (!ID_RE.test(id)) return null;
  try {
    const row = await pb.collection(EXPORT_DOCUMENTS).getFirstListItem<DocumentRow>(pb.filter('id = {:id} && tenant = {:t}', { id, t: tenantId }), {
      fields: 'id,startup,assessment,update_event,gap_question,upload_stage,original_name,mime,size_bytes,file,extraction_status,extraction_warning,created'
    });
    return { ...rowToExportDocument(row), startup: row.startup };
  } catch {
    return null;
  }
}

export async function listExportJobs(pb: PocketBase, tenantId: string, startupId: string): Promise<ReadResult<ExportJob>> {
  try {
    const rows = await pb.collection(EXPORT_AI_JOBS).getFullList<JobRow>({
      filter: pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId }),
      sort: '-created',
      fields: 'id,assessment,job_type,status,model_name,prompt_version,error,completed_at,created'
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        assessment: r.assessment || null,
        jobType: r.job_type === 'sufficiency' || r.job_type === 'plan' || r.job_type === 'update_plan' ? r.job_type : 'profile',
        status: r.status,
        modelName: r.model_name ?? '',
        promptVersion: r.prompt_version ?? '',
        error: r.error ?? '',
        completedAt: r.completed_at || null,
        createdAt: r.created || ''
      }))
    };
  } catch (err) {
    return { items: [], error: readError(err, 'AI-körningarna') };
  }
}

/** Movexum-personal i tenanten som kan vara ansvarig — id + visningsnamn (aldrig e-post). */
export async function listExportAssignableStaff(pb: PocketBase, tenantId: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const rows = await pb.collection('users').getFullList<{ id: string; display_name?: string; roles?: string[] }>({
      filter: pb.filter('tenant = {:t}', { t: tenantId }),
      fields: 'id,display_name,roles',
      sort: 'display_name'
    });
    return rows
      .filter((u) => (u.roles ?? []).some((r) => ['admin', 'incubator_lead', 'coach', 'mentor'].includes(r)))
      .map((u) => ({ id: u.id, name: (u.display_name ?? '').trim() || 'Kollega' }));
  } catch {
    return [];
  }
}
