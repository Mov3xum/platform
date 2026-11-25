'use server';

import { revalidatePath } from 'next/cache';
import type PocketBase from 'pocketbase';
import { createHash } from 'node:crypto';
import { getServerPb, getCurrentUser, type SessionUser } from '@/lib/auth.server';
import { logAgentAction, type Actor } from '@/lib/core/write';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { describePbError, pbStatus } from '@/lib/pb-error';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { logAiUsage } from '@/lib/ai/usage';
import { AiBudgetExceededError, assertWithinAiBudget } from '@/lib/ai/budget.server';
import { getExportStepConfig, runExportPlan, runExportProfile, runExportSufficiency, runExportUpdate, type ExportAiOutcome } from '@/lib/ai/export-analysis';
import { exportErrorMessage, exportFailureCode, exportFailureMessage } from '@/lib/export-lab/messages';
import { loadExportIrl } from '@/lib/export-lab/irl.server';
import { exportHref } from '@/lib/export-lab/tabs';
import {
  EXPORT_AI_JOBS,
  EXPORT_ASSESSMENTS,
  EXPORT_DOCUMENTS,
  EXPORT_GAP_QUESTIONS,
  EXPORT_MARKET_REVIEWS,
  EXPORT_UPDATE_EVENTS,
  getExportAssessment,
  getExportCompany,
  getExportDocument,
  latestCompletePlan,
  listExportAssessments,
  listExportDocumentTexts,
  listExportGapQuestions,
  listExportJobs,
  type ExportAssessment,
  type ExportCompany,
  type ExportDocumentText
} from '@/lib/export-lab/data';
import {
  ALL_PHASES,
  ANALYSIS_LEASE_GRACE_MS,
  EXPORT_FRAMEWORK_VERSION,
  applyExportMarketReview,
  applyExportSummaryComment,
  buildExportPlanAIInput,
  buildExportProfileAIInput,
  buildExportSufficiencyAIInput,
  buildExportUpdateAIInput,
  canDeleteExportLab,
  canManageExportLab,
  canWorkOnExportCompany,
  createAnalysisLease,
  exportCompanyStatusFor,
  exportGapResponseStatus,
  exportPhaseFor,
  isAnalysisLease,
  isStaleAnalysisLease,
  type ExportAssessmentStatus,
  type ExportGapResponseInput,
  type ExportJobType,
  type ExportMarketDecision,
  type ExportMarketPromotion,
  type ExportProfile,
  type ExportStep,
  type ExportSufficiency,
  type StartupPhase
} from '@platform/shared';

/**
 * Export Lab (CLAUDE.md § 58) — server actions, samma mönster som Impact
 * Navigator (§ 56): RBAC (driva = Movexum-personal, ta bort = ledning,
 * observer läser), tenant + skapare stämplas server-side, skrivning via
 * användarens token med superuser-fallback ENBART vid PB v0.23.4:s tysta
 * regel-nekande, personnummer-sanering av all fritext, PII-fri audit i
 * `agent_actions`, tokens i `ai_usage_events` (surface `intl`), månadstak
 * (§ 9.6), jobbaudit i `export_ai_jobs`. Människa-i-loopen (art. 14):
 * marknaderna granskas, kompletteringarna fylls i och planen startas av en
 * människa; inget publiceras automatiskt. Ett misslyckat AI-steg lämnar
 * analysen i steget före; bara en misslyckad UPPDATERING markeras `failed`.
 */

export interface ExportActionState {
  ok?: boolean;
  error?: string;
  warning?: string;
  id?: string;
  assessmentId?: string;
  next?: string;
}

function revalidate(startupId?: string) {
  revalidatePath('/exportlab');
  if (startupId) {
    revalidatePath(`/exportlab/${startupId}`, 'layout');
    revalidatePath(`/startups/${startupId}/utveckling`);
  }
}

function actorOf(user: SessionUser): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

/** Personal för alla bolag, bolagsmedlem bara för det egna länkade bolaget (§ 58, 2026-11-09; RLS speglar i migration 1700000213). */
async function requireWorker(startupId: string | null): Promise<{ user: SessionUser; pb: PocketBase } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!canWorkOnExportCompany(user, startupId)) {
    return { error: user.roles.includes('startup_member') ? 'Du kan bara arbeta med ditt eget bolags exportanalys.' : 'Bara Movexum-personal kan arbeta med Export Lab.' };
  }
  const pb = await getServerPb();
  return { user, pb };
}

async function superuser(): Promise<PocketBase | null> {
  const su = await getSuperuserPb();
  if (!su.ok) {
    console.error('[exportlab] superuser unavailable — ingen fallback', { reason: su.reason });
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

async function setCompanyStatus(pb: PocketBase, startupId: string, status: ExportAssessmentStatus): Promise<void> {
  const res = await write(pb, (c) => c.collection('startups').update(startupId, { export_status: exportCompanyStatusFor(status) }), 'status');
  if (isErr(res)) console.warn('[exportlab] company status not updated', { startupId, status });
}

async function setAssessmentStatus(pb: PocketBase, a: ExportAssessment, status: ExportAssessmentStatus, extra: Record<string, unknown> = {}): Promise<{ error: string } | null> {
  const res = await write(pb, (c) => c.collection(EXPORT_ASSESSMENTS).update(a.id, { status, ...extra }), 'Kunde inte uppdatera analysen.');
  if (isErr(res)) return res;
  await setCompanyStatus(pb, a.startup, status);
  return null;
}

// ─── Underlag ────────────────────────────────────────────────────────────────

const asSource = (d: ExportDocumentText) => ({ originalName: d.name, extractedText: d.text || null });

function profileDocuments(docs: readonly ExportDocumentText[], a: ExportAssessment): ExportDocumentText[] {
  const linked = docs.filter((d) => d.assessment === a.id && (d.stage === 'innovation_description' || d.stage === 'full_information'));
  if (linked.length || a.version > 1) return linked;
  return docs.filter((d) => !d.assessment && (d.stage === 'innovation_description' || d.stage === 'full_information'));
}

async function linkDocuments(pb: PocketBase, tenant: string, startupId: string, ids: readonly string[], patch: Record<string, string>): Promise<ExportDocumentText[]> {
  for (const id of ids) {
    const doc = await getExportDocument(pb, tenant, id);
    if (!doc || doc.startup !== startupId) continue;
    await write(pb, (c) => c.collection(EXPORT_DOCUMENTS).update(id, patch), 'dokument');
  }
  if (!ids.length) return [];
  const all = await listExportDocumentTexts(pb, tenant, startupId);
  return all.filter((d) => ids.includes(d.id));
}

// ─── AI-körningar: jobb, budget, usage ──────────────────────────────────────

async function createJob(pb: PocketBase, user: SessionUser, a: ExportAssessment, jobType: ExportJobType): Promise<string | null> {
  const res = await write(
    pb,
    (c) => c.collection(EXPORT_AI_JOBS).create<{ id: string }>({ tenant: user.tenant, startup: a.startup, assessment: a.id, job_type: jobType, status: 'running', prompt_version: '', input_hash: '' }),
    'job'
  );
  return isErr(res) ? null : res.id;
}

async function finishJob<T>(pb: PocketBase, user: SessionUser, jobId: string | null, outcome: ExportAiOutcome<T>): Promise<void> {
  if (outcome.usage.tokensIn + outcome.usage.tokensOut > 0) {
    await logAiUsage(pb, { tenant: user.tenant, userId: user.id, surface: 'intl', model: outcome.model, tokensIn: outcome.usage.tokensIn, tokensOut: outcome.usage.tokensOut });
  }
  if (!jobId) return;
  await write(
    pb,
    (c) =>
      c.collection(EXPORT_AI_JOBS).update(jobId, {
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

type StepCtx = { user: SessionUser; pb: PocketBase; company: ExportCompany; a: ExportAssessment };

async function loadForStep(startupId: string, assessmentId: string): Promise<StepCtx | { error: string }> {
  const ctx = await requireWorker(startupId);
  if ('error' in ctx) return ctx;
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId) || !ID_RE.test(assessmentId)) return { error: 'Ogiltig analys.' };
  const company = await getExportCompany(pb, user.tenant, startupId);
  const a = await getExportAssessment(pb, user.tenant, assessmentId);
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

function hashInput(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input) ?? 'null').digest('hex');
}

function companyContext(company: ExportCompany) {
  return { name: company.name, phase: exportPhaseFor(company.phase), industry: company.industry, city: company.city, website: company.website };
}

// ─── Lease ───────────────────────────────────────────────────────────────────

const RECLAIM_ERROR = 'Körningen återtogs efter att analysens tidsgräns passerat.';
const LEASE_JOB_TYPE: Record<ExportStep, ExportJobType> = { profile: 'profile', sufficiency: 'sufficiency', plan: 'plan', update: 'update_plan' };

async function failRunningJobs(pb: PocketBase, tenant: string, assessmentId: string, step: ExportStep, message = RECLAIM_ERROR): Promise<void> {
  try {
    const rows = await pb.collection(EXPORT_AI_JOBS).getFullList<{ id: string }>({
      filter: pb.filter('tenant = {:t} && assessment = {:a} && job_type = {:j} && status = "running"', { t: tenant, a: assessmentId, j: LEASE_JOB_TYPE[step] }),
      fields: 'id'
    });
    for (const r of rows) await write(pb, (c) => c.collection(EXPORT_AI_JOBS).update(r.id, { status: 'failed', error: message, completed_at: nowPb() }), 'job');
  } catch (err) {
    console.warn('[exportlab] could not mark running jobs failed', { step, status: pbStatus(err) });
  }
}

async function claimLease(
  pb: PocketBase,
  user: SessionUser,
  a: ExportAssessment,
  step: ExportStep,
  opts: { expectedStatus: ExportAssessmentStatus; retryStatus: ExportAssessmentStatus; claimStatus?: ExportAssessmentStatus; surface: 'profile' | 'analysis' | 'update' }
): Promise<{ lease: string } | { error: string }> {
  const running = exportErrorMessage('analysis-running', opts.surface);
  const current = a.inputHash;
  if (isAnalysisLease(current)) {
    if (!isAnalysisLease(current, step) || !isStaleAnalysisLease(current, step, getExportStepConfig(step).timeoutMs)) return { error: running };
    const reclaimed = await write(pb, (c) => c.collection(EXPORT_ASSESSMENTS).update(a.id, { status: opts.retryStatus, input_hash: '' }), 'status');
    if (isErr(reclaimed)) return { error: running };
    await failRunningJobs(pb, user.tenant, a.id, step);
  }
  const lease = createAnalysisLease(step);
  const claimed = await write(pb, (c) => c.collection(EXPORT_ASSESSMENTS).update(a.id, { input_hash: lease, ...(opts.claimStatus ? { status: opts.claimStatus } : {}) }), 'status');
  if (isErr(claimed)) return claimed;
  const check = await getExportAssessment(pb, user.tenant, a.id);
  if (!check || check.inputHash !== lease || check.status !== (opts.claimStatus ?? opts.expectedStatus)) return { error: running };
  return { lease };
}

async function releaseLease(pb: PocketBase, user: SessionUser, a: ExportAssessment, lease: string, retryStatus?: ExportAssessmentStatus): Promise<void> {
  const check = await getExportAssessment(pb, user.tenant, a.id);
  if (!check || check.inputHash !== lease) return;
  const res = await write(pb, (c) => c.collection(EXPORT_ASSESSMENTS).update(a.id, { input_hash: '', ...(retryStatus ? { status: retryStatus } : {}) }), 'status');
  if (isErr(res)) console.warn('[exportlab] lease not released', { assessment: a.id });
  if (retryStatus) await setCompanyStatus(pb, a.startup, retryStatus);
}

// ─── Steg 1: Skapa bolag + första analysversionen ───────────────────────────

export async function createExportCompanyAction(input: Record<string, unknown>): Promise<ExportActionState> {
  const existingId = clean(input.startupId, 64);
  // Nytt bolag kräver personal; på ett befintligt bolagskort får även den
  // länkade bolagsmedlemmen starta exportanalysen.
  const ctx = await requireWorker(existingId || null);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;

  const ambitionText = clean(input.ambitionText, 20000);
  const desiredMarkets = clean(input.desiredMarkets, 1000);
  if (!ambitionText) return { error: 'Beskriv innovationen och den internationella ambitionen — det är underlaget analysen utgår från.' };

  let startupId = existingId;
  let name = '';
  if (existingId) {
    if (!ID_RE.test(existingId)) return { error: 'Ogiltigt bolag.' };
    const company = await getExportCompany(pb, user.tenant, existingId);
    if (!company) return { error: 'Bolaget hittades inte.' };
    name = company.name;
    const res = await write(
      pb,
      (c) => c.collection('startups').update(existingId, { export_ambition_text: ambitionText, export_desired_markets: desiredMarkets, export_status: 'draft', export_assigned_to: user.id }),
      'Kunde inte spara bolaget.'
    );
    if (isErr(res)) return res;
  } else {
    name = clean(input.name, 120);
    const industry = clean(input.industry, 160);
    const phase = String(input.phase ?? '');
    if (!name || !industry) return { error: 'Fyll i bolagsnamn och bransch.' };
    if (!(ALL_PHASES as readonly string[]).includes(phase)) return { error: 'Välj en giltig Movexumfas.' };
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
          export_ambition_text: ambitionText,
          export_desired_markets: desiredMarkets,
          export_status: 'draft',
          export_assigned_to: user.id
        }),
      'Kunde inte skapa bolaget.'
    );
    if (isErr(created)) return created;
    startupId = created.id;
  }

  const existing = await listExportAssessments(pb, user.tenant, startupId);
  const nextVersion = existing.items.reduce((m, a) => Math.max(m, a.version), 0) + 1;
  const assessment = await write(
    pb,
    (c) =>
      c.collection(EXPORT_ASSESSMENTS).create<{ id: string }>({
        tenant: user.tenant,
        startup: startupId,
        version: nextVersion,
        type: 'initial',
        status: 'profile_pending',
        framework_version: EXPORT_FRAMEWORK_VERSION,
        created_by: user.id
      }),
    'Kunde inte skapa analysen.'
  );
  if (isErr(assessment)) return assessment;

  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'create',
    collection: EXPORT_ASSESSMENTS,
    record_id: assessment.id,
    after_value: { startup_name: name, version: nextVersion, status: 'profile_pending', startup: startupId }
  });
  revalidate(startupId);
  return { ok: true, id: startupId, assessmentId: assessment.id };
}

// ─── Steg 2: Exportprofil & marknadsurval ───────────────────────────────────

export async function runExportProfileAction(startupId: string, assessmentId: string): Promise<ExportActionState> {
  const ctx = await loadForStep(startupId, assessmentId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb, company, a } = ctx;
  if (a.type !== 'initial' || a.status !== 'profile_pending' || a.profile) {
    return { error: 'Exportprofilen är redan skapad för den här versionen.', next: exportHref(startupId, 'marknader') };
  }
  const budget = await checkBudget(pb, user.tenant);
  if (budget) return { error: budget };

  const docs = profileDocuments(await listExportDocumentTexts(pb, user.tenant, company.id), a);
  const irl = await loadExportIrl(pb, user.tenant, company.id);
  const aiInput = buildExportProfileAIInput({
    name: company.name,
    phase: exportPhaseFor(company.phase),
    industry: company.industry,
    city: company.city,
    website: company.website,
    ambitionText: company.ambitionText,
    desiredMarkets: company.desiredMarkets,
    irl,
    documents: docs.map(asSource)
  });
  const claim = await claimLease(pb, user, a, 'profile', { expectedStatus: 'profile_pending', retryStatus: 'profile_pending', surface: 'profile' });
  if (isErr(claim)) return claim;
  const jobId = await createJob(pb, user, a, 'profile');
  const outcome = await runExportProfile(aiInput);
  await finishJob(pb, user, jobId, outcome);
  if (!outcome.result) {
    await releaseLease(pb, user, a, claim.lease);
    revalidate(startupId);
    return { error: exportFailureMessage(outcome.errorKind, 'profile') };
  }
  const err = await setAssessmentStatus(pb, a, 'market_review', {
    profile: outcome.result,
    irl_snapshot: irl?.profile ?? null,
    model_name: outcome.model,
    prompt_version: outcome.promptVersion,
    input_hash: hashInput(aiInput)
  });
  if (err) return err;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: EXPORT_ASSESSMENTS,
    record_id: a.id,
    field: 'profile',
    after_value: { startup_name: company.name, version: a.version, status: 'market_review', markets: outcome.result.candidateMarkets.length, readiness: outcome.result.readinessLevel.level, model: outcome.model }
  });
  revalidate(startupId);
  return { ok: true, next: exportHref(startupId, 'marknader') };
}

// ─── Steg 2 → 3: Godkänn marknaderna och kör informationsgapanalysen ───────

async function persistSufficiency(pb: PocketBase, user: SessionUser, company: ExportCompany, a: ExportAssessment, result: ExportSufficiency, model: string, promptVersion: string, inputHash: string): Promise<{ error: string } | { created: number }> {
  const existing = await listExportGapQuestions(pb, user.tenant, [a.id]);
  for (const q of existing.items) await write(pb, (c) => c.collection(EXPORT_GAP_QUESTIONS).delete(q.id), 'fråga');
  let created = 0;
  for (const check of result.checks) {
    const q = check.question;
    if (!q) continue;
    const res = await write(
      pb,
      (c) =>
        c.collection(EXPORT_GAP_QUESTIONS).create({
          tenant: user.tenant,
          assessment: a.id,
          target_code: check.code,
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
    prompt_version: promptVersion,
    input_hash: inputHash
  });
  if (err) return err;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: EXPORT_ASSESSMENTS,
    record_id: a.id,
    field: 'sufficiency',
    after_value: { startup_name: company.name, version: a.version, status: 'needs_more_info', questions: created, model }
  });
  return { created };
}

export async function approveMarketsAction(startupId: string, assessmentId: string, input: Record<string, unknown>): Promise<ExportActionState> {
  const ctx = await loadForStep(startupId, assessmentId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb, company, a } = ctx;
  if (!a.profile) return { error: 'Exportprofilen saknas.' };
  if (a.type !== 'initial' || a.status !== 'market_review') return { error: 'Marknaderna är redan godkända.', next: exportHref(startupId, 'analys') };
  const budget = await checkBudget(pb, user.tenant);
  if (budget) return { error: budget };

  const decisions: ExportMarketDecision[] = (Array.isArray(input.decisions) ? input.decisions : []).slice(0, 40).map((d) => {
    const r = (d ?? {}) as Record<string, unknown>;
    return { code: clean(r.code, 40).toUpperCase(), priority: String(r.priority ?? ''), comment: clean(r.comment, 2000) };
  });
  const promotions: ExportMarketPromotion[] = (Array.isArray(input.promotions) ? input.promotions : []).slice(0, 40).map((p) => {
    const r = (p ?? {}) as Record<string, unknown>;
    return { code: clean(r.code, 40).toUpperCase(), comment: clean(r.comment, 2000) };
  });
  const customCountry = clean(input.customCountry, 120);
  const review = applyExportMarketReview(a.profile, { decisions, promotions, customMarket: customCountry ? { country: customCountry, comment: clean(input.customComment, 2000) } : null });
  const updated: ExportProfile = applyExportSummaryComment(review.profile, clean(input.summaryComment, 2000));
  if (updated.candidateMarkets.length === 0) return { error: 'Minst en marknad måste finnas kvar i planen — lyft en övervägd marknad eller lägg till en egen.' };

  for (const change of review.changes) {
    const res = await write(
      pb,
      (c) =>
        c.collection(EXPORT_MARKET_REVIEWS).create({
          tenant: user.tenant,
          assessment: a.id,
          market_code: change.code,
          country: change.country.slice(0, 120),
          original_priority: change.originalPriority.toLowerCase(),
          new_priority: change.newPriority.toLowerCase(),
          comment: change.comment,
          created_by: user.id
        }),
      'Kunde inte spara marknadsbeslutet.'
    );
    if (isErr(res)) return res;
  }
  const err = await setAssessmentStatus(pb, a, 'info_pending', { profile: updated });
  if (err) return err;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: EXPORT_ASSESSMENTS,
    record_id: a.id,
    field: 'markets_confirmed',
    after_value: { startup_name: company.name, version: a.version, status: 'info_pending', changes: review.changes.length, markets: updated.candidateMarkets.length, custom_market: Boolean(customCountry) }
  });

  const refreshed: ExportAssessment = { ...a, status: 'info_pending', profile: updated, inputHash: '' };
  const claim = await claimLease(pb, user, refreshed, 'sufficiency', { expectedStatus: 'info_pending', retryStatus: 'info_pending', surface: 'analysis' });
  if (isErr(claim)) return { ok: true, error: claim.error, next: exportHref(startupId, 'analys', 'error=analysis-running') };
  const irl = await loadExportIrl(pb, user.tenant, company.id);
  const sufficiencyInput = buildExportSufficiencyAIInput({ phase: exportPhaseFor(company.phase), irl, profile: updated });
  const jobId = await createJob(pb, user, refreshed, 'sufficiency');
  const outcome = await runExportSufficiency(sufficiencyInput);
  await finishJob(pb, user, jobId, outcome);
  revalidate(startupId);
  if (!outcome.result) {
    await releaseLease(pb, user, refreshed, claim.lease);
    return { ok: true, error: exportFailureMessage(outcome.errorKind, 'analysis'), next: exportHref(startupId, 'analys', `error=${exportFailureCode(outcome.errorKind)}`) };
  }
  const persisted = await persistSufficiency(pb, user, company, refreshed, outcome.result, outcome.model, outcome.promptVersion, hashInput(sufficiencyInput));
  if (isErr(persisted)) return persisted;
  revalidate(startupId);
  return { ok: true, next: `${exportHref(startupId, 'analys')}#gap` };
}

export async function runExportSufficiencyAction(startupId: string, assessmentId: string, input: Record<string, unknown> = {}): Promise<ExportActionState> {
  const ctx = await loadForStep(startupId, assessmentId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb, company, a } = ctx;
  if (!a.profile) return { error: 'Exportprofilen saknas.' };
  if (a.type !== 'initial' || a.status !== 'info_pending') return { error: 'Informationsgapanalysen kan bara köras när marknaderna är godkända och ingen prövning finns.', next: exportHref(startupId, 'analys') };
  const budget = await checkBudget(pb, user.tenant);
  if (budget) return { error: budget };

  const newIds = idList(input.documentIds);
  await linkDocuments(pb, user.tenant, startupId, newIds, { assessment: a.id, upload_stage: 'full_information' });
  const docs = await listExportDocumentTexts(pb, user.tenant, company.id);
  const jobs = await listExportJobs(pb, user.tenant, company.id);
  const profileDone = jobs.items.find((j) => j.assessment === a.id && j.jobType === 'profile' && j.status === 'complete')?.completedAt ?? null;
  const isNew = (d: ExportDocumentText) => newIds.includes(d.id) || (d.assessment === a.id && d.stage === 'full_information' && (!profileDone || d.createdAt > profileDone));
  const newDocs = docs.filter(isNew);
  const known = docs.filter((d) => !isNew(d) && d.text).map((d) => d.text);

  const claim = await claimLease(pb, user, a, 'sufficiency', { expectedStatus: 'info_pending', retryStatus: 'info_pending', surface: 'analysis' });
  if (isErr(claim)) return claim;
  const irl = await loadExportIrl(pb, user.tenant, company.id);
  const sufficiencyInput = buildExportSufficiencyAIInput({ phase: exportPhaseFor(company.phase), irl, profile: a.profile, newDocuments: newDocs.map(asSource), knownEvidenceTexts: known });
  const jobId = await createJob(pb, user, a, 'sufficiency');
  const outcome = await runExportSufficiency(sufficiencyInput);
  await finishJob(pb, user, jobId, outcome);
  if (!outcome.result) {
    await releaseLease(pb, user, a, claim.lease);
    revalidate(startupId);
    return { error: exportFailureMessage(outcome.errorKind, 'analysis') };
  }
  const persisted = await persistSufficiency(pb, user, company, a, outcome.result, outcome.model, outcome.promptVersion, hashInput(sufficiencyInput));
  if (isErr(persisted)) return persisted;
  revalidate(startupId);
  return { ok: true, next: `${exportHref(startupId, 'analys')}#gap` };
}

// ─── Steg 3 → 4: Kompletteringar och exportplan ────────────────────────────

interface GapSubmission {
  questionId: string;
  answerText: string;
  requestedStatus: string;
  documentIds: string[];
}

export async function finalizeExportPlanAction(startupId: string, assessmentId: string, input: Record<string, unknown>): Promise<ExportActionState> {
  const ctx = await loadForStep(startupId, assessmentId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb, company, a } = ctx;
  if (a.type !== 'initial') return { error: 'Exportplanen skapas på den ursprungliga versionen.', next: exportHref(startupId, 'plan') };
  if (!a.profile || !a.sufficiency) return { error: 'Exportprofil och informationsgap måste finnas innan planen.' };
  if (a.status !== 'needs_more_info' && a.status !== 'plan_pending') {
    return { error: a.status === 'complete' ? 'Planen är redan skapad.' : 'Analysen är inte redo för exportplan.', next: exportHref(startupId, a.status === 'complete' ? 'plan' : 'analys') };
  }
  const budget = await checkBudget(pb, user.tenant);
  if (budget) return { error: budget };

  const submissions: GapSubmission[] = (Array.isArray(input.submissions) ? input.submissions : []).slice(0, 40).map((s) => {
    const r = (s ?? {}) as Record<string, unknown>;
    return { questionId: clean(r.questionId, 64), answerText: clean(r.answerText, 10000), requestedStatus: String(r.requestedStatus ?? ''), documentIds: idList(r.documentIds) };
  });
  const byQuestion = new Map(submissions.filter((s) => ID_RE.test(s.questionId)).map((s) => [s.questionId, s]));

  const questions = (await listExportGapQuestions(pb, user.tenant, [a.id])).items;
  for (const q of questions) {
    const sub = byQuestion.get(q.id);
    if (sub?.documentIds.length) await linkDocuments(pb, user.tenant, startupId, sub.documentIds, { assessment: a.id, gap_question: q.id, upload_stage: 'gap_response' });
  }
  const docs = await listExportDocumentTexts(pb, user.tenant, company.id);
  const gapResponses: ExportGapResponseInput[] = questions.map((q) => {
    const sub = byQuestion.get(q.id);
    const qDocs = docs.filter((d) => d.gapQuestion === q.id && d.stage === 'gap_response');
    return {
      code: q.targetCode,
      question: q.question,
      status: exportGapResponseStatus(sub?.requestedStatus ?? q.status, (sub?.answerText || q.answerText) || null, qDocs.some((d) => Boolean(d.text))),
      answerText: sub ? sub.answerText || null : q.answerText || null,
      documents: qDocs.map(asSource)
    };
  });
  const unusable = questions.some((q, i) => {
    const sub = byQuestion.get(q.id);
    if (!sub?.documentIds.length) return false;
    const r = gapResponses[i];
    return r.status === 'open' && !r.answerText;
  });
  if (unusable) return { error: exportErrorMessage('gap-document-empty', 'analysis') };

  if (a.status === 'plan_pending' && isAnalysisLease(a.inputHash, 'plan') && !isStaleAnalysisLease(a.inputHash, 'plan', getExportStepConfig('plan').timeoutMs)) {
    return { error: exportErrorMessage('analysis-running', 'analysis') };
  }

  for (const [i, q] of questions.entries()) {
    const r = gapResponses[i];
    await write(pb, (c) => c.collection(EXPORT_GAP_QUESTIONS).update(q.id, { answer_text: r.answerText ?? '', status: r.status }), 'svar');
  }
  const claim = await claimLease(pb, user, a, 'plan', { expectedStatus: a.status, retryStatus: 'needs_more_info', claimStatus: 'plan_pending', surface: 'analysis' });
  if (isErr(claim)) return claim;
  await setCompanyStatus(pb, startupId, 'plan_pending');
  const pending: ExportAssessment = { ...a, status: 'plan_pending', inputHash: claim.lease };

  const irl = await loadExportIrl(pb, user.tenant, company.id);
  const aiInput = buildExportPlanAIInput({
    company: companyContext(company),
    irl,
    profile: a.profile,
    sufficiency: a.sufficiency,
    gapResponses,
    knownEvidenceTexts: docs.filter((d) => d.stage !== 'gap_response' && d.text).map((d) => d.text)
  });
  const jobId = await createJob(pb, user, pending, 'plan');
  const outcome = await runExportPlan(aiInput);
  await finishJob(pb, user, jobId, outcome);
  if (!outcome.result) {
    await releaseLease(pb, user, pending, claim.lease, 'needs_more_info');
    revalidate(startupId);
    return { error: exportFailureMessage(outcome.errorKind, 'analysis') };
  }
  const err = await setAssessmentStatus(pb, pending, 'complete', {
    plan: outcome.result,
    irl_snapshot: irl?.profile ?? null,
    information_quality_score: a.sufficiency.overallInformationQuality,
    model_name: outcome.model,
    prompt_version: outcome.promptVersion,
    input_hash: hashInput(aiInput),
    completed_at: nowPb()
  });
  if (err) return err;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: EXPORT_ASSESSMENTS,
    record_id: a.id,
    field: 'plan',
    after_value: { startup_name: company.name, version: a.version, status: 'complete', readiness: outcome.result.internationalStrategy.readinessLevel.level, pathway: outcome.result.internationalStrategy.pathway.code, model: outcome.model }
  });
  revalidate(startupId);
  return { ok: true, next: exportHref(startupId, 'plan') };
}

// ─── Uppdatera planen (ny version) ──────────────────────────────────────────

export async function updateExportPlanAction(startupId: string, input: Record<string, unknown>): Promise<ExportActionState> {
  const ctx = await requireWorker(startupId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId)) return { error: 'Ogiltigt bolag.' };
  const company = await getExportCompany(pb, user.tenant, startupId);
  if (!company) return { error: 'Bolaget hittades inte.' };
  const narrative = clean(input.narrative, 20000);
  const documentIds = idList(input.documentIds);
  if (!narrative && documentIds.length === 0) return { error: exportErrorMessage('update-empty', 'update') };
  const budget = await checkBudget(pb, user.tenant);
  if (budget) return { error: budget };

  const all = (await listExportAssessments(pb, user.tenant, startupId)).items;
  const previous = latestCompletePlan(all);
  if (!previous?.plan || !previous.profile) return { error: 'Det finns ingen färdig exportplan att uppdatera — skapa först planen.', next: exportHref(startupId, 'analys') };
  const latest = [...all].sort((x, y) => y.version - x.version)[0];
  const updateTimeoutMs = getExportStepConfig('update').timeoutMs;
  if (latest && latest.id !== previous.id && latest.status !== 'failed') {
    const started = Date.parse(latest.createdAt.replace(' ', 'T')) || 0;
    const stale =
      latest.status === 'plan_pending' &&
      (isAnalysisLease(latest.inputHash, 'update') ? isStaleAnalysisLease(latest.inputHash, 'update', updateTimeoutMs) : Date.now() - started > updateTimeoutMs + ANALYSIS_LEASE_GRACE_MS);
    if (!stale) return { error: exportErrorMessage('update-concurrent', 'update') };
    const reclaimed = await write(pb, (c) => c.collection(EXPORT_ASSESSMENTS).update(latest.id, { status: 'failed', input_hash: '' }), 'status');
    if (isErr(reclaimed)) return { error: exportErrorMessage('update-concurrent', 'update') };
    await failRunningJobs(pb, user.tenant, latest.id, 'update', 'Körningen återtogs efter att uppdateringsversionens tidsgräns passerat.');
  }

  const nextVersion = all.reduce((m, x) => Math.max(m, x.version), 0) + 1;
  const lease = createAnalysisLease('update');
  const created = await write(
    pb,
    (c) =>
      c.collection(EXPORT_ASSESSMENTS).create<{ id: string }>({
        tenant: user.tenant,
        startup: startupId,
        version: nextVersion,
        type: 'update',
        status: 'plan_pending',
        framework_version: EXPORT_FRAMEWORK_VERSION,
        profile: previous.profile,
        sufficiency: previous.sufficiency,
        previous_assessment: previous.id,
        input_hash: lease,
        created_by: user.id
      }),
    'Kunde inte skapa uppdateringen.'
  );
  if (isErr(created)) return { error: /unik|unique|version/i.test(created.error) ? exportErrorMessage('update-version-conflict', 'update') : created.error };
  const event = await write(
    pb,
    (c) => c.collection(EXPORT_UPDATE_EVENTS).create<{ id: string }>({ tenant: user.tenant, startup: startupId, assessment: created.id, created_by: user.id, narrative }),
    'Kunde inte spara uppdateringen.'
  );
  if (isErr(event)) return event;
  await setCompanyStatus(pb, startupId, 'plan_pending');
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'create',
    collection: EXPORT_UPDATE_EVENTS,
    record_id: event.id,
    after_value: { startup_name: company.name, version: nextVersion, narrative_length: narrative.length, documents: documentIds.length, startup: startupId }
  });

  const newDocs = await linkDocuments(pb, user.tenant, startupId, documentIds, { assessment: created.id, update_event: event.id, upload_stage: 'update' });
  const docs = await listExportDocumentTexts(pb, user.tenant, company.id);
  const completeIds = new Set(all.filter((x) => x.status === 'complete').map((x) => x.id));
  const known = docs.filter((d) => d.assessment && completeIds.has(d.assessment) && d.text).map((d) => d.text);
  const irl = await loadExportIrl(pb, user.tenant, company.id);
  const aiInput = buildExportUpdateAIInput({
    companyName: company.name,
    phase: exportPhaseFor(company.phase),
    industry: company.industry,
    irl,
    previousPlan: previous.plan,
    profile: previous.profile,
    sufficiency: previous.sufficiency,
    narrative,
    documents: newDocs.map(asSource),
    knownEvidenceTexts: known
  });
  const a: ExportAssessment = { ...previous, id: created.id, version: nextVersion, type: 'update', status: 'plan_pending', previousAssessment: previous.id, inputHash: lease };
  if (!aiInput.newEvidence.narrative && aiInput.newEvidence.documents.length === 0) {
    await write(pb, (c) => c.collection(EXPORT_ASSESSMENTS).update(created.id, { status: 'failed', input_hash: '' }), 'status');
    await setCompanyStatus(pb, startupId, 'complete');
    revalidate(startupId);
    return { error: exportErrorMessage('update-document-empty', 'update') };
  }

  const jobId = await createJob(pb, user, a, 'update_plan');
  const outcome = await runExportUpdate(aiInput);
  await finishJob(pb, user, jobId, outcome);
  if (!outcome.result) {
    await write(pb, (c) => c.collection(EXPORT_ASSESSMENTS).update(created.id, { status: 'failed', input_hash: '' }), 'status');
    await setCompanyStatus(pb, startupId, 'complete');
    revalidate(startupId);
    return { error: exportFailureMessage(outcome.errorKind, 'update') };
  }
  const err = await setAssessmentStatus(pb, a, 'complete', {
    plan: outcome.result.updatedPlan,
    update_delta: outcome.result.deltaSummary,
    irl_snapshot: irl?.profile ?? null,
    information_quality_score: previous.informationQualityScore,
    model_name: outcome.model,
    prompt_version: outcome.promptVersion,
    input_hash: hashInput(aiInput),
    completed_at: nowPb()
  });
  if (err) return err;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: EXPORT_ASSESSMENTS,
    record_id: created.id,
    field: 'plan',
    after_value: { startup_name: company.name, version: nextVersion, status: 'complete', readiness: outcome.result.updatedPlan.internationalStrategy.readinessLevel.level, model: outcome.model, update: true }
  });
  revalidate(startupId);
  return { ok: true, assessmentId: created.id, next: exportHref(startupId, 'plan') };
}

// ─── Bolagsuppgifter, dokument, radering ────────────────────────────────────

export async function updateExportCompanyDetailsAction(startupId: string, input: Record<string, unknown>): Promise<ExportActionState> {
  const ctx = await requireWorker(startupId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId)) return { error: 'Ogiltigt bolag.' };
  // En bolagsmedlem får bara uppdatera sin egen ambition och sina önskade
  // marknader — namn, bransch, fas och ansvarig är personalens.
  if (!canManageExportLab(user.roles) && Object.keys(input).some((k) => k !== 'ambitionText' && k !== 'desiredMarkets')) {
    return { error: 'Bara Movexum-personal kan ändra bolagsuppgifter och ansvarig.' };
  }
  const company = await getExportCompany(pb, user.tenant, startupId);
  if (!company) return { error: 'Bolaget hittades inte.' };
  const payload: Record<string, unknown> = {};
  if ('name' in input || 'industry' in input) {
    if (String(input.name ?? '').trim().length > 120 || String(input.industry ?? '').trim().length > 160) return { error: 'Bolagsnamnet eller branschen är för lång.' };
    const name = clean(input.name, 120);
    const industry = clean(input.industry, 160);
    if (!name || !industry) return { error: 'Fyll i både bolagsnamn och bransch.' };
    payload.name = name;
    payload.industri = industry;
  }
  if ('phase' in input) {
    const phase = String(input.phase ?? '');
    if (!(ALL_PHASES as readonly string[]).includes(phase)) return { error: 'Välj en giltig Movexumfas.' };
    payload.phase = phase;
  }
  if ('ambitionText' in input) payload.export_ambition_text = clean(input.ambitionText, 20000);
  if ('desiredMarkets' in input) payload.export_desired_markets = clean(input.desiredMarkets, 1000);
  if ('assignedTo' in input) {
    const v = clean(input.assignedTo, 64);
    if (v && !ID_RE.test(v)) return { error: 'Ogiltig ansvarig.' };
    payload.export_assigned_to = v;
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
    after_value: { startup_name: clean(payload.name ?? company.name, 120), exportlab: true }
  });
  revalidate(startupId);
  revalidatePath(`/startups/${startupId}`, 'layout');
  return { ok: true };
}

export async function deleteExportDocumentAction(startupId: string, documentId: string): Promise<ExportActionState> {
  const ctx = await requireWorker(startupId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId) || !ID_RE.test(documentId)) return { error: 'Ogiltigt dokument.' };
  const doc = await getExportDocument(pb, user.tenant, documentId);
  if (!doc || doc.startup !== startupId) return { error: 'Dokumentet hittades inte.' };
  const res = await write(pb, (c) => c.collection(EXPORT_DOCUMENTS).delete(documentId), 'Kunde inte ta bort dokumentet.');
  if (isErr(res)) return res;
  await logAgentAction(pb, { actor: actorOf(user), action_type: 'update', collection: EXPORT_DOCUMENTS, record_id: documentId, after_value: { deleted: true, stage: doc.stage, startup: startupId } });
  revalidate(startupId);
  return { ok: true };
}

/** Tar bort bolaget ur Export Lab: alla versioner, frågor, marknadsbeslut, uppdateringar, dokument och AI-körningar. Bolagskortet finns kvar. Bara ledningen. */
export async function deleteExportCompanyAction(startupId: string): Promise<ExportActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!canDeleteExportLab(user.roles)) return { error: 'Bara admin eller incubator_lead kan ta bort en analys.' };
  if (!ID_RE.test(startupId)) return { error: 'Ogiltigt bolag.' };
  const pb = await getServerPb();
  const company = await getExportCompany(pb, user.tenant, startupId);
  if (!company) return { error: 'Bolaget hittades inte.' };

  const byStartup = async (collection: string) => {
    const rows = await pb.collection(collection).getFullList<{ id: string }>({ filter: pb.filter('tenant = {:t} && startup = {:s}', { t: user.tenant, s: startupId }), fields: 'id' });
    for (const r of rows) {
      const res = await write(pb, (c) => c.collection(collection).delete(r.id), 'radering');
      if (isErr(res)) return res;
    }
    return null;
  };
  for (const collection of [EXPORT_DOCUMENTS, EXPORT_AI_JOBS, EXPORT_UPDATE_EVENTS]) {
    const err = await byStartup(collection);
    if (err) return err;
  }
  const assessments = (await listExportAssessments(pb, user.tenant, startupId)).items;
  for (const a of [...assessments].sort((x, y) => y.version - x.version)) {
    for (const collection of [EXPORT_GAP_QUESTIONS, EXPORT_MARKET_REVIEWS]) {
      const rows = await pb.collection(collection).getFullList<{ id: string }>({ filter: pb.filter('tenant = {:t} && assessment = {:a}', { t: user.tenant, a: a.id }), fields: 'id' });
      for (const r of rows) await write(pb, (c) => c.collection(collection).delete(r.id), 'radering');
    }
    const res = await write(pb, (c) => c.collection(EXPORT_ASSESSMENTS).delete(a.id), 'Kunde inte ta bort analysen.');
    if (isErr(res)) return res;
  }
  await write(pb, (c) => c.collection('startups').update(startupId, { export_status: '', export_ambition_text: '', export_desired_markets: '', export_assigned_to: '' }), 'bolag');
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: EXPORT_ASSESSMENTS,
    record_id: startupId,
    after_value: { deleted: true, startup_name: company.name, versions: assessments.length, startup: startupId }
  });
  revalidate(startupId);
  return { ok: true, next: '/exportlab' };
}
