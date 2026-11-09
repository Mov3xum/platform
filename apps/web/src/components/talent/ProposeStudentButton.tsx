'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { actionErrorMessage } from '@/lib/action-error';
import { proposeStudentAction } from '@/lib/actions/talent';
import { Notice, btnGhost, btnPrimary, inputClass } from './ui';

/** "Föreslå för studenten" (§ 54): en människa skickar, studenten avgör. */
export function ProposeStudentButton({ needId, studentId, compact = false }: { needId: string; studentId: string; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ error?: string; notice?: string }>({});

  function send() {
    start(async () => {
      try {
        const res = await proposeStudentAction(needId, studentId, message);
        setState(res.error ? { error: res.error } : { notice: res.notice });
        if (!res.error) {
          setOpen(false);
          router.refresh();
        }
      } catch (err) {
        setState({ error: actionErrorMessage(err, 'Kunde inte skicka förslaget.') });
      }
    });
  }

  if (state.notice) return <span className="text-xs text-movexum-morkgron dark:text-movexum-gron">Förslag skickat</span>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={compact ? btnGhost : btnPrimary}>
        Föreslå för studenten
      </button>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-2xl border border-default bg-canvas-subtle/60 p-3">
      <textarea
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={1000}
        className={inputClass}
        placeholder="Hälsning till studenten (valfritt) — varför ni tror att hen passar. Inga personuppgifter om andra."
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={send} disabled={pending} className={btnPrimary}>
          {pending ? 'Skickar…' : 'Skicka förslaget'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
          Avbryt
        </button>
      </div>
      {state.error ? <Notice kind="error">{state.error}</Notice> : null}
      <p className="text-[11px] text-foreground-subtle">Studenten får ett mejl och ser bolagets namn (om det inte är anonymt). Ni ser studentens namn och kontakt först efter ett ja.</p>
    </div>
  );
}
