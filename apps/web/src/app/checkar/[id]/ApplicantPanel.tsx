'use client';

import Link from 'next/link';
import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SUPPORT_CHECK_INTENT_TEXT } from '@platform/shared';
import { recordFinalReportAction, submitApplicationAction, withdrawApplicationAction } from '@/lib/actions/support-checks';
import { Icon } from '@/components/proto';
import { Notice, btnGhost, btnPrimary, inputClass, labelClass } from '../ui';

/**
 * Bolagets (och staffs) handlingar på ärendet: redigera utkast, skicka in +
 * signera (AES-intyg), återkalla och registrera slutrapport. Signeringen är
 * en MÄNSKLIG handling — namn + bekräftad avsikt — och beviset skrivs som en
 * oföränderlig revision av skrivlagret.
 */
export function ApplicantPanel({
  applicationId,
  status,
  canEdit,
  canSubmit,
  canWithdraw,
  canReport,
  requestedSek,
  activityCount,
  openIssues
}: {
  applicationId: string;
  status: string;
  canEdit: boolean;
  canSubmit: boolean;
  canWithdraw: boolean;
  canReport: boolean;
  requestedSek: number | null;
  activityCount: number;
  openIssues: number;
}) {
  const router = useRouter();
  const uid = useId();
  const [signerName, setSignerName] = useState('');
  const [intent, setIntent] = useState(false);
  const [showSign, setShowSign] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState<{ error?: string; warning?: string; notice?: string }>({});
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {feedback.error && <Notice kind="error">{feedback.error}</Notice>}
      {feedback.warning && <Notice kind="warning">{feedback.warning}</Notice>}
      {feedback.notice && <Notice kind="notice">{feedback.notice}</Notice>}

      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Link href={`/checkar/${applicationId}/redigera`} className={btnGhost}>
            <Icon name="pencil" size={12} /> Redigera ansökan
          </Link>
        )}
        {canSubmit && !showSign && (
          <button type="button" className={btnPrimary} onClick={() => setShowSign(true)} disabled={activityCount === 0 || openIssues > 0}>
            <Icon name="send" size={12} /> {status === 'changes_requested' ? 'Skicka in kompletteringen' : 'Skicka in och signera'}
          </button>
        )}
        {canReport && (
          <button
            type="button"
            className={btnGhost}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await recordFinalReportAction(applicationId, {});
                setFeedback({ error: res.error, warning: res.warning, notice: res.notice });
                router.refresh();
              })
            }
          >
            <Icon name="check" size={12} /> Markera slutrapport lämnad
          </button>
        )}
        {canWithdraw && !showWithdraw && (
          <button type="button" className={btnGhost} onClick={() => setShowWithdraw(true)}>
            Återkalla ansökan
          </button>
        )}
      </div>
      {canSubmit && openIssues > 0 && (
        <p className="text-xs text-movexum-morkgul dark:text-movexum-pastell-gul">{openIssues} kompletteringspunkt(er) är olösta — svara på dem i kommentarerna så att granskaren kan bocka av dem innan ni skickar in på nytt.</p>
      )}
      {canSubmit && activityCount === 0 && <p className="text-xs text-foreground-subtle">Lägg till minst en insats innan ansökan kan skickas in.</p>}

      {showSign && (
        <form
          className="space-y-3 rounded-2xl border border-default bg-canvas-subtle p-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await submitApplicationAction(applicationId, { signerName, intentConfirmed: intent });
              setFeedback({ error: res.error, warning: res.warning, notice: res.notice });
              if (res.ok) {
                setShowSign(false);
                router.refresh();
              }
            });
          }}
        >
          <h3 className="text-sm font-semibold text-foreground">Intyg och signering (firmatecknare)</h3>
          <p className="text-xs text-foreground-muted">
            Ansökan {requestedSek !== null ? `om ${Math.round(requestedSek).toLocaleString('sv-SE')} kr ` : ''}fryses i den version du signerar och får en innehålls-hash som bevis (avancerad elektronisk signatur). Ändringar efter signering kräver ny signering.
          </p>
          <div>
            <label htmlFor={`${uid}-name`} className={labelClass}>
              Fullständigt namn (som firmatecknare)
            </label>
            <input id={`${uid}-name`} className={inputClass} value={signerName} onChange={(e) => setSignerName(e.target.value)} required maxLength={200} />
          </div>
          <label className="flex items-start gap-2 text-xs text-foreground-muted">
            <input type="checkbox" checked={intent} onChange={(e) => setIntent(e.target.checked)} className="mt-0.5" />
            <span>{SUPPORT_CHECK_INTENT_TEXT}</span>
          </label>
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={pending || !signerName.trim() || !intent}>
              {pending ? 'Signerar…' : 'Signera och skicka in'}
            </button>
            <button type="button" className={btnGhost} onClick={() => setShowSign(false)}>
              Avbryt
            </button>
          </div>
        </form>
      )}

      {showWithdraw && (
        <form
          className="space-y-3 rounded-2xl border border-default bg-canvas-subtle p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!confirm('Återkalla ansökan? Det går inte att ångra.')) return;
            startTransition(async () => {
              const res = await withdrawApplicationAction(applicationId, { reason });
              setFeedback({ error: res.error, warning: res.warning, notice: res.notice });
              if (res.ok) {
                setShowWithdraw(false);
                router.refresh();
              }
            });
          }}
        >
          <label htmlFor={`${uid}-reason`} className={labelClass}>
            Anledning (valfritt)
          </label>
          <textarea id={`${uid}-reason`} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={pending}>
              Återkalla
            </button>
            <button type="button" className={btnGhost} onClick={() => setShowWithdraw(false)}>
              Avbryt
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
