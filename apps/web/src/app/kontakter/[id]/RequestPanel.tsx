'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ContactRequestStatus } from '@platform/shared';
import {
  decideContactRequestAction,
  requestContactUseAction,
  withdrawContactRequestAction,
  type ContactActionState
} from '@/lib/actions/contacts';
import { Icon } from '@/components/proto';
import { Notice, RequestStatusChip, btnGhost, btnPrimary, fmtDateTime, inputClass, labelClass } from '../ui';

export interface RequestView {
  id: string;
  status: ContactRequestStatus;
  purpose: string;
  requesterId: string;
  requesterName: string;
  startupId: string | null;
  startupName: string | null;
  startupRole: string | null;
  decisionNote: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  created: string | null;
  /** Kan den inloggade avgöra just denna förfrågan? */
  canDecide: boolean;
  canWithdraw: boolean;
}

export interface StartupOption {
  id: string;
  name: string;
}

const initial: ContactActionState = {};

/**
 * Förfrågningspanelen på kontaktkortet (§ 45.3): be om att använda kontakten
 * (syfte + ev. bolag), och för ägaren: godkänn/avböj. Beslutet är alltid ett
 * mänskligt klick; skrivlagret verifierar ägarskap server-side.
 */
export function RequestPanel({
  contactId,
  contactName,
  isOwner,
  canRequest,
  startups,
  requests,
  highlightId
}: {
  contactId: string;
  contactName: string;
  isOwner: boolean;
  canRequest: boolean;
  startups: StartupOption[];
  requests: RequestView[];
  highlightId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reqState, reqAction, reqPending] = useActionState(requestContactUseAction, initial);
  const [decState, decAction, decPending] = useActionState(decideContactRequestAction, initial);
  const [wdState, wdAction, wdPending] = useActionState(withdrawContactRequestAction, initial);
  const [noteFor, setNoteFor] = useState<string | null>(null);

  useEffect(() => {
    if (reqState.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [reqState.ok, reqState.id, router]);
  useEffect(() => {
    if (decState.ok || wdState.ok) router.refresh();
  }, [decState.ok, decState.id, wdState.ok, wdState.id, router]);

  const pending = requests.filter((r) => r.status === 'pending');
  const history = requests.filter((r) => r.status !== 'pending');

  return (
    <div className="space-y-4">
      {(reqState.notice || decState.notice || wdState.notice) && (
        <Notice kind="notice">{reqState.notice ?? decState.notice ?? wdState.notice}</Notice>
      )}
      {(reqState.warning || decState.warning) && <Notice kind="warning">{reqState.warning ?? decState.warning}</Notice>}
      {(reqState.error || decState.error || wdState.error) && (
        <Notice kind="error">{reqState.error ?? decState.error ?? wdState.error}</Notice>
      )}

      {canRequest && (
        <div className="rounded-2xl border border-default bg-canvas-subtle p-4">
          {!open ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex-1 text-sm text-foreground-muted">
                {isOwner
                  ? 'Du äger kontakten. Registrera vad du använder den till, eller dela den med ett bolag — det godkänns direkt.'
                  : 'Vill du använda kontakten? Beskriv syftet så får ägaren en förfrågan att godkänna.'}
              </p>
              <button type="button" onClick={() => setOpen(true)} className={btnPrimary}>
                <Icon name="send" size={13} /> {isOwner ? 'Använd / dela kontakten' : 'Be om att använda kontakten'}
              </button>
            </div>
          ) : (
            <form action={reqAction} className="space-y-3">
              <input type="hidden" name="contact_id" value={contactId} />
              <div>
                <label className={labelClass} htmlFor="purpose">
                  Syfte *
                </label>
                <textarea
                  id="purpose"
                  name="purpose"
                  required
                  maxLength={2000}
                  className={`${inputClass} min-h-[80px]`}
                  placeholder={`Vad ska ${contactName} användas till? T.ex. "Introducera till bolaget X inför deras ansökan om innovationsbidrag."`}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="startup_id">
                    Dela med bolag (valfritt)
                  </label>
                  <select id="startup_id" name="startup_id" className={inputClass} defaultValue="">
                    <option value="">— Inget bolag —</option>
                    {startups.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="startup_role">
                    Kontaktens roll för bolaget
                  </label>
                  <input id="startup_role" name="startup_role" className={inputClass} maxLength={100} placeholder="t.ex. Mentor, Investerare, Jurist" />
                </div>
              </div>
              <p className="text-xs text-foreground-subtle">
                Vid godkännande med bolag kopplas kontakten till bolagskortet och bolaget ser namn, organisation, roll och
                kontaktuppgifter under &quot;Delade kontakter&quot; på Mitt bolag — tillsammans med syftet.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={reqPending} className={btnPrimary}>
                  {reqPending ? 'Skickar…' : isOwner ? 'Registrera' : 'Skicka förfrågan'}
                </button>
                <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
                  Avbryt
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Väntar på svar</h3>
          <ul className="space-y-2">
            {pending.map((r) => (
              <li
                key={r.id}
                className={`rounded-2xl border p-4 ${
                  r.id === highlightId ? 'border-brand bg-movexum-pastell-gul/40 dark:bg-movexum-morkgul/20' : 'border-default bg-surface'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <RequestStatusChip status={r.status} />
                  <span className="text-sm font-medium text-foreground">{r.requesterName}</span>
                  <span className="text-xs text-foreground-subtle">{fmtDateTime(r.created)}</span>
                  {r.startupName && (
                    <span className="text-xs text-foreground-muted">
                      · dela med <strong className="font-semibold text-foreground">{r.startupName}</strong>
                      {r.startupRole ? ` (${r.startupRole})` : ''}
                    </span>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{r.purpose}</p>
                {r.canDecide && (
                  <form action={decAction} className="mt-3 space-y-2">
                    <input type="hidden" name="request_id" value={r.id} />
                    {noteFor === r.id && (
                      <textarea name="note" maxLength={2000} className={`${inputClass} min-h-[60px]`} placeholder="Kommentar till den som frågar (valfritt)" />
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" name="decision" value="approved" disabled={decPending} className={btnPrimary}>
                        <Icon name="check" size={13} /> Godkänn
                      </button>
                      <button type="submit" name="decision" value="declined" disabled={decPending} className={btnGhost}>
                        <Icon name="x" size={13} /> Avböj
                      </button>
                      {noteFor !== r.id && (
                        <button type="button" onClick={() => setNoteFor(r.id)} className="text-xs text-link hover:underline">
                          Lägg till kommentar
                        </button>
                      )}
                    </div>
                  </form>
                )}
                {!r.canDecide && r.canWithdraw && (
                  <form action={wdAction} className="mt-3">
                    <input type="hidden" name="request_id" value={r.id} />
                    <button type="submit" disabled={wdPending} className={btnGhost}>
                      Återkalla förfrågan
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Historik</h3>
          <ul className="divide-y divide-default rounded-2xl border border-default bg-surface">
            {history.map((r) => (
              <li key={r.id} className={`px-4 py-3 text-sm ${r.id === highlightId ? 'bg-canvas-subtle' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <RequestStatusChip status={r.status} />
                  <span className="font-medium text-foreground">{r.requesterName}</span>
                  <span className="text-xs text-foreground-subtle">{fmtDateTime(r.created)}</span>
                  {r.startupName && <span className="text-xs text-foreground-muted">· {r.startupName}</span>}
                </div>
                <p className="mt-1 text-foreground-muted">{r.purpose}</p>
                {(r.decidedByName || r.decisionNote) && (
                  <p className="mt-1 text-xs text-foreground-subtle">
                    {r.decidedByName ? `${r.decidedByName}, ${fmtDateTime(r.decidedAt)}` : ''}
                    {r.decisionNote ? ` — ${r.decisionNote}` : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {requests.length === 0 && !canRequest && (
        <p className="text-sm text-foreground-subtle">Inga förfrågningar ännu.</p>
      )}
    </div>
  );
}
