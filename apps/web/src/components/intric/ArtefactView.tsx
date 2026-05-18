'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto/Icon';
import {
  approveRunAction,
  requestChangesAction,
  startRunAction,
  submitForReviewAction,
  addThreadCommentAction
} from '@/lib/actions/tools';
import type { ToolRunStatus, ToolRunThreadEntry } from '@platform/shared';
import {
  ASSIGN_STATUS,
  daysUntil,
  formatDeadline,
  formatRelativeDate,
  statusFor
} from './constants';

export interface ArtefactRun {
  id: string;
  status: ToolRunStatus;
  toolId: string;
  toolName: string;
  toolCategory?: string;
  output_md?: string;
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_estimate_usd?: number;
  deadline?: string;
  instruction?: string;
  assignedByName?: string;
  assignedToName?: string;
  version: number;
  parentRunId?: string;
  thread: ToolRunThreadEntry[];
  threadDisplay: Array<ToolRunThreadEntry & { displayName: string }>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface Props {
  run: ArtefactRun;
  startupId: string;
  startupName: string;
  perspective: 'coach' | 'founder';
  versions: Array<{ id: string; version: number; status: ToolRunStatus }>;
}

export function ArtefactView({
  run,
  startupId,
  startupName,
  perspective,
  versions
}: Props) {
  const router = useRouter();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showChangesBox, setShowChangesBox] = useState(false);

  const days = daysUntil(run.deadline);
  const overdue = days !== null && days < 0 && run.status !== 'approved';
  const s = statusFor(run.status, overdue);

  const canFounder = perspective === 'founder';
  const canCoach = perspective === 'coach';

  function action(name: 'run' | 'submit' | 'approve' | 'request_changes' | 'comment') {
    setError(null);
    startTransition(async () => {
      let result;
      if (name === 'run') result = await startRunAction(run.id);
      else if (name === 'submit') result = await submitForReviewAction(run.id);
      else if (name === 'approve') result = await approveRunAction(run.id);
      else if (name === 'request_changes')
        result = await requestChangesAction(run.id, comment.trim() || 'Begär ändring');
      else result = await addThreadCommentAction(run.id, comment.trim());

      if (result.error) {
        setError(result.error);
        return;
      }
      if (name === 'request_changes' && result.runId) {
        router.push(`/startups/${startupId}/verktyg/${result.runId}`);
        return;
      }
      setComment('');
      setShowChangesBox(false);
      router.refresh();
    });
  }

  const hasOutput = Boolean(run.output_md && run.output_md.trim().length > 0);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      {/* Top toolbar */}
      <div className="flex items-center gap-3 border-b border-default px-5 py-3 lg:px-8">
        <Link
          href={`/startups/${startupId}/verktyg`}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] text-foreground-muted hover:bg-canvas-muted"
        >
          <Icon name="back" size={14} /> Tillbaka
        </Link>
        <div className="hidden items-center gap-1.5 font-mono text-[11px] text-foreground-subtle md:flex">
          <span>{startupName}</span>
          <Icon name="chevron" size={11} />
          <span>Verktyg</span>
          <Icon name="chevron" size={11} />
          <span className="text-foreground">{run.toolName}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {versions.length > 1 && (
            <div className="flex items-center gap-1 rounded-lg border border-default px-2 py-1">
              {versions.map((v) => (
                <Link
                  key={v.id}
                  href={`/startups/${startupId}/verktyg/${v.id}`}
                  className={`rounded-md px-2 py-0.5 font-mono text-[11px] ${v.id === run.id ? 'bg-brand text-brand-foreground' : 'text-foreground-muted hover:bg-canvas-muted'}`}
                  title={`v${v.version} · ${v.status}`}
                >
                  v{v.version}
                </Link>
              ))}
            </div>
          )}
          <span
            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-medium ${s.bgClass} ${s.fgClass}`}
          >
            <Icon name={s.iconName} size={10} /> {s.label}
          </span>
        </div>
      </div>

      {/* Title strip */}
      <div className="flex flex-wrap items-start gap-4 border-b border-default px-5 py-4 lg:px-8">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-movexum-pastell-lila text-movexum-lila">
          <Icon name="sparkle" size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-[20px] font-semibold tracking-tight">{run.toolName}</h1>
            {run.toolCategory && (
              <span className="rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10.5px] font-medium text-foreground-muted">
                {run.toolCategory}
              </span>
            )}
            <span className="rounded-md bg-canvas-muted px-1.5 py-0.5 font-mono text-[10.5px] text-foreground-muted">
              v{run.version}
            </span>
          </div>
          {run.instruction && (
            <p
              className="mt-1 max-w-[80ch] text-[12.5px] leading-relaxed text-foreground-muted"
              dangerouslySetInnerHTML={{
                __html: run.instruction.replace(/<script[\s\S]*?<\/script>/gi, '')
              }}
            />
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-subtle">
            {run.assignedByName && run.assignedToName && (
              <span className="inline-flex items-center gap-1">
                <Icon name="people" size={11} /> {run.assignedByName} → {run.assignedToName}
              </span>
            )}
            {run.deadline && (
              <span
                className={`inline-flex items-center gap-1 ${overdue ? 'font-medium text-movexum-orange' : ''}`}
              >
                <Icon name="calendar" size={11} /> deadline {formatDeadline(run.deadline)}
                {overdue
                  ? ' (försenad)'
                  : days !== null && days >= 0
                    ? ` · om ${days} dgr`
                    : ''}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Icon name="clock" size={11} /> tilldelad {formatRelativeDate(run.createdAt)}
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-6 lg:grid-cols-[1fr_320px] lg:px-8">
          {/* Content */}
          <div className="min-w-0">
            {!hasOutput ? (
              <div className="rounded-2xl border border-dashed border-default p-10 text-center">
                <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-canvas-muted text-foreground-subtle">
                  <Icon name="sparkle" size={20} />
                </div>
                <h3 className="mb-1 font-heading text-[16px] font-semibold">Inget utkast ännu</h3>
                <p className="mx-auto max-w-[40ch] text-[13px] text-foreground-subtle">
                  {canFounder
                    ? `Kör verktyget för att låta Mistral generera ett första utkast baserat på ${startupName}s kunskap.`
                    : `${run.assignedToName || 'Foundern'} har inte kört verktyget ännu. Du kan påminna dem eller köra själv.`}
                </p>
                <button
                  type="button"
                  onClick={() => action('run')}
                  disabled={isPending}
                  className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-[12.5px] font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <Icon name="sparkle" size={13} />
                  {isPending ? 'Kör…' : 'Kör verktyget nu'}
                </button>
              </div>
            ) : (
              <article className="prose prose-sm max-w-[68ch]">
                <div
                  className="rounded-2xl border border-default bg-surface p-6 text-[14px] leading-relaxed text-foreground"
                  dangerouslySetInnerHTML={{
                    __html: markdownToHtml(run.output_md || '')
                  }}
                />
              </article>
            )}

            {error && (
              <div className="mt-4 rounded-lg bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange">
                {error}
              </div>
            )}
          </div>

          {/* Side panel */}
          <aside className="space-y-5">
            {hasOutput && (
              <section>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  Modell
                </div>
                <div className="space-y-1 rounded-xl border border-default bg-canvas-subtle p-3 font-mono text-[11px] text-foreground-muted">
                  {run.model && <div>{run.model}</div>}
                  {(run.tokens_in || run.tokens_out) && (
                    <div>
                      {(run.tokens_in || 0) + (run.tokens_out || 0)} tokens · ${(run.cost_estimate_usd || 0).toFixed(2)}
                    </div>
                  )}
                  {run.completedAt && <div>kördes {formatRelativeDate(run.completedAt)}</div>}
                </div>
              </section>
            )}

            <section>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                Tråd{' '}
                <span className="ml-1 font-mono normal-case tracking-normal text-foreground-subtle">
                  {run.threadDisplay.length}
                </span>
              </div>
              {run.threadDisplay.length === 0 ? (
                <div className="rounded-xl border border-dashed border-default px-3 py-4 text-[11px] text-foreground-subtle">
                  Inga kommentarer ännu.
                </div>
              ) : (
                <div className="space-y-3">
                  {run.threadDisplay.map((t, i) => (
                    <div key={i} className="flex gap-2.5">
                      <div
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-heading text-[10px] font-semibold ${t.role === 'coach' ? 'bg-brand text-brand-foreground' : 'bg-movexum-lila text-white'}`}
                      >
                        {(t.displayName || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-heading text-[12px] font-semibold">
                            {t.displayName}
                          </span>
                          <span className="text-[10px] text-foreground-subtle">· {t.role}</span>
                          <span className="ml-auto font-mono text-[10px] text-foreground-subtle">
                            {formatRelativeDate(t.at)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-foreground-muted">
                          {t.text}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Comment input */}
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-default bg-canvas-subtle px-2.5 py-1.5 focus-within:border-brand">
                <Icon name="message" size={13} />
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Lämna en kommentar…"
                  className="flex-1 bg-transparent text-[12px] placeholder:text-foreground-subtle focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => action('comment')}
                  disabled={isPending || !comment.trim()}
                  className="rounded-md px-2 py-0.5 text-[11px] font-medium text-brand hover:bg-canvas-muted disabled:opacity-40"
                >
                  Skicka
                </button>
              </div>
            </section>

            {run.status === 'approved' && (
              <section className="rounded-xl border border-default bg-movexum-pastell-gron/40 p-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-movexum-gron">
                  <Icon name="badge-check" size={13} /> Sparat i {startupName}s kunskap
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-foreground-muted">
                  Artefakten är nu en del av bolagets minne. AI-svar kan referera till den när
                  andra frågor ställs.
                </p>
              </section>
            )}
          </aside>
        </div>
      </div>

      {/* Footer / actions */}
      <div className="flex flex-wrap items-center gap-3 border-t border-default bg-canvas-subtle px-5 py-3 lg:px-8">
        <div className="hidden font-mono text-[11px] text-foreground-subtle md:flex md:items-center md:gap-1.5">
          <Icon name="bot" size={12} />
          {hasOutput && run.model
            ? `${run.model} · v${run.version}`
            : 'Inte kört än'}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {run.status === 'assigned' && canFounder && (
            <button
              type="button"
              onClick={() => action('run')}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Icon name="sparkle" size={13} /> Kör verktyget
            </button>
          )}
          {run.status === 'assigned' && canCoach && (
            <>
              <button
                type="button"
                onClick={() => action('run')}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-[12px] hover:bg-canvas-muted disabled:opacity-50"
              >
                <Icon name="sparkle" size={12} /> Kör själv
              </button>
            </>
          )}
          {run.status === 'in_progress' && canFounder && (
            <>
              <button
                type="button"
                onClick={() => action('run')}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-[12px] hover:bg-canvas-muted disabled:opacity-50"
              >
                <Icon name="rotate-ccw" size={12} /> Kör om
              </button>
              <button
                type="button"
                onClick={() => action('submit')}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
              >
                Skicka för granskning <Icon name="send" size={12} />
              </button>
            </>
          )}
          {run.status === 'in_progress' && canCoach && (
            <span className="text-[12px] text-foreground-subtle">
              {run.assignedToName || 'Foundern'} jobbar — du blir notifierad vid granskning.
            </span>
          )}
          {run.status === 'ready_for_review' && canCoach && (
            <>
              {showChangesBox ? (
                <div className="flex items-center gap-2">
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Vad ska ändras?"
                    className="rounded-lg border border-default bg-surface px-3 py-1.5 text-[12px] outline-none focus:border-brand"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => action('request_changes')}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-[12px] hover:bg-canvas-muted disabled:opacity-50"
                  >
                    <Icon name="edit3" size={12} /> Skicka tillbaka
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowChangesBox(false)}
                    className="rounded-lg px-2 py-1.5 text-[11px] text-foreground-subtle hover:bg-canvas-muted"
                  >
                    Avbryt
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowChangesBox(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-[12px] hover:bg-canvas-muted"
                >
                  <Icon name="edit3" size={12} /> Begär ändring
                </button>
              )}
              <button
                type="button"
                onClick={() => action('approve')}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-movexum-gron px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                <Icon name="check" size={13} /> Godkänn
              </button>
            </>
          )}
          {run.status === 'ready_for_review' && canFounder && (
            <span className="text-[12px] text-foreground-subtle">
              Inskickad till {run.assignedByName || 'coach'}. Du blir notifierad när det är granskat.
            </span>
          )}
          {run.status === 'approved' && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-movexum-gron">
              <Icon name="badge-check" size={13} /> Godkänd och sparad
            </span>
          )}
          {run.status === 'rejected' && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-foreground-muted">
              Begärd ändring — ny version skapad
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Mini markdown → HTML för output_md. Stödjer headers, paragrafer,
 * listor och fet text. Tillräckligt för Mistral-output.
 */
function markdownToHtml(md: string): string {
  // strip HTML tags (defense)
  const clean = md.replace(/<script[\s\S]*?<\/script>/gi, '');

  const lines = clean.split('\n');
  const out: string[] = [];
  let inList = false;

  for (const raw of lines) {
    const l = raw.trim();
    if (!l) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push('');
      continue;
    }
    if (l.startsWith('### ')) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<h3 class="font-heading font-semibold text-[15px] mt-5 mb-2">${escapeHtml(l.slice(4))}</h3>`);
    } else if (l.startsWith('## ')) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<h2 class="font-heading font-semibold text-[17px] mt-6 mb-2 tracking-tight">${escapeHtml(l.slice(3))}</h2>`);
    } else if (l.startsWith('# ')) {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<h1 class="font-heading font-semibold text-[20px] mt-6 mb-3 tracking-tight">${escapeHtml(l.slice(2))}</h1>`);
    } else if (l.startsWith('- ') || l.startsWith('* ')) {
      if (!inList) {
        out.push('<ul class="space-y-1.5 mt-2 mb-3">');
        inList = true;
      }
      out.push(
        `<li class="flex gap-3 text-foreground-muted"><span class="w-1 h-1 rounded-full bg-brand mt-2.5 shrink-0"></span><span>${inlineMd(l.slice(2))}</span></li>`
      );
    } else {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(`<p class="leading-relaxed mb-3 text-foreground-muted">${inlineMd(l)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMd(s: string): string {
  return escapeHtml(s).replace(
    /\*\*(.*?)\*\*/g,
    '<strong class="font-semibold text-foreground">$1</strong>'
  );
}
