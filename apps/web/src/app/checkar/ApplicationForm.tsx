'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  SUPPORT_CHECK_MAX_ACTIVITIES,
  emptySupportCheckActivity,
  sumActivityCosts,
  type SupportCheckActivity
} from '@platform/shared';
import { createApplicationAction, updateApplicationDraftAction } from '@/lib/actions/support-checks';
import { Icon } from '@/components/proto';
import type { FormOption } from './form-data';
import { Notice, btnGhost, btnPrimary, inputClass, labelClass } from './ui';

export interface CheckTypeOption extends FormOption {
  description?: string | null;
  maxAmountSek?: number | null;
  requiresFinalReport?: boolean;
}

export interface ApplicationFormValues {
  checkTypeId: string;
  startupId: string;
  title: string;
  activities: SupportCheckActivity[];
  requested_amount_sek: string;
  activity_end_date: string;
  applicant_note: string;
}

/**
 * Ansökningsformuläret (§ 46) — digital motsvarighet till mallen
 * "Aktivitetsplan & ansökan": 1–n insatser med beskrivning, deltagare,
 * kostnad och spetskompetens, plus följebrev. Sparas som UTKAST; inskick +
 * signering görs på ärendesidan så att firmatecknaren ser exakt det som
 * signeras. Deltagarfältet innehåller personnamn — det visas bara för
 * bolaget och Movexums handläggare och når aldrig AI.
 */
export function ApplicationForm({
  mode,
  applicationId,
  types,
  startups,
  initial,
  lockStartup
}: {
  mode: 'create' | 'edit';
  applicationId?: string;
  types: CheckTypeOption[];
  startups: FormOption[];
  initial?: Partial<ApplicationFormValues>;
  lockStartup?: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [values, setValues] = useState<ApplicationFormValues>({
    checkTypeId: initial?.checkTypeId ?? types[0]?.id ?? '',
    startupId: initial?.startupId ?? startups[0]?.id ?? '',
    title: initial?.title ?? '',
    activities: initial?.activities?.length ? initial.activities : [emptySupportCheckActivity(0)],
    requested_amount_sek: initial?.requested_amount_sek ?? '',
    activity_end_date: initial?.activity_end_date ?? '',
    applicant_note: initial?.applicant_note ?? ''
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const type = types.find((t) => t.id === values.checkTypeId) ?? null;
  const sum = sumActivityCosts(values.activities);

  const set = <K extends keyof ApplicationFormValues>(k: K, v: ApplicationFormValues[K]) => setValues((s) => ({ ...s, [k]: v }));
  const setActivity = (i: number, patch: Partial<SupportCheckActivity>) =>
    setValues((s) => ({ ...s, activities: s.activities.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const payload = {
        title: values.title,
        activities: values.activities,
        requested_amount_sek: values.requested_amount_sek || null,
        activity_end_date: values.activity_end_date || null,
        applicant_note: values.applicant_note
      };
      const res =
        mode === 'create'
          ? await createApplicationAction({ checkTypeId: values.checkTypeId, startupId: values.startupId, ...payload })
          : await updateApplicationDraftAction(applicationId!, payload);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(res.path ?? '/checkar');
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && <Notice kind="error">{error}</Notice>}

      <section className="rounded-3xl border border-default bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-foreground">Vad söker ni?</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-type`} className={labelClass}>
              Stödcheck
            </label>
            <select id={`${uid}-type`} className={inputClass} value={values.checkTypeId} disabled={mode === 'edit'} onChange={(e) => set('checkTypeId', e.target.value)}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            {type?.description && <p className="mt-2 whitespace-pre-line text-xs text-foreground-muted">{type.description}</p>}
            {type?.maxAmountSek ? <p className="mt-1 text-xs text-foreground-subtle">Max {Math.round(type.maxAmountSek).toLocaleString('sv-SE')} kr per check.</p> : null}
          </div>
          <div>
            <label htmlFor={`${uid}-startup`} className={labelClass}>
              Bolag
            </label>
            <select id={`${uid}-startup`} className={inputClass} value={values.startupId} disabled={mode === 'edit' || lockStartup} onChange={(e) => set('startupId', e.target.value)}>
              {startups.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${uid}-title`} className={labelClass}>
              Rubrik på ansökan
            </label>
            <input id={`${uid}-title`} className={inputClass} value={values.title} onChange={(e) => set('title', e.target.value)} placeholder="T.ex. Marknadsundersökning Norden" maxLength={200} />
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-default bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-foreground">Insatser i prioriteringsordning</h2>
          <span className="flex-1" />
          {values.activities.length < SUPPORT_CHECK_MAX_ACTIVITIES && (
            <button type="button" className={btnGhost} onClick={() => set('activities', [...values.activities, emptySupportCheckActivity(values.activities.length)])}>
              <Icon name="plus" size={12} /> Lägg till insats
            </button>
          )}
        </div>
        <p className="mb-4 text-xs text-foreground-muted">
          Beskriv aktiviteten, vad som ska uppnås, vad insatsen omfattar, varför den är prioriterad och en grov tidplan. Om fler insatser söks, beskriv hur ni avsätter resurser i följebrevet nedan.
        </p>
        <div className="space-y-4">
          {values.activities.map((a, i) => (
            <div key={a.id} className="rounded-2xl border border-default p-4">
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-brand-foreground">Insats {i + 1}</span>
                <input className={`${inputClass} flex-1`} value={a.title} onChange={(e) => setActivity(i, { title: e.target.value })} placeholder="Rubrik, t.ex. Kundbesök i Oslo" maxLength={200} />
                {values.activities.length > 1 && (
                  <button type="button" className={btnGhost} aria-label="Ta bort insats" onClick={() => set('activities', values.activities.filter((_, j) => j !== i))}>
                    <Icon name="trash" size={12} />
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelClass}>Beskriv aktiviteten, målet, omfattningen, varför den är prioriterad och tidplanen</label>
                  <textarea className={`${inputClass} min-h-[110px]`} value={a.description} onChange={(e) => setActivity(i, { description: e.target.value })} maxLength={4000} />
                </div>
                <div>
                  <label className={labelClass}>Vem/vilka från bolaget medverkar?</label>
                  <textarea className={`${inputClass} min-h-[60px]`} value={a.participants} onChange={(e) => setActivity(i, { participants: e.target.value })} maxLength={1000} placeholder="Roller och namn — inga personnummer" />
                </div>
                <div>
                  <label className={labelClass}>Behövs spetskompetens? Beskriv behovet.</label>
                  <textarea className={`${inputClass} min-h-[60px]`} value={a.expert_need} onChange={(e) => setActivity(i, { expert_need: e.target.value })} maxLength={2000} />
                </div>
                <div>
                  <label className={labelClass}>Grov uppskattad kostnad (kr)</label>
                  <input className={inputClass} inputMode="numeric" value={a.cost_sek ?? ''} onChange={(e) => setActivity(i, { cost_sek: e.target.value === '' ? null : Number(e.target.value.replace(/\s/g, '').replace(',', '.')) })} />
                </div>
                <div>
                  <label className={labelClass}>Planerat slutdatum</label>
                  <input type="date" className={inputClass} value={a.ends_at ?? ''} onChange={(e) => setActivity(i, { ends_at: e.target.value || null })} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-default bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-foreground">Belopp och följebrev</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-amount`} className={labelClass}>
              Sökt belopp (kr)
            </label>
            <input id={`${uid}-amount`} className={inputClass} inputMode="numeric" value={values.requested_amount_sek} onChange={(e) => set('requested_amount_sek', e.target.value)} placeholder={sum > 0 ? String(Math.round(sum)) : ''} />
            <p className="mt-1 text-xs text-foreground-subtle">Lämnas tomt = summan av insatserna ({Math.round(sum).toLocaleString('sv-SE')} kr).</p>
          </div>
          <div>
            <label htmlFor={`${uid}-end`} className={labelClass}>
              Planerat slut för hela insatsen
            </label>
            <input id={`${uid}-end`} type="date" className={inputClass} value={values.activity_end_date} onChange={(e) => set('activity_end_date', e.target.value)} />
            <p className="mt-1 text-xs text-foreground-subtle">Styr när slutrapport väntas. Lämnas tomt = senaste insatsens slutdatum.</p>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${uid}-note`} className={labelClass}>
              Följebrev — hur avsätter ni resurser för arbetet? (valfritt)
            </label>
            <textarea id={`${uid}-note`} className={`${inputClass} min-h-[90px]`} value={values.applicant_note} onChange={(e) => set('applicant_note', e.target.value)} maxLength={5000} />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={btnPrimary} disabled={pending || !values.checkTypeId || !values.startupId}>
          {pending ? 'Sparar…' : mode === 'create' ? 'Spara utkast' : 'Spara ändringar'}
        </button>
        <button type="button" className={btnGhost} onClick={() => router.back()}>
          Avbryt
        </button>
        <span className="text-xs text-foreground-subtle">Inskick och signering görs på ärendesidan när utkastet är klart.</span>
      </div>
    </form>
  );
}
