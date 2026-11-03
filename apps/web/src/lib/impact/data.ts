import 'server-only';
import type PocketBase from 'pocketbase';
import {
  isImpactAssessmentStatus,
  isImpactCompanyStatus,
  isImpactUploadStage,
  normalizeImpactDashboard,
  normalizeImpactMateriality,
  normalizeImpactSufficiency,
  normalizeImpactUpdateDelta,
  type ImpactAssessmentStatus,
  type ImpactAssessmentType,
  type ImpactCompanyStatus,
  type ImpactDashboard,
  type ImpactGapSeverity,
  type ImpactGapStatus,
  type ImpactJobType,
  type ImpactMateriality,
  type ImpactSufficiency,
  type ImpactUpdateDelta,
  type ImpactUploadStage
} from '@platform/shared';

/**
 * Enda läsvägen för Impact Navigator (CLAUDE.md § 56). Reads går via den
 * inkommande klienten (användarens token → RLS § 21: sustainability_* är
 * staff/observer-only). Fail-soft mot ett ännu inte migrerat schema (tomma
 * listor + `error`). Kollektionerna adresseras på NAMN (§ 30.4 p. 1).
 * Visningsnamn — aldrig e-post (GDPR § 5).
 */

export const ASSESSMENTS = 'sustainability_assessments';
export const GAP_QUESTIONS = 'sustainability_gap_questions';
export const OVERRIDES = 'sustainability_materiality_overrides';
export const UPDATE_EVENTS = 'sustainability_update_events';
export const DOCUMENTS = 'sustainability_documents';
export const AI_JOBS = 'sustainability_ai_jobs';

interface UserRef {
  id: string;
  display_name?: string;
}
function nameOf(ref: UserRef | undefined): string | null {
  if (!ref) return null;
  const n = (ref.display_name ?? '').trim();
  return n || 'Kollega';
}

export interface ImpactStartupRow {
  id: string;
  name: string;
  phase?: string;
  industri?: string;
  status?: string;
  sustainability_journey_text?: string;
  sustainability_status?: string;
  sustainability_assigned_to?: string;
  expand?: { sustainability_assigned_to?: UserRef };
}

export interface ImpactCompany {
  id: string;
  name: string;
  phase: string;
  industry: string;
  startupStatus: string;
  journeyText: string;
  status: ImpactCompanyStatus | null;
  assignedTo: string | null;
  assignedToName: string | null;
}

export function rowToImpactCompany(row: ImpactStartupRow): ImpactCompany {
  return {
    id: row.id,
    name: row.name,
    phase: row.phase ?? '',
    industry: row.industri ?? '',
    startupStatus: row.status ?? '',
    journeyText: row.sustainability_journey_text ?? '',
    status: isImpactCompanyStatus(row.sustainability_status) ? row.sustainability_status : null,
    assignedTo: row.sustainability_assigned_to || null,
    assignedToName: nameOf(row.expand?.sustainability_assigned_to)
  };
}

interface AssessmentRow {
  id: string;
  startup: string;
  version: number;
  type: string;
  status: string;
  framework_version?: string;
  materiality?: unknown;
  sufficiency?: unknown;
  dashboard?: unknown;
  update_delta?: unknown;
  information_quality_score?: number;
  model_name?: string;
  prompt_version?: string;
  previous_assessment?: string;
  created_by?: string;
  completed_at?: string;
  created?: string;
  source_created_at?: string;
  expand?: { created_by?: UserRef };
}

export interface ImpactAssessment {
  id: string;
  startup: string;
  version: number;
  type: ImpactAssessmentType;
  status: ImpactAssessmentStatus;
  frameworkVersion: string;
  materiality: ImpactMateriality | null;
  sufficiency: ImpactSufficiency | null;
  dashboard: ImpactDashboard | null;
  updateDelta: ImpactUpdateDelta | null;
  informationQualityScore: number | null;
  modelName: string;
  promptVersion: string;
  previousAssessment: string | null;
  createdBy: string | null;
  createdByName: string | null;
  completedAt: string | null;
  /** Källans tidsstämpel vid import, annars PB:s `created`. */
  createdAt: string;
}

function present(v: unknown): boolean {
  return v !== null && v !== undefined && !(typeof v === 'object' && Object.keys(v as object).length === 0);
}

export function rowToAssessment(row: AssessmentRow): ImpactAssessment {
  const score = typeof row.information_quality_score === 'number' ? row.information_quality_score : null;
  return {
    id: row.id,
    startup: row.startup,
    version: Number(row.version) || 0,
    type: row.type === 'update' ? 'update' : 'initial',
    status: isImpactAssessmentStatus(row.status) ? row.status : 'failed',
    frameworkVersion: row.framework_version ?? '',
    materiality: present(row.materiality) ? normalizeImpactMateriality(row.materiality) : null,
    sufficiency: present(row.sufficiency) ? normalizeImpactSufficiency(row.sufficiency) : null,
    dashboard: present(row.dashboard) ? normalizeImpactDashboard(row.dashboard) : null,
    updateDelta: present(row.update_delta) ? normalizeImpactUpdateDelta(row.update_delta) : null,
    informationQualityScore: score,
    modelName: row.model_name ?? '',
    promptVersion: row.prompt_version ?? '',
    previousAssessment: row.previous_assessment || null,
    createdBy: row.created_by || null,
    createdByName: nameOf(row.expand?.created_by),
    completedAt: row.completed_at || null,
    createdAt: row.source_created_at || row.created || ''
  };
}

interface GapRow {
  id: string;
  assessment: string;
  aspect_code: string;
  question: string;
  missing_information?: string;
  severity: string;
  status: string;
  answer_text?: string;
  created?: string;
  source_created_at?: string;
}
export interface ImpactGapQuestion {
  id: string;
  assessment: string;
  aspectCode: string;
  question: string;
  missingInformation: string;
  severity: ImpactGapSeverity;
  status: ImpactGapStatus;
  answerText: string;
  createdAt: string;
}
export function rowToGap(row: GapRow): ImpactGapQuestion {
  return {
    id: row.id,
    assessment: row.assessment,
    aspectCode: row.aspect_code,
    question: row.question,
    missingInformation: row.missing_information ?? '',
    severity: row.severity === 'required' ? 'required' : 'recommended',
    status: row.status === 'answered' ? 'answered' : row.status === 'not_available' ? 'not_available' : 'open',
    answerText: row.answer_text ?? '',
    createdAt: row.source_created_at || row.created || ''
  };
}

interface OverrideRow {
  id: string;
  assessment: string;
  aspect_code: string;
  original_status: string;
  new_status: string;
  comment?: string;
  created_by?: string;
  created?: string;
  source_created_at?: string;
  expand?: { created_by?: UserRef };
}
export interface ImpactOverride {
  id: string;
  assessment: string;
  aspectCode: string;
  originalStatus: string;
  newStatus: string;
  comment: string;
  createdByName: string | null;
  createdAt: string;
}
export function rowToOverride(row: OverrideRow): ImpactOverride {
  return {
    id: row.id,
    assessment: row.assessment,
    aspectCode: row.aspect_code,
    originalStatus: row.original_status,
    newStatus: row.new_status,
    comment: row.comment ?? '',
    createdByName: nameOf(row.expand?.created_by),
    createdAt: row.source_created_at || row.created || ''
  };
}

interface UpdateEventRow {
  id: string;
  startup: string;
  assessment?: string;
  narrative?: string;
  created_by?: string;
  created?: string;
  source_created_at?: string;
  expand?: { created_by?: UserRef };
}
export interface ImpactUpdateEvent {
  id: string;
  assessment: string | null;
  narrative: string;
  createdByName: string | null;
  createdAt: string;
}
export function rowToUpdateEvent(row: UpdateEventRow): ImpactUpdateEvent {
  return {
    id: row.id,
    assessment: row.assessment || null,
    narrative: row.narrative ?? '',
    createdByName: nameOf(row.expand?.created_by),
    createdAt: row.source_created_at || row.created || ''
  };
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
  storage_path?: string;
  extracted_text?: string;
  extraction_status?: string;
  extraction_warning?: string;
  uploaded_by?: string;
  created?: string;
  source_created_at?: string;
  expand?: { uploaded_by?: UserRef };
}
export interface ImpactDocument {
  id: string;
  assessment: string | null;
  updateEvent: string | null;
  gapQuestion: string | null;
  stage: ImpactUploadStage;
  name: string;
  mime: string;
  sizeBytes: number | null;
  /** PB-filnamn — tomt för importerade rader (originalet låg i Vercel Blob). */
  file: string;
  hasText: boolean;
  charCount: number;
  extractionStatus: string;
  extractionWarning: string;
  uploadedByName: string | null;
  createdAt: string;
}
export function rowToDocument(row: DocumentRow): ImpactDocument {
  return {
    id: row.id,
    assessment: row.assessment || null,
    updateEvent: row.update_event || null,
    gapQuestion: row.gap_question || null,
    stage: isImpactUploadStage(row.upload_stage) ? row.upload_stage : 'full_information',
    name: row.original_name,
    mime: row.mime ?? '',
    sizeBytes: typeof row.size_bytes === 'number' ? row.size_bytes : null,
    file: row.file ?? '',
    hasText: (row.extracted_text ?? '').trim().length > 0,
    charCount: (row.extracted_text ?? '').length,
    extractionStatus: row.extraction_status ?? '',
    extractionWarning: row.extraction_warning ?? '',
    uploadedByName: nameOf(row.expand?.uploaded_by),
    createdAt: row.source_created_at || row.created || ''
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
  source_created_at?: string;
}
export interface ImpactJob {
  id: string;
  assessment: string | null;
  jobType: ImpactJobType;
  status: string;
  modelName: string;
  promptVersion: string;
  error: string;
  completedAt: string | null;
  createdAt: string;
}
export function rowToJob(row: JobRow): ImpactJob {
  const jt = row.job_type;
  return {
    id: row.id,
    assessment: row.assessment || null,
    jobType: jt === 'sufficiency' || jt === 'final_analysis' || jt === 'update_analysis' ? jt : 'materiality',
    status: row.status,
    modelName: row.model_name ?? '',
    promptVersion: row.prompt_version ?? '',
    error: row.error ?? '',
    completedAt: row.completed_at || null,
    createdAt: row.source_created_at || row.created || ''
  };
}

interface NoteRow {
  id: string;
  body?: string;
  confidential?: boolean;
  author?: string;
  created?: string;
  expand?: { author?: UserRef };
}
export interface ImpactNote {
  id: string;
  /** HTML (editor) — renderas via lib/safe-html. */
  body: string;
  confidential: boolean;
  authorName: string | null;
  createdAt: string;
}

export interface ReadResult<T> {
  items: T[];
  error?: string;
}

function readError(err: unknown, what: string): string {
  const status = (err as { status?: number })?.status;
  if (status === 404) return `${what} saknas — kör migration 1700000206.`;
  return `${what} kunde inte läsas just nu.`;
}

/** Bolagen i Impact Navigator = startups med en hållbarhetsstatus, plus övriga aktiva (för att starta en analys). */
export async function listImpactCompanies(
  pb: PocketBase,
  tenantId: string
): Promise<ReadResult<ImpactCompany> & { latest: Map<string, ImpactAssessment>; latestComplete: Map<string, ImpactAssessment> }> {
  const latest = new Map<string, ImpactAssessment>();
  const latestComplete = new Map<string, ImpactAssessment>();
  let items: ImpactCompany[] = [];
  let error: string | undefined;
  try {
    const rows = await pb.collection('startups').getFullList<ImpactStartupRow>({
      filter: pb.filter('tenant = {:t}', { t: tenantId }),
      sort: 'name',
      fields: 'id,name,phase,industri,status,sustainability_journey_text,sustainability_status,sustainability_assigned_to,expand.sustainability_assigned_to.id,expand.sustainability_assigned_to.display_name',
      expand: 'sustainability_assigned_to'
    });
    items = rows.map(rowToImpactCompany);
  } catch (err) {
    return { items: [], latest, latestComplete, error: readError(err, 'Bolagslistan') };
  }
  try {
    const rows = await pb.collection(ASSESSMENTS).getFullList<AssessmentRow>({
      filter: pb.filter('tenant = {:t}', { t: tenantId }),
      sort: '-version',
      fields: 'id,startup,version,type,status,information_quality_score,dashboard,completed_at,created,source_created_at,model_name'
    });
    for (const row of rows) {
      const a = rowToAssessment(row);
      if (!latest.has(row.startup)) latest.set(row.startup, a);
      if (a.status === 'complete' && a.dashboard && !latestComplete.has(row.startup)) latestComplete.set(row.startup, a);
    }
  } catch (err) {
    error = readError(err, 'Analyserna');
  }
  return { items, latest, latestComplete, error };
}

export async function getImpactCompany(pb: PocketBase, tenantId: string, startupId: string): Promise<ImpactCompany | null> {
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(startupId)) return null;
  try {
    const row = await pb.collection('startups').getFirstListItem<ImpactStartupRow>(
      pb.filter('id = {:id} && tenant = {:t}', { id: startupId, t: tenantId }),
      { expand: 'sustainability_assigned_to' }
    );
    return rowToImpactCompany(row);
  } catch {
    return null;
  }
}

export async function listAssessments(pb: PocketBase, tenantId: string, startupId: string): Promise<ReadResult<ImpactAssessment>> {
  try {
    const rows = await pb.collection(ASSESSMENTS).getFullList<AssessmentRow>({
      filter: pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId }),
      sort: '-version',
      expand: 'created_by'
    });
    return { items: rows.map(rowToAssessment) };
  } catch (err) {
    return { items: [], error: readError(err, 'Analyserna') };
  }
}

/** Senaste färdiga slutanalysen (dashboarden), annars null. */
export function latestCompleteAssessment(items: readonly ImpactAssessment[]): ImpactAssessment | null {
  return [...items].sort((a, b) => b.version - a.version).find((a) => a.status === 'complete' && a.dashboard) ?? null;
}

/** Senaste INITIAL-versionen som inte misslyckats — det guiden (steg 2–3) jobbar mot. */
export function activeInitialAssessment(items: readonly ImpactAssessment[]): ImpactAssessment | null {
  return [...items].sort((a, b) => b.version - a.version).find((a) => a.type === 'initial' && a.status !== 'failed') ?? null;
}

export async function getAssessment(pb: PocketBase, tenantId: string, id: string): Promise<ImpactAssessment | null> {
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(id)) return null;
  try {
    const row = await pb.collection(ASSESSMENTS).getFirstListItem<AssessmentRow>(pb.filter('id = {:id} && tenant = {:t}', { id, t: tenantId }));
    return rowToAssessment(row);
  } catch {
    return null;
  }
}

export async function listGapQuestions(pb: PocketBase, tenantId: string, assessmentIds: readonly string[]): Promise<ReadResult<ImpactGapQuestion>> {
  if (assessmentIds.length === 0) return { items: [] };
  try {
    const parts = assessmentIds.slice(0, 40).map((_, i) => `assessment = {:a${i}}`);
    const params: Record<string, string> = { t: tenantId };
    assessmentIds.slice(0, 40).forEach((id, i) => { params[`a${i}`] = id; });
    const rows = await pb.collection(GAP_QUESTIONS).getFullList<GapRow>({
      filter: pb.filter(`tenant = {:t} && (${parts.join(' || ')})`, params),
      sort: 'created'
    });
    return { items: rows.map(rowToGap) };
  } catch (err) {
    return { items: [], error: readError(err, 'Kompletteringsfrågorna') };
  }
}

export async function getGapQuestion(pb: PocketBase, tenantId: string, id: string): Promise<ImpactGapQuestion | null> {
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(id)) return null;
  try {
    const row = await pb.collection(GAP_QUESTIONS).getFirstListItem<GapRow>(pb.filter('id = {:id} && tenant = {:t}', { id, t: tenantId }));
    return rowToGap(row);
  } catch {
    return null;
  }
}

export async function listOverrides(pb: PocketBase, tenantId: string, assessmentIds: readonly string[]): Promise<ReadResult<ImpactOverride>> {
  if (assessmentIds.length === 0) return { items: [] };
  try {
    const parts = assessmentIds.slice(0, 40).map((_, i) => `assessment = {:a${i}}`);
    const params: Record<string, string> = { t: tenantId };
    assessmentIds.slice(0, 40).forEach((id, i) => { params[`a${i}`] = id; });
    const rows = await pb.collection(OVERRIDES).getFullList<OverrideRow>({
      filter: pb.filter(`tenant = {:t} && (${parts.join(' || ')})`, params),
      sort: 'created',
      expand: 'created_by'
    });
    return { items: rows.map(rowToOverride) };
  } catch (err) {
    return { items: [], error: readError(err, 'Väsentlighetsjusteringarna') };
  }
}

export async function listUpdateEvents(pb: PocketBase, tenantId: string, startupId: string): Promise<ReadResult<ImpactUpdateEvent>> {
  try {
    const rows = await pb.collection(UPDATE_EVENTS).getFullList<UpdateEventRow>({
      filter: pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId }),
      sort: '-created',
      expand: 'created_by'
    });
    return { items: rows.map(rowToUpdateEvent) };
  } catch (err) {
    return { items: [], error: readError(err, 'Uppdateringarna') };
  }
}

export async function listDocuments(pb: PocketBase, tenantId: string, startupId: string, opts: { withText?: boolean } = {}): Promise<ReadResult<ImpactDocument & { text?: string }>> {
  try {
    const rows = await pb.collection(DOCUMENTS).getFullList<DocumentRow>({
      filter: pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId }),
      sort: '-created',
      fields: 'id,startup,assessment,update_event,gap_question,upload_stage,original_name,mime,size_bytes,file,extraction_status,extraction_warning,uploaded_by,created,source_created_at,extracted_text,expand.uploaded_by.id,expand.uploaded_by.display_name',
      expand: 'uploaded_by'
    });
    return { items: rows.map((r) => (opts.withText ? { ...rowToDocument(r), text: (r.extracted_text ?? '').slice(0, 20000) } : rowToDocument(r))) };
  } catch (err) {
    return { items: [], error: readError(err, 'Dokumenten') };
  }
}

/** Dokument med text — det som matas till modellen. Hämtas separat (stora fält). */
export interface ImpactDocumentText {
  id: string;
  name: string;
  stage: ImpactUploadStage;
  /** Tom sträng när ingen text kunde läsas ut (dokumentet finns men matar inte analysen). */
  text: string;
  assessment: string | null;
  updateEvent: string | null;
  gapQuestion: string | null;
  createdAt: string;
}

/** Alla dokument med sin text — det som matas till modellen. Hämtas separat (stora fält). */
export async function listDocumentTexts(pb: PocketBase, tenantId: string, startupId: string): Promise<ImpactDocumentText[]> {
  const rows = await pb.collection(DOCUMENTS).getFullList<DocumentRow>({
    filter: pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId }),
    sort: 'created',
    fields: 'id,original_name,upload_stage,extracted_text,assessment,update_event,gap_question,created,source_created_at'
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.original_name,
    stage: isImpactUploadStage(r.upload_stage) ? r.upload_stage : 'full_information',
    text: (r.extracted_text ?? '').trim(),
    assessment: r.assessment || null,
    updateEvent: r.update_event || null,
    gapQuestion: r.gap_question || null,
    createdAt: r.source_created_at || r.created || ''
  }));
}

export async function getDocument(pb: PocketBase, tenantId: string, id: string): Promise<(ImpactDocument & { startup: string }) | null> {
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(id)) return null;
  try {
    const row = await pb.collection(DOCUMENTS).getFirstListItem<DocumentRow>(pb.filter('id = {:id} && tenant = {:t}', { id, t: tenantId }), {
      fields: 'id,startup,assessment,update_event,gap_question,upload_stage,original_name,mime,size_bytes,file,extraction_status,extraction_warning,created,source_created_at'
    });
    return { ...rowToDocument(row), startup: row.startup };
  } catch {
    return null;
  }
}

export async function listJobs(pb: PocketBase, tenantId: string, startupId: string): Promise<ReadResult<ImpactJob>> {
  try {
    const rows = await pb.collection(AI_JOBS).getFullList<JobRow>({
      filter: pb.filter('tenant = {:t} && startup = {:s}', { t: tenantId, s: startupId }),
      sort: '-created',
      fields: 'id,assessment,job_type,status,model_name,prompt_version,error,completed_at,created,source_created_at'
    });
    return { items: rows.map(rowToJob) };
  } catch (err) {
    return { items: [], error: readError(err, 'AI-körningarna') };
  }
}

export async function listNotes(pb: PocketBase, startupId: string): Promise<ReadResult<ImpactNote>> {
  try {
    const rows = await pb.collection('notes').getList<NoteRow>(1, 50, {
      filter: pb.filter('startup = {:s}', { s: startupId }),
      sort: '-created',
      expand: 'author'
    });
    return {
      items: rows.items.map((r) => ({
        id: r.id,
        body: r.body ?? '',
        confidential: r.confidential === true,
        authorName: nameOf(r.expand?.author),
        createdAt: r.created ?? ''
      }))
    };
  } catch (err) {
    return { items: [], error: readError(err, 'Anteckningarna') };
  }
}

/** Movexum-personal i tenanten som kan vara ansvarig — id + visningsnamn (aldrig e-post). */
export async function listAssignableStaff(pb: PocketBase, tenantId: string): Promise<Array<{ id: string; name: string }>> {
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
