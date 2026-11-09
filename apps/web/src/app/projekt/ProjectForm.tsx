'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  FUNDING_BASES,
  FUNDING_BASIS_LABELS,
  FUNDING_PROJECT_KINDS,
  FUNDING_PROJECT_KIND_LABELS,
  FUNDING_PROJECT_STATUSES,
  FUNDING_PROJECT_STATUS_LABELS
} from '@platform/shared';
import { createFundingProjectAction, updateFundingProjectAction } from '@/lib/actions/funding';
import type { FormOption } from '@/app/checkar/form-data';
import { Notice, btnGhost, btnPrimary, inputClass, labelClass } from '@/app/checkar/ui';

export interface ProjectFormValues {
  title: string;
  kind: string;
  status: string;
  funder: string;
  diarienummer: string;
  description: string;
  budget_sek: string;
  starts_at: string;
  ends_at: string;
  default_state_aid_basis: string;
  default_stodgivare: string;
  responsible: string;
}

export const EMPTY_PROJECT: ProjectFormValues = {
  title: '',
  kind: 'vinnova',
  status: 'active',
  funder: '',
  diarienummer: '',
  description: '',
  budget_sek: '',
  starts_at: '',
  ends_at: '',
  default_state_aid_basis: 'de_minimis',
  default_stodgivare: '',
  responsible: ''
};

/** Finansieringsprojekt (§ 46.3): kassan ett stöd tas ur. Ledning. */
export function ProjectForm({ mode, projectId, initial, people }: { mode: 'create' | 'edit'; projectId?: string; initial?: Partial<ProjectFormValues>; people: FormOption[] }) {
  const router = useRouter();
  const uid = useId();
  const [v, setV] = useState<ProjectFormValues>({ ...EMPTY_PROJECT, ...initial });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof ProjectFormValues>(k: K, val: ProjectFormValues[K]) => setV((s) => ({ ...s, [k]: val }));

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload = { ...v, budget_sek: v.budget_sek || null, starts_at: v.starts_at || null, ends_at: v.ends_at || null, responsible: v.responsible || null };
      const res = mode === 'create' ? await createFundingProjectAction(payload) : await updateFundingProjectAction(projectId!, payload);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(res.path ?? '/projekt');
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && <Notice kind="error">{error}</Notice>}
      <section className="rounded-3xl border border-default bg-surface p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor={`${uid}-t`} className={labelClass}>Titel</label>
            <input id={`${uid}-t`} className={inputClass} value={v.title} onChange={(e) => set('title', e.target.value)} required maxLength={200} placeholder="T.ex. Vinnova Excellens 2026–2027" />
          </div>
          <div>
            <label className={labelClass}>Finansiär</label>
            <select className={inputClass} value={v.kind} onChange={(e) => set('kind', e.target.value)}>
              {FUNDING_PROJECT_KINDS.map((k) => (
                <option key={k} value={k}>{FUNDING_PROJECT_KIND_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select className={inputClass} value={v.status} onChange={(e) => set('status', e.target.value)}>
              {FUNDING_PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>{FUNDING_PROJECT_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Finansiärens namn (fritext)</label>
            <input className={inputClass} value={v.funder} onChange={(e) => set('funder', e.target.value)} maxLength={200} placeholder="Vinnova / Tillväxtverket / Region Gävleborg" />
          </div>
          <div>
            <label className={labelClass}>Diarienummer</label>
            <input className={inputClass} value={v.diarienummer} onChange={(e) => set('diarienummer', e.target.value)} maxLength={80} />
          </div>
          <div>
            <label className={labelClass}>Budget för stöd till bolag (kr)</label>
            <input className={inputClass} inputMode="numeric" value={v.budget_sek} onChange={(e) => set('budget_sek', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Ansvarig</label>
            <select className={inputClass} value={v.responsible} onChange={(e) => set('responsible', e.target.value)}>
              <option value="">–</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Startar</label>
            <input type="date" className={inputClass} value={v.starts_at} onChange={(e) => set('starts_at', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Slutar</label>
            <input type="date" className={inputClass} value={v.ends_at} onChange={(e) => set('ends_at', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Default statsstödsgrund för checkar</label>
            <select className={inputClass} value={v.default_state_aid_basis} onChange={(e) => set('default_state_aid_basis', e.target.value)}>
              {FUNDING_BASES.map((b) => (
                <option key={b} value={b}>{FUNDING_BASIS_LABELS[b]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Stödgivare på de minimis-posten</label>
            <input className={inputClass} value={v.default_stodgivare} onChange={(e) => set('default_stodgivare', e.target.value)} maxLength={200} placeholder="Movexum (Vinnova Excellens)" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Beskrivning</label>
            <textarea className={`${inputClass} min-h-[80px]`} value={v.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
          </div>
        </div>
      </section>
      <div className="flex gap-3">
        <button type="submit" className={btnPrimary} disabled={pending || !v.title.trim()}>{pending ? 'Sparar…' : mode === 'create' ? 'Skapa projekt' : 'Spara'}</button>
        <button type="button" className={btnGhost} onClick={() => router.back()}>Avbryt</button>
      </div>
    </form>
  );
}
