'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { TALENT_NEED_STATUSES, TALENT_NEED_STATUS_LABELS, canTransitionNeed, type TalentNeedStatus } from '@platform/shared';
import { actionErrorMessage } from '@/lib/action-error';
import { deleteTalentNeedAction, setTalentNeedStatusAction } from '@/lib/actions/talent';
import { Notice, btnDanger, btnGhost, btnPrimary, inputClass, labelClass } from './ui';

interface Props {
  needId: string;
  status: TalentNeedStatus;
  party: 'company' | 'staff';
  /** Vart sidan går efter borttagning. */
  afterDelete: string;
}

const BUTTON_LABEL: Record<TalentNeedStatus, string> = {
  draft: 'Skicka tillbaka som utkast',
  pending_review: 'Skicka till Movexum',
  published: 'Publicera för studenter',
  paused: 'Pausa',
  closed: 'Avsluta'
};

/** Statusknappar för ett behov (§ 54): bolaget skickar/pausar/avslutar, Movexum publicerar/skickar tillbaka. */
export function NeedStatusButtons({ needId, status, party, afterDelete }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const targets = TALENT_NEED_STATUSES.filter((to) => canTransitionNeed(status, to, party));
  const needsNote = party === 'staff' && (status === 'pending_review' || status === 'published');

  function go(to: TalentNeedStatus) {
    setError(null);
    start(async () => {
      try {
        const res = await setTalentNeedStatusAction(needId, to, note || undefined);
        if (res.error) setError(res.error);
        else router.refresh();
      } catch (err) {
        setError(actionErrorMessage(err, 'Kunde inte ändra status.'));
      }
    });
  }

  function remove() {
    if (!window.confirm('Ta bort behovet? Det går inte att ångra.')) return;
    start(async () => {
      try {
        const res = await deleteTalentNeedAction(needId);
        if (res.error) setError(res.error);
        else router.push(afterDelete);
      } catch (err) {
        setError(actionErrorMessage(err, 'Kunde inte ta bort behovet.'));
      }
    });
  }

  return (
    <div className="space-y-3">
      {needsNote ? (
        <label className="block">
          <span className={labelClass}>Meddelande till bolaget (valfritt — visas när ni skickar tillbaka eller publicerar)</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className={inputClass} />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {targets.map((to) => (
          <button
            key={to}
            type="button"
            onClick={() => go(to)}
            disabled={pending}
            className={to === 'published' || to === 'pending_review' ? btnPrimary : btnGhost}
            title={TALENT_NEED_STATUS_LABELS[to]}
          >
            {BUTTON_LABEL[to]}
          </button>
        ))}
        {(party === 'staff' || status === 'draft') && (
          <button type="button" onClick={remove} disabled={pending} className={btnDanger}>
            Ta bort
          </button>
        )}
      </div>
      {error ? <Notice kind="error">{error}</Notice> : null}
    </div>
  );
}
