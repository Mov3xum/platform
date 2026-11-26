'use client';

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import {
  SPARK_ACCELERATOR_CATEGORIES,
  SPARK_CONSENTS,
  SPARK_CONSENT_LABELS,
  SPARK_MATCH_STATUSES,
  SPARK_MATCH_STATUS_LABELS,
  SPARK_SUPPORT_KINDS,
  SPARK_SUPPORT_KIND_LABELS,
  SPARK_TRL,
  SPARK_WORK_PACKAGES,
  buildSparkImportTemplateCsv,
  type SparkImportRow
} from '@platform/shared';
import { Icon } from '@/components/proto';
import {
  applySparkInterviewAction,
  assessSparkSolutionAction,
  commitSparkImportAction,
  createSparkMatchAction,
  deleteSparkInterviewAction,
  deleteSparkMatchAction,
  previewSparkImportAction,
  saveSparkOrganizationAction,
  setSparkRecordStatusAction,
  updateSparkActorAction,
  updateSparkMatchAction,
  type SparkActionState
} from '@/lib/actions/spark';
import { actionErrorMessage } from '@/lib/action-error';
import { Notice, btnDanger, btnGhost, btnPrimary, inputClass, labelClass } from '@/components/talent/ui';

/** Klientkontroller för SPARK (CLAUDE.md § 61) — tunna omslag kring server actions. */

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<SparkActionState>({});
  const run = (fn: () => Promise<SparkActionState>, after?: (s: SparkActionState) => void) =>
    start(async () => {
      try {
        const res = await fn();
        setState(res);
        if (res.ok) {
          after?.(res);
          router.refresh();
        }
      } catch (err) {
        setState({ error: actionErrorMessage(err, 'Något gick fel. Försök igen.') });
      }
    });
  return { pending, state, run };
}

function Feedback({ state }: { state: SparkActionState }) {
  if (state.error) return <Notice kind="error">{state.error}</Notice>;
  if (state.warning) return <Notice kind="warning">{state.warning}</Notice>;
  if (state.notice) return <Notice kind="notice">{state.notice}</Notice>;
  return null;
}

export function ApplyInterviewButton({ interviewId, label = 'För in i registret' }: { interviewId: string; label?: string }) {
  const { pending, state, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" className={btnPrimary} disabled={pending} onClick={() => run(() => applySparkInterviewAction(interviewId))}>
        <Icon name="check" size={14} /> {pending ? 'För in …' : label}
      </button>
      {state.error ? <span className="max-w-xs text-right text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">{state.error}</span> : null}
    </span>
  );
}

export function DeleteInterviewButton({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const { pending, state, run } = useAction();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        className={btnDanger}
        disabled={pending}
        onClick={() => {
          if (window.confirm('Ta bort intervjun? Det går inte att ångra.')) run(() => deleteSparkInterviewAction(interviewId), () => router.push('/spark/intervjuer'));
        }}
      >
        <Icon name="trash" size={12} /> Ta bort
      </button>
      {state.error ? <span className="text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">{state.error}</span> : null}
    </span>
  );
}

export function CreateMatchButton({ needId, solutionId, testbedId, label = 'Skapa matchning' }: { needId?: string; solutionId?: string; testbedId?: string; label?: string }) {
  const { pending, state, run } = useAction();
  if (state.ok) return <span className="text-xs font-semibold text-movexum-morkgron dark:text-movexum-pastell-gron">Tillagd som förslag</span>;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" className={btnGhost} disabled={pending} onClick={() => run(() => createSparkMatchAction({ needId, solutionId, testbedId }))}>
        <Icon name="plus" size={12} /> {pending ? 'Skapar …' : label}
      </button>
      {state.error ? <span className="max-w-xs text-right text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">{state.error}</span> : null}
    </span>
  );
}

export function RecordStatusSelect({ kind, id, value, options }: { kind: 'need' | 'solution' | 'testbed'; id: string; value: string; options: { id: string; label: string }[] }) {
  const { pending, state, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <select
        aria-label="Status"
        className="rounded-full border border-default bg-surface px-2.5 py-1 text-xs text-foreground-muted"
        defaultValue={value}
        disabled={pending}
        onChange={(e) => run(() => setSparkRecordStatusAction(kind, id, e.target.value))}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {state.error ? <span className="text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">{state.error}</span> : null}
    </span>
  );
}

export interface MatchFormValues {
  status: string;
  need_consent: string;
  solution_consent: string;
  next_step: string;
  next_step_due: string;
  notes: string;
  outcome: string;
  support_kind: string;
  support_confirmed: boolean;
  support_note: string;
  work_package: string;
}

export function MatchForm({ matchId, initial, hasNeedSide, hasSolution, canDelete }: { matchId: string; initial: MatchFormValues; hasNeedSide: boolean; hasSolution: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const { pending, state, run } = useAction();
  const set = <K extends keyof MatchFormValues>(k: K, val: MatchFormValues[K]) => setV((p) => ({ ...p, [k]: val }));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateSparkMatchAction(matchId, { ...v }));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass}>Status</label>
          <select className={inputClass} value={v.status} onChange={(e) => set('status', e.target.value)}>
            {SPARK_MATCH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SPARK_MATCH_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        {hasNeedSide ? (
          <div>
            <label className={labelClass}>Behovsägaren / testmiljön</label>
            <select className={inputClass} value={v.need_consent} onChange={(e) => set('need_consent', e.target.value)}>
              {SPARK_CONSENTS.map((c) => (
                <option key={c} value={c}>
                  {SPARK_CONSENT_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {hasSolution ? (
          <div>
            <label className={labelClass}>Innovationsaktören</label>
            <select className={inputClass} value={v.solution_consent} onChange={(e) => set('solution_consent', e.target.value)}>
              {SPARK_CONSENTS.map((c) => (
                <option key={c} value={c}>
                  {SPARK_CONSENT_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
        <div>
          <label className={labelClass}>Nästa steg</label>
          <input className={inputClass} maxLength={300} value={v.next_step} onChange={(e) => set('next_step', e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Senast</label>
          <input type="date" className={inputClass} value={v.next_step_due} onChange={(e) => set('next_step_due', e.target.value)} />
        </div>
      </div>
      <div>
        <label className={labelClass}>Anteckningar</label>
        <textarea className={`${inputClass} min-h-20`} maxLength={3000} value={v.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <div>
        <label className={labelClass}>Resultat och lärdomar</label>
        <textarea className={`${inputClass} min-h-16`} maxLength={2000} value={v.outcome} onChange={(e) => set('outcome', e.target.value)} />
      </div>
      <fieldset className="rounded-2xl border border-default bg-canvas-subtle p-4">
        <legend className="px-1 text-xs font-semibold text-foreground-muted">Statsstöd</legend>
        <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
          <div>
            <label className={labelClass}>Typ av insats</label>
            <select className={inputClass} value={v.support_kind} onChange={(e) => set('support_kind', e.target.value)}>
              {SPARK_SUPPORT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SPARK_SUPPORT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Arbetspaket</label>
            <select className={inputClass} value={v.work_package} onChange={(e) => set('work_package', e.target.value)}>
              <option value="">–</option>
              {SPARK_WORK_PACKAGES.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
        </div>
        {v.support_kind === 'de_minimis' ? (
          <div className="mt-3 space-y-3">
            <label className="flex items-start gap-2 text-sm text-foreground-muted">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={v.support_confirmed} onChange={(e) => set('support_confirmed', e.target.checked)} />
              <span>Stödet är registrerat och intyget om stöd av mindre betydelse är godkänt. Krävs innan piloten kan starta.</span>
            </label>
            <input className={inputClass} maxLength={500} placeholder="Referens, t.ex. beslut eller diarienummer" value={v.support_note} onChange={(e) => set('support_note', e.target.value)} />
          </div>
        ) : (
          <p className="mt-3 text-xs text-foreground-subtle">Kartläggning och matchning är systeminsatser (AP 1, 2 och 4). Välj stödinsats när ett enskilt företag får testbäddsanpassning, pilotstöd eller expertstöd (AP 3 eller AP 5).</p>
        )}
      </fieldset>
      <Feedback state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={btnPrimary} disabled={pending}>
          {pending ? 'Sparar …' : 'Spara'}
        </button>
        <span className="flex-1" />
        {canDelete ? (
          <button
            type="button"
            className={btnDanger}
            disabled={pending}
            onClick={() => {
              if (window.confirm('Ta bort matchningen?')) run(() => deleteSparkMatchAction(matchId), () => router.push('/spark/matchning'));
            }}
          >
            <Icon name="trash" size={12} /> Ta bort
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function AssessSolutionForm({ solutionId, trl, category, note, suggested }: { solutionId: string; trl: string; category: string; note: string; suggested: string | null }) {
  const [v, setV] = useState({ trl, category: category || suggested || '', note });
  const { pending, state, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => assessSparkSolutionAction(solutionId, v));
      }}
    >
      <div>
        <label className={labelClass}>Movexums TRL-bedömning</label>
        <select className={inputClass} value={v.trl} onChange={(e) => setV((p) => ({ ...p, trl: e.target.value }))}>
          <option value="">Inte bedömd</option>
          {SPARK_TRL.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Kategori</label>
        <select className={inputClass} value={v.category} onChange={(e) => setV((p) => ({ ...p, category: e.target.value }))}>
          <option value="">Inte kategoriserad</option>
          {SPARK_ACCELERATOR_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <input className={inputClass} maxLength={1000} placeholder="Motivering (valfri)" value={v.note} onChange={(e) => setV((p) => ({ ...p, note: e.target.value }))} />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className={btnGhost} disabled={pending}>
          {pending ? 'Sparar …' : 'Spara bedömning'}
        </button>
        {state.error ? <span className="text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">{state.error}</span> : null}
        {state.ok ? <span className="text-xs font-semibold text-movexum-morkgron dark:text-movexum-pastell-gron">Sparat</span> : null}
      </div>
    </form>
  );
}

export function ActorAdminForm({ actorId, notes, website, startup, status, startups }: { actorId: string; notes: string; website: string; startup: string; status: string; startups: { id: string; name: string }[] }) {
  const [v, setV] = useState({ notes, website, startup, status });
  const { pending, state, run } = useAction();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateSparkActorAction(actorId, v));
      }}
    >
      <div>
        <label className={labelClass}>Movexums anteckningar</label>
        <textarea className={`${inputClass} min-h-20`} maxLength={3000} value={v.notes} onChange={(e) => setV((p) => ({ ...p, notes: e.target.value }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass}>Webbplats</label>
          <input className={inputClass} maxLength={300} value={v.website} onChange={(e) => setV((p) => ({ ...p, website: e.target.value }))} />
        </div>
        <div>
          <label className={labelClass}>Portföljbolag</label>
          <select className={inputClass} value={v.startup} onChange={(e) => setV((p) => ({ ...p, startup: e.target.value }))}>
            <option value="">Inte ett portföljbolag</option>
            {startups.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Status</label>
          <select className={inputClass} value={v.status} onChange={(e) => setV((p) => ({ ...p, status: e.target.value }))}>
            <option value="active">Aktiv</option>
            <option value="archived">Arkiverad</option>
          </select>
        </div>
      </div>
      <Feedback state={state} />
      <button type="submit" className={btnGhost} disabled={pending}>
        {pending ? 'Sparar …' : 'Spara'}
      </button>
    </form>
  );
}

export function ImportForm({ canApply }: { canApply: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState<SparkImportRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [org, setOrg] = useState('');
  const [state, setState] = useState<SparkActionState>({});

  function downloadTemplate() {
    const blob = new Blob(['﻿', buildSparkImportTemplateCsv()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'spark-intervjumall.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnGhost} onClick={downloadTemplate}>
          <Icon name="download" size={14} /> Ladda ned mallen
        </button>
        <span className="text-xs text-foreground-subtle">Öppnas i Excel. En rad per företag — spara som Excel eller CSV och ladda upp nedan.</span>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setState({});
          start(async () => {
            try {
              const res = await previewSparkImportAction(fd);
              if (res.error) {
                setState({ error: res.error });
                setRows(null);
                return;
              }
              setRows(res.rows ?? []);
              setWarnings(res.warnings ?? []);
              setUnmapped(res.unmappedHeaders ?? []);
            } catch (err) {
              setState({ error: actionErrorMessage(err, 'Något gick fel. Försök igen.') });
            }
          });
        }}
      >
        <div>
          <label className={labelClass}>Fil (Excel eller CSV)</label>
          <input name="file" type="file" accept=".xlsx,.csv,text/csv" className={inputClass} required />
        </div>
        <div>
          <label className={labelClass}>Intervjuande organisation</label>
          <input className={inputClass} maxLength={160} value={org} placeholder="t.ex. Högskolan i Gävle" onChange={(e) => setOrg(e.target.value)} />
        </div>
        <button type="submit" className={btnPrimary} disabled={pending}>
          {pending ? 'Läser …' : 'Förhandsgranska'}
        </button>
      </form>
      <Feedback state={state} />
      {rows ? (
        <div className="space-y-3">
          {unmapped.length ? <Notice kind="warning">Kolumner som inte kändes igen och inte importeras: {unmapped.join(', ')}.</Notice> : null}
          {warnings.map((w) => (
            <Notice key={w} kind="warning">
              {w}
            </Notice>
          ))}
          <div className="overflow-x-auto rounded-2xl border border-default">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-canvas-subtle text-left text-xs text-foreground-subtle">
                <tr>
                  <th className="px-3 py-2 font-semibold">Rad</th>
                  <th className="px-3 py-2 font-semibold">Företag</th>
                  <th className="px-3 py-2 font-semibold">Behov</th>
                  <th className="px-3 py-2 font-semibold">Lösningar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-default">
                {rows.slice(0, 50).map((r) => (
                  <tr key={r.line}>
                    <td className="px-3 py-2 mx-tnum text-foreground-subtle">{r.line}</td>
                    <td className="px-3 py-2 font-medium text-foreground">{r.name}</td>
                    <td className="px-3 py-2 text-foreground-muted">{r.answers.needs.map((n) => String(n.title ?? '')).join(', ') || '–'}</td>
                    <td className="px-3 py-2 text-foreground-muted">{r.answers.solutions.map((s) => String(s.name ?? '')).join(', ') || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 50 ? <p className="text-xs text-foreground-subtle">Visar 50 av {rows.length} rader.</p> : null}
          <button
            type="button"
            className={btnPrimary}
            disabled={pending || rows.length === 0}
            onClick={() =>
              start(async () => {
                try {
                  const res = await commitSparkImportAction({ rows: rows.map((r) => ({ line: r.line, answers: r.answers })), interviewerOrg: org });
                  setState(res);
                  if (res.ok) {
                    setRows(null);
                    router.refresh();
                  }
                } catch (err) {
                  setState({ error: actionErrorMessage(err, 'Något gick fel. Försök igen.') });
                }
              })
            }
          >
            {pending ? 'Importerar …' : canApply ? `Importera ${rows.length} företag och för in i registret` : `Importera ${rows.length} företag och skicka till Movexum`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function OrganizationForm({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const { pending, state, run } = useAction();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveSparkOrganizationAction(value));
      }}
    >
      <div className="min-w-0 flex-1">
        <label className={labelClass} htmlFor="spark-organization">
          Din organisation
        </label>
        <input id="spark-organization" className={inputClass} maxLength={120} value={value} placeholder="t.ex. Sandvikens kommun" onChange={(e) => setValue(e.target.value)} />
      </div>
      <button type="submit" className={btnGhost} disabled={pending}>
        {pending ? 'Sparar …' : 'Spara'}
      </button>
      {state.error ? <span className="w-full text-xs text-movexum-morkorange dark:text-movexum-pastell-orange">{state.error}</span> : null}
      {state.ok ? <span className="w-full text-xs font-semibold text-movexum-morkgron dark:text-movexum-pastell-gron">Sparat — företagen ser namnet när de öppnar din länk.</span> : null}
    </form>
  );
}

/** Delningslänk + QR-kod (genereras lokalt) och en färdig text att skicka vidare. */
export function SharePanel({ path, message, children }: { path: string; message: string; children?: ReactNode }) {
  const [origin, setOrigin] = useState('');
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState<'link' | 'text' | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const url = origin ? `${origin}${path}` : '';
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: 'M' })
      .then((d) => {
        if (!cancelled) setQr(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url]);
  const text = `${message}\n\n${url}`;
  const copy = (what: 'link' | 'text') => {
    navigator.clipboard?.writeText(what === 'link' ? url : text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_200px]">
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Din länk</label>
          <div className="flex flex-wrap gap-2">
            <input className={`${inputClass} min-w-0 flex-1`} readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className={btnGhost} onClick={() => copy('link')}>
              <Icon name="copy" size={12} /> {copied === 'link' ? 'Kopierad' : 'Kopiera länk'}
            </button>
          </div>
        </div>
        <div>
          <label className={labelClass}>Text att skicka till företagen</label>
          <textarea className={`${inputClass} min-h-32`} readOnly value={text} />
          <button type="button" className={`${btnGhost} mt-2`} onClick={() => copy('text')}>
            <Icon name="copy" size={12} /> {copied === 'text' ? 'Kopierad' : 'Kopiera texten'}
          </button>
        </div>
        {children}
      </div>
      <div className="flex flex-col items-center gap-2">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="QR-kod till anmälan" className="h-44 w-44 rounded-xl border border-default bg-movexum-vit p-2" />
        ) : (
          <div className="h-44 w-44 rounded-xl border border-dashed border-default" />
        )}
        {qr ? (
          <a className={btnGhost} href={qr} download="spark-qr.png">
            <Icon name="download" size={12} /> Ladda ned QR-kod
          </a>
        ) : null}
      </div>
    </div>
  );
}
