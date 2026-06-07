'use client';

import { useId, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addStodAction } from '@/lib/actions/de-minimis';
import {
  DE_MINIMIS_TEMPLATES,
  DE_MINIMIS_TEMPLATE_CUSTOM,
  DEFAULT_VAXELKURS_SEK_PER_EUR,
  FORORDNING_KODER,
  findDeMinimisTemplate,
  forordningLabels,
  type DeMinimisRegel,
  type ForordningKod
} from '@platform/shared';

const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const labelClass = 'mb-1 block text-xs font-semibold text-foreground-muted';

/**
 * Registreringsformulär för ett mottaget de minimis-stöd (CLAUDE.md § 20).
 *
 * Förenklat, mall-drivet flöde: välj stödgivare ur en färdig lista (förordning
 * + namn förifylls), fyll i belopp i kronor och beslutsdatum, spara. Ingen
 * enhets-/org.nr-hantering krävs — `addStodAction` skapar enheten lazy när bara
 * `startupId` skickas. EUR (legalt tak) härleds ur SEK × kurs men kan anges
 * exakt.
 */
export function AddStodForm({
  unitId,
  startupId,
  regelverk
}: {
  /** Befintlig enhet (fullskärmsvyn). Utelämnas i det förenklade flödet. */
  unitId?: string;
  /** Bolaget — används när ingen `unitId` finns (enheten skapas lazy). */
  startupId?: string;
  regelverk: DeMinimisRegel[];
}) {
  const router = useRouter();
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [templateId, setTemplateId] = useState<string>(DE_MINIMIS_TEMPLATES[0]?.id ?? DE_MINIMIS_TEMPLATE_CUSTOM);
  const [stodgivare, setStodgivare] = useState<string>(DE_MINIMIS_TEMPLATES[0]?.stodgivare ?? '');
  const [forordning, setForordning] = useState<ForordningKod>(DE_MINIMIS_TEMPLATES[0]?.forordning ?? 'ALLMAN');
  const [syfte, setSyfte] = useState<string>(DE_MINIMIS_TEMPLATES[0]?.hint ?? '');

  const [sek, setSek] = useState('');
  const [kurs, setKurs] = useState(String(DEFAULT_VAXELKURS_SEK_PER_EUR));
  const [eur, setEur] = useState('');

  const [isPending, startTransition] = useTransition();

  const isCustom = templateId === DE_MINIMIS_TEMPLATE_CUSTOM;

  const derivedEur = useMemo(() => {
    if (eur) return null;
    const s = Number(sek);
    const k = Number(kurs);
    if (s > 0 && k > 0) return (s / k).toFixed(2);
    return null;
  }, [eur, sek, kurs]);

  const onTemplateChange = (id: string) => {
    setTemplateId(id);
    const tpl = findDeMinimisTemplate(id);
    if (tpl) {
      setStodgivare(tpl.stodgivare);
      setForordning(tpl.forordning);
      if (tpl.hint) setSyfte(tpl.hint);
    } else {
      // "Annan" — låt fälten vara redigerbara, töm namnet för fritext.
      setStodgivare('');
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setWarnings([]);
    const fd = new FormData(e.currentTarget);
    // Skicka enhet ELLER bolag (enheten skapas lazy i actionen vid bara bolag).
    if (unitId) fd.set('unitId', unitId);
    else if (startupId) fd.set('startupId', startupId);
    fd.set('forordning', forordning);
    fd.set('stodgivare', stodgivare);
    startTransition(async () => {
      const result = await addStodAction(fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      setWarnings(result.warnings ?? []);
      formRef.current?.reset();
      setSek('');
      setEur('');
      setKurs(String(DEFAULT_VAXELKURS_SEK_PER_EUR));
      router.refresh();
    });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`template-${uid}`}>
            Stödgivare (välj mall) *
          </label>
          <select
            id={`template-${uid}`}
            value={templateId}
            onChange={(e) => onTemplateChange(e.target.value)}
            className={inputClass}
          >
            {DE_MINIMIS_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.stodgivare} – {forordningLabels[t.forordning]}
              </option>
            ))}
            <option value={DE_MINIMIS_TEMPLATE_CUSTOM}>Annan stödgivare…</option>
          </select>
        </div>

        {isCustom ? (
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor={`stodgivare-${uid}`}>
              Namn på stödgivare *
            </label>
            <input
              id={`stodgivare-${uid}`}
              value={stodgivare}
              onChange={(e) => setStodgivare(e.target.value)}
              required
              maxLength={200}
              placeholder="t.ex. Region Gävleborg"
              className={inputClass}
            />
          </div>
        ) : null}

        <div>
          <label className={labelClass} htmlFor={`forordning-${uid}`}>
            Förordning *
          </label>
          <select
            id={`forordning-${uid}`}
            value={forordning}
            onChange={(e) => setForordning(e.target.value as ForordningKod)}
            className={inputClass}
          >
            {FORORDNING_KODER.map((kod) => {
              const regel = regelverk.find((r) => r.kod === kod);
              return (
                <option key={kod} value={kod}>
                  {forordningLabels[kod]}
                  {regel ? ` (${Math.round(regel.tak_eur).toLocaleString('sv-SE')} EUR)` : ''}
                </option>
              );
            })}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor={`beslutsdatum-${uid}`}>
            Beslutsdatum *
          </label>
          <input id={`beslutsdatum-${uid}`} name="beslutsdatum" type="date" required className={inputClass} />
        </div>

        <div>
          <label className={labelClass} htmlFor={`belopp_sek-${uid}`}>
            Belopp (SEK) *
          </label>
          <input
            id={`belopp_sek-${uid}`}
            name="belopp_sek"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            required
            value={sek}
            onChange={(e) => setSek(e.target.value)}
            placeholder="Mottaget belopp i kronor"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor={`valutakurs-${uid}`}>
            Valutakurs (SEK per EUR) *
          </label>
          <input
            id={`valutakurs-${uid}`}
            name="valutakurs"
            type="number"
            min="0"
            step="0.000001"
            inputMode="decimal"
            required
            value={kurs}
            onChange={(e) => setKurs(e.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-foreground-subtle">
            Förifylld – justera mot ECB-kursen på beslutsdatumet om du har den.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`belopp_eur-${uid}`}>
            Belopp (EUR) – legalt tak
          </label>
          <input
            id={`belopp_eur-${uid}`}
            name="belopp_eur"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={eur}
            onChange={(e) => setEur(e.target.value)}
            placeholder={derivedEur ?? 'Beräknas ur SEK / kurs'}
            className={inputClass}
          />
          {derivedEur ? (
            <p className="mt-1 text-[11px] text-foreground-subtle">
              Beräknat ur SEK / kurs: {Number(derivedEur).toLocaleString('sv-SE')} EUR (sparas om EUR
              lämnas tomt). Står ett exakt EUR-belopp i beslutet – ange det här.
            </p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`beslut_referens-${uid}`}>
            Beslutsreferens (diarienr)
          </label>
          <input id={`beslut_referens-${uid}`} name="beslut_referens" maxLength={200} className={inputClass} />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`syfte-${uid}`}>
            Syfte
          </label>
          <input
            id={`syfte-${uid}`}
            name="syfte"
            maxLength={500}
            value={syfte}
            onChange={(e) => setSyfte(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor={`dokument-${uid}`}>
            Beslut (PDF/bild, valfritt)
          </label>
          <input
            id={`dokument-${uid}`}
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
