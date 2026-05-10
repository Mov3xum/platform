'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  completeWorkshopAction,
  runWorkshopAiChatAction,
  saveWorkshopProgressAction
} from '@/lib/actions/workshops';
import type { WorkshopAssignment, WorkshopModule } from '@platform/shared';

interface WorkshopRunnerProps {
  assignment: WorkshopAssignment;
  modules: WorkshopModule[];
}

export function WorkshopRunner({ assignment, modules }: WorkshopRunnerProps) {
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

  const allBlocks = useMemo(() => modules.flatMap((m) => m.blocks), [modules]);

  const completedRequired = useMemo(() => {
    const requiredBlocks = allBlocks.filter((block) => block.required);
    if (requiredBlocks.length === 0) return true;
    return requiredBlocks.every((block) => {
      if (block.type === 'video') return artifacts[`video_ack_${block.id}`] === true;
      if (block.type === 'instruction') return artifacts[`ack_${block.id}`] === true;
      if (block.type === 'ai_chat') {
        return aiThreadCount > 0 || Boolean(answers[`${block.id}__ai_done`]);
      }
      if (block.type === 'test') {
        const val = answers[block.id];
        return Array.isArray(val) ? val.length > 0 : (typeof val === 'string' && val.length > 0);
      }
      const value = answers[block.id];
      return typeof value === 'string' && value.trim().length > 0;
    });
  }, [answers, artifacts, allBlocks, aiThreadCount]);

  const remainingCount = useMemo(
    () =>
      allBlocks.filter((block) => {
        if (!block.required) return false;
        if (block.type === 'video') return artifacts[`video_ack_${block.id}`] !== true;
        if (block.type === 'instruction') return artifacts[`ack_${block.id}`] !== true;
        if (block.type === 'ai_chat') {
          return !(aiThreadCount > 0 || Boolean(answers[`${block.id}__ai_done`]));
        }
        if (block.type === 'test') {
          const val = answers[block.id];
          return Array.isArray(val) ? val.length === 0 : !(typeof val === 'string' && val.length > 0);
        }
        const value = answers[block.id];
        return !(typeof value === 'string' && value.trim().length > 0);
      }).length,
    [answers, artifacts, allBlocks, aiThreadCount]
  );

  const saveProgress = async () => {
    const progress = {
      completedRequired,
      remainingCount,
      updatedAt: new Date().toISOString()
    };
    return saveWorkshopProgressAction(assignment.id, { progress, answers, artifacts });
  };

  const textareaClass =
    'mt-3 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  const isDone = assignment.status === 'done';

  return (
    <div className="space-y-8">
      {/* Status bar */}
      <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4 text-sm text-foreground-muted">
        Status: <span className="font-semibold text-foreground">{assignment.status}</span>
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
                      <a
                        href={block.video_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-sm font-medium text-link hover:underline"
                      >
                        Öppna video →
                      </a>
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
                        const currentAnswers = Array.isArray(answers[block.id])
                          ? (answers[block.id] as string[])
                          : answers[block.id]
                            ? [String(answers[block.id])]
                            : [];
                        const isChecked = currentAnswers.includes(opt.id);

                        const handleChange = (checked: boolean) => {
                          if (isMultiple) {
                            setAnswers((prev) => {
                              const prev_arr = Array.isArray(prev[block.id])
                                ? (prev[block.id] as string[])
                                : prev[block.id] ? [String(prev[block.id])] : [];
                              return {
                                ...prev,
                                [block.id]: checked
                                  ? [...prev_arr, opt.id]
                                  : prev_arr.filter((id) => id !== opt.id)
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
                          const result = await runWorkshopAiChatAction(assignment.id, question);
                          if (result.error) {
                            setError(result.error);
                            return;
                          }
                          setAiAnswers((prev) => ({ ...prev, [block.id]: result.answer ?? '' }));
                          setAiThreadCount((prev) => prev + 1);
                          setAnswers((prev) => ({
                            ...prev,
                            [`${block.id}__ai_done`]: 'done'
                          }));
                          setMessage('AI-svar sparat på workshopen.');
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
          <button
            type="button"
            disabled={pendingComplete || !completedRequired}
            onClick={() => {
              setError(null);
              setMessage(null);
              startComplete(async () => {
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
            {pendingComplete ? 'Genererar rapport…' : 'Slutför & generera rapport'}
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

