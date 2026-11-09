'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  TALENT_INTEREST_STATUSES,
  TALENT_INTEREST_STATUS_LABELS,
  TALENT_OUTCOMES,
  TALENT_OUTCOME_LABELS,
  canTransitionInterest,
  type TalentInterestStatus,
  type TalentOutcome
} from '@platform/shared';
import { actionErrorMessage } from '@/lib/action-error';
import { setInterestStatusAction } from '@/lib/actions/talent';
import { Notice, btnGhost, btnPrimary, inputClass, labelClass } from './ui';

interface Props {
  interestId: string;
  status: TalentInterestStatus;
  party: 'company' | 'staff';
  outcome: TalentOutcome | null;
  companyNote: string;
}

const LABEL: Record<TalentInterestStatus, string> = {
  proposed: 'Föreslå igen',
  new: 'Markera som ny',
  dialogue: 'Vi har kontakt',
  matched: 'Vi är överens — matcha',
  declined: 'Tacka nej',
  withdrawn: 'Dra tillbaka'
};

/** Bolagets/Movexums statusknappar på ett intresse + utfall när det är klart (§ 54). */
export function InterestControls({ interestId, status, party, outcome, companyNote }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(companyNote);
  const [outcomeValue, setOutcome] = useState<string>(outcome ?? '');
  const [outcomeNote, setOutcomeNote] = useState('');
  const targets = TALENT_INTEREST_STATUSES.filter((to) => canTransitionInterest(status, to, party));

  function go(to: TalentInterestStatus) {
    setError(null);
    start(async () => {
      try {
        const res = await setInterestStatusAction(interestId, to, {
          companyNote: note,
          outcome: to === 'matched' || status === 'matched' ? outcomeValue || undefined : undefined,
          outcomeNote: outcomeNote || undefined
        });
        if (res.error) setError(res.error);
        else router.refresh();
      } catch (err) {
        setError(actionErrorMessage(err, 'Kunde inte spara.'));
      }
    });
  }

  return (
    <div className="space-y-3 rounded-2xl border border-default bg-canvas-subtle/60 p-3">
      <label className="block">
        <span className={labelClass}>Intern anteckning (syns inte för studenten)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={inputClass} placeholder="T.ex. intervju bokad 12/11" />
      </label>
      {(status === 'matched' || targets.includes('matched')) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Utfall (när det är klart)</span>
            <select value={outcomeValue} onChange={(e) => setOutcome(e.target.value)} className={inputClass}>
              <option value="">Inte avgjort än</option>
              {TALENT_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {TALENT_OUTCOME_LABELS[o]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Kommentar om utfallet (valfritt)</span>
            <input value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} maxLength={500} className={inputClass} />
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {targets.map((to) => (
          <button key={to} type="button" onClick={() => go(to)} disabled={pending} className={to === 'matched' ? btnPrimary : btnGhost} title={TALENT_INTEREST_STATUS_LABELS[to]}>
            {LABEL[to]}
          </button>
        ))}
        {status === 'matched' && targets.length === 0 ? null : null}
        {status === 'matched' ? (
          <button type="button" onClick={() => go('matched' as TalentInterestStatus)} disabled={pending || !outcomeValue} className={btnGhost}>
            Spara utfall
          </button>
        ) : null}
      </div>
      {error ? <Notice kind="error">{error}</Notice> : null}
    </div>
  );
}
