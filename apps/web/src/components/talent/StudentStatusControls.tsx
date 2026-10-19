'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { StudentProfileStatus } from '@platform/shared';
import { actionErrorMessage } from '@/lib/action-error';
import { deleteStudentAction, setStudentStatusAction } from '@/lib/actions/talent';
import { Notice, btnDanger, btnGhost } from './ui';

/** Movexums kontroller på en studentprofil: pausa/aktivera, ta bort (ledningen). */
export function StudentStatusControls({ studentId, status, canDelete }: { studentId: string; status: StudentProfileStatus; canDelete: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function set(to: StudentProfileStatus) {
    start(async () => {
      try {
        const res = await setStudentStatusAction(studentId, to);
        if (res.error) setError(res.error);
        else router.refresh();
      } catch (err) {
        setError(actionErrorMessage(err, 'Kunde inte ändra status.'));
      }
    });
  }
  function remove() {
    if (!window.confirm('Ta bort studentens profil och alla intressen? Det går inte att ångra (GDPR art. 17).')) return;
    start(async () => {
      try {
        const res = await deleteStudentAction(studentId);
        if (res.error) setError(res.error);
        else router.push('/talang/studenter');
      } catch (err) {
        setError(actionErrorMessage(err, 'Kunde inte ta bort profilen.'));
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status !== 'active' && status !== 'pending' ? (
          <button type="button" onClick={() => set('active')} disabled={pending} className={btnGhost}>
            Aktivera igen
          </button>
        ) : null}
        {status === 'active' ? (
          <button type="button" onClick={() => set('paused')} disabled={pending} className={btnGhost}>
            Pausa (osynlig för bolag)
          </button>
        ) : null}
        {status !== 'withdrawn' ? (
          <button type="button" onClick={() => set('withdrawn')} disabled={pending} className={btnGhost}>
            Avregistrera
          </button>
        ) : null}
        {canDelete ? (
          <button type="button" onClick={remove} disabled={pending} className={btnDanger}>
            Ta bort helt
          </button>
        ) : null}
      </div>
      {error ? <Notice kind="error">{error}</Notice> : null}
    </div>
  );
}
