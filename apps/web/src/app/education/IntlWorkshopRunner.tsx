'use client';

import { useState, useTransition, useMemo } from 'react';
import Link from 'next/link';
import type { WorkshopAssignment, WorkshopModule } from '@platform/shared';
import { saveWorkshopProgressAction, runWorkshopAiChatAction } from '@/lib/actions/workshops';
import {
  runIntlDiagnosticAction,
  runIntlScenariosAction,
  runIntlDevilsAdvocateAction,
  submitForCoachReviewAction,
  coachReviewDecisionAction,
  commitIntlStrategyAction
} from '@/lib/actions/internationalization';

interface IntlWorkshopRunnerProps {
  assignment: WorkshopAssignment;
  modules: WorkshopModule[];
  isStaff: boolean;
}

// Block IDs that get specialized pipeline rendering
const PIPELINE_BLOCKS = new Set([
  'diagnostic_run',
  'scenarios_run',
  'da_run',
  'coach_submission',
  'commit_strategy'
]);

// Shared class strings following existing WorkshopRunner conventions
const textareaClass =
  'mt-3 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const inputClass =
  'mt-1 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const btnPrimary =
  'inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50';
const btnSecondary =
  'inline-flex items-center justify-center rounded-full border border-default bg-surface px-5 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle disabled:cursor-not-allowed disabled:opacity-50';

// ── AI output box ─────────────────────────────────────────────────────────────

function AiOutputBox({ children }: { children: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-movexum-bla/30 bg-movexum-pastell-bla p-5 dark:border-movexum-djupbla/50 dark:bg-movexum-morkbla/20">
      <p className="mb-2 text-xs font-medium text-movexum-morkbla dark:text-movexum-pastell-bla">
        Genererat av AI – verifiera innan delning
      </p>
      <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">
        {children}
      </pre>
    </div>
  );
}

// ── Lock overlay ──────────────────────────────────────────────────────────────

function LockedOverlay({ reason }: { reason: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-default bg-canvas-subtle/60 px-4 py-3">
      <p className="text-sm text-foreground-subtle">🔒 {reason}</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function IntlWorkshopRunner({ assignment, modules, isStaff }: IntlWorkshopRunnerProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries((assignment.answers_json as Record<string, unknown>) || {}).map(([k, v]) => [
        k,
        String(v ?? '')
      ])
    )
  );
  const [artifacts, setArtifacts] = useState<Record<string, unknown>>(
    (assignment.artifacts_json as Record<string, unknown>) || {}
  );

  const [coachNotesInput, setCoachNotesInput] = useState('');
  const [baseRateQuestion, setBaseRateQuestion] = useState('');
  const [baseRateAnswer, setBaseRateAnswer] = useState('');

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pendingSave, startSave] = useTransition();
  const [pendingDiag, startDiag] = useTransition();
  const [pendingScenarios, startScenarios] = useTransition();
  const [pendingDA, startDA] = useTransition();
  const [pendingBaseRate, startBaseRate] = useTransition();
  const [pendingCoach, startCoach] = useTransition();
  const [pendingCommit, startCommit] = useTransition();

  const allBlocks = useMemo(() => modules.flatMap((m) => m.blocks), [modules]);

  // Derive progress gates from artifacts / answers
  const hasDiagnostic = Boolean(artifacts.diagnostic_output);
  const hasScenarios = Boolean(artifacts.scenarios_output);
  const hasChosenScenario = Boolean(answers.da_chosen_scenario?.trim());
  const hasDevilsAdvocate = Boolean(artifacts.devils_advocate_output);
  const hasDAResponse = Boolean(answers.da_response?.trim());
  const coachReviewSubmitted = Boolean(artifacts.coach_review_submitted_at);
  const coachDecision = artifacts.coach_decision as 'approved' | 'returned' | null | undefined;
  const strategyId = artifacts.strategy_id ? String(artifacts.strategy_id) : null;

  // Count completed required blocks for the status bar
  const completedRequired = useMemo(() => {
    return allBlocks
      .filter((b) => b.required)
      .every((b) => {
        if (PIPELINE_BLOCKS.has(b.id)) {
          if (b.id === 'diagnostic_run') return hasDiagnostic;
          if (b.id === 'scenarios_run') return hasScenarios;
          if (b.id === 'da_run') return hasDevilsAdvocate;
          return false;
        }
        const v = answers[b.id];
        return typeof v === 'string' && v.trim().length > 0;
      });
  }, [answers, hasDiagnostic, hasScenarios, hasDevilsAdvocate, allBlocks]);

  const notify = (msg: string, isErr = false) => {
    if (isErr) setError(msg);
    else setMessage(msg);
  };

  const clearNotice = () => {
    setError(null);
    setMessage(null);
  };

  // ── Save intake answers ──────────────────────────────────────────────────────

  const handleSave = () => {
    clearNotice();
    startSave(async () => {
      const res = await saveWorkshopProgressAction(assignment.id, {
        answers: answers as Record<string, unknown>,
        artifacts: artifacts,
        progress: { completedRequired, updatedAt: new Date().toISOString() }
      });
      if (res.error) notify(res.error, true);
      else notify('Svar sparade.');
    });
  };

  // ── Diagnostic pipeline ──────────────────────────────────────────────────────

  const handleDiagnostic = () => {
    clearNotice();
    startDiag(async () => {
      // Auto-save intake answers first
      await saveWorkshopProgressAction(assignment.id, {
        answers: answers as Record<string, unknown>,
        artifacts: artifacts
      });
      const res = await runIntlDiagnosticAction(assignment.id);
      if (res.error) { notify(res.error, true); return; }
      setArtifacts((prev) => ({
        ...prev,
        diagnostic_output: res.output,
        diagnostic_run_id: res.runId,
        diagnostic_at: new Date().toISOString()
      }));
      notify('Diagnostisk analys klar.');
    });
  };

  // ── Scenarios pipeline ───────────────────────────────────────────────────────

  const handleScenarios = () => {
    clearNotice();
    startScenarios(async () => {
      const res = await runIntlScenariosAction(assignment.id);
      if (res.error) { notify(res.error, true); return; }
      setArtifacts((prev) => ({
        ...prev,
        scenarios_output: res.output,
        scenarios_run_id: res.runId,
        scenarios_at: new Date().toISOString()
      }));
      notify('Scenariogenerering klar.');
    });
  };

  // ── Devil's advocate pipeline ────────────────────────────────────────────────

  const handleDevilsAdvocate = () => {
    clearNotice();
    startDA(async () => {
      await saveWorkshopProgressAction(assignment.id, {
        answers: answers as Record<string, unknown>
      });
      const res = await runIntlDevilsAdvocateAction(assignment.id);
      if (res.error) { notify(res.error, true); return; }
      setArtifacts((prev) => ({
        ...prev,
        devils_advocate_output: res.output,
        devils_advocate_run_id: res.runId,
        devils_advocate_at: new Date().toISOString()
      }));
      notify('Devil\'s advocate-analys klar.');
    });
  };

  // ── Base rate ai_chat (generic, reuses runWorkshopAiChatAction) ──────────────

  const handleBaseRate = () => {
    if (!baseRateQuestion.trim()) return;
    clearNotice();
    startBaseRate(async () => {
      const res = await runWorkshopAiChatAction(assignment.id, baseRateQuestion.trim());
      if (res.error) { notify(res.error, true); return; }
      setBaseRateAnswer(res.answer ?? '');
      setBaseRateQuestion('');
      notify('Base rate-analys klar.');
    });
  };

  // ── Coach review ─────────────────────────────────────────────────────────────

  const handleSubmitToCoach = () => {
    clearNotice();
    startCoach(async () => {
      await saveWorkshopProgressAction(assignment.id, {
        answers: answers as Record<string, unknown>,
        artifacts: artifacts
      });
      const res = await submitForCoachReviewAction(assignment.id);
      if (res.error) { notify(res.error, true); return; }
      setArtifacts((prev) => ({
        ...prev,
        coach_review_submitted_at: new Date().toISOString(),
        coach_decision: null
      }));
      notify('Skickat till coach för granskning.');
    });
  };

  const handleCoachDecision = (decision: 'approved' | 'returned') => {
    clearNotice();
    startCoach(async () => {
      const res = await coachReviewDecisionAction(assignment.id, decision, coachNotesInput);
      if (res.error) { notify(res.error, true); return; }
      setArtifacts((prev) => ({
        ...prev,
        coach_decision: decision,
        coach_notes: coachNotesInput,
        coach_reviewed_at: new Date().toISOString()
      }));
      notify(decision === 'approved' ? 'Strategi godkänd.' : 'Strategi returnerad för revidering.');
    });
  };

  // ── Commit ───────────────────────────────────────────────────────────────────

  const handleCommit = () => {
    clearNotice();
    startCommit(async () => {
      const res = await commitIntlStrategyAction(assignment.id);
      if (res.error) { notify(res.error, true); return; }
      setArtifacts((prev) => ({
        ...prev,
        strategy_id: res.strategyId,
        committed_at: new Date().toISOString()
      }));
      notify('Strategi committad! Levande strategidokument skapat.');
    });
  };

  const isDone = assignment.status === 'done';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-10">
      {/* Status bar */}
      <div className="rounded-2xl border border-default bg-canvas-subtle/40 px-4 py-3 text-sm text-foreground-muted">
        Status:{' '}
        <span className="font-semibold text-foreground">{assignment.status}</span>
        {strategyId && (
          <>
            {' '}·{' '}
            <Link
              href={`/education/strategies/${strategyId}`}
              className="font-medium text-link hover:underline"
            >
              Visa strategidokument →
            </Link>
          </>
        )}
      </div>

      {/* Modules */}
      {modules.map((mod, modIdx) => (
        <section key={mod.id}>
          <div className="mb-4 flex items-center gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
              {modIdx + 1}
            </span>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{mod.title}</h2>
              {mod.description && (
                <p className="text-sm text-foreground-muted">{mod.description}</p>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {mod.blocks.map((block, blockIdx) => (
              <section
                key={block.id}
                className="rounded-3xl border border-default bg-surface p-5"
              >
                {/* Block meta */}
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex rounded-full bg-canvas-subtle px-2 py-0.5 text-xs font-medium text-foreground-muted">
                    {modIdx + 1}.{blockIdx + 1}
                  </span>
                  <span className="inline-flex rounded-full bg-movexum-pastell-bla px-2 py-0.5 text-xs font-medium text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla">
                    {block.type}
                  </span>
                  {block.required && (
                    <span className="inline-flex rounded-full bg-movexum-pastell-gul px-2 py-0.5 text-xs font-medium text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
                      Obligatorisk
                    </span>
                  )}
                </div>

                <h3 className="text-base font-semibold text-foreground">{block.title}</h3>
                {block.instructions && (
                  <p className="mt-1 whitespace-pre-line text-sm text-foreground-muted">
                    {block.instructions}
                  </p>
                )}
                {block.desired_result && (
                  <p className="mt-1 text-xs text-foreground-subtle">
                    Mål: {block.desired_result}
                  </p>
                )}

                {/* ── Specialized pipeline blocks ── */}

                {block.id === 'diagnostic_run' ? (
                  <div className="mt-4 space-y-3">
                    {hasDiagnostic ? (
                      <AiOutputBox>{String(artifacts.diagnostic_output)}</AiOutputBox>
                    ) : (
                      <button
                        type="button"
                        disabled={pendingDiag || isDone}
                        onClick={handleDiagnostic}
                        className={btnPrimary}
                      >
                        {pendingDiag ? 'Analyserar…' : 'Kör diagnostisk analys'}
                      </button>
                    )}
                    {hasDiagnostic && !isDone && (
                      <button
                        type="button"
                        disabled={pendingDiag}
                        onClick={handleDiagnostic}
                        className={btnSecondary}
                      >
                        {pendingDiag ? 'Analyserar…' : 'Kör om analys'}
                      </button>
                    )}
                  </div>
                ) : block.id === 'scenarios_run' ? (
                  <div className="mt-4 space-y-3">
                    {!hasDiagnostic ? (
                      <LockedOverlay reason="Kör diagnostisk analys (steg 2) för att låsa upp scenariogenerering." />
                    ) : hasScenarios ? (
                      <>
                        <AiOutputBox>{String(artifacts.scenarios_output)}</AiOutputBox>
                        {!isDone && (
                          <button
                            type="button"
                            disabled={pendingScenarios}
                            onClick={handleScenarios}
                            className={btnSecondary}
                          >
                            {pendingScenarios ? 'Genererar…' : 'Generera om scenarier'}
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={pendingScenarios || isDone}
                        onClick={handleScenarios}
                        className={btnPrimary}
                      >
                        {pendingScenarios ? 'Genererar scenarier…' : 'Kör scenariogenerering'}
                      </button>
                    )}
                  </div>
                ) : block.id === 'da_run' ? (
                  <div className="mt-4 space-y-3">
                    {!hasChosenScenario ? (
                      <LockedOverlay reason="Fyll i 'Vilket scenario väljer ni?' ovan för att låsa upp devil's advocate." />
                    ) : !hasScenarios ? (
                      <LockedOverlay reason="Kör scenariogenerering (steg 4) för att låsa upp devil's advocate." />
                    ) : hasDevilsAdvocate ? (
                      <>
                        <AiOutputBox>{String(artifacts.devils_advocate_output)}</AiOutputBox>
                        {!isDone && (
                          <button
                            type="button"
                            disabled={pendingDA}
                            onClick={handleDevilsAdvocate}
                            className={btnSecondary}
                          >
                            {pendingDA ? 'Analyserar…' : 'Kör om devil\'s advocate'}
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={pendingDA || isDone}
                        onClick={handleDevilsAdvocate}
                        className={btnPrimary}
                      >
                        {pendingDA ? 'Analyserar…' : 'Kör devil\'s advocate'}
                      </button>
                    )}
                  </div>
                ) : block.id === 'coach_submission' ? (
                  <div className="mt-4 space-y-4">
                    {strategyId ? (
                      <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-sm text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                        ✓ Strategi committad.{' '}
                        <Link
                          href={`/education/strategies/${strategyId}`}
                          className="font-medium underline"
                        >
                          Visa strategidokument →
                        </Link>
                      </p>
                    ) : coachDecision === 'approved' ? (
                      <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-sm text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                        ✓ Coach har godkänt strategin. Gå vidare till Commit (steg 7).
                      </p>
                    ) : coachDecision === 'returned' ? (
                      <div className="space-y-2">
                        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
                          ↩ Coach har returnerat strategin för revidering.
                        </p>
                        {artifacts.coach_notes && (
                          <div className="rounded-2xl border border-default bg-canvas-subtle/60 p-4">
                            <p className="mb-1 text-xs font-medium text-foreground-subtle">Coach-anteckningar</p>
                            <p className="text-sm text-foreground-muted">{String(artifacts.coach_notes)}</p>
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={pendingCoach || !hasDAResponse || isDone}
                          onClick={handleSubmitToCoach}
                          className={btnSecondary}
                        >
                          {pendingCoach ? 'Skickar…' : 'Skicka på nytt till coach'}
                        </button>
                      </div>
                    ) : coachReviewSubmitted ? (
                      <p className="rounded-xl bg-movexum-pastell-bla px-3 py-2 text-sm text-movexum-morkbla dark:bg-movexum-morkbla/40 dark:text-movexum-pastell-bla">
                        ⏳ Skickad till coach – inväntar granskning.
                      </p>
                    ) : (
                      <button
                        type="button"
                        disabled={pendingCoach || !hasDAResponse || !hasDevilsAdvocate || isDone}
                        onClick={handleSubmitToCoach}
                        className={btnPrimary}
                        title={
                          !hasDevilsAdvocate
                            ? 'Kör devil\'s advocate-analysen (steg 5) först'
                            : !hasDAResponse
                              ? 'Fyll i era svar på devil\'s advocate-utmaningarna (steg 5)'
                              : undefined
                        }
                      >
                        {pendingCoach ? 'Skickar…' : 'Skicka till coach för granskning'}
                      </button>
                    )}

                    {/* Staff coach review form */}
                    {isStaff && coachReviewSubmitted && !strategyId && (
                      <div className="mt-4 space-y-3 rounded-2xl border border-movexum-lila/30 bg-movexum-pastell-lila/40 p-4 dark:border-movexum-morklila/30 dark:bg-movexum-morklila/10">
                        <p className="text-xs font-semibold uppercase tracking-wide text-movexum-lila dark:text-movexum-ljuslila">
                          Coach-granskning
                        </p>
                        <textarea
                          value={coachNotesInput}
                          onChange={(e) => setCoachNotesInput(e.target.value)}
                          rows={4}
                          placeholder="Kommentar till bolaget (syns vid godkännande och returnering)…"
                          className={textareaClass}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={pendingCoach}
                            onClick={() => handleCoachDecision('approved')}
                            className={btnPrimary}
                          >
                            {pendingCoach ? '…' : '✓ Godkänn strategi'}
                          </button>
                          <button
                            type="button"
                            disabled={pendingCoach}
                            onClick={() => handleCoachDecision('returned')}
                            className={btnSecondary}
                          >
                            {pendingCoach ? '…' : '↩ Returnera för revidering'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : block.id === 'commit_strategy' ? (
                  <div className="mt-4 space-y-3">
                    {strategyId ? (
                      <div className="space-y-3">
                        <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-sm font-medium text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                          ✓ Strategi committad – levande strategidokument skapat.
                        </p>
                        <Link
                          href={`/education/strategies/${strategyId}`}
                          className={btnPrimary}
                        >
                          Visa strategidokument →
                        </Link>
                      </div>
                    ) : coachDecision !== 'approved' ? (
                      <LockedOverlay reason="Coach måste godkänna strategin (steg 6) innan commit." />
                    ) : (
                      <button
                        type="button"
                        disabled={pendingCommit || isDone}
                        onClick={handleCommit}
                        className={btnPrimary}
                      >
                        {pendingCommit ? 'Skapar strategidokument…' : 'Förbind er till strategin'}
                      </button>
                    )}
                  </div>

                ) : block.id === 'base_rate_run' ? (
                  /* Base rate uses generic ai_chat via runWorkshopAiChatAction */
                  <div className="mt-4 space-y-3">
                    {baseRateAnswer && <AiOutputBox>{baseRateAnswer}</AiOutputBox>}
                    <textarea
                      value={baseRateQuestion}
                      onChange={(e) => setBaseRateQuestion(e.target.value)}
                      rows={3}
                      placeholder="Beskriv era internationaliseringsambitioner och tidshorisont…"
                      className={textareaClass}
                    />
                    <button
                      type="button"
                      disabled={pendingBaseRate || !baseRateQuestion.trim() || isDone}
                      onClick={handleBaseRate}
                      className={btnPrimary}
                    >
                      {pendingBaseRate ? 'Analyserar…' : 'Kör base rate-kalibrering'}
                    </button>
                  </div>

                ) : block.type === 'instruction' ? (
                  /* Instruction: acknowledge checkbox */
                  <div className="mt-4">
                    <label className="flex items-center gap-2 text-sm text-foreground-muted">
                      <input
                        type="checkbox"
                        checked={answers[`ack_${block.id}`] === 'true'}
                        onChange={(e) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [`ack_${block.id}`]: String(e.target.checked)
                          }))
                        }
                        className="rounded border-default accent-brand"
                      />
                      Jag har läst och förstått detta
                    </label>
                  </div>

                ) : block.type === 'question' ? (
                  /* Short-answer question */
                  <input
                    type="text"
                    value={answers[block.id] ?? ''}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [block.id]: e.target.value }))
                    }
                    placeholder="Ert svar…"
                    className={inputClass}
                    disabled={isDone}
                  />

                ) : block.type === 'summary' ? (
                  /* Summary block: status display only, no input needed beyond specialized rendering above */
                  null

                ) : (
                  /* exercise, ai_chat (fallthrough), image, video, test → free text */
                  <textarea
                    value={answers[block.id] ?? ''}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [block.id]: e.target.value }))
                    }
                    rows={5}
                    placeholder="Skriv ert svar här…"
                    className={textareaClass}
                    disabled={isDone}
                  />
                )}
              </section>
            ))}
          </div>
        </section>
      ))}

      {/* Save + messages */}
      {!isDone && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={pendingSave}
            onClick={handleSave}
            className={btnSecondary}
          >
            {pendingSave ? 'Sparar…' : 'Spara svar'}
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-sm text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
          {message}
        </p>
      )}
    </div>
  );
}
