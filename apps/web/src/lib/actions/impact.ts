'use server';

import { revalidatePath } from 'next/cache';
import type PocketBase from 'pocketbase';
import { getServerPb, getCurrentUser, type SessionUser } from '@/lib/auth.server';
import { logAgentAction, type Actor } from '@/lib/core/write';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { describePbError, pbStatus } from '@/lib/pb-error';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { escapeHtml } from '@/lib/safe-html';
import { logAiUsage } from '@/lib/ai/usage';
import { AiBudgetExceededError, assertWithinAiBudget } from '@/lib/ai/budget.server';
import { runImpactFinal, runImpactMateriality, runImpactSufficiency, runImpactUpdate, type ImpactAiOutcome } from '@/lib/ai/impact-analysis';
import {
  AI_JOBS,
  ASSESSMENTS,
  GAP_QUESTIONS,
  OVERRIDES,
  UPDATE_EVENTS,
  DOCUMENTS,
  activeInitialAssessment,
  getAssessment,
  getDocument,
  getImpactCompany,
  latestCompleteAssessment,
  listAssessments,
  listDocumentTexts,
  listGapQuestions,
  listJobs,
  type ImpactAssessment,
  type ImpactCompany,
  type ImpactDocumentText
} from '@/lib/impact/data';
import {
  IMPACT_FRAMEWORK_AREAS,
  IMPACT_FRAMEWORK_VERSION,
  applyImpactMaterialityReview,
  applyImpactSummaryComment,
  buildImpactFinalAnalysisAIInput,
  buildImpactMaterialityAIInput,
  buildImpactSufficiencyAIInput,
  buildImpactUpdateAnalysisAIInput,
  canDeleteImpact,
  canManageImpact,
  createImpactCustomAspect,
  impactCompanyStatusFor,
  impactGapResponseStatus,
  impactPhaseFor,
  type ImpactAssessmentStatus,
  type ImpactGapResponseInput,
  type ImpactJobType,
  type ImpactMateriality,
  type ImpactReviewDecision,
  type ImpactReviewPromotion,
  type ImpactSufficiency
} from '@platform/shared';
import { ALL_PHASES, type StartupPhase } from '@platform/shared';

/**
 * Impact Navigator (CLAUDE.md § 56) — server actions, porterade från
 * originalets `actions/company.ts` + `ai/pipeline.ts`.
 *
 * RBAC: driva analysen (skapa bolag/analys, köra AI-steg, granska
 * väsentlighet, svara på kompletteringar, uppdatera) = Movexum-personal
 * (`IMPACT_MANAGE_ROLES`); ta bort ett bolags hela analyshistorik =
 * ledningen; observer läser. Rollen enforce:as HÄR (PB:s createRule är
 * roll-lös per § 21.3); tenant + skapare stämplas server-side. Skrivningar går
 * via användarens token med superuser-fallback ENBART vid PB v0.23.4:s tysta
 * regel-nekande (400/403/404), efter verifierad roll + tenant. All fritext
 * personnummer-saneras (§ 15.6). Varje mutation audit-loggas PII-fritt i
 * `agent_actions` (bolagsnamn, version, status — aldrig underlag). AI-stegen
 * loggar tokens i `ai_usage_events`, prövar månadstaket (§ 9.6) och bokförs
 * i `sustainability_ai_jobs`. Människa-i-loopen (art. 14): väsentligheten
 * granskas, kompletteringarna fylls i och slutanalysen startas av en
 * människa; inget publiceras automatiskt.
 *
 * Statusflödet följer originalet: ett misslyckat AI-steg lämnar analysen i
 * steget före (underlaget är sparat, användaren kan försöka igen); bara en
 * misslyckad UPPDATERING markeras `failed` (den tidigare versionen är orörd).
 */

export interface ImpactActionState {
  ok?: boolean;
  error?: string;
  warning?: string;
  id?: string;
  assessmentId?: string;
  /** Vart klienten ska navigera när steget lyckats. */
  next?: string;
}

function revalidate(startupId?: string) {
  revalidatePath('/impactnavigator');
  revalidatePath('/impactnavigator/jamfor');
  if (startupId) {
    revalidatePath(`/impactnavigator/${startupId}`, 'layout');
    revalidatePath(`/startups/${startupId}/utveckling`);
  }
}

function actorOf(user: SessionUser): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

async function requireManager(): Promise<{ user: SessionUser; pb: PocketBase } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!canManageImpact(user.roles)) return { error: 'Bara Movexum-personal kan arbeta med analysen.' };
  const pb = await getServerPb();
  return { user, pb };
}

async function superuser(): Promise<PocketBase | null> {
  const su = await getSuperuserPb();
  if (!su.ok) {
    console.error('[impact] superuser unavailable — ingen fallback', { reason: su.reason });
    return null;
  }
  return su.pb;
}

function isRuleDenial(err: unknown): boolean {
  const status = pbStatus(err);
  return status === 400 || status === 403 || status === 404;
}

async function write<T>(pb: PocketBase, run: (client: PocketBase) => Promise<T>, fallback: string): Promise<T | { error: string }> {
  try {
    return await run(pb);
  } catch (err) {
    if (!isRuleDenial(err)) return { error: describePbError(err, fallback) };
    const su = await superuser();
    if (!su) return { error: describePbError(err, fallback) };
    try {
      return await run(su);
    } catch (err2) {
      return { error: describePbError(err2, fallback) };
    }
  }
}

function isErr(v: unknown): v is { error: string } {
  return typeof v === 'object' && v !== null && 'error' in v && typeof (v as { error: unknown }).error === 'string';
}

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;
const clean = (v: unknown, max: number) =>
  sanitizePersonnummer(String(v ?? ''))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
    .slice(0, max);
const idList = (v: unknown, max = 40): string[] =>
  (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter((x) => ID_RE.test(x)).slice(0, max);
const nowPb = () => new Date().toISOString().replace('T', ' ');

async function setCompanyStatus(pb: PocketBase, startupId: string, status: ImpactAssessmentStatus): Promise<void> {
  const res = await write(pb, (c) => c.collection('startups').update(startupId, { sustainability_status: impactCompanyStatusFor(status) }), 'status');
  if (isErr(res)) console.warn('[impact] company status not updated', { startupId, status });
}

async function setAssessmentStatus(pb: PocketBase, a: ImpactAssessment, status: ImpactAssessmentStatus, extra: Record<string, unknown> = {}): Promise<{ error: string } | null> {
  const res = await write(pb, (c) => c.collection(ASSESSMENTS).update(a.id, { status, ...extra }), 'Kunde inte uppdatera analysen.');
  if (isErr(res)) return res;
  await setCompanyStatus(pb, a.startup, status);
  return null;
}

// ─── Underlag ────────────────────────────────────────────────────────────────

const asSource = (d: ImpactDocumentText) => ({ originalName: d.name, extractedText: d.text || null });

/** Dokument för väsentlighetsanalysen: de som hör till versionen; äldre poster utan koppling tas med för v1. */
function materialityDocuments(docs: readonly ImpactDocumentText[], a: ImpactAssessment): ImpactDocumentText[] {
  const linked = docs.filter((d) => d.assessment === a.id && (d.stage === 'idea_description' || d.stage === 'full_information'));
  if (linked.length || a.version > 1) return linked;
  return docs.filter((d) => !d.assessment && (d.stage === 'idea_description' || d.stage === 'full_information'));
}

/** Koppla nyss uppladdade dokument (uppladdade utan analys-id) till en version/händelse/fråga. */
async function linkDocuments(pb: PocketBase, tenant: string, startupId: string, ids: readonly string[], patch: Record<string, string>): Promise<ImpactDocumentText[]> {
  const out: ImpactDocumentText[] = [];
  for (const id of ids) {
    const doc = await getDocument(pb, tenant, id);
    if (!doc || doc.startup !== startupId) continue;
    await write(pb, (c) => c.collection(DOCUMENTS).update(id, patch), 'dokument');
  }
  if (ids.length) {
    const all = await listDocumentTexts(pb, tenant, startupId);
    for (const d of all) if (ids.includes(d.id)) out.push(d);
  }
  return out;
}

// ─── AI-körningar: jobb, budget, usage ──────────────────────────────────────

async function createJob(pb: PocketBase, user: SessionUser, a: ImpactAssessment, jobType: ImpactJobType): Promise<string | null> {
  const res = await write(
    pb,
    (c) =>
      c.collection(AI_JOBS).create<{ id: string }>({
        tenant: user.tenant,
        startup: a.startup,
        assessment: a.id,
        job_type: jobType,
        status: 'running',
        prompt_version: '',
        input_hash: ''
      }),
    'job'
  );
  return isErr(res) ? null : res.id;
}

async function finishJob<T>(pb: PocketBase, user: SessionUser, jobId: string | null, outcome: ImpactAiOutcome<T>): Promise<void> {
  if (outcome.usage.tokensIn + outcome.usage.tokensOut > 0) {
    await logAiUsage(pb, { tenant: user.tenant, userId: user.id, surface: 'suggestions', model: outcome.model, tokensIn: outcome.usage.tokensIn, tokensOut: outcome.usage.tokensOut });
  }
  if (!jobId) return;
  await write(
    pb,
    (c) =>
      c.collection(AI_JOBS).update(jobId, {
        status: outcome.result ? 'complete' : 'failed',
        model_name: outcome.model,
        prompt_version: outcome.promptVersion,
        output: outcome.raw ?? null,
        error: outcome.error ?? '',
        completed_at: nowPb()
      }),
    'job'
  );
}

type StepCtx = { user: SessionUser; pb: PocketBase; company: ImpactCompany; a: ImpactAssessment };

async function loadForStep(startupId: string, assessmentId: string): Promise<StepCtx | { error: string }> {
  const ctx = await requireManager();
  if ('error' in ctx) return ctx;
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId) || !ID_RE.test(assessmentId)) return { error: 'Ogiltig analys.' };
  const company = await getImpactCompany(pb, user.tenant, startupId);
  const a = await getAssessment(pb, user.tenant, assessmentId);
  if (!company || !a || a.startup !== startupId) return { error: 'Analysen hittades inte.' };
  return { user, pb, company, a };
}

async function checkBudget(pb: PocketBase, tenant: string): Promise<string | null> {
  try {
    await assertWithinAiBudget(pb, tenant);
    return null;
  } catch (err) {
    if (err instanceof AiBudgetExceededError) return 'Månadstaket för AI är nått — justera under Inställningar → AI-analys.';
    throw err;
  }
}

// ─── Steg 1: Skapa bolag + första analysversionen ───────────────────────────

/**
 * Skapar (eller väljer) bolaget och version 1 (`materiality_pending`).
 * Klienten laddar sedan upp idébeskrivningen + övrigt underlag (route
 * handler, § 18.2) och anropar `runMaterialityAction` — originalets
 * "Skapa bolag och sammanfattning" i tre steg.
 */
export async function createImpactCompanyAction(input: Record<string, unknown>): Promise<ImpactActionState> {
  const ctx = await requireManager();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;

  const existingId = clean(input.startupId, 64);
  const journeyText = clean(input.journeyText, 20000);
  if (!journeyText) return { error: 'Beskriv bolagets hållbarhetsambitioner och vägval — det är underlaget analysen utgår från.' };

  let startupId = existingId;
  let name = '';
  if (existingId) {
    if (!ID_RE.test(existingId)) return { error: 'Ogiltigt bolag.' };
    const company = await getImpactCompany(pb, user.tenant, existingId);
    if (!company) return { error: 'Bolaget hittades inte.' };
    name = company.name;
    const res = await write(
      pb,
      (c) => c.collection('startups').update(existingId, { sustainability_journey_text: journeyText, sustainability_status: 'draft', sustainability_assigned_to: user.id }),
      'Kunde inte spara bolaget.'
    );
    if (isErr(res)) return res;
  } else {
    name = clean(input.name, 120);
    const industry = clean(input.industry, 160);
    const phase = String(input.phase ?? '');
    if (!name || !industry) return { error: 'Fyll i bolagsnamn och bransch.' };
    if (!(ALL_PHASES as readonly string[]).includes(phase)) return { error: 'Välj en giltig fas.' };
    const created = await write(
      pb,
      (c) =>
        c.collection('startups').create<{ id: string }>({
          tenant: user.tenant,
          name,
          phase: phase as StartupPhase,
          status: 'active',
          industri: industry,
          owner: user.id,
          sustainability_journey_text: journeyText,
          sustainability_status: 'draft',
          sustainability_assigned_to: user.id
        }),
      'Kunde inte skapa bolaget.'
    );
    if (isErr(created)) return created;
    startupId = created.id;
  }

  const existing = await listAssessments(pb, user.tenant, startupId);
  const nextVersion = existing.items.reduce((m, a) => Math.max(m, a.version), 0) + 1;
  const assessment = await write(
    pb,
    (c) =>
      c.collection(ASSESSMENTS).create<{ id: string }>({
        tenant: user.tenant,
        startup: startupId,
        version: nextVersion,
        type: 'initial',
        status: 'materiality_pending',
        framework_version: IMPACT_FRAMEWORK_VERSION,
        created_by: user.id
      }),
    'Kunde inte skapa analysen.'
  );
  if (isErr(assessment)) return assessment;

  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'create',
    collection: ASSESSMENTS,
    record_id: assessment.id,
    after_value: { startup_name: name, version: nextVersion, status: 'materiality_pending', startup: startupId }
  });
  revalidate(startupId);
  return { ok: true, id: startupId, assessmentId: assessment.id };
}

// ─── Steg 2: Väsentlighetsanalys ────────────────────────────────────────────

export async function runMaterialityAction(startupId: string, assessmentId: string): Promise<ImpactActionState> {
  const ctx = await loadForStep(startupId, assessmentId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb, company, a } = ctx;
  if (a.type !== 'initial' || a.status !== 'materiality_pending' || a.materiality) {
    return { error: 'Väsentlighetsanalysen är redan gjord för den här versionen.', next: `/impactnavigator/${startupId}/vasentlighet` };
  }
  const budget = await checkBudget(pb, user.tenant);
  if (budget) return { error: budget };

  const docs = materialityDocuments(await listDocumentTexts(pb, user.tenant, company.id), a);
  const aiInput = buildImpactMaterialityAIInput({
    name: company.name,
    phase: impactPhaseFor(company.phase),
    industry: company.industry,
    journeyText: company.journeyText,
    documents: docs.map(asSource),
    referenceMaterialityAreas: IMPACT_FRAMEWORK_AREAS.map((area) => ({ code: area.code, name: area.name, category: area.category }))
  });
  const jobId = await createJob(pb, user, a, 'materiality');
  const outcome = await runImpactMateriality(aiInput);
  await finishJob(pb, user, jobId, outcome);
  if (!outcome.result) return { error: outcome.error ?? 'AI-analysen misslyckades.' };

  const err = await setAssessmentStatus(pb, a, 'materiality_review', {
    materiality: outcome.result,
    model_name: outcome.model,
    prompt_version: outcome.promptVersion
  });
  if (err) return err;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: ASSESSMENTS,
    record_id: a.id,
    field: 'materiality',
    after_value: { startup_name: company.name, version: a.version, status: 'materiality_review', aspects: outcome.result.selectedAspects.length, model: outcome.model }
  });
  revalidate(startupId);
  return { ok: true, next: `/impactnavigator/${startupId}/vasentlighet` };
}

// ─── Steg 2 → 3: Godkänn väsentligheten och kör informationsgapanalysen ────

async function persistSufficiency(pb: PocketBase, user: SessionUser, company: ImpactCompany, a: ImpactAssessment, result: ImpactSufficiency, model: string, promptVersion: string): Promise<{ error: string } | { created: number }> {
  // Originalet raderar versionens frågor och skapar om dem från resultatet.
  const existing = await listGapQuestions(pb, user.tenant, [a.id]);
  for (const q of existing.items) {
    await write(pb, (c) => c.collection(GAP_QUESTIONS).delete(q.id), 'fråga');
  }
  let created = 0;
  for (const check of result.aspectChecks) {
    const q = check.question;
    if (!q) continue;
    const res = await write(
      pb,
      (c) =>
        c.collection(GAP_QUESTIONS).create({
          tenant: user.tenant,
          assessment: a.id,
          aspect_code: check.code,
          question: clean(q.question, 2000),
          missing_information: clean(q.missingInformation, 2000),
          severity: q.severity.toLowerCase(),
          status: 'open'
        }),
      'Kunde inte spara kompletteringsfråga.'
    );
    if (!isErr(res)) created += 1;
  }
  const err = await setAssessmentStatus(pb, a, 'needs_more_info', {
    sufficiency: result,
    information_quality_score: result.overallInformationQuality,
    model_name: model,
    prompt_version: promptVersion
  });
  if (err) return err;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: ASSESSMENTS,
    record_id: a.id,
    field: 'sufficiency',
    after_value: { startup_name: company.name, version: a.version, status: 'needs_more_info', questions: created, model }
  });
  return { created };
}

export async function approveMaterialityAction(startupId: string, assessmentId: string, input: Record<string, unknown>): Promise<ImpactActionState> {
  const ctx = await loadForStep(startupId, assessmentId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb, company, a } = ctx;
  if (!a.materiality) return { error: 'Väsentlighetsanalysen saknas.' };
  if (a.type !== 'initial' || a.status !== 'materiality_review') return { error: 'Väsentligheten är redan godkänd.', next: `/impactnavigator/${startupId}/analys` };
  const budget = await checkBudget(pb, user.tenant);
  if (budget) return { error: budget };

  const decisions: ImpactReviewDecision[] = (Array.isArray(input.decisions) ? input.decisions : []).slice(0, 40).map((d) => {
    const r = (d ?? {}) as Record<string, unknown>;
    return { aspectCode: clean(r.aspectCode, 40).toUpperCase(), status: String(r.status ?? ''), comment: clean(r.comment, 2000) };
  });
  const promotions: ImpactReviewPromotion[] = (Array.isArray(input.promotions) ? input.promotions : []).slice(0, 40).map((p) => {
    const r = (p ?? {}) as Record<string, unknown>;
    return { aspectCode: clean(r.aspectCode, 40).toUpperCase(), comment: clean(r.comment, 2000) };
  });
  const review = applyImpactMaterialityReview(a.materiality, { decisions, promotions });
  let updated: ImpactMateriality = applyImpactSummaryComment(review.materiality, clean(input.summaryComment, 2000));
  const customName = clean(input.customName, 160);
  if (customName) {
    const custom = createImpactCustomAspect(updated, { name: customName, category: String(input.customCategory ?? 'GOVERNANCE'), underlying: clean(input.customUnderlying, 500) });
    updated = { ...updated, selectedAspects: [...updated.selectedAspects, custom] };
  }

  for (const change of review.changes) {
    const res = await write(
      pb,
      (c) =>
        c.collection(OVERRIDES).create({
          tenant: user.tenant,
          assessment: a.id,
          aspect_code: change.aspectCode,
          original_status: change.originalStatus.toLowerCase(),
          new_status: change.newStatus.toLowerCase(),
          comment: change.comment,
          created_by: user.id
        }),
      'Kunde inte spara justeringen.'
    );
    if (isErr(res)) return res;
  }
  const err = await setAssessmentStatus(pb, a, 'info_pending', { materiality: updated });
  if (err) return err;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: ASSESSMENTS,
    record_id: a.id,
    field: 'materiality_confirmed',
    after_value: { startup_name: company.name, version: a.version, status: 'info_pending', overrides: review.changes.length, custom_area: Boolean(customName) }
  });

  // Direkt vidare till informationsgapanalysen (originalets approveMaterialityAction).
  const refreshed = { ...a, status: 'info_pending' as const, materiality: updated };
  const jobId = await createJob(pb, user, refreshed, 'sufficiency');
  const outcome = await runImpactSufficiency(buildImpactSufficiencyAIInput({ phase: impactPhaseFor(company.phase), materiality: updated }));
  await finishJob(pb, user, jobId, outcome);
  revalidate(startupId);
  if (!outcome.result) {
    return { ok: true, error: outcome.error ?? 'Informationsgapanalysen misslyckades. Väsentligheten är sparad — kör analysen igen från nästa steg.', next: `/impactnavigator/${startupId}/analys` };
  }
  const persisted = await persistSufficiency(pb, user, company, refreshed, outcome.result, outcome.model, outcome.promptVersion);
  if (isErr(persisted)) return persisted;
  revalidate(startupId);
  return { ok: true, next: `/impactnavigator/${startupId}/analys#gap` };
}

/** Kör (om) informationsgapanalysen med ev. nytt underlag — originalets `uploadInformationAction`. */
export async function runSufficiencyAction(startupId: string, assessmentId: string, input: Record<string, unknown> = {}): Promise<ImpactActionState> {
  const ctx = await loadForStep(startupId, assessmentId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb, company, a } = ctx;
  if (!a.materiality) return { error: 'Väsentlighetsanalysen saknas.' };
  if (a.type !== 'initial' || a.status !== 'info_pending') return { error: 'Informationsgapanalysen kan bara köras när väsentligheten är godkänd och ingen prövning finns.', next: `/impactnavigator/${startupId}/analys` };
  const budget = await checkBudget(pb, user.tenant);
  if (budget) return { error: budget };

  const newIds = idList(input.documentIds);
  await linkDocuments(pb, user.tenant, startupId, newIds, { assessment: a.id, upload_stage: 'full_information' });
  const docs = await listDocumentTexts(pb, user.tenant, company.id);
  // Nytt underlag = dokument som laddats upp efter väsentlighetsanalysen (+ de nyss uppladdade).
  const jobs = await listJobs(pb, user.tenant, company.id);
  const materialityDone = jobs.items.find((j) => j.assessment === a.id && j.jobType === 'materiality' && j.status === 'complete')?.completedAt ?? null;
  const isNew = (d: ImpactDocumentText) =>
    newIds.includes(d.id) || (d.assessment === a.id && d.stage === 'full_information' && (!materialityDone || d.createdAt > materialityDone));
  const newDocs = docs.filter(isNew);
  const known = docs.filter((d) => !isNew(d) && d.text).map((d) => d.text);

  const jobId = await createJob(pb, user, a, 'sufficiency');
  const outcome = await runImpactSufficiency(
    buildImpactSufficiencyAIInput({ phase: impactPhaseFor(company.phase), materiality: a.materiality, newDocuments: newDocs.map(asSource), knownEvidenceTexts: known })
  );
  await finishJob(pb, user, jobId, outcome);
  if (!outcome.result) return { error: outcome.error ?? 'Informationsgapanalysen misslyckades.' };
  const persisted = await persistSufficiency(pb, user, company, a, outcome.result, outcome.model, outcome.promptVersion);
  if (isErr(persisted)) return persisted;
  revalidate(startupId);
  return { ok: true, next: `/impactnavigator/${startupId}/analys#gap` };
}

// ─── Steg 3 → 4: Kompletteringar och slutanalys ────────────────────────────

interface GapSubmission {
  questionId: string;
  answerText: string;
  requestedStatus: string;
  documentIds: string[];
}

/** "Jag har kompletterat det jag kan – fortsätt": spara svaren och skapa dashboarden. */
export async function finalizeAnalysisAction(startupId: string, assessmentId: string, input: Record<string, unknown>): Promise<ImpactActionState> {
  const ctx = await loadForStep(startupId, assessmentId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb, company, a } = ctx;
  if (a.type !== 'initial') return { error: 'Slutanalysen körs på den ursprungliga versionen.', next: `/impactnavigator/${startupId}/dashboard` };
  if (!a.materiality || !a.sufficiency) return { error: 'Väsentlighet och informationsgap måste finnas innan slutanalysen.' };
  if (a.status !== 'needs_more_info' && a.status !== 'final_pending') {
    return { error: a.status === 'complete' ? 'Resultatet är redan skapat.' : 'Analysen är inte redo för slutanalys.', next: `/impactnavigator/${startupId}/${a.status === 'complete' ? 'dashboard' : 'analys'}` };
  }
  const budget = await checkBudget(pb, user.tenant);
  if (budget) return { error: budget };

  const submissions: GapSubmission[] = (Array.isArray(input.submissions) ? input.submissions : []).slice(0, 40).map((s) => {
    const r = (s ?? {}) as Record<string, unknown>;
    return { questionId: clean(r.questionId, 64), answerText: clean(r.answerText, 10000), requestedStatus: String(r.requestedStatus ?? ''), documentIds: idList(r.documentIds) };
  });
  const byQuestion = new Map(submissions.filter((s) => ID_RE.test(s.questionId)).map((s) => [s.questionId, s]));

  const questions = (await listGapQuestions(pb, user.tenant, [a.id])).items;
  for (const q of questions) {
    const sub = byQuestion.get(q.id);
    if (sub?.documentIds.length) await linkDocuments(pb, user.tenant, startupId, sub.documentIds, { assessment: a.id, gap_question: q.id, upload_stage: 'gap_response' });
  }
  const docs = await listDocumentTexts(pb, user.tenant, company.id);
  const gapResponses: ImpactGapResponseInput[] = questions.map((q) => {
    const sub = byQuestion.get(q.id);
    const qDocs = docs.filter((d) => d.gapQuestion === q.id && d.stage === 'gap_response');
    return {
      areaCode: q.aspectCode,
      question: q.question,
      status: impactGapResponseStatus(sub?.requestedStatus ?? q.status, (sub?.answerText || q.answerText) || null, qDocs.some((d) => Boolean(d.text))),
      answerText: sub ? sub.answerText || null : q.answerText || null,
      documents: qDocs.map(asSource)
    };
  });

  // Originalets "gap-document-empty": filer bifogades men varken text eller svar finns.
  const unusable = questions.some((q, i) => {
    const sub = byQuestion.get(q.id);
    if (!sub?.documentIds.length) return false;
    const r = gapResponses[i];
    return r.status === 'open' && !r.answerText;
  });
  if (unusable) {
    return { error: 'Ingen läsbar text kunde hämtas från de uppladdade dokumenten. Kontrollera filerna eller komplettera frågorna med text och försök igen.' };
  }

  for (const [i, q] of questions.entries()) {
    const r = gapResponses[i];
    await write(pb, (c) => c.collection(GAP_QUESTIONS).update(q.id, { answer_text: r.answerText ?? '', status: r.status }), 'svar');
  }
  const statusErr = await setAssessmentStatus(pb, a, 'final_pending');
  if (statusErr) return statusErr;

  const aiInput = buildImpactFinalAnalysisAIInput({
    companyName: company.name,
    phase: impactPhaseFor(company.phase),
    industry: company.industry,
    materiality: a.materiality,
    sufficiency: a.sufficiency,
    gapResponses,
    knownEvidenceTexts: docs.filter((d) => d.stage !== 'gap_response' && d.text).map((d) => d.text)
  });
  const jobId = await createJob(pb, user, a, 'final_analysis');
  const outcome = await runImpactFinal(aiInput);
  await finishJob(pb, user, jobId, outcome);
  if (!outcome.result) {
    await setAssessmentStatus(pb, a, 'needs_more_info');
    revalidate(startupId);
    return { error: outcome.error ?? 'Slutanalysen misslyckades. Dina uppgifter är sparade och du kan försöka igen.' };
  }
  const err = await setAssessmentStatus(pb, a, 'complete', {
    dashboard: outcome.result,
    information_quality_score: a.sufficiency.overallInformationQuality,
    model_name: outcome.model,
    prompt_version: outcome.promptVersion,
    completed_at: nowPb()
  });
  if (err) return err;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: ASSESSMENTS,
    record_id: a.id,
    field: 'dashboard',
    after_value: { startup_name: company.name, version: a.version, status: 'complete', impact_level: outcome.result.impactLevel.level, model: outcome.model }
  });
  revalidate(startupId);
  return { ok: true, next: `/impactnavigator/${startupId}/dashboard` };
}

// ─── Uppdatera bolag (ny analysversion) ─────────────────────────────────────

const UPDATE_STALE_MS = 6 * 60 * 1000;

export async function updateCompanyAction(startupId: string, input: Record<string, unknown>): Promise<ImpactActionState> {
  const ctx = await requireManager();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId)) return { error: 'Ogiltigt bolag.' };
  const company = await getImpactCompany(pb, user.tenant, startupId);
  if (!company) return { error: 'Bolaget hittades inte.' };
  const narrative = clean(input.narrative, 20000);
  const documentIds = idList(input.documentIds);
  if (!narrative && documentIds.length === 0) return { error: 'Beskriv vad som har hänt sedan sist eller ladda upp minst ett nytt dokument.' };
  const budget = await checkBudget(pb, user.tenant);
  if (budget) return { error: budget };

  const all = (await listAssessments(pb, user.tenant, startupId)).items;
  const previous = latestCompleteAssessment(all);
  if (!previous?.dashboard || !previous.materiality) return { error: 'Det finns ingen färdig slutanalys att uppdatera — skapa först dashboarden.', next: `/impactnavigator/${startupId}/analys` };
  const latest = [...all].sort((x, y) => y.version - x.version)[0];
  if (latest && latest.id !== previous.id && latest.status !== 'failed') {
    const started = Date.parse(latest.createdAt.replace(' ', 'T')) || 0;
    const stale = latest.status === 'final_pending' && Date.now() - started > UPDATE_STALE_MS;
    if (!stale) return { error: 'En annan uppdatering av bolaget pågår redan. Vänta tills den är klar och försök sedan igen.' };
    await write(pb, (c) => c.collection(ASSESSMENTS).update(latest.id, { status: 'failed' }), 'status');
  }

  const nextVersion = all.reduce((m, x) => Math.max(m, x.version), 0) + 1;
  const created = await write(
    pb,
    (c) =>
      c.collection(ASSESSMENTS).create<{ id: string }>({
        tenant: user.tenant,
        startup: startupId,
        version: nextVersion,
        type: 'update',
        status: 'final_pending',
        framework_version: IMPACT_FRAMEWORK_VERSION,
        materiality: previous.materiality,
        sufficiency: previous.sufficiency,
        previous_assessment: previous.id,
        created_by: user.id
      }),
    'Kunde inte skapa uppdateringen.'
  );
  if (isErr(created)) return created;
  const event = await write(
    pb,
    (c) => c.collection(UPDATE_EVENTS).create<{ id: string }>({ tenant: user.tenant, startup: startupId, assessment: created.id, created_by: user.id, narrative }),
    'Kunde inte spara uppdateringen.'
  );
  if (isErr(event)) return event;
  await setCompanyStatus(pb, startupId, 'final_pending');
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'create',
    collection: UPDATE_EVENTS,
    record_id: event.id,
    after_value: { startup_name: company.name, version: nextVersion, narrative_length: narrative.length, documents: documentIds.length, startup: startupId }
  });

  const newDocs = await linkDocuments(pb, user.tenant, startupId, documentIds, { assessment: created.id, update_event: event.id, upload_stage: 'update' });
  const docs = await listDocumentTexts(pb, user.tenant, company.id);
  const completeIds = new Set(all.filter((x) => x.status === 'complete').map((x) => x.id));
  const known = docs.filter((d) => d.assessment && completeIds.has(d.assessment) && d.text).map((d) => d.text);
  const aiInput = buildImpactUpdateAnalysisAIInput({
    companyName: company.name,
    phase: impactPhaseFor(company.phase),
    previousDashboard: previous.dashboard,
    materiality: previous.materiality,
    sufficiency: previous.sufficiency,
    narrative,
    documents: newDocs.map(asSource),
    knownEvidenceTexts: known
  });
  const a: ImpactAssessment = { ...previous, id: created.id, version: nextVersion, type: 'update', status: 'final_pending', previousAssessment: previous.id };
  if (!aiInput.newEvidence.narrative && aiInput.newEvidence.documents.length === 0) {
    await write(pb, (c) => c.collection(ASSESSMENTS).update(created.id, { status: 'failed' }), 'status');
    await setCompanyStatus(pb, startupId, 'complete');
    revalidate(startupId);
    return { error: 'Ingen läsbar text kunde hämtas från de nya dokumenten. Kontrollera filerna eller lägg till en kort beskrivning och försök igen.' };
  }

  const jobId = await createJob(pb, user, a, 'update_analysis');
  const outcome = await runImpactUpdate(aiInput, previous.informationQualityScore);
  await finishJob(pb, user, jobId, outcome);
  if (!outcome.result) {
    await write(pb, (c) => c.collection(ASSESSMENTS).update(created.id, { status: 'failed' }), 'status');
    await setCompanyStatus(pb, startupId, 'complete');
    revalidate(startupId);
    return { error: `${outcome.error ?? 'Uppdateringsanalysen misslyckades.'} Den tidigare analysversionen är oförändrad.` };
  }
  const err = await setAssessmentStatus(pb, a, 'complete', {
    dashboard: outcome.result.updatedDashboard,
    update_delta: outcome.result.deltaSummary,
    information_quality_score: previous.informationQualityScore,
    model_name: outcome.model,
    prompt_version: outcome.promptVersion,
    completed_at: nowPb()
  });
  if (err) return err;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: ASSESSMENTS,
    record_id: created.id,
    field: 'dashboard',
    after_value: { startup_name: company.name, version: nextVersion, status: 'complete', impact_level: outcome.result.updatedDashboard.impactLevel.level, model: outcome.model, update: true }
  });
  revalidate(startupId);
  return { ok: true, assessmentId: created.id, next: `/impactnavigator/${startupId}/dashboard` };
}

// ─── Bolagsuppgifter, anteckningar, dokument, radering ─────────────────────

/** Bolagsuppgifter (namn, bransch, fas, hållbarhetsresa, ansvarig) — originalets settings-sida. */
export async function updateCompanyDetailsAction(startupId: string, input: Record<string, unknown>): Promise<ImpactActionState> {
  const ctx = await requireManager();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId)) return { error: 'Ogiltigt bolag.' };
  const company = await getImpactCompany(pb, user.tenant, startupId);
  if (!company) return { error: 'Bolaget hittades inte.' };
  const payload: Record<string, unknown> = {};
  if ('name' in input || 'industry' in input) {
    const name = clean(input.name, 120);
    const industry = clean(input.industry, 160);
    if (!name || !industry) return { error: 'Fyll i både bolagsnamn och bransch.' };
    payload.name = name;
    payload.industri = industry;
  }
  if ('phase' in input) {
    const phase = String(input.phase ?? '');
    if (!(ALL_PHASES as readonly string[]).includes(phase)) return { error: 'Välj en giltig fas.' };
    payload.phase = phase;
  }
  if ('journeyText' in input) payload.sustainability_journey_text = clean(input.journeyText, 20000);
  if ('assignedTo' in input) {
    const a = clean(input.assignedTo, 64);
    if (a && !ID_RE.test(a)) return { error: 'Ogiltig ansvarig.' };
    payload.sustainability_assigned_to = a;
  }
  if (!Object.keys(payload).length) return { ok: true };
  const res = await write(pb, (c) => c.collection('startups').update(startupId, payload), 'Bolagsuppgifterna kunde inte sparas.');
  if (isErr(res)) return res;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: 'startups',
    record_id: startupId,
    field: Object.keys(payload).join(','),
    after_value: { startup_name: clean(payload.name ?? company.name, 120), impact: true }
  });
  revalidate(startupId);
  revalidatePath(`/startups/${startupId}`, 'layout');
  return { ok: true };
}

/** Bakåtkompatibelt namn (bolagets resa / ansvarig). */
export async function updateImpactCompanyAction(startupId: string, input: Record<string, unknown>): Promise<ImpactActionState> {
  return updateCompanyDetailsAction(startupId, input);
}

export async function addImpactNoteAction(startupId: string, input: Record<string, unknown>): Promise<ImpactActionState> {
  const ctx = await requireManager();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId)) return { error: 'Ogiltigt bolag.' };
  const company = await getImpactCompany(pb, user.tenant, startupId);
  if (!company) return { error: 'Bolaget hittades inte.' };
  const body = clean(input.body, 20000);
  if (!body) return { error: 'Skriv något i anteckningen.' };
  const html = body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const res = await write(pb, (c) => c.collection('notes').create<{ id: string }>({ startup: startupId, author: user.id, body: html, confidential: false }), 'Kunde inte spara anteckningen.');
  if (isErr(res)) return res;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'create',
    collection: 'notes',
    record_id: res.id,
    after_value: { startup_name: company.name, body_length: body.length, startup: startupId, impact: true }
  });
  revalidate(startupId);
  return { ok: true, id: res.id };
}

export async function deleteImpactDocumentAction(startupId: string, documentId: string): Promise<ImpactActionState> {
  const ctx = await requireManager();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId) || !ID_RE.test(documentId)) return { error: 'Ogiltigt dokument.' };
  const doc = await getDocument(pb, user.tenant, documentId);
  if (!doc || doc.startup !== startupId) return { error: 'Dokumentet hittades inte.' };
  const res = await write(pb, (c) => c.collection(DOCUMENTS).delete(documentId), 'Kunde inte ta bort dokumentet.');
  if (isErr(res)) return res;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: DOCUMENTS,
    record_id: documentId,
    after_value: { deleted: true, stage: doc.stage, startup: startupId }
  });
  revalidate(startupId);
  return { ok: true };
}

/**
 * Tar bort bolaget ur Impact Navigator (originalets "Ta bort bolag"): alla
 * analysversioner, frågor, justeringar, uppdateringar, dokument och
 * AI-körningar raderas och hållbarhetsfälten nollställs. Bolagskortet
 * självt finns kvar — det delas med resten av plattformen. Bara ledningen.
 */
export async function deleteImpactCompanyAction(startupId: string): Promise<ImpactActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!canDeleteImpact(user.roles)) return { error: 'Bara admin eller incubator_lead kan ta bort en analys.' };
  if (!ID_RE.test(startupId)) return { error: 'Ogiltigt bolag.' };
  const pb = await getServerPb();
  const company = await getImpactCompany(pb, user.tenant, startupId);
  if (!company) return { error: 'Bolaget hittades inte.' };

  const byStartup = async (collection: string) => {
    const rows = await pb.collection(collection).getFullList<{ id: string }>({ filter: pb.filter('tenant = {:t} && startup = {:s}', { t: user.tenant, s: startupId }), fields: 'id' });
    for (const r of rows) {
      const res = await write(pb, (c) => c.collection(collection).delete(r.id), 'radering');
      if (isErr(res)) return res;
    }
    return null;
  };
  // Dokument och jobb före analyserna (relationerna pekar på analysen).
  for (const collection of [DOCUMENTS, AI_JOBS, UPDATE_EVENTS]) {
    const err = await byStartup(collection);
    if (err) return err;
  }
  const assessments = (await listAssessments(pb, user.tenant, startupId)).items;
  for (const a of [...assessments].sort((x, y) => y.version - x.version)) {
    for (const collection of [GAP_QUESTIONS, OVERRIDES]) {
      const rows = await pb.collection(collection).getFullList<{ id: string }>({ filter: pb.filter('tenant = {:t} && assessment = {:a}', { t: user.tenant, a: a.id }), fields: 'id' });
      for (const r of rows) await write(pb, (c) => c.collection(collection).delete(r.id), 'radering');
    }
    const res = await write(pb, (c) => c.collection(ASSESSMENTS).delete(a.id), 'Kunde inte ta bort analysen.');
    if (isErr(res)) return res;
  }
  await write(pb, (c) => c.collection('startups').update(startupId, { sustainability_status: '', sustainability_journey_text: '', sustainability_assigned_to: '' }), 'bolag');
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: ASSESSMENTS,
    record_id: startupId,
    after_value: { deleted: true, startup_name: company.name, versions: assessments.length, startup: startupId }
  });
  revalidate(startupId);
  return { ok: true, next: '/impactnavigator' };
}
