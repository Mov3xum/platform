'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  completeWorkshopAction,
  runPipelineBlockAction,
  runWorkshopAiChatAction,
  saveWorkshopProgressAction,
  submitForCoachReviewAction,
  coachReviewDecisionAction,
  commitWorkshopDocumentAction,
  previewWorkshopAiChatAction,
  previewPipelineBlockAction,
  previewWorkshopReportAction
} from '@/lib/actions/workshops';
import type { WorkshopAssignment, WorkshopModule } from '@platform/shared';

interface WorkshopRunnerProps {
  assignment: WorkshopAssignment;
  modules: WorkshopModule[];
  isStaff?: boolean;
  /**
   * Staff-testläge (CLAUDE.md § 18.5): fullt interaktivt — precis som bolaget
   * ser workshopen — men INGENTING persisteras. AI-momenten körs via
   * preview-actions mot ett fiktivt exempelbolag; coach-granskning och commit
   * simuleras lokalt. `assignment` är då ett syntetiskt objekt (id används
   * aldrig) och `assignment.workshop` pekar på workshopen som testas.
   */
  preview?: boolean;
}

export function WorkshopRunner({
  assignment,
  modules,
  isStaff = false,
  preview = false
}: WorkshopRunnerProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(
    (assignment.answers_json as Record<string, unknown>) || {}
  );
  const [artifacts, setArtifacts] = useState<Record<string, unknown>>(
    (assignment.artifacts_json as Record<string, unknown>) || {}
  );
  const [aiQuestions, setAiQuestions] = useState<Record<string, string>>({});
  const [aiAnswers, setAiAnswers] = useState<Record<string, string>>({});
  const [aiThreadCount, setAiThreadCount] = useState(
    Array.isArray(assignment.ai_thread_json) ? assignment.ai_thread_json.length : 0
  );
  const [pendingPipelineBlockId, setPendingPipelineBlockId] = useState<string | null>(null);
  const [pipelineOutputs, setPipelineOutputs] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries((assignment.artifacts_json as Record<string, unknown>) || {})
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => [k, v as string])
    )
  );

  // Coach review + commit state (for coach_review / commit_document block types)
  const initArtifacts = (assignment.artifacts_json as Record<string, unknown>) || {};
  const [coachReviewSubmitted, setCoachReviewSubmitted] = useState(
    Boolean(initArtifacts.coach_review_submitted_at)
  );
  const [coachDecision, setCoachDecision] = useState<'approved' | 'returned' | null>(
    (initArtifacts.coach_decision as 'approved' | 'returned' | null) ?? null
  );
  const [coachNotesInput, setCoachNotesInput] = useState('');
  const [documentUrl, setDocumentUrl] = useState<string | null>(
    (initArtifacts.document_url as string | null)
      ?? (initArtifacts.strategy_id ? `/education/strategies/${initArtifacts.strategy_id}` : null)
  );
  const [pendingCoach, startCoach] = useTransition();
  const [pendingCommit, startCommit] = useTransition();
  const [generatedReport, setGeneratedReport] = useState<string | null>(
    typeof (assignment.takeaway_json as Record<string, unknown> | undefined)?.report_md === 'string'
      ? String((assignment.takeaway_json as Record<string, unknown>).report_md)
      : null
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, startSave] = useTransition();
  const [pendingAi, startAi] = useTransition();
  const [pendingComplete, startComplete] = useTransition();

  // Testläge: lokalt simulerad commit + lokal AI-chatlogg (matas in i
  // testrapporten så den speglar det bolaget skulle få).
  const [previewCommitted, setPreviewCommitted] = useState(false);
  const [previewThread, setPreviewThread] = useState<Array<{ question: string; answer: string }>>(
    []
  );

  const allBlocks = useMemo(() => modules.flatMap((m) => m.blocks), [modules]);

  function normalizeAnswerArray(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string' && value) return [value];
    return [];
  }

  const completedRequired = useMemo(() => {
    const requiredBlocks = allBlocks.filter((block) => block.required);
    if (requiredBlocks.length === 0) return true;
    return requiredBlocks.every((block) => {
      if (block.type === 'video') return artifacts[`video_ack_${block.id}`] === true;
      if (block.type === 'instruction') return artifacts[`ack_${block.id}`] === true;
      if (block.type === 'ai_chat') {
        return aiThreadCount > 0 || Boolean(answers[`${block.id}__ai_done`]);
      }
      if (block.type === 'ai_pipeline') {
        const key = block.pipeline_output_key ?? `pipeline_${block.id}`;
        return Boolean(pipelineOutputs[key] || artifacts[key]);
      }
      if (block.type === 'test') {
        return normalizeAnswerArray(answers[block.id]).length > 0;
      }
      const value = answers[block.id];
      return typeof value === 'string' && value.trim().length > 0;
    });
  }, [answers, artifacts, allBlocks, aiThreadCount, pipelineOutputs]);

  const remainingCount = useMemo(
    () =>
      allBlocks.filter((block) => {
        if (!block.required) return false;
        if (block.type === 'video') return artifacts[`video_ack_${block.id}`] !== true;
        if (block.type === 'instruction') return artifacts[`ack_${block.id}`] !== true;
        if (block.type === 'ai_chat') {
          return !(aiThreadCount > 0 || Boolean(answers[`${block.id}__ai_done`]));
        }
        if (block.type === 'ai_pipeline') {
          const key = block.pipeline_output_key ?? `pipeline_${block.id}`;
          return !Boolean(pipelineOutputs[key] || artifacts[key]);
        }
        if (block.type === 'test') {
          return normalizeAnswerArray(answers[block.id]).length === 0;
        }
        const value = answers[block.id];
        return !(typeof value === 'string' && value.trim().length > 0);
      }).length,
    [answers, artifacts, allBlocks, aiThreadCount, pipelineOutputs]
  );

  const saveProgress = async () => {
    const progress = {
      completedRequired,
      remainingCount,
      updatedAt: new Date().toISOString()
    };
    return saveWorkshopProgressAction(assignment.id, { progress, answers, artifacts });
  };

  // Delad körning för ai_pipeline-block ("Kör" + "Kör om") — i testläget går
  // anropet mot preview-actionen med de lokala svaren/artefakterna i stället
  // för tilldelningen.
  const runPipeline = (blockId: string, outputKey: string) => {
    setError(null);
    setMessage(null);
    setPendingPipelineBlockId(blockId);
    startAi(async () => {
      const res = preview
        ? await previewPipelineBlockAction(String(assignment.workshop), blockId, answers, artifacts)
        : await runPipelineBlockAction(assignment.id, blockId);
      setPendingPipelineBlockId(null);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.output) {
        setPipelineOutputs((prev) => ({
          ...prev,
          [outputKey]: res.output!
        }));
        setArtifacts((prev) => ({
          ...prev,
          [outputKey]: res.output
        }));
      }
      setMessage(preview ? 'Analys klar (testläge — inget sparas).' : 'Analys klar.');
    });
  };

  const textareaClass =
    'mt-3 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  const isDone = !preview && assignment.status === 'done';
  const isCommitted = Boolean(documentUrl) || (preview && previewCommitted);

  return (
    <div className="space-y-8">
      {/* Preview banner */}
      {preview ? (
        <p className="rounded-xl bg-movexum-pastell-gul px-3 py-2 text-sm text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
          Förhandsgranskning/testläge — du ser och testar workshopen precis som ett bolag gör.
          Ingenting sparas, och AI-momenten körs mot ett fiktivt exempelbolag i stället för
          riktig bolagsdata.
        </p>
      ) : null}

      {/* Status bar */}
      <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4 text-sm text-foreground-muted">
        Status:{' '}
        <span className="font-semibold text-foreground">
          {preview ? 'testläge' : assignment.status}
        </span>
        {!isDone && (
          <>
            {' '}· Obligatoriska moment kvar:{' '}
            <span className="font-semibold text-foreground">{remainingCount}</span>
          </>
        )}
      </div>

      {/* Modules */}
      {modules.map((mod, modIdx) => (
        <section key={mod.id}>
          {/* Module heading */}
          <div className="mb-4 flex items-center gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
              {modIdx + 1}
            </span>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{mod.title}</h2>
              {mod.description ? (
                <p className="text-sm text-foreground-muted">{mod.description}</p>
              ) : null}
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
                  {block.required ? (
                    <span className="inline-flex rounded-full bg-movexum-pastell-gul px-2 py-0.5 text-xs font-medium text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
                      Obligatorisk
                    </span>
                  ) : null}
                </div>

                <h3 className="text-base font-semibold text-foreground">{block.title}</h3>
                {block.instructions ? (
                  <p className="mt-1 whitespace-pre-line text-sm text-foreground-muted">
                    {block.instructions}
                  </p>
                ) : null}
                {block.desired_result ? (
                  <p className="mt-1 text-xs text-foreground-subtle">
                    Mål: {block.desired_result}
                  </p>
                ) : null}

                {/* ── Block type renderers ── */}

                {block.type === 'instruction' ? (
                  <div className="mt-4">
                    <label className="flex items-center gap-2 text-sm text-foreground-muted">
                      <input
                        type="checkbox"
                        checked={artifacts[`ack_${block.id}`] === true}
                        onChange={(e) =>
                          setArtifacts((prev) => ({
                            ...prev,
                            [`ack_${block.id}`]: e.target.checked
                          }))
                        }
                        className="rounded border-default accent-brand"
                      />
                      Jag har läst och förstått detta
                    </label>
                  </div>
                ) : block.type === 'video' ? (
                  <div className="mt-4 space-y-3">
                    {block.video_url ? (
                      <video
                        controls
                        src={block.video_url}
                        className="max-h-96 w-full rounded-2xl border border-default"
                      />
                    ) : null}
                    <label className="flex items-center gap-2 text-sm text-foreground-muted">
                      <input
                        type="checkbox"
                        checked={artifacts[`video_ack_${block.id}`] === true}
                        onChange={(e) =>
                          setArtifacts((prev) => ({
                            ...prev,
                            [`video_ack_${block.id}`]: e.target.checked
                          }))
                        }
                        className="rounded border-default accent-brand"
                      />
                      Vi har gått igenom videon
                    </label>
                  </div>
                ) : block.type === 'image' ? (
                  <div className="mt-4 space-y-3">
                    {block.image_url ? (
                      <img
                        src={block.image_url}
                        alt={block.title}
                        className="max-h-96 max-w-full rounded-2xl border border-default object-contain"
                      />
                    ) : null}
                    <textarea
                      value={String(answers[block.id] || '')}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [block.id]: e.target.value }))
                      }
                      rows={3}
                      placeholder="Reflektioner kring bilden (valfritt)…"
                      className={textareaClass}
                    />
                  </div>
                ) : block.type === 'test' ? (
                  <div className="mt-4 space-y-2">
                    {(block.options ?? []).length === 0 ? (
                      <p className="text-sm text-foreground-subtle">Inga svarsalternativ definierade.</p>
                    ) : (
                      (block.options ?? []).map((opt) => {
                        const isMultiple = block.question_type === 'multiple';
                        const currentAnswers = normalizeAnswerArray(answers[block.id]);
                        const isChecked = currentAnswers.includes(opt.id);

                        const handleChange = (checked: boolean) => {
                          if (isMultiple) {
                            setAnswers((prev) => {
                              const prevArr = normalizeAnswerArray(prev[block.id]);
                              return {
                                ...prev,
                                [block.id]: checked
                                  ? [...prevArr, opt.id]
                                  : prevArr.filter((id) => id !== opt.id)
                              };
                            });
                          } else {
                            setAnswers((prev) => ({ ...prev, [block.id]: checked ? opt.id : '' }));
                          }
                        };

                        return (
                          <label
                            key={opt.id}
                            className="flex cursor-pointer items-center gap-3 rounded-xl border border-default p-3 transition hover:bg-canvas-subtle"
                          >
                            <input
                              type={isMultiple ? 'checkbox' : 'radio'}
                              name={`test_${block.id}`}
                              checked={isChecked}
                              onChange={(e) => handleChange(e.target.checked)}
                              className="rounded accent-brand"
                            />
                            <span className="text-sm text-foreground">{opt.text}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                ) : block.type === 'ai_pipeline' ? (
                  (() => {
                    const outputKey = block.pipeline_output_key ?? `pipeline_${block.id}`;
                    const existingOutput = pipelineOutputs[outputKey] ?? String(artifacts[outputKey] ?? '');
                    const isLocked =
                      block.pipeline_requires_key
                        ? !Boolean(
                            pipelineOutputs[block.pipeline_requires_key] ||
                              artifacts[block.pipeline_requires_key]
                          )
                        : false;
                    const isPending = pendingPipelineBlockId === block.id;
                    return (
                      <div className="mt-4 space-y-3">
                        {isLocked ? (
                          <div className="rounded-2xl border border-default bg-canvas-subtle/60 px-4 py-3">
                            <p className="text-sm text-foreground-subtle">
                              🔒 Slutför föregående analys-steg för att låsa upp detta block.
                            </p>
                          </div>
                        ) : existingOutput ? (
                          <>
                            <div className="rounded-2xl border border-movexum-bla/30 bg-movexum-pastell-bla p-5 dark:border-movexum-djupbla/50 dark:bg-movexum-morkbla/20">
                              <p className="mb-2 text-xs font-medium text-movexum-morkbla dark:text-movexum-pastell-bla">
                                Genererat av AI – verifiera innan delning
                              </p>
                              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-foreground-muted">
                                {existingOutput}
                              </pre>
                            </div>
                            {!isDone && (
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => runPipeline(block.id, outputKey)}
                                className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-4 py-2 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isPending ? 'Analyserar…' : 'Kör om analys'}
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={isPending || isDone}
                            onClick={() => runPipeline(block.id, outputKey)}
                            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isPending ? 'Analyserar…' : `Kör ${block.title}`}
                          </button>
                        )}
                      </div>
                    );
                  })()
                ) : block.type === 'ai_chat' ? (
                  <div className="mt-4 space-y-3">
                    <textarea
                      value={aiQuestions[block.id] ?? ''}
                      onChange={(e) =>
                        setAiQuestions((prev) => ({ ...prev, [block.id]: e.target.value }))
                      }
                      rows={3}
                      placeholder="Ställ en fråga till workshopens AI-coach…"
                      className={textareaClass}
                    />
                    <button
                      type="button"
                      disabled={pendingAi || (aiQuestions[block.id] ?? '').trim().length === 0}
                      onClick={() => {
                        const question = aiQuestions[block.id] ?? '';
                        setError(null);
                        setMessage(null);
                        startAi(async () => {
                          const result = preview
                            ? await previewWorkshopAiChatAction(
                                String(assignment.workshop),
                                question,
                                answers
                              )
                            : await runWorkshopAiChatAction(assignment.id, question);
                          if (result.error) {
                            setError(result.error);
                            return;
                          }
                          setAiAnswers((prev) => ({ ...prev, [block.id]: result.answer ?? '' }));
                          setAiThreadCount((prev) => prev + 1);
                          if (preview) {
                            setPreviewThread((prev) => [
                              ...prev,
                              { question, answer: result.answer ?? '' }
                            ]);
                          }
                          setAnswers((prev) => ({
                            ...prev,
                            [`${block.id}__ai_done`]: 'done'
                          }));
                          setMessage(
                            preview
                              ? 'AI-svar genererat (testläge — inget sparas).'
                              : 'AI-svar sparat på workshopen.'
                          );
                          setAiQuestions((prev) => ({ ...prev, [block.id]: '' }));
                        });
                      }}
                      className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pendingAi ? 'Skickar…' : 'Fråga AI'}
                    </button>
                    {aiAnswers[block.id] ? (
                      <div className="rounded-2xl border border-default bg-canvas-subtle/50 p-4">
                        <p className="mb-1 text-xs font-medium text-foreground-subtle">Senaste AI-svar</p>
                        <pre className="whitespace-pre-wrap text-sm text-foreground-muted">
                          {aiAnswers[block.id]}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                ) : block.type === 'coach_review' ? (
                  // Generic coach review block: works for ANY workshop
                  <div className="mt-4 space-y-4">
                    {isCommitted ? (
                      <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-sm font-medium text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                        ✓ Committad.{' '}
                        {documentUrl ? (
                          <a href={documentUrl} className="font-semibold underline">
                            Visa dokument →
                          </a>
                        ) : (
                          <span>(testläge — inget dokument skapades)</span>
                        )}
                      </p>
                    ) : coachDecision === 'approved' ? (
                      <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-sm text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                        ✓ Godkänt av coach. Gå vidare och commita.
                      </p>
                    ) : coachDecision === 'returned' ? (
                      <div className="space-y-2">
                        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
                          ↩ Returnerad av coach – revidera och skicka på nytt.
                        </p>
                        {artifacts.coach_notes ? (
                          <div className="rounded-2xl border border-default bg-canvas-subtle/60 p-4">
                            <p className="mb-1 text-xs font-medium text-foreground-subtle">Coach-anteckningar</p>
                            <p className="text-sm text-foreground-muted">{String(artifacts.coach_notes)}</p>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          disabled={pendingCoach || isDone}
                          onClick={() => {
                            if (preview) {
                              setCoachReviewSubmitted(true);
                              setCoachDecision(null);
                              setMessage('Testläge: skickad till coach igen (inget sparas).');
                              return;
                            }
                            startCoach(async () => {
                              const res = await submitForCoachReviewAction(assignment.id);
                              if (res.error) { setError(res.error); return; }
                              setCoachReviewSubmitted(true);
                              setCoachDecision(null);
                              setMessage('Skickat till coach igen.');
                            });
                          }}
                          className="inline-flex items-center rounded-full border border-default bg-surface px-4 py-2 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-50"
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
                        disabled={pendingCoach || isDone}
                        onClick={() => {
                          if (preview) {
                            setCoachReviewSubmitted(true);
                            setMessage(
                              'Testläge: markerad som skickad till coach (inget sparas). Testa coach-granskningen nedan.'
                            );
                            return;
                          }
                          startCoach(async () => {
                            const res = await submitForCoachReviewAction(assignment.id);
                            if (res.error) { setError(res.error); return; }
                            setCoachReviewSubmitted(true);
                            setMessage('Skickat till coach för granskning.');
                          });
                        }}
                        className="inline-flex items-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
                      >
                        {pendingCoach ? 'Skickar…' : 'Skicka till coach för granskning'}
                      </button>
                    )}

                    {/* Staff coach review form */}
                    {isStaff && coachReviewSubmitted && !isCommitted && (
                      <div className="mt-4 space-y-3 rounded-2xl border border-movexum-lila/30 bg-movexum-pastell-lila/40 p-4 dark:border-movexum-morklila/30 dark:bg-movexum-morklila/10">
                        <p className="text-xs font-semibold uppercase tracking-wide text-movexum-lila dark:text-movexum-ljuslila">
                          🎓 Coach-granskning
                        </p>
                        <textarea
                          value={coachNotesInput}
                          onChange={(e) => setCoachNotesInput(e.target.value)}
                          rows={4}
                          placeholder="Kommentar till bolaget (visas vid godkännande och returnering)…"
                          className={textareaClass}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={pendingCoach}
                            onClick={() => {
                              if (preview) {
                                if (coachNotesInput.trim()) {
                                  setArtifacts((prev) => ({ ...prev, coach_notes: coachNotesInput }));
                                }
                                setCoachDecision('approved');
                                setMessage('Testläge: godkänd av coach (inget sparas).');
                                return;
                              }
                              startCoach(async () => {
                                const res = await coachReviewDecisionAction(assignment.id, 'approved', coachNotesInput);
                                if (res.error) { setError(res.error); return; }
                                setCoachDecision('approved');
                                setMessage('Strategi godkänd.');
                              });
                            }}
                            className="inline-flex items-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
                          >
                            {pendingCoach ? '…' : '✓ Godkänn'}
                          </button>
                          <button
                            type="button"
                            disabled={pendingCoach}
                            onClick={() => {
                              if (preview) {
                                if (coachNotesInput.trim()) {
                                  setArtifacts((prev) => ({ ...prev, coach_notes: coachNotesInput }));
                                }
                                setCoachDecision('returned');
                                setMessage('Testläge: returnerad för revidering (inget sparas).');
                                return;
                              }
                              startCoach(async () => {
                                const res = await coachReviewDecisionAction(assignment.id, 'returned', coachNotesInput);
                                if (res.error) { setError(res.error); return; }
                                setCoachDecision('returned');
                                setMessage('Returnerad för revidering.');
                              });
                            }}
                            className="inline-flex items-center rounded-full border border-default bg-surface px-4 py-2 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-50"
                          >
                            {pendingCoach ? '…' : '↩ Returnera'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                ) : block.type === 'commit_document' ? (
                  // Generic commit block: locks workshop into a committed living document
                  <div className="mt-4 space-y-3">
                    {isCommitted ? (
                      <div className="space-y-3">
                        <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-sm font-medium text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                          ✓ Committad – levande dokument skapat.
                        </p>
                        {documentUrl ? (
                          <a
                            href={documentUrl}
                            className="inline-flex items-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
                          >
                            Öppna dokument →
                          </a>
                        ) : (
                          <p className="text-xs text-foreground-subtle">
                            Testläge — i skarpt läge skapas här ett levande dokument på bolagskortet.
                          </p>
                        )}
                      </div>
                    ) : coachDecision !== 'approved' ? (
                      <div className="rounded-2xl border border-default bg-canvas-subtle/60 px-4 py-3">
                        <p className="text-sm text-foreground-subtle">
                          🔒 Coach måste granska och godkänna (steg ovan) innan commit.
                        </p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={pendingCommit || isDone}
                        onClick={() => {
                          if (preview) {
                            setPreviewCommitted(true);
                            setMessage(
                              'Testläge: committad (inget sparas). I skarpt läge skapas nu det levande dokumentet på bolagskortet.'
                            );
                            return;
                          }
                          startCommit(async () => {
                            const res = await commitWorkshopDocumentAction(assignment.id);
                            if (res.error) { setError(res.error); return; }
                            setDocumentUrl(res.documentUrl ?? `/education/assignments/${assignment.id}`);
                            setMessage('Committad! Levande dokument skapat.');
                          });
                        }}
                        className="inline-flex items-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
                      >
                        {pendingCommit ? 'Skapar dokument…' : '📌 Förbind er till detta dokument'}
                      </button>
                    )}
                  </div>

                ) : (
                  // exercise, question, summary – free text
                  <textarea
                    value={String(answers[block.id] || '')}
                    onChange={(e) =>
                      setAnswers((prev) => ({ ...prev, [block.id]: e.target.value }))
                    }
                    rows={5}
                    placeholder="Skriv ert svar här…"
                    className={textareaClass}
                  />
                )}
              </section>
            ))}
          </div>
        </section>
      ))}

      {/* Actions */}
      {!isDone && (
        <div className="flex flex-wrap gap-3">
          {!preview && (
            <button
              type="button"
              disabled={pendingSave}
              onClick={() => {
                setError(null);
                setMessage(null);
                startSave(async () => {
                  const result = await saveProgress();
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  setMessage('Progression sparad.');
                });
              }}
              className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-5 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingSave ? 'Sparar…' : 'Spara progression'}
            </button>
          )}
          <button
            type="button"
            disabled={pendingComplete || !completedRequired}
            onClick={() => {
              setError(null);
              setMessage(null);
              startComplete(async () => {
                if (preview) {
                  const result = await previewWorkshopReportAction(
                    String(assignment.workshop),
                    answers,
                    previewThread
                  );
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  if (result.reportMd) setGeneratedReport(result.reportMd);
                  setMessage(
                    'Testrapport genererad (inget sparas). I skarpt läge sparas rapporten på bolagskortet.'
                  );
                  return;
                }
                const saveResult = await saveProgress();
                if (saveResult.error) {
                  setError(saveResult.error);
                  return;
                }
                const result = await completeWorkshopAction(assignment.id);
                if (result.error) {
                  setError(result.error);
                  return;
                }
                if (result.reportMd) setGeneratedReport(result.reportMd);
                setMessage(
                  'Workshopen är slutförd! En rapport har genererats och sparats på bolagskortet.'
                );
              });
            }}
            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingComplete
              ? 'Genererar rapport…'
              : preview
                ? 'Testa slutförande & rapport'
                : 'Slutför & generera rapport'}
          </button>
        </div>
      )}

      {error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl bg-movexum-pastell-gron px-3 py-2 text-sm text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
          {message}
        </p>
      ) : null}

      {/* Generated report */}
      {generatedReport ? (
        <section className="rounded-3xl border border-movexum-bla/30 bg-movexum-pastell-bla p-6 dark:border-movexum-djupbla/50 dark:bg-movexum-morkbla/20">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-foreground">📄 Workshoprapport</h2>
            <span className="text-xs text-foreground-subtle">Genererat av AI – verifiera innan delning</span>
          </div>
          <pre className="whitespace-pre-wrap text-sm text-foreground-muted leading-relaxed">
            {generatedReport}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
