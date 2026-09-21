'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveOnboardingProgressAction,
  completeOnboardingAction
} from '@/lib/actions/onboarding';
import {
  flattenOnboardingBlocks,
  onboardingRemainingRequired,
  onboardingProgressPct,
  type OnboardingModule
} from '@platform/shared';

interface OnboardingRunnerProps {
  flowId: string;
  startupId: string;
  modules: OnboardingModule[];
  initialAnswers?: Record<string, unknown>;
  initialStatus?: 'in_progress' | 'completed';
  /** Staff-förhandsgranskning: interaktivt men inga skrivningar. */
  preview?: boolean;
}

function answerArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value) return [value];
  return [];
}

export function OnboardingRunner({
  flowId,
  startupId,
  modules,
  initialAnswers,
  initialStatus,
  preview = false
}: OnboardingRunnerProps) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialAnswers || {});
  const [completed, setCompleted] = useState(initialStatus === 'completed');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, startSave] = useTransition();
  const [pendingComplete, startComplete] = useTransition();

  const allBlocks = useMemo(() => flattenOnboardingBlocks(modules), [modules]);
  const remaining = useMemo(() => onboardingRemainingRequired(modules, answers), [modules, answers]);
  const pct = useMemo(() => onboardingProgressPct(modules, answers), [modules, answers]);

  const textareaClass =
    'mt-3 w-full rounded-2xl border border-default bg-surface px-4 py-2.5 text-sm text-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  // Preview är fullt interaktivt (staff testar flödet som ett bolag) — bara en
  // slutförd körning låser fälten. Inga svar sparas i preview: spara-/slutför-
  // knapparna renderas inte alls (se Actions nedan).
  const locked = completed;

  return (
    <div className="space-y-8">
      {/* Progress */}
      <div className="rounded-2xl border border-default bg-canvas-subtle/40 p-4">
        <div className="mb-2 flex items-center justify-between text-sm text-foreground-muted">
          <span>
            {completed ? (
              <span className="font-semibold text-movexum-morkgron dark:text-movexum-gron">
                ✓ Onboarding slutförd
              </span>
            ) : (
              <>
                Obligatoriska moment kvar:{' '}
                <span className="font-semibold text-foreground">{remaining}</span>
              </>
            )}
          </span>
          <span className="font-semibold text-foreground">{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-canvas-muted">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {preview ? (
        <p className="rounded-xl bg-movexum-pastell-gul px-3 py-2 text-sm text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
          Förhandsgranskning/testläge — testa flödet fritt, precis som ett bolag ser det. Inga svar
          sparas.
        </p>
      ) : null}

      {allBlocks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">
          Den här onboardingen har inga moduler ännu.
        </p>
      ) : null}

      {/* Modules */}
      {modules.map((mod, modIdx) => (
        <section key={mod.id}>
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
              <section key={block.id} className="rounded-3xl border border-default bg-surface p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex rounded-full bg-canvas-subtle px-2 py-0.5 text-xs font-medium text-foreground-muted">
                    {modIdx + 1}.{blockIdx + 1}
                  </span>
                  {block.required ? (
                    <span className="inline-flex rounded-full bg-movexum-pastell-gul px-2 py-0.5 text-xs font-medium text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
                      Obligatorisk
                    </span>
                  ) : null}
                </div>

                <h3 className="text-base font-semibold text-foreground">{block.title}</h3>
                {block.body ? (
                  <p className="mt-1 whitespace-pre-line text-sm text-foreground-muted">{block.body}</p>
                ) : null}

                {/* Renderers per block type */}
                {block.type === 'video' ? (
                  <div className="mt-4 space-y-3">
                    {block.video_url ? (
                      <video controls src={block.video_url} className="max-h-96 w-full rounded-2xl border border-default" />
                    ) : null}
                    <label className="flex items-center gap-2 text-sm text-foreground-muted">
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={answers[block.id] === true}
                        onChange={(e) => setAnswers((p) => ({ ...p, [block.id]: e.target.checked }))}
                        className="rounded border-default accent-brand"
                      />
                      Vi har sett filmen
                    </label>
                  </div>
                ) : block.type === 'image' ? (
                  <div className="mt-4 space-y-3">
                    {block.image_url ? (
                      <img src={block.image_url} alt={block.title} className="max-h-96 max-w-full rounded-2xl border border-default object-contain" />
                    ) : null}
                    {block.required ? (
                      <label className="flex items-center gap-2 text-sm text-foreground-muted">
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={answers[block.id] === true}
                          onChange={(e) => setAnswers((p) => ({ ...p, [block.id]: e.target.checked }))}
                          className="rounded border-default accent-brand"
                        />
                        Vi har tagit del av detta
                      </label>
                    ) : null}
                  </div>
                ) : block.type === 'text' ? (
                  block.required ? (
                    <label className="mt-4 flex items-center gap-2 text-sm text-foreground-muted">
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={answers[block.id] === true}
                        onChange={(e) => setAnswers((p) => ({ ...p, [block.id]: e.target.checked }))}
                        className="rounded border-default accent-brand"
                      />
                      Jag har läst och förstått detta
                    </label>
                  ) : null
                ) : block.type === 'acknowledge' ? (
                  <label className="mt-4 flex items-center gap-2 text-sm text-foreground-muted">
                    <input
                      type="checkbox"
                      disabled={locked}
                      checked={answers[block.id] === true}
                      onChange={(e) => setAnswers((p) => ({ ...p, [block.id]: e.target.checked }))}
                      className="rounded border-default accent-brand"
                    />
                    Jag bekräftar att jag har läst och förstått detta
                  </label>
                ) : block.type === 'question' ? (
                  <textarea
                    value={String(answers[block.id] || '')}
                    disabled={locked}
                    onChange={(e) => setAnswers((p) => ({ ...p, [block.id]: e.target.value }))}
                    rows={4}
                    placeholder="Skriv ert svar här…"
                    className={textareaClass}
                  />
                ) : block.type === 'quiz' ? (
                  <div className="mt-4 space-y-2">
                    {(block.options ?? []).length === 0 ? (
                      <p className="text-sm text-foreground-subtle">Inga svarsalternativ definierade.</p>
                    ) : (
                      (block.options ?? []).map((opt) => {
                        const isMultiple = block.question_type === 'multiple';
                        const current = answerArray(answers[block.id]);
                        const isChecked = current.includes(opt.id);
                        const handleChange = (checked: boolean) => {
                          if (isMultiple) {
                            setAnswers((p) => {
                              const arr = answerArray(p[block.id]);
                              return {
                                ...p,
                                [block.id]: checked ? [...arr, opt.id] : arr.filter((id) => id !== opt.id)
                              };
                            });
                          } else {
                            setAnswers((p) => ({ ...p, [block.id]: checked ? opt.id : '' }));
                          }
                        };
                        return (
                          <label
                            key={opt.id}
                            className="flex cursor-pointer items-center gap-3 rounded-xl border border-default p-3 transition hover:bg-canvas-subtle"
                          >
                            <input
                              type={isMultiple ? 'checkbox' : 'radio'}
                              name={`quiz_${block.id}`}
                              disabled={locked}
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
                ) : null}
              </section>
            ))}
          </div>
        </section>
      ))}

      {/* Actions */}
      {!preview && !completed ? (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={pendingSave}
            onClick={() => {
              setError(null);
              setMessage(null);
              startSave(async () => {
                const res = await saveOnboardingProgressAction(flowId, startupId, { answers });
                if (res.error) {
                  setError(res.error);
                  return;
                }
                setMessage('Framsteg sparat.');
              });
            }}
            className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-5 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingSave ? 'Sparar…' : 'Spara framsteg'}
          </button>
          <button
            type="button"
            disabled={pendingComplete || remaining > 0}
            onClick={() => {
              setError(null);
              setMessage(null);
              startComplete(async () => {
                const res = await completeOnboardingAction(flowId, startupId, { answers });
                if (res.error) {
                  setError(res.error);
                  return;
                }
                setCompleted(true);
                setMessage('Onboardingen är slutförd!');
                router.refresh();
              });
            }}
            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pendingComplete ? 'Slutför…' : 'Slutför onboarding'}
          </button>
        </div>
      ) : null}

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
