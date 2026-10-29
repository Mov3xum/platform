'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { createImpactCompanyAction } from '@/lib/actions/impact';
import { phaseLabels } from '@/lib/labels';
import { ALL_PHASES } from '@platform/shared';

const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const labelClass = 'mb-1 block text-xs font-semibold text-foreground-muted';
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60';

interface StartupOption {
  id: string;
  name: string;
  hasAnalysis: boolean;
  journeyText: string;
}

/**
 * Steg 0 i Impact Navigator (§ 56): välj bolagskort (eller skapa ett nytt
 * bolag), beskriv bolagets resa och vem som är ansvarig. Analysen (första
 * versionen) skapas som "väntar på väsentlighetsanalys"; underlag laddas upp
 * på bolagets sida innan AI-steget startas av en människa.
 */
export function NewImpactCompanyForm({
  startups,
  staff,
  meId,
  preselectedStartup
}: {
  startups: StartupOption[];
  staff: Array<{ id: string; name: string }>;
  meId: string;
  preselectedStartup: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<'existing' | 'new'>(preselectedStartup || startups.length > 0 ? 'existing' : 'new');
  const [startupId, setStartupId] = useState(preselectedStartup);
  const [journey, setJourney] = useState(startups.find((s) => s.id === preselectedStartup)?.journeyText ?? '');
  const [error, setError] = useState<string | null>(null);

  const selected = startups.find((s) => s.id === startupId);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const input: Record<string, unknown> = {
      journeyText: journey,
      assignedTo: String(fd.get('assignedTo') ?? '')
    };
    if (mode === 'existing') {
      if (!startupId) {
        setError('Välj ett bolag.');
        return;
      }
      input.startupId = startupId;
    } else {
      input.name = String(fd.get('name') ?? '');
      input.phase = String(fd.get('phase') ?? '');
      input.industry = String(fd.get('industry') ?? '');
    }
    start(async () => {
      const res = await createImpactCompanyAction(input);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(`/impactnavigator/${res.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode('existing')} className={`rounded-full px-3 py-1.5 text-sm font-medium ${mode === 'existing' ? 'bg-brand text-brand-foreground' : 'border border-default text-foreground-muted'}`}>
          Befintligt bolagskort
        </button>
        <button type="button" onClick={() => setMode('new')} className={`rounded-full px-3 py-1.5 text-sm font-medium ${mode === 'new' ? 'bg-brand text-brand-foreground' : 'border border-default text-foreground-muted'}`}>
          Nytt bolag
        </button>
      </div>

      {mode === 'existing' ? (
        <div>
          <label className={labelClass} htmlFor="startup">Bolag</label>
          <select
            id="startup"
            className={inputClass}
            value={startupId}
            onChange={(e) => {
              setStartupId(e.target.value);
              const s = startups.find((x) => x.id === e.target.value);
              if (s?.journeyText && !journey) setJourney(s.journeyText);
            }}
          >
            <option value="">Välj bolag …</option>
            {startups.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.hasAnalysis ? ' (har analys — ny version)' : ''}
              </option>
            ))}
          </select>
          {selected?.hasAnalysis ? <p className="mt-1 text-xs text-foreground-muted">Bolaget har redan en analys. En ny version skapas; använd hellre Uppdatering på bolagets sida om ni bara vill komplettera.</p> : null}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="name">Bolagets namn</label>
            <input id="name" name="name" className={inputClass} required maxLength={200} />
          </div>
          <div>
            <label className={labelClass} htmlFor="phase">Fas</label>
            <select id="phase" name="phase" className={inputClass} defaultValue="lead">
              {ALL_PHASES.map((p) => (
                <option key={p} value={p}>{phaseLabels[p]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="industry">Bransch</label>
            <input id="industry" name="industry" className={inputClass} maxLength={200} placeholder="t.ex. HealthTech" />
          </div>
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="journey">Bolagets resa</label>
        <textarea id="journey" className={inputClass} rows={6} value={journey} onChange={(e) => setJourney(e.target.value)} maxLength={20000} placeholder="Vad gör bolaget, för vem, var står det i dag och vart är det på väg? Det här är kontexten analysen utgår från." required />
        <p className="mt-1 text-xs text-foreground-subtle">Skriv inte personuppgifter — texten går till AI-analysen (Mistral, EU).</p>
      </div>

      <div>
        <label className={labelClass} htmlFor="assignedTo">Ansvarig</label>
        <select id="assignedTo" name="assignedTo" className={inputClass} defaultValue={meId}>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {error ? <p className="rounded-xl border border-movexum-orange/40 bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange">{error}</p> : null}
      <div className="flex justify-end">
        <button type="submit" className={btnPrimary} disabled={pending}>{pending ? 'Skapar …' : 'Skapa analys'}</button>
      </div>
    </form>
  );
}
