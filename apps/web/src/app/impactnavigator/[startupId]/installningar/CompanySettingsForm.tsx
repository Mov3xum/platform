'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { deleteImpactCompanyAction, updateCompanyDetailsAction } from '@/lib/actions/impact';
import type { ImpactCompany } from '@/lib/impact/data';
import { phaseLabels } from '@/lib/labels';
import { btnDanger, btnPrimary, card, hintClass, inputClass, labelClass, noticeError, noticeGood } from '@/components/impact/ui';
import { ALL_PHASES } from '@platform/shared';

export function CompanySettingsForm({
  company,
  staff,
  canManage,
  canDelete,
  versions
}: {
  company: ImpactCompany;
  staff: Array<{ id: string; name: string }>;
  canManage: boolean;
  canDelete: boolean;
  versions: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await updateCompanyDetailsAction(company.id, {
        name: String(fd.get('name') ?? ''),
        industry: String(fd.get('industry') ?? ''),
        phase: String(fd.get('phase') ?? ''),
        journeyText: String(fd.get('journeyText') ?? ''),
        assignedTo: String(fd.get('assignedTo') ?? '')
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {saved ? <p role="status" className={noticeGood}>Bolagsuppgifterna har sparats.</p> : null}
      {error ? <p role="alert" className={noticeError}>{error}</p> : null}
      <form onSubmit={submit} className={card}>
        <h3 className="font-heading text-base font-semibold text-foreground">Grunduppgifter</h3>
        <p className={hintClass}>Namn, bransch och plats i Movexums program.</p>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <label className={`${labelClass} md:col-span-2`}>
            Bolagsnamn
            <input name="name" defaultValue={company.name} maxLength={120} required disabled={!canManage} className={`${inputClass} mt-1.5`} />
          </label>
          <label className={labelClass}>
            Bransch
            <input name="industry" defaultValue={company.industry} maxLength={160} required disabled={!canManage} className={`${inputClass} mt-1.5`} />
          </label>
          <label className={labelClass}>
            Fas
            <select name="phase" defaultValue={company.phase} disabled={!canManage} className={`${inputClass} mt-1.5`}>
              {ALL_PHASES.map((p) => (
                <option key={p} value={p}>
                  {phaseLabels[p]}
                </option>
              ))}
            </select>
          </label>
          <label className={`${labelClass} md:col-span-2`}>
            Bolagets hållbarhetsambitioner, vägval och arbete (underlag till analysen)
            <textarea name="journeyText" defaultValue={company.journeyText} rows={6} maxLength={20000} disabled={!canManage} className={`${inputClass} mt-1.5`} />
          </label>
          <label className={labelClass}>
            Ansvarig
            <select name="assignedTo" defaultValue={company.assignedTo ?? ''} disabled={!canManage} className={`${inputClass} mt-1.5`}>
              <option value="">–</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4">
          <p className="text-sm text-foreground-muted">Befintliga analysversioner ändras inte. De nya uppgifterna används nästa gång en analysversion skapas.</p>
          {canManage ? (
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? 'Sparar …' : 'Spara bolagsuppgifter'}
            </button>
          ) : null}
        </div>
      </form>

      {canDelete ? (
        <section className={card}>
          <h3 className="font-heading text-base font-semibold text-foreground">Ta bort ur Impact Navigator</h3>
          <p className="mt-1 text-sm text-foreground-muted">
            Raderar alla {versions} analysversioner, kompletteringsfrågor, dokument och AI-körningar för bolaget. Bolagskortet finns kvar i plattformen. Går inte att ångra.
          </p>
          <button
            type="button"
            disabled={deleting}
            className={`mt-3 ${btnDanger}`}
            onClick={() => {
              const typed = window.prompt(`Skriv bolagets namn (${company.name}) för att bekräfta borttagningen.`);
              if (typed?.trim() !== company.name) return;
              setError(null);
              startDelete(async () => {
                const res = await deleteImpactCompanyAction(company.id);
                if (res.error) {
                  setError(res.error);
                  return;
                }
                router.push(res.next ?? '/impactnavigator');
                router.refresh();
              });
            }}
          >
            {deleting ? 'Tar bort …' : 'Ta bort analysen'}
          </button>
        </section>
      ) : null}
    </div>
  );
}
