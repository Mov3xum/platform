'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_SUPPORT_CHECK_CRITERIA,
  FUNDING_BASES,
  FUNDING_BASIS_LABELS,
  SUPPORT_CHECK_KINDS,
  SUPPORT_CHECK_KIND_LABELS,
  slugifyCriterionKey,
  type SupportCheckCriterion
} from '@platform/shared';
import { createCheckTypeAction, deleteCheckTypeAction, updateCheckTypeAction } from '@/lib/actions/support-checks';
import { Icon } from '@/components/proto';
import type { FormOption, FundingOptions } from '../form-data';
import { Notice, btnGhost, btnPrimary, inputClass, labelClass } from '../ui';

export interface CheckTypeFormValues {
  title: string;
  kind: string;
  description: string;
  active: boolean;
  max_amount_sek: string;
  funding_project: string;
  default_work_package: string;
  default_state_aid_basis: string;
  requires_workshop: string;
  min_irl_level: string;
  requires_final_report: boolean;
  report_due_days: string;
  changes_due_days: string;
  is_excellence_activity: boolean;
  criteria: SupportCheckCriterion[];
  opens_at: string;
  closes_at: string;
}

export const EMPTY_TYPE: CheckTypeFormValues = {
  title: '',
  kind: 'excellence',
  description: '',
  active: true,
  max_amount_sek: '',
  funding_project: '',
  default_work_package: '',
  default_state_aid_basis: 'de_minimis',
  requires_workshop: '',
  min_irl_level: '',
  requires_final_report: true,
  report_due_days: '30',
  changes_due_days: '14',
  is_excellence_activity: false,
  criteria: DEFAULT_SUPPORT_CHECK_CRITERIA.map((c) => ({ ...c })),
  opens_at: '',
  closes_at: ''
};

/** Checktyp = konfiguration (§ 46): vad som kan sökas, krav, kriterier, defaults för finansiering. Ledning. */
export function CheckTypeForm({ mode, typeId, initial, workshops, funding }: { mode: 'create' | 'edit'; typeId?: string; initial?: Partial<CheckTypeFormValues>; workshops: FormOption[]; funding: FundingOptions }) {
  const router = useRouter();
  const uid = useId();
  const [v, setV] = useState<CheckTypeFormValues>({ ...EMPTY_TYPE, ...initial });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof CheckTypeFormValues>(k: K, val: CheckTypeFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const wps = funding.workPackages.filter((w) => w.project === v.funding_project);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload = {
        title: v.title,
        kind: v.kind,
        description: v.description,
        active: v.active,
        max_amount_sek: v.max_amount_sek || null,
        funding_project: v.funding_project || null,
        default_work_package: v.default_work_package || null,
        default_state_aid_basis: v.default_state_aid_basis || null,
        requires_workshop: v.requires_workshop || null,
        min_irl_level: v.min_irl_level || null,
        requires_final_report: v.requires_final_report,
        report_due_days: v.report_due_days || null,
        changes_due_days: v.changes_due_days || null,
        is_excellence_activity: v.is_excellence_activity,
        criteria: v.criteria,
        opens_at: v.opens_at || null,
        closes_at: v.closes_at || null
      };
      const res = mode === 'create' ? await createCheckTypeAction(payload) : await updateCheckTypeAction(typeId!, payload);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push('/checkar/typer');
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && <Notice kind="error">{error}</Notice>}
      <section className="rounded-3xl border border-default bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-foreground">Checken</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-t`} className={labelClass}>Titel</label>
            <input id={`${uid}-t`} className={inputClass} value={v.title} onChange={(e) => set('title', e.target.value)} required maxLength={200} placeholder="T.ex. Resecheck internationalisering" />
          </div>
          <div>
            <label htmlFor={`${uid}-k`} className={labelClass}>Slag</label>
            <select id={`${uid}-k`} className={inputClass} value={v.kind} onChange={(e) => set('kind', e.target.value)}>
              {SUPPORT_CHECK_KINDS.map((k) => (
                <option key={k} value={k}>{SUPPORT_CHECK_KIND_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${uid}-d`} className={labelClass}>Beskrivning till bolagen (visas i ansökningsformuläret)</label>
            <textarea id={`${uid}-d`} className={`${inputClass} min-h-[90px]`} value={v.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
          </div>
          <div>
            <label htmlFor={`${uid}-max`} className={labelClass}>Max belopp per check (kr)</label>
            <input id={`${uid}-max`} className={inputClass} inputMode="numeric" value={v.max_amount_sek} onChange={(e) => set('max_amount_sek', e.target.value)} />
          </div>
          <div className="flex flex-col gap-2 pt-5 text-sm text-foreground">
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Öppen för ansökningar</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.is_excellence_activity} onChange={(e) => set('is_excellence_activity', e.target.checked)} /> Excellens-insats</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={v.requires_final_report} onChange={(e) => set('requires_final_report', e.target.checked)} /> Kräver slutrapport</label>
          </div>
          <div>
            <label className={labelClass}>Öppnar</label>
            <input type="date" className={inputClass} value={v.opens_at} onChange={(e) => set('opens_at', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Stänger</label>
            <input type="date" className={inputClass} value={v.closes_at} onChange={(e) => set('closes_at', e.target.value)} />
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-default bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-foreground">Behörighetskrav och frister</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-w`} className={labelClass}>Obligatorisk workshop (genomförd)</label>
            <select id={`${uid}-w`} className={inputClass} value={v.requires_workshop} onChange={(e) => set('requires_workshop', e.target.value)}>
              <option value="">Inget krav</option>
              {workshops.map((w) => (
                <option key={w.id} value={w.id}>{w.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-irl`} className={labelClass}>Minsta IRL-nivå (1–9)</label>
            <input id={`${uid}-irl`} className={inputClass} inputMode="numeric" value={v.min_irl_level} onChange={(e) => set('min_irl_level', e.target.value)} placeholder="Inget krav" />
          </div>
          <div>
            <label className={labelClass}>Slutrapport senast (dagar efter insatsens slut)</label>
            <input className={inputClass} inputMode="numeric" value={v.report_due_days} onChange={(e) => set('report_due_days', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Kompletteringsfrist (dagar)</label>
            <input className={inputClass} inputMode="numeric" value={v.changes_due_days} onChange={(e) => set('changes_due_days', e.target.value)} />
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-default bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-foreground">Finansiering (default per ansökan)</h2>
        <p className="mb-3 text-xs text-foreground-muted">Förifyller finansieringsblocket — ledningen kan ändra per ansökan. Statsstödsgrunden är en egen axel: en TVV-check kan vara de minimis, en excellenscheck art. 22.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass}>Projekt</label>
            <select className={inputClass} value={v.funding_project} onChange={(e) => { set('funding_project', e.target.value); set('default_work_package', ''); }}>
              <option value="">– inget –</option>
              {funding.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Arbetspaket</label>
            <select className={inputClass} value={v.default_work_package} onChange={(e) => set('default_work_package', e.target.value)} disabled={!v.funding_project}>
              <option value="">– inget –</option>
              {wps.map((w) => (
                <option key={w.id} value={w.id}>{w.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Statsstödsgrund</label>
            <select className={inputClass} value={v.default_state_aid_basis} onChange={(e) => set('default_state_aid_basis', e.target.value)}>
              {FUNDING_BASES.map((b) => (
                <option key={b} value={b}>{FUNDING_BASIS_LABELS[b]}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-default bg-surface p-5">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-base font-semibold text-foreground">Bedömningskriterier (viktade, 0–5)</h2>
          <span className="flex-1" />
          <button type="button" className={btnGhost} onClick={() => set('criteria', [...v.criteria, { key: `kriterium-${v.criteria.length + 1}`, label: '', weight: 1 }])}>
            <Icon name="plus" size={12} /> Kriterium
          </button>
        </div>
        <div className="space-y-2">
          {v.criteria.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input className={`${inputClass} flex-1`} value={c.label} placeholder="Kriterium" onChange={(e) => set('criteria', v.criteria.map((x, j) => (j === i ? { ...x, label: e.target.value, key: x.key.startsWith('kriterium-') || !x.key ? slugifyCriterionKey(e.target.value) || x.key : x.key } : x)))} />
              <input className={`${inputClass} w-20`} inputMode="numeric" value={c.weight} onChange={(e) => set('criteria', v.criteria.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) || 1 } : x)))} />
              <button type="button" className={btnGhost} aria-label="Ta bort" onClick={() => set('criteria', v.criteria.filter((_, j) => j !== i))}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={btnPrimary} disabled={pending || !v.title.trim()}>
          {pending ? 'Sparar…' : mode === 'create' ? 'Skapa checktyp' : 'Spara'}
        </button>
        <button type="button" className={btnGhost} onClick={() => router.push('/checkar/typer')}>Avbryt</button>
        {mode === 'edit' && typeId && (
          <button
            type="button"
            className="ml-auto text-xs text-foreground-subtle hover:underline"
            disabled={pending}
            onClick={() => {
              if (!confirm('Ta bort checktypen? Går bara om inga ansökningar finns.')) return;
              startTransition(async () => {
                const res = await deleteCheckTypeAction(typeId);
                if (res.error) setError(res.error);
                else {
                  router.push('/checkar/typer');
                  router.refresh();
                }
              });
            }}
          >
            Ta bort checktypen
          </button>
        )}
      </div>
    </form>
  );
}
