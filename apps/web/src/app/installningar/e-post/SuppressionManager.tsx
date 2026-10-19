'use client';

import { useActionState, useState, useTransition } from 'react';
import { actionErrorMessage } from '@/lib/action-error';
import { addSuppressionAction, deleteSuppressionAction, type CampaignActionState } from '@/lib/actions/email-campaigns';
import type { SuppressionRow } from '@/lib/email/suppression';
import { EMAIL_SUPPRESSION_REASON_LABELS, formatStockholmDateTime } from '@platform/shared';

const idle: CampaignActionState = {};

/** Spärrlistan (§ 54.1): maskerade adresser, orsak, källa; manuell spärr; borttagning för ledningen. */
export function SuppressionManager({ rows, canDelete }: { rows: SuppressionRow[]; canDelete: boolean }) {
  const [state, action, pending] = useActionState(addSuppressionAction, idle);
  const [delState, setDelState] = useState<CampaignActionState | null>(null);
  const [busy, start] = useTransition();
  const [filter, setFilter] = useState('');
  const shown = rows.filter((r) => !filter || r.email_masked.toLowerCase().includes(filter.toLowerCase()) || r.note.toLowerCase().includes(filter.toLowerCase()));

  const notice = delState ?? state;
  return (
    <div className="mt-3 space-y-3">
      <form action={action} className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr_auto]">
        <input name="email" type="email" required className="mx-input" placeholder="adress@exempel.se" />
        <select name="reason" className="mx-input" defaultValue="manual">
          <option value="manual">Spärrad för hand</option>
          <option value="unsubscribe">Avregistrerad</option>
          <option value="bounce">Studsar</option>
          <option value="complaint">Klagomål</option>
        </select>
        <input name="note" className="mx-input" maxLength={200} placeholder="Notering (ingen personuppgift)" />
        <button type="submit" className="mx-btn mx-sm mx-primary" disabled={pending}>
          Spärra
        </button>
      </form>
      {(notice?.error || notice?.notice) && (
        <p className="text-sm" style={{ color: notice.error ? 'var(--movexum-morkorange)' : 'var(--movexum-morkgron)' }}>
          {notice.error ?? notice.notice}
        </p>
      )}
      <input className="mx-input" placeholder="Filtrera på maskerad adress eller notering" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="overflow-x-auto rounded-2xl border border-default">
        <table className="w-full text-sm">
          <thead className="bg-canvas-subtle text-left text-xs uppercase tracking-wide text-foreground-subtle">
            <tr>
              <th className="px-3 py-2">Adress</th>
              <th className="px-3 py-2">Orsak</th>
              <th className="px-3 py-2">Källa</th>
              <th className="px-3 py-2">Notering</th>
              <th className="px-3 py-2">Tillagd</th>
              {canDelete && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-foreground-muted" colSpan={6}>
                  {rows.length === 0 ? 'Inga spärrade adresser.' : 'Inga träffar.'}
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-default">
                <td className="px-3 py-2 font-mono text-xs">{r.email_masked || '••••'}</td>
                <td className="px-3 py-2">{EMAIL_SUPPRESSION_REASON_LABELS[r.reason]}</td>
                <td className="px-3 py-2 text-foreground-muted">{r.source || '–'}</td>
                <td className="px-3 py-2 text-foreground-muted">{r.note || '–'}</td>
                <td className="px-3 py-2 text-foreground-muted mx-tnum">{formatStockholmDateTime(r.created) || ''}</td>
                {canDelete && (
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="mx-btn mx-sm"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Ta bort spärren för ${r.email_masked}? Adressen kan då få utskick igen.`)) return;
                        start(async () => {
                          try {
                            setDelState(await deleteSuppressionAction(r.id));
                          } catch (err) {
                            setDelState({ error: actionErrorMessage(err, 'Kunde inte ta bort spärren.') });
                          }
                        });
                      }}
                    >
                      Ta bort
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length >= 200 && <p className="text-xs text-foreground-subtle">Visar de 200 senaste.</p>}
    </div>
  );
}
