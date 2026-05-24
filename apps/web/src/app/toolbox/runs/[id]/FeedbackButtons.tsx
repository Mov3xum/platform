'use client';

import { useState, useTransition } from 'react';
import { submitRunFeedbackAction } from '@/lib/actions/feedback';
import type { ToolRunFeedbackRating } from '@platform/shared';

const THUMB_BASE =
  'inline-flex h-7 w-7 items-center justify-center rounded-full border text-sm transition ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila ' +
  'dark:focus-visible:ring-movexum-morklila disabled:opacity-50';

export function FeedbackButtons({
  runId,
  messageIndex,
  initialRating = null,
  initialReason = ''
}: {
  runId: string;
  messageIndex: number;
  initialRating?: ToolRunFeedbackRating | null;
  initialReason?: string;
}) {
  const [rating, setRating] = useState<ToolRunFeedbackRating | null>(initialRating);
  const [reason, setReason] = useState(initialReason);
  const [showReason, setShowReason] = useState(initialRating === 'down');
  const [savedReason, setSavedReason] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(next: ToolRunFeedbackRating | 'clear', withReason?: string) {
    setError(null);
    setSavedReason(false);
    startTransition(async () => {
      const res = await submitRunFeedbackAction({
        runId,
        messageIndex,
        rating: next,
        reason: withReason ?? reason
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      const resolved = res.rating ?? null;
      setRating(resolved);
      setShowReason(resolved === 'down');
      if (resolved === null) setReason('');
      if (withReason !== undefined) setSavedReason(true);
    });
  }

  function handleThumb(dir: ToolRunFeedbackRating) {
    submit(rating === dir ? 'clear' : dir);
  }

  return (
    <div className="mt-3 border-t border-default pt-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs text-foreground-subtle">Var svaret användbart?</span>
        <button
          type="button"
          aria-label="Användbart"
          aria-pressed={rating === 'up'}
          disabled={pending}
          onClick={() => handleThumb('up')}
          className={`${THUMB_BASE} ${
            rating === 'up'
              ? 'border-movexum-gron bg-movexum-pastell-gron'
              : 'border-default bg-surface hover:bg-canvas-subtle'
          }`}
        >
          <span aria-hidden>👍</span>
        </button>
        <button
          type="button"
          aria-label="Inte användbart"
          aria-pressed={rating === 'down'}
          disabled={pending}
          onClick={() => handleThumb('down')}
          className={`${THUMB_BASE} ${
            rating === 'down'
              ? 'border-movexum-orange bg-movexum-pastell-orange'
              : 'border-default bg-surface hover:bg-canvas-subtle'
          }`}
        >
          <span aria-hidden>👎</span>
        </button>
        {rating && !showReason && (
          <span className="text-xs text-movexum-morkgron dark:text-movexum-pastell-gron">
            Tack för din feedback
          </span>
        )}
      </div>

      {showReason && (
        <div className="mt-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Valfritt: vad var fel? (skriv inga personuppgifter)"
            className="w-full rounded-xl border border-default bg-canvas-subtle px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => submit('down', reason)}
              className="rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
            >
              Spara orsak
            </button>
            {savedReason && (
              <span className="text-xs text-movexum-morkgron dark:text-movexum-pastell-gron">
                Sparat
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="mt-1.5 text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}
    </div>
  );
}
