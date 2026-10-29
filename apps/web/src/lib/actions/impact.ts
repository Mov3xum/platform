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
  getAssessment,
  getDocument,
  getGapQuestion,
  getImpactCompany,
  listAssessments,
  listDocumentTexts,
  listGapQuestions,
  type ImpactAssessment,
  type ImpactCompany
} from '@/lib/impact/data';
import {
  IMPACT_FRAMEWORK_VERSION,
  applyImpactOverrides,
  buildImpactInput,
  canManageImpact,
  impactCompanyStatusFor,
  isImpactMaterialityStatus,
  type ImpactAssessmentStatus,
  type ImpactJobType,
  type ImpactMateriality,
  type ImpactOverrideInput
} from '@platform/shared';
import { ALL_PHASES, type StartupPhase } from '@platform/shared';

/**
 * Impact Navigator (CLAUDE.md § 56) — server actions.
 *
 * RBAC: driva analysen (skapa bolag/analys, köra AI-steg, granska
 * väsentlighet, svara på kompletteringar, uppdatera) = Movexum-personal
 * (`IMPACT_MANAGE_ROLES`); observer läser. Rollen enforce:as HÄR (PB:s
 * createRule är roll-lös per § 21.3); tenant + skapare stämplas server-side.
 * Skrivningar går via användarens token med superuser-fallback ENBART vid PB
 * v0.23.4:s tysta regel-nekande (400/403/404), efter verifierad roll +
 * tenant. All fritext personnummer-saneras (§ 15.6). Varje mutation
 * audit-loggas PII-fritt i `agent_actions` (bolagsnamn, version, status —
 * aldrig underlag). AI-stegen loggar tokens i `ai_usage_events` och prövar
 * månadstaket (§ 9.6). Människa-i-loopen: väsentligheten granskas och
 * slutanalysen startas av en människa; inget publiceras automatiskt.
 */

export interface ImpactActionState {
  ok?: boolean;
  error?: string;
  warning?: string;
  id?: string;
  assessmentId?: string;
}

function revalidate(startupId?: string) {
  revalidatePath('/impactnavigator');
  if (startupId) {
    revalidatePath(`/impactnavigator/${startupId}`);
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
const clean = (v: unknown, max: number) => sanitizePersonnummer(String(v ?? '')).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

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

// ─── Bolag ───────────────────────────────────────────────────────────────────

export async function createImpactCompanyAction(input: Record<string, unknown>): Promise<ImpactActionState> {
  const ctx = await requireManager();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;

  const existingId = clean(input.startupId, 64);
  const journeyText = clean(input.journeyText, 20000);
  const assignedTo = clean(input.assignedTo, 64);
  if (!journeyText) return { error: 'Beskriv bolagets resa — det är underlaget analysen utgår från.' };
  if (assignedTo && !ID_RE.test(assignedTo)) return { error: 'Ogiltig ansvarig.' };

  let startupId = existingId;
  let name = '';
  if (existingId) {
    if (!ID_RE.test(existingId)) return { error: 'Ogiltigt bolag.' };
    const company = await getImpactCompany(pb, user.tenant, existingId);
    if (!company) return { error: 'Bolaget hittades inte.' };
    name = company.name;
    const res = await write(
      pb,
      (c) => c.collection('startups').update(existingId, { sustainability_journey_text: journeyText, sustainability_status: 'draft', sustainability_assigned_to: assignedTo || user.id }),
      'Kunde inte spara bolaget.'
    );
    if (isErr(res)) return res;
  } else {
    name = clean(input.name, 200);
    const industry = clean(input.industry, 200);
    const phase = String(input.phase ?? '');
    if (!name) return { error: 'Ange bolagets namn.' };
    if (!(ALL_PHASES as readonly string[]).includes(phase)) return { error: 'Välj en fas.' };
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
          sustainability_assigned_to: assignedTo || user.id
        }),
      'Kunde inte skapa bolaget.'
    );
    if (isErr(created)) return created;
    startupId = created.id;
  }

  // Första analysversionen (väntar på väsentlighetsanalys).
  const existing = await listAssessments(pb, user.tenant, startupId);
  const nextVersion = existing.items.reduce((m, a) => Math.max(m, a.version), 0) + 1;
  const assessment = await write(
    pb,
    (c) =>
      c.collection(ASSESSMENTS).create<{ id: string }>({
        tenant: user.tenant,
        startup: startupId,
        version: nextVersion,
        type: nextVersion === 1 ? 'initial' : 'update',
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

export async function updateImpactCompanyAction(startupId: string, input: Record<string, unknown>): Promise<ImpactActionState> {
  const ctx = await requireManager();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId)) return { error: 'Ogiltigt bolag.' };
  const company = await getImpactCompany(pb, user.tenant, startupId);
  if (!company) return { error: 'Bolaget hittades inte.' };
  const payload: Record<string, unknown> = {};
  if ('journeyText' in input) payload.sustainability_journey_text = clean(input.journeyText, 20000);
  if ('assignedTo' in input) {
    const a = clean(input.assignedTo, 64);
    if (a && !ID_RE.test(a)) return { error: 'Ogiltig ansvarig.' };
    payload.sustainability_assigned_to = a;
  }
  const res = await write(pb, (c) => c.collection('startups').update(startupId, payload), 'Kunde inte spara.');
  if (isErr(res)) return res;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: 'startups',
    record_id: startupId,
    field: 'journeyText' in input ? 'sustainability_journey_text' : 'sustainability_assigned_to',
    after_value: { startup_name: company.name, impact: true }
  });
  revalidate(startupId);
  return { ok: true };
}

// ─── AI-steg ─────────────────────────────────────────────────────────────────

async function loadCompanyInput(
  pb: PocketBase,
  tenant: string,
  company: ImpactCompany,
  a: ImpactAssessment,
  opts: { updateNarrative?: string } = {}
) {
  const docs = await listDocumentTexts(pb, tenant, company.id);
  const gaps = await listGapQuestions(pb, tenant, [a.id, ...(a.previousAssessment ? [a.previousAssessment] : [])]);
  const answered = gaps.items.filter((g) => g.status === 'answered' && g.answerText).map((g) => ({ question: g.question, answer: g.answerText }));
  return buildImpactInput({
    companyName: company.name,
    phase: company.phase,
    industry: company.industry,
    journeyText: company.journeyText,
    documents: docs.map((d) => ({ name: d.name, stage: d.stage, text: d.text })),
    gapAnswers: answered,
    updateNarrative: opts.updateNarrative
  });
}

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
        completed_at: new Date().toISOString().replace('T', ' ').replace(/Z$/, 'Z')
      }),
    'job'
  );
}

async function loadForStep(startupId: string, assessmentId: string) {
  const ctx = await requireManager();
  if ('error' in ctx) return ctx;
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId) || !ID_RE.test(assessmentId)) return { error: 'Ogiltig analys.' };
  const company = await getImpactCompany(pb, user.tenant, startupId);
  const a = await getAssessment(pb, user.tenant, assessmentId);
  if (!company || !a || a.startup !== startupId) return { error: 'Analysen hittades inte.' };
  try {
    await assertWithinAiBudget(pb, user.tenant);
  } catch (err) {
    if (err instanceof AiBudgetExceededError) return { error: 'Månadstaket för AI är nått — justera under Inställningar → AI-analys.' };
    throw err;
  }
  return { user, pb, company, a };
}

const nowPb = () => new Date().toISOString().replace('T', ' ');

export async function runMaterialityAction(startupId: string, assessmentId: string): Promise<ImpactActionState> {
  const ctx = await loadForStep(startupId, assessmentId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb, company, a } = ctx;
  if (a.status !== 'materiality_pending' && a.status !== 'failed' && a.status !== 'materiality_review') {
    return { error: 'Väsentlighetsanalysen är redan gjord för den här versionen.' };
  }
  const input = await loadCompanyInput(pb, user.tenant, company, a);
  const jobId = await createJob(pb, user, a, 'materiality');
  const outcome = await runImpactMateriality({ companyInput: input.text });
  await finishJob(pb, user, jobId, outcome);
  if (!outcome.result) {
    await setAssessmentStatus(pb, a, 'failed');
    return { error: outcome.error ?? 'AI-analysen misslyckades.' };
  }
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
  return { ok: true, warning: input.truncated ? 'Underlaget var stort — delar av dokumenten kapades innan analysen.' : undefined };
}

export async function confirmMaterialityAction(startupId: string, assessmentId: string, rawOverrides: unknown): Promise<ImpactActionState> {
  const ctx = await requireManager();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId) || !ID_RE.test(assessmentId)) return { error: 'Ogiltig analys.' };
  const company = await getImpactCompany(pb, user.tenant, startupId);
  const a = await getAssessment(pb, user.tenant, assessmentId);
  if (!company || !a || a.startup !== startupId || !a.materiality) return { error: 'Analysen hittades inte.' };
  if (a.status !== 'materiality_review') return { error: 'Väsentligheten är redan bekräftad.' };

  const overrides: ImpactOverrideInput[] = [];
  if (Array.isArray(rawOverrides)) {
    for (const o of rawOverrides.slice(0, 40)) {
      const r = (o ?? {}) as Record<string, unknown>;
      const code = clean(r.aspectCode, 40).toUpperCase();
      const status = typeof r.newStatus === 'string' ? r.newStatus.toUpperCase() : '';
      if (!code || !isImpactMaterialityStatus(status)) continue;
      overrides.push({ aspectCode: code, newStatus: status, comment: clean(r.comment, 5000) });
    }
  }
  const { materiality, applied } = applyImpactOverrides(a.materiality, overrides);
  for (const ap of applied) {
    const o = overrides.find((x) => x.aspectCode === ap.aspectCode);
    const res = await write(
      pb,
      (c) =>
        c.collection(OVERRIDES).create({
          tenant: user.tenant,
          assessment: a.id,
          aspect_code: ap.aspectCode,
          original_status: ap.originalStatus.toLowerCase(),
          new_status: ap.newStatus.toLowerCase(),
          comment: o?.comment ?? '',
          created_by: user.id
        }),
      'Kunde inte spara justeringen.'
    );
    if (isErr(res)) return res;
  }
  const err = await setAssessmentStatus(pb, a, 'info_pending', { materiality });
  if (err) return err;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: ASSESSMENTS,
    record_id: a.id,
    field: 'materiality_confirmed',
    after_value: { startup_name: company.name, version: a.version, status: 'info_pending', overrides: applied.length }
  });
  revalidate(startupId);
  return { ok: true };
}

export async function runSufficiencyAction(startupId: string, assessmentId: string): Promise<ImpactActionState> {
  const ctx = await loadForStep(startupId, assessmentId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb, company, a } = ctx;
  if (!a.materiality) return { error: 'Väsentlighetsanalysen saknas.' };
  if (!['info_pending', 'needs_more_info', 'failed'].includes(a.status)) return { error: 'Tillräcklighetsprövningen kan inte köras i det här läget.' };

  const input = await loadCompanyInput(pb, user.tenant, company, a);
  const jobId = await createJob(pb, user, a, 'sufficiency');
  const outcome = await runImpactSufficiency({ companyInput: input.text, materiality: a.materiality });
  await finishJob(pb, user, jobId, outcome);
  if (!outcome.result) {
    await setAssessmentStatus(pb, a, 'failed');
    return { error: outcome.error ?? 'AI-analysen misslyckades.' };
  }
  // Nya frågor skapas bara för aspekter som inte redan har en öppen fråga.
  const existing = await listGapQuestions(pb, user.tenant, [a.id]);
  const openCodes = new Set(existing.items.filter((g) => g.status === 'open').map((g) => `${g.aspectCode}|${g.question}`));
  let created = 0;
  for (const check of outcome.result.aspectChecks) {
    const q = check.question;
    if (!q) continue;
    if (openCodes.has(`${check.code}|${q.question}`)) continue;
    const res = await write(
      pb,
      (c) =>
        c.collection(GAP_QUESTIONS).create({
          tenant: user.tenant,
          assessment: a.id,
          aspect_code: check.code,
          question: clean(q.question, 2000),
          missing_information: clean(q.missingInformation, 2000),
          severity: q.severity,
          status: 'open'
        }),
      'Kunde inte spara kompletteringsfråga.'
    );
    if (!isErr(res)) created += 1;
  }
  const requiredOpen = outcome.result.aspectChecks.some((c) => c.question?.severity === 'required');
  const status: ImpactAssessmentStatus = outcome.result.readyForFinalAnalysis && !requiredOpen ? 'final_pending' : 'needs_more_info';
  const err = await setAssessmentStatus(pb, a, status, {
    sufficiency: outcome.result,
    information_quality_score: outcome.result.overallInformationQuality,
    model_name: outcome.model,
    prompt_version: outcome.promptVersion
  });
  if (err) return err;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: ASSESSMENTS,
    record_id: a.id,
    field: 'sufficiency',
    after_value: { startup_name: company.name, version: a.version, status, questions: created, model: outcome.model }
  });
  revalidate(startupId);
  return { ok: true, warning: input.truncated ? 'Underlaget var stort — delar av dokumenten kapades innan analysen.' : undefined };
}

export async function runFinalAction(startupId: string, assessmentId: string): Promise<ImpactActionState> {
  const ctx = await loadForStep(startupId, assessmentId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb, company, a } = ctx;
  if (!a.materiality) return { error: 'Väsentlighetsanalysen saknas.' };
  if (!['final_pending', 'needs_more_info', 'failed', 'complete'].includes(a.status)) return { error: 'Slutanalysen kan inte köras i det här läget.' };

  const input = await loadCompanyInput(pb, user.tenant, company, a);
  const jobId = await createJob(pb, user, a, 'final_analysis');
  const outcome = await runImpactFinal({ companyInput: input.text, materiality: a.materiality, sufficiency: a.sufficiency });
  await finishJob(pb, user, jobId, outcome);
  if (!outcome.result) {
    await setAssessmentStatus(pb, a, 'failed');
    return { error: outcome.error ?? 'AI-analysen misslyckades.' };
  }
  const err = await setAssessmentStatus(pb, a, 'complete', {
    dashboard: outcome.result,
    information_quality_score: outcome.result.informationQualityScore,
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
  return { ok: true, warning: input.truncated ? 'Underlaget var stort — delar av dokumenten kapades innan analysen.' : undefined };
}

// ─── Kompletteringar ─────────────────────────────────────────────────────────

export async function answerGapQuestionAction(startupId: string, questionId: string, input: Record<string, unknown>): Promise<ImpactActionState> {
  const ctx = await requireManager();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId) || !ID_RE.test(questionId)) return { error: 'Ogiltig fråga.' };
  const q = await getGapQuestion(pb, user.tenant, questionId);
  if (!q) return { error: 'Frågan hittades inte.' };
  const a = await getAssessment(pb, user.tenant, q.assessment);
  if (!a || a.startup !== startupId) return { error: 'Frågan hör inte till bolaget.' };
  const notAvailable = input.notAvailable === true;
  const answer = clean(input.answer, 10000);
  if (!notAvailable && !answer) return { error: 'Skriv ett svar eller markera att uppgiften inte finns.' };
  const res = await write(
    pb,
    (c) => c.collection(GAP_QUESTIONS).update(questionId, { status: notAvailable ? 'not_available' : 'answered', answer_text: notAvailable ? answer : answer }),
    'Kunde inte spara svaret.'
  );
  if (isErr(res)) return res;
  await logAgentAction(pb, {
    actor: actorOf(user),
    action_type: 'update',
    collection: GAP_QUESTIONS,
    record_id: questionId,
    field: 'answer_text',
    after_value: { aspect_code: q.aspectCode, status: notAvailable ? 'not_available' : 'answered', answer_length: answer.length, startup: startupId }
  });
  revalidate(startupId);
  return { ok: true };
}

// ─── Uppdatering (ny version) ────────────────────────────────────────────────

export async function createUpdateAction(startupId: string, input: Record<string, unknown>): Promise<ImpactActionState> {
  const ctx = await requireManager();
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb } = ctx;
  if (!ID_RE.test(startupId)) return { error: 'Ogiltigt bolag.' };
  const company = await getImpactCompany(pb, user.tenant, startupId);
  if (!company) return { error: 'Bolaget hittades inte.' };
  const narrative = clean(input.narrative, 20000);
  if (!narrative) return { error: 'Beskriv vad som hänt sedan senaste analysen.' };

  const all = await listAssessments(pb, user.tenant, startupId);
  const previous = all.items.find((x) => x.status === 'complete' && x.dashboard) ?? null;
  if (!previous) return { error: 'Det finns ingen färdig slutanalys att uppdatera — kör först den ursprungliga analysen.' };
  const nextVersion = all.items.reduce((m, x) => Math.max(m, x.version), 0) + 1;

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
    after_value: { startup_name: company.name, version: nextVersion, narrative_length: narrative.length, startup: startupId }
  });
  revalidate(startupId);
  return { ok: true, assessmentId: created.id, id: event.id };
}

export async function runUpdateAnalysisAction(startupId: string, assessmentId: string): Promise<ImpactActionState> {
  const ctx = await loadForStep(startupId, assessmentId);
  if ('error' in ctx) return { error: ctx.error };
  const { user, pb, company, a } = ctx;
  if (a.type !== 'update' || !a.previousAssessment) return { error: 'Det här är ingen uppdatering.' };
  const previous = await getAssessment(pb, user.tenant, a.previousAssessment);
  if (!previous?.dashboard) return { error: 'Föregående slutanalys saknas.' };
  const events = await pb.collection(UPDATE_EVENTS).getFullList<{ narrative?: string }>({
    filter: pb.filter('tenant = {:t} && assessment = {:a}', { t: user.tenant, a: a.id }),
    fields: 'narrative'
  });
  const narrative = events.map((e) => e.narrative ?? '').filter(Boolean).join('\n\n');
  const input = await loadCompanyInput(pb, user.tenant, company, a, { updateNarrative: narrative });
  const jobId = await createJob(pb, user, a, 'update_analysis');
  const outcome = await runImpactUpdate({ companyInput: input.text, previousDashboard: previous.dashboard, materiality: a.materiality ?? previous.materiality });
  await finishJob(pb, user, jobId, outcome);
  if (!outcome.result) {
    await setAssessmentStatus(pb, a, 'failed');
    return { error: outcome.error ?? 'AI-analysen misslyckades.' };
  }
  const err = await setAssessmentStatus(pb, a, 'complete', {
    dashboard: outcome.result.dashboard,
    update_delta: outcome.result.updateDelta,
    information_quality_score: outcome.result.dashboard.informationQualityScore,
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
    after_value: { startup_name: company.name, version: a.version, status: 'complete', impact_level: outcome.result.dashboard.impactLevel.level, model: outcome.model, update: true }
  });
  revalidate(startupId);
  return { ok: true, warning: input.truncated ? 'Underlaget var stort — delar av dokumenten kapades innan analysen.' : undefined };
}

// ─── Anteckningar & dokument ────────────────────────────────────────────────

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

