'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  completeWorkshopAction,
  runWorkshopAiChatAction,
  saveWorkshopProgressAction
} from '@/lib/actions/workshops';
import type { WorkshopAssignment, WorkshopBlock } from '@platform/shared';

interface WorkshopRunnerProps {
  assignment: WorkshopAssignment;
  blocks: WorkshopBlock[];
}

export function WorkshopRunner({ assignment, blocks }: WorkshopRunnerProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(
    (assignment.answers_json as Record<string, unknown>) || {}
  );
  const [artifacts, setArtifacts] = useState<Record<string, unknown>>(
    (assignment.artifacts_json as Record<string, unknown>) || {}
  );
  const [summary, setSummary] = useState(
    String((assignment.takeaway_json as Record<string, unknown> | undefined)?.summary || '')
  );
  const [keyInsights, setKeyInsights] = useState(
    String((assignment.takeaway_json as Record<string, unknown> | undefined)?.keyInsights || '')
  );
  const [prioritizedActions, setPrioritizedActions] = useState(
    String((assignment.takeaway_json as Record<string, unknown> | undefined)?.prioritizedActions || '')
  );
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, startSave] = useTransition();
  const [pendingAi, startAi] = useTransition();
  const [pendingComplete, startComplete] = useTransition();

  const completedRequired = useMemo(() => {
    const requiredBlocks = blocks.filter((block) => block.required);
    if (requiredBlocks.length === 0) return true;
    return requiredBlocks.every((block) => {
      if (block.type === 'video') {
        return artifacts[`video_ack_${block.id}`] === true;
      }
      const value = answers[block.id];
      return typeof value === 'string' && value.trim().length > 0;
    });
  }, [answers, artifacts, blocks]);

  const remainingCount = useMemo(
    () =>
      blocks.filter((block) => {
        if (block.type === 'video') return artifacts[`video_ack_${block.id}`] !== true;
        const value = answers[block.id];
        return !(typeof value === 'string' && value.trim().length > 0);
      }).length,
    [answers, artifacts, blocks]
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4 text-sm text-foreground-muted">
        Status: <span className="font-semibold text-foreground">{assignment.status}</span> · Återstående
        moment: <span className="font-semibold text-foreground">{remainingCount}</span>
      </div>

      {blocks.map((block, index) => (
        <section key={block.id} className="rounded-3xl border border-default bg-surface p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-canvas-subtle px-2 py-0.5 text-xs font-medium text-foreground-muted">
              Moment {index + 1}
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
            <p className="mt-1 text-sm text-foreground-muted">{block.instructions}</p>
          ) : null}

          {block.type === 'video' ? (
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
          ) : block.type === 'ai_chat' ? (
            <div className="mt-4 space-y-3">
              <textarea
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                rows={3}
                placeholder="Ställ en fråga till workshopens AI-coach…"
                className="w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
              />
              <button
                type="button"
                disabled={pendingAi || aiQuestion.trim().length === 0}
                onClick={() => {
                  setError(null);
                  setMessage(null);
                  startAi(async () => {
                    const result = await runWorkshopAiChatAction(assignment.id, aiQuestion);
                    if (result.error) {
                      setError(result.error);
                      return;
                    }
                    setAiAnswer(result.answer || '');
                    setMessage('AI-svar sparat på workshopen.');
                    setAiQuestion('');
                  });
                }}
                className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAi ? 'Skickar…' : 'Fråga AI'}
              </button>
              {aiAnswer ? (
                <div className="rounded-2xl border border-default bg-canvas-subtle/50 p-4">
                  <p className="mb-1 text-xs font-medium text-foreground-subtle">Senaste AI-svar</p>
                  <pre className="whitespace-pre-wrap text-sm text-foreground-muted">{aiAnswer}</pre>
                </div>
              ) : null}
            </div>
          ) : (
            <textarea
              value={String(answers[block.id] || '')}
              onChange={(e) =>
                setAnswers((prev) => ({
                  ...prev,
                  [block.id]: e.target.value
                }))
              }
              rows={5}
              placeholder="Skriv ert svar här…"
              className="mt-4 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
            />
          )}
        </section>
      ))}

      <section className="rounded-3xl border border-default bg-surface p-5">
        <h3 className="text-base font-semibold text-foreground">Takeaway till bolagskortet</h3>
        <p className="mt-1 text-sm text-foreground-muted">
          Denna information visas på startupens bolagskort när workshopen är slutförd.
        </p>
        <div className="mt-4 space-y-3">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            placeholder="Kort sammanfattning"
            className="w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
          />
          <textarea
            value={keyInsights}
            onChange={(e) => setKeyInsights(e.target.value)}
            rows={4}
            placeholder="Nyckelinsikter"
            className="w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
          />
          <textarea
            value={prioritizedActions}
            onChange={(e) => setPrioritizedActions(e.target.value)}
            rows={4}
            placeholder="Prioriterade actions"
            className="w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
          />
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pendingSave}
          onClick={() => {
            setError(null);
            setMessage(null);
            startSave(async () => {
              const progress = {
                completedRequired,
                remainingCount,
                updatedAt: new Date().toISOString()
              };
              const result = await saveWorkshopProgressAction(assignment.id, {
                progress,
                answers,
                artifacts
              });
              if (result.error) {
                setError(result.error);
                return;
              }
              setMessage('Progress sparad.');
            });
          }}
          className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-5 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingSave ? 'Sparar…' : 'Spara progression'}
        </button>
        <button
          type="button"
          disabled={pendingComplete || !completedRequired || summary.trim().length === 0}
          onClick={() => {
            setError(null);
            setMessage(null);
            startComplete(async () => {
              const saveResult = await saveWorkshopProgressAction(assignment.id, {
                progress: {
                  completedRequired,
                  remainingCount,
                  updatedAt: new Date().toISOString()
                },
                answers,
                artifacts
              });
              if (saveResult.error) {
                setError(saveResult.error);
                return;
              }
              const result = await completeWorkshopAction(assignment.id, {
                summary,
                keyInsights,
                prioritizedActions
              });
              if (result.error) {
                setError(result.error);
                return;
              }
              setMessage('Workshopen är slutförd och takeaway är sparad på bolagskortet.');
            });
          }}
          className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingComplete ? 'Slutför…' : 'Markera som klar'}
        </button>
      </div>

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
    </div>
  );
}
