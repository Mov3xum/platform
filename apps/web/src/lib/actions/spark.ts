'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser, type SessionUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { readTableFile } from '@/lib/import/table-file';
import {
  applySparkInterview,
  assessSparkSolution,
  canManageSpark,
  createSparkMatch,
  deleteSparkInterview,
  deleteSparkMatch,
  draftSparkIntroduction,
  reindexSparkEmbeddings,
  suggestSparkAssessment,
  suggestSparkAssessments,
  importSparkInterviews,
  saveSparkInterview,
  setSparkRecordStatus,
  updateSparkActor,
  updateSparkMatch,
  type Actor,
  type SparkRecordKind
} from '@/lib/core/write';
import { SPARK_IMPORT_MAX_ROWS, cleanSparkText, parseSparkImportRows, type SparkImportRow } from '@platform/shared';

/**
 * SPARK – energimatchning (CLAUDE.md § 61) — tunna server actions. Grinden
 * (modulen + roll) ligger här; validering, tenant, statusregler och audit i
 * `lib/core/write/spark.ts`.
 */

export interface SparkActionState {
  ok?: boolean;
  error?: string;
  notice?: string;
  warning?: string;
  id?: string;
}

async function session(): Promise<{ user: SessionUser; actor: Actor } | { error: string }> {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'spark', user.enabledModules)) return { error: 'Du har inte tillgång till SPARK.' };
  return { user, actor: { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles } };
}

function revalidate() {
  revalidatePath('/spark', 'layout');
}

/**
 * Håller likhetsindexet (§ 61.7) aktuellt när registret fått nya poster.
 * Best-effort: saknad AI-nyckel, nått kostnadstak eller ett AI-fel får aldrig
 * fälla det som just sparades — indexet kan alltid läsas in från Matchning.
 */
async function refreshIndex(pb: Awaited<ReturnType<typeof getServerPb>>, actor: Actor): Promise<void> {
  if (!canManageSpark(actor.roles)) return;
  await reindexSparkEmbeddings(pb, actor).catch(() => undefined);
}

export async function saveSparkInterviewAction(input: {
  id?: string | null;
  answers: unknown;
  interviewerOrg?: string;
  interviewedAt?: string;
  submit: boolean;
}): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const pb = await getServerPb();
  const res = await saveSparkInterview(pb, ctx.actor, input.id ?? null, {
    answers: input.answers,
    interviewerOrg: input.interviewerOrg,
    interviewedAt: input.interviewedAt,
    submit: input.submit
  });
  if (!res.ok) return { error: res.error };
  if (res.value.applied) await refreshIndex(pb, ctx.actor);
  revalidate();
  const { status, applied, warning, interviewId } = res.value;
  let notice = 'Utkastet är sparat.';
  if (applied) {
    notice = `${applied.actorName} är ${applied.actorCreated ? 'tillagd i' : 'uppdaterad i'} registret: ${applied.needs} behov, ${applied.solutions} lösningar, ${applied.testbeds} testmiljöer.`;
  } else if (input.submit && status === 'submitted') {
    notice = 'Intervjun är inskickad. Movexum för in den i registret.';
  }
  return { ok: true, id: interviewId, notice, warning };
}

export async function applySparkInterviewAction(interviewId: string): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const pb = await getServerPb();
  const res = await applySparkInterview(pb, ctx.actor, interviewId);
  if (!res.ok) return { error: res.error };
  await refreshIndex(pb, ctx.actor);
  revalidate();
  const a = res.value;
  return { ok: true, id: a.actorId, notice: `${a.actorName} är ${a.actorCreated ? 'tillagd i' : 'uppdaterad i'} registret: ${a.needs} behov, ${a.solutions} lösningar, ${a.testbeds} testmiljöer.` };
}

export async function deleteSparkInterviewAction(interviewId: string): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const res = await deleteSparkInterview(await getServerPb(), ctx.actor, interviewId);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true };
}

export async function updateSparkActorAction(actorId: string, input: { notes?: string; website?: string; startup?: string; status?: string }): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const res = await updateSparkActor(await getServerPb(), ctx.actor, actorId, input);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, notice: 'Sparat.' };
}

export async function setSparkRecordStatusAction(kind: SparkRecordKind, id: string, status: string): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const res = await setSparkRecordStatus(await getServerPb(), ctx.actor, kind, id, status);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true };
}

export async function assessSparkSolutionAction(solutionId: string, input: { trl?: string; category?: string; note?: string }): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const res = await assessSparkSolution(await getServerPb(), ctx.actor, solutionId, input);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, notice: 'Bedömningen är sparad.' };
}

export async function createSparkMatchAction(input: { needId?: string; solutionId?: string; testbedId?: string; semantic?: string }): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const res = await createSparkMatch(await getServerPb(), ctx.actor, input);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.matchId, notice: 'Matchningen är skapad som förslag.' };
}

export async function updateSparkMatchAction(matchId: string, patch: Record<string, unknown>): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const res = await updateSparkMatch(await getServerPb(), ctx.actor, matchId, patch);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, notice: 'Sparat.' };
}

export async function deleteSparkMatchAction(matchId: string): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const res = await deleteSparkMatch(await getServerPb(), ctx.actor, matchId);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true };
}

/** Sparar vilken organisation den inloggade företräder — visas för företag som får delningslänken. */
export async function saveSparkOrganizationAction(organization: string): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const value = cleanSparkText(organization, 120);
  const pb = await getServerPb();
  try {
    const updated = await pb.collection('users').update<{ organization?: string }>(ctx.user.id, { organization: value });
    // PocketBase släpper okända fält tyst — läs tillbaka så en saknad migration syns.
    if ((updated.organization ?? '') !== value) return { error: 'Fältet saknas i databasen — kör migration 1700000223 (eller workflowen "Sync PocketBase").' };
  } catch {
    return { error: 'Kunde inte spara organisationen. Försök igen.' };
  }
  revalidate();
  return { ok: true, notice: 'Sparat.' };
}

// ── AI-lagret (§ 61.7) — alltid på en människas klick ────────────────────────

export async function suggestSparkAssessmentAction(solutionId: string): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const res = await suggestSparkAssessment(await getServerPb(), ctx.actor, solutionId);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, notice: 'AI-förslaget är klart. Läs motiveringen och spara er egen bedömning.' };
}

export async function suggestSparkAssessmentsAction(): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const res = await suggestSparkAssessments(await getServerPb(), ctx.actor);
  revalidate();
  if (!res.ok) return { error: res.error };
  const { done, skipped, remaining } = res.value;
  return {
    ok: true,
    notice: done === 0 && skipped === 0 ? 'Det finns inga lösningar utan förslag.' : `${done} lösningar fick ett AI-förslag.${remaining ? ` ${remaining} återstår — kör igen.` : ''}`,
    warning: skipped ? `${skipped} gav inget tolkbart svar.` : undefined
  };
}

export interface SparkIntroState extends SparkActionState {
  text?: string;
  anonymous?: boolean;
}

export async function draftSparkIntroAction(matchId: string, recipient: 'need' | 'solution'): Promise<SparkIntroState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  if (recipient !== 'need' && recipient !== 'solution') return { error: 'Ogiltig mottagare.' };
  const res = await draftSparkIntroduction(await getServerPb(), ctx.actor, matchId, recipient);
  if (!res.ok) return { error: res.error };
  return { ok: true, text: res.value.text, anonymous: res.value.anonymous, warning: res.value.caution };
}

export async function reindexSparkAction(): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const res = await reindexSparkEmbeddings(await getServerPb(), ctx.actor);
  if (!res.ok) return { error: res.error };
  revalidate();
  const r = res.value;
  return {
    ok: true,
    notice: r.embedded === 0 ? 'Likhetsindexet är redan aktuellt.' : `${r.embedded} beskrivningar lästes in.${r.remaining ? ` ${r.remaining} återstår — kör igen.` : ''}`
  };
}

export interface SparkImportPreview {
  error?: string;
  rows?: SparkImportRow[];
  mappedHeaders?: string[];
  unmappedHeaders?: string[];
  warnings?: string[];
}

export async function previewSparkImportAction(fd: FormData): Promise<SparkImportPreview> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Välj en fil (Excel eller CSV).' };
  const table = await readTableFile(file, { maxRows: SPARK_IMPORT_MAX_ROWS, rowNoun: 'företag' });
  if ('error' in table) return { error: table.error };
  const parsed = parseSparkImportRows(table.headers, table.rows);
  return { rows: parsed.rows, mappedHeaders: parsed.mappedHeaders, unmappedHeaders: parsed.unmappedHeaders, warnings: parsed.warnings };
}

export async function commitSparkImportAction(input: { rows: { line: number; answers: unknown }[]; interviewerOrg?: string }): Promise<SparkActionState> {
  const ctx = await session();
  if ('error' in ctx) return { error: ctx.error };
  if (!Array.isArray(input.rows) || input.rows.length === 0) return { error: 'Det finns inga rader att importera.' };
  const rows = input.rows
    .slice(0, SPARK_IMPORT_MAX_ROWS)
    .filter((r) => r && typeof r === 'object')
    // Raderna kommer från klienten — skrivlagret normaliserar varje svar på nytt.
    .map((r) => ({ line: Number(r.line) || 0, answers: r.answers as never }));
  const pb = await getServerPb();
  const res = await importSparkInterviews(pb, ctx.actor, rows, { interviewerOrg: input.interviewerOrg });
  if (!res.ok) return { error: res.error };
  if (res.value.applied > 0) await refreshIndex(pb, ctx.actor);
  revalidate();
  const s = res.value;
  const manage = canManageSpark(ctx.user.roles);
  return {
    ok: true,
    notice: manage
      ? `${s.created} intervjuer importerade, ${s.applied} införda i registret.`
      : `${s.created} intervjuer importerade. Movexum för in dem i registret.`,
    warning: s.failed || s.errors.length ? [`${s.failed} rader kunde inte sparas.`, ...s.errors].filter(Boolean).join(' ') : undefined
  };
}
