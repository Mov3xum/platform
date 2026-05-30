'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addStodAction } from '@/lib/actions/de-minimis';
import { FORORDNING_KODER, forordningLabels, type DeMinimisRegel } from '@platform/shared';

const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const labelClass = 'mb-1 block text-xs font-semibold text-foreground-muted';

export function AddStodForm({
  unitId,
  regelverk
}: {
  unitId: string;
  regelverk: DeMinimisRegel[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sek, setSek] = useState('');
  const [kurs, setKurs] = useState('');
  const [eur, setEur] = useState('');
  const [isPending, startTransition] = useTransition();

  const derivedEur =
    !eur && Number(sek) > 0 && Number(kurs) > 0
      ? (Number(sek) / Number(kurs)).toFixed(2)
      : null;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setWarnings([]);
    const fd = new FormData(e.currentTarget);
    fd.set('unitId', unitId);
    startTransition(async () => {
      const result = await addStodAction(fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      setWarnings(result.warnings ?? []);
      formRef.current?.reset();
      setSek('');
      setKurs('');
      setEur('');
      router.refresh();
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor={`forordning-${unitId}`}>
            Förordning *
          </label>
          <select id={`forordning-${unitId}`} name="forordning" required className={inputClass} defaultValue="ALLMAN">
            {FORORDNING_KODER.map((kod) => {
              const regel = regelverk.find((r) => r.kod === kod);
              return (
                <option key={kod} value={kod}>
                  {forordningLabels[kod]}
                  {regel ? ` – ${regel.forordning_text} (${Math.round(regel.tak_eur).toLocaleString('sv-SE')} EUR)` : ''}
                </option>
              );
            })}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor={`stodgivare-${unitId}`}>
            Stödgivare *
          </label>
          <input
            id={`stodgivare-${unitId}`}
            name="stodgivare"
            required
            maxLength={200}
            placeholder="t.ex. Vinnova, Region Gävleborg"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`beslutsdatum-${unitId}`}>
            Beslutsdatum *
          </label>
          <input
            id={`beslutsdatum-${unitId}`}
            name="beslutsdatum"
            type="date"
            required
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`belopp_eur-${unitId}`}>
            Belopp (EUR) *
          </label>
          <input
            id={`belopp_eur-${unitId}`}
            name="belopp_eur"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={eur}
            onChange={(e) => setEur(e.target.value)}
            placeholder={derivedEur ?? 'Bruttobidragsekvivalent'}
            className={inputClass}
          />
          {derivedEur ? (
            <p className="mt-1 text-[11px] text-foreground-subtle">
              Beräknat ur SEK/kurs: {Number(derivedEur).toLocaleString('sv-SE')} EUR (sparas om EUR lämnas tomt)
            </p>
          ) : null}
        </div>
        <div>
          <label className={labelClass} htmlFor={`belopp_sek-${unitId}`}>
            Belopp (SEK)
          </label>
          <input
            id={`belopp_sek-${unitId}`}
            name="belopp_sek"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={sek}
            onChange={(e) => setSek(e.target.value)}
            placeholder="Informativt"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor={`valutakurs-${unitId}`}>
            Valutakurs (SEK per EUR)
          </label>
          <input
            id={`valutakurs-${unitId}`}
            name="valutakurs"
            type="number"
            min="0"
            step="0.000001"
            inputMode="decimal"
            value={kurs}
            onChange={(e) => setKurs(e.target.value)}
            placeholder="ECB-kurs på beslutsdatum"
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`beslut_referens-${unitId}`}>
            Beslutsreferens (diarienr)
          </label>
          <input
            id={`beslut_referens-${unitId}`}
            name="beslut_referens"
            maxLength={200}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`syfte-${unitId}`}>
            Syfte
          </label>
          <input id={`syfte-${unitId}`} name="syfte" maxLength={500} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`dokument-${unitId}`}>
            Beslut (PDF/bild, valfritt)
          </label>
          <input
            id={`dokument-${unitId}`}
            name="dokument"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.xls,.xlsx,.doc,.docx"
            className="w-full text-sm text-foreground-muted file:mr-3 file:rounded-lg file:border-0 file:bg-canvas-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground-muted">
        <input type="checkbox" name="registrerad_i_eair" className="h-4 w-4 rounded border-default" />
        Registrerat i eAir
      </label>

      {error ? (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {error}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <div className="rounded-xl bg-movexum-pastell-gul px-3 py-2 text-sm text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60"
      >
        {isPending ? 'Registrerar…' : 'Registrera stöd'}
      </button>
    </form>
  );
}
