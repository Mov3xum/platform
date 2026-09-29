'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createWorkPackageAction, deleteWorkPackageAction, updateWorkPackageAction } from '@/lib/actions/funding';
import { Icon } from '@/components/proto';
import { Notice, btnGhost, btnPrimary, fmtSek, inputClass, labelClass } from '@/app/checkar/ui';

export interface WorkPackageView {
  id: string;
  code: string;
  title: string;
  description: string;
  budgetSek: number | null;
  startsAt: string;
  endsAt: string;
  grantedSek: number;
  paidSek: number;
  count: number;
  signal: 'ok' | 'behind' | 'over' | 'none';
}

interface Draft {
  id: string | null;
  code: string;
  title: string;
  description: string;
  budget_sek: string;
  starts_at: string;
  ends_at: string;
}

const SIGNAL: Record<WorkPackageView['signal'], string> = {
  ok: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  behind: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  over: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  none: 'bg-canvas-muted text-foreground-muted'
};
const SIGNAL_LABEL: Record<WorkPackageView['signal'], string> = { ok: 'I fas', behind: 'Under plan', over: 'Över budget', none: 'Ingen budget' };

/** Arbetspaket (AP) i ett finansieringsprojekt — redovisningsenheten checkarna belastar. */
export function WorkPackagesPanel({ projectId, items, canManage }: { projectId: string; items: WorkPackageView[]; canManage: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {error && <Notice kind="error">{error}</Notice>}
      {items.length === 0 ? <p className="text-sm text-foreground-subtle">Inga arbetspaket än — lägg till minst ett så checkarna kan belasta det.</p> : null}
      <ul className="divide-y divide-default">
        {items.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">{w.code ? `${w.code} ` : ''}{w.title}</div>
              <div className="text-xs text-foreground-subtle mx-tnum">
                Beviljat {fmtSek(w.grantedSek)} · utbetalt {fmtSek(w.paidSek)}{w.budgetSek ? ` · budget ${fmtSek(w.budgetSek)}` : ''} · {w.count} checkar
                {(w.startsAt || w.endsAt) && ` · ${w.startsAt || '…'} – ${w.endsAt || '…'}`}
              </div>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SIGNAL[w.signal]}`}>{SIGNAL_LABEL[w.signal]}</span>
            {canManage && (
              <>
                <button type="button" className={btnGhost} onClick={() => setDraft({ id: w.id, code: w.code, title: w.title, description: w.description, budget_sek: w.budgetSek ? String(w.budgetSek) : '', starts_at: w.startsAt, ends_at: w.endsAt })}>
                  <Icon name="pencil" size={12} />
                </button>
                <button
                  type="button"
                  className={btnGhost}
                  disabled={pending}
                  onClick={() => {
                    if (!confirm(`Ta bort arbetspaketet "${w.title}"?`)) return;
                    startTransition(async () => {
                      const res = await deleteWorkPackageAction(w.id);
                      if (res.error) setError(res.error);
                      router.refresh();
                    });
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {canManage && !draft && (
        <button type="button" className={btnGhost} onClick={() => setDraft({ id: null, code: `AP${items.length + 1}`, title: '', description: '', budget_sek: '', starts_at: '', ends_at: '' })}>
          <Icon name="plus" size={12} /> Nytt arbetspaket
        </button>
      )}
      {draft && (
        <form
          className="space-y-3 rounded-2xl border border-default bg-canvas-subtle p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const payload = { code: draft.code, title: draft.title, description: draft.description, budget_sek: draft.budget_sek || null, starts_at: draft.starts_at || null, ends_at: draft.ends_at || null, sort_order: items.length };
              const res = draft.id ? await updateWorkPackageAction(draft.id, payload) : await createWorkPackageAction(projectId, payload);
              if (res.error) {
                setError(res.error);
                return;
              }
              setDraft(null);
              router.refresh();
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Kod</label>
              <input className={inputClass} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} maxLength={20} placeholder="AP3" />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Titel</label>
              <input className={inputClass} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required maxLength={200} />
            </div>
            <div>
              <label className={labelClass}>Budget (kr)</label>
              <input className={inputClass} inputMode="numeric" value={draft.budget_sek} onChange={(e) => setDraft({ ...draft, budget_sek: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Startar</label>
              <input type="date" className={inputClass} value={draft.starts_at} onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>Slutar</label>
              <input type="date" className={inputClass} value={draft.ends_at} onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <label className={labelClass}>Beskrivning</label>
              <input className={inputClass} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={2000} />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={pending || !draft.title.trim()}>Spara</button>
            <button type="button" className={btnGhost} onClick={() => setDraft(null)}>Avbryt</button>
          </div>
        </form>
      )}
    </div>
  );
}
