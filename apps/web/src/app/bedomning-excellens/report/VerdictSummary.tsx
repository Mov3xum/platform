'use client';

import { SCREENING_COMMENT_MAX, STATE_AID_OUTCOME_LABEL, VINNOVA_OUTCOME_LABEL, type ExcellenceScreeningResult } from '@platform/shared';
import { EditToggle, VERDICT_TONE, WARN_TONE, inputCls } from './shared';

/**
 * Utfallet överst i rapporten (§ 51.12): statsstöd och Vinnova som två stora
 * chips med sin motivering, räknaren och controllerns kommentar. Ersätter
 * review-tabellen på skärmen — PDF:n behåller Combly-dokumentets review-rad.
 */
export function VerdictSummary({
  result,
  comment,
  onCommentChange,
  editingComment,
  onToggleComment
}: {
  result: ExcellenceScreeningResult;
  comment?: string;
  onCommentChange: (v: string | undefined) => void;
  editingComment: boolean;
  onToggleComment: () => void;
}) {
  const counts = { yes: 0, no: 0, unknown: 0 };
  for (const ch of result.checks) counts[ch.verdict]++;
  const stateAidTone =
    result.stateAid.outcome === 'art22_possible'
      ? VERDICT_TONE.yes
      : result.stateAid.outcome === 'undetermined'
        ? VERDICT_TONE.unknown
        : result.stateAid.outcome === 'not_eligible'
          ? VERDICT_TONE.no
          : WARN_TONE;
  const vinnovaTone =
    result.vinnova.outcome === 'in_target_possible' ? VERDICT_TONE.yes : result.vinnova.outcome === 'not_in_target' ? VERDICT_TONE.no : VERDICT_TONE.unknown;

  return (
    <section id="sammanfattning" className="scroll-mt-24 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-default bg-surface px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Statsstöd (art. 22 GBER / de minimis)</p>
          <p className="mt-1.5">
            <span className={`inline-block rounded-full px-3 py-1 text-[13px] font-semibold ${stateAidTone}`}>{STATE_AID_OUTCOME_LABEL[result.stateAid.outcome]}</span>
          </p>
          <p className="mt-1.5 text-[12.5px] text-foreground-muted">{result.stateAid.text}</p>
        </div>
        <div className="rounded-2xl border border-default bg-surface px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Vinnovas målgrupp</p>
          <p className="mt-1.5">
            <span className={`inline-block rounded-full px-3 py-1 text-[13px] font-semibold ${vinnovaTone}`}>{VINNOVA_OUTCOME_LABEL[result.vinnova.outcome]}</span>
          </p>
          <p className="mt-1.5 text-[12.5px] text-foreground-muted">{result.vinnova.text}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-2xl border border-default bg-canvas-subtle px-4 py-3">
        <p className="shrink-0 text-[12px] text-foreground-muted mx-tnum">
          <span className={`mr-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${VERDICT_TONE.yes}`}>{counts.yes}</span> ja ·{' '}
          <span className={`mr-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${VERDICT_TONE.no}`}>{counts.no}</span> nej ·{' '}
          <span className={`mr-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${VERDICT_TONE.unknown}`}>{counts.unknown}</span> okänt
        </p>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
            Controllerns kommentar
            <EditToggle editing={editingComment} onToggle={onToggleComment} label={comment ? 'Ändra' : 'Skriv kommentar'} />
          </p>
          {editingComment ? (
            <textarea
              autoFocus
              aria-label="Controllerns kommentar"
              value={comment ?? ''}
              maxLength={SCREENING_COMMENT_MAX}
              rows={3}
              onChange={(e) => onCommentChange(e.target.value || undefined)}
              placeholder="Sammanfattande kommentar — skrivs i PDF:ns review-rad. Inga personuppgifter."
              className={`${inputCls} mt-1`}
            />
          ) : comment ? (
            <p className="mt-0.5 whitespace-pre-line text-[12.5px] text-foreground">{comment}</p>
          ) : (
            <p className="mt-0.5 text-[12.5px] text-foreground-subtle">Ingen kommentar ännu.</p>
          )}
        </div>
      </div>
    </section>
  );
}
