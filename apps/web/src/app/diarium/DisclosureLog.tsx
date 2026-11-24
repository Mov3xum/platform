'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { DISCLOSURE_OUTCOMES, DISCLOSURE_OUTCOME_LABELS, type DisclosureOutcome } from '@platform/shared';
import type { DisclosureView } from '@/lib/register/data';
import { logDisclosureAction, type RegisterActionState } from '@/lib/actions/register';
import { ActionNotice, Chip, Notice, btnGhost, btnPrimary, card, formatRegisterDate, inputClass, labelClass, type Tone } from '@/components/register/ui';

const OUTCOME_TONE: Record<DisclosureOutcome, Tone> = { released: 'good', partial: 'warn', denied: 'bad' };

export function DisclosureForm({ caseId, entryId, onDone }: { caseId?: string; entryId?: string; onDone?: () => void }) {
  const [state, action, pending] = useActionState<RegisterActionState, FormData>(logDisclosureAction, {});
  const [outcome, setOutcome] = useState<DisclosureOutcome>('released');
  return (
    <form action={action} onReset={() => setOutcome('released')} className={`${card} space-y-4 p-5`}>
      {caseId && <input type="hidden" name="case_id" value={caseId} />}
      {entryId && <input type="hidden" name="entry_id" value={entryId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={labelClass}>Vad som begärdes ut</span>
          <input name="request_summary" required minLength={3} maxLength={400} className={inputClass} placeholder="Beskriv handlingarna — inte vem som frågade" />
        </label>
        <label className="block">
          <span className={labelClass}>Begäran kom in</span>
          <input type="date" name="requested_at" className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Utfall</span>
          <select name="outcome" defaultValue="released" onChange={(e) => setOutcome(e.target.value as DisclosureOutcome)} className={inputClass}>
            {DISCLOSURE_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {DISCLOSURE_OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
        </label>
        {outcome !== 'released' && (
          <label className="block sm:col-span-2">
            <span className={labelClass}>Lagrum för sekretessen</span>
            <input name="secrecy_basis" required maxLength={300} className={inputClass} />
          </label>
        )}
        <label className="block sm:col-span-2">
          <span className={labelClass}>Anteckning (valfri)</span>
          <input name="note" maxLength={600} className={inputClass} placeholder="T.ex. hur handlingen lämnades ut, om beslut med besvärshänvisning skrevs" />
        </label>
      </div>
      <ActionNotice state={state} />
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={pending}>
          {pending ? 'Loggar…' : 'Logga utlämnande'}
        </button>
        {onDone && (
          <button type="button" className={btnGhost} onClick={onDone}>
            Stäng
          </button>
        )}
      </div>
    </form>
  );
}

export function DisclosureRows({ items }: { items: DisclosureView[] }) {
  return (
    <div className={`${card} divide-y divide-default`}>
      {items.map((d) => (
        <div key={d.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3 text-sm">
          <span className="mx-tnum whitespace-nowrap text-foreground-muted">{formatRegisterDate(d.requestedAt)}</span>
          <div className="min-w-0 flex-1">
            <div className="text-foreground">{d.summary}</div>
            <div className="text-xs text-foreground-subtle">
              {[d.secrecyBasis, d.note, d.handledByName && `Handlagd av ${d.handledByName}`].filter(Boolean).join(' · ')}
            </div>
          </div>
          {d.caseId && (
            <Link href={`/diarium/${d.caseId}`} className="mx-tnum text-link hover:underline">
              {d.designation || d.caseNumber}
            </Link>
          )}
          <Chip tone={OUTCOME_TONE[d.outcome]}>{DISCLOSURE_OUTCOME_LABELS[d.outcome]}</Chip>
        </div>
      ))}
    </div>
  );
}

export function DisclosureLog({ items, canManage, readError }: { items: DisclosureView[]; canManage: boolean; readError: string | null }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      {readError && <Notice tone="bad">{readError}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-foreground-muted">
          Logga varje begäran om allmän handling och hur den hanterades. Den som begär ut en handling har rätt att vara anonym — fråga inte efter namn eller syfte.
        </p>
        {canManage && !adding && (
          <button className={btnPrimary} onClick={() => setAdding(true)}>
            Logga utlämnande
          </button>
        )}
      </div>
      {adding && <DisclosureForm onDone={() => setAdding(false)} />}
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-default p-12 text-center text-sm text-foreground-muted">Inga utlämnanden är loggade än.</div>
      ) : (
        <DisclosureRows items={items} />
      )}
    </div>
  );
}
