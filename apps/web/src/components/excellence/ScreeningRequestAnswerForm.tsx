'use client';

import { useActionState, useState } from 'react';
import {
  IRL_AXES,
  MATURITY_PHASES,
  MATURITY_PHASE_LABEL,
  SCREENING_CONDITION_QUESTION,
  SCREENING_EXCELLENCE_QUESTION,
  SCREENING_MAX_FOUNDERS,
  SCREENING_NOTE_MAX,
  SCREENING_REQUEST_DOCUMENT_MAX,
  SCREENING_REQUEST_KIND_LABEL,
  SCREENING_VINNOVA_QUESTION,
  type IrlAxis,
  type ScreeningFounderFact,
  type ScreeningQuestionMeta,
  type ScreeningRequestAnswer,
  type ScreeningRequestItem
} from '@platform/shared';
import { answerScreeningRequestAction, type AnswerScreeningRequestState } from '@/lib/actions/screening-requests';

// Svarsformuläret för en begäran om komplettering (CLAUDE.md § 51.6). Samma
// formulär för coachen och för bolaget (Mitt bolag): varje punkt får en
// inmatning efter sin sort; svaren skickas som JSON och normaliseras
// server-side (klienten är aldrig gränsen). Delvis ifyllt går att spara —
// resten besvaras senare. Skriv aldrig personnummer (saneras på skrivvägen).

interface Prefill {
  founders?: ScreeningFounderFact[];
  maturity_phase?: ScreeningRequestAnswer['maturity_phase'];
  research_spinoff?: boolean;
}

interface Props {
  requestId: string;
  items: ScreeningRequestItem[];
  prefill?: Prefill;
  /** Vem som läser formuläret — styr hjälptexterna. */
  viewer: 'coach' | 'startup';
  readOnly?: boolean;
}

const inputCls =
  'block w-full rounded-xl border border-default bg-canvas px-3 py-1.5 text-[12.5px] text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila disabled:opacity-60';
const IRL_LABEL: Record<IrlAxis, string> = { crl: 'CRL — kund', brl: 'BRL — affär', tmrl: 'TMRL — teknik', srl: 'SRL — hållbarhet' };
const OK_TONE = 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron';
const WARN_TONE = 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul';

type Answers = Record<string, ScreeningRequestAnswer>;

function initialAnswers(items: ScreeningRequestItem[], prefill?: Prefill): Answers {
  const a: Answers = {};
  for (const i of items) {
    if (i.answer) a[i.key] = i.answer;
    else if (i.kind === 'founders' && prefill?.founders && prefill.founders.length > 0) {
      a[i.key] = { founders: prefill.founders, maturity_phase: prefill.maturity_phase, research_spinoff: prefill.research_spinoff };
    }
  }
  return a;
}

function num(v: string): number | undefined {
  const n = Number(v.replace(/\s/g, '').replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
}

function VerdictInput({ meta, value, onChange, disabled }: { meta: ScreeningQuestionMeta; value?: ScreeningRequestAnswer; onChange: (v: ScreeningRequestAnswer | undefined) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(200px,260px)_minmax(0,1fr)]">
      <select
        aria-label={`${meta.question} — svar`}
        value={value?.verdict ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === 'yes' || v === 'no' ? { ...(value ?? {}), verdict: v } : undefined);
        }}
        className={inputCls}
      >
        <option value="">Välj svar</option>
        <option value="yes">{meta.fulfilled}</option>
        <option value="no">{meta.failed}</option>
      </select>
      <input
        aria-label={`${meta.question} — motivering`}
        value={value?.note ?? ''}
        maxLength={SCREENING_NOTE_MAX}
        disabled={disabled || !value?.verdict}
        placeholder="Motivering/källa (bolagsordning, protokoll, intyg …)"
        onChange={(e) => onChange(value?.verdict ? { ...value, note: e.target.value || undefined } : undefined)}
        className={inputCls}
      />
    </div>
  );
}

const initialState: AnswerScreeningRequestState = {};

export function ScreeningRequestAnswerForm({ requestId, items, prefill, viewer, readOnly }: Props) {
  const [state, formAction, pending] = useActionState(answerScreeningRequestAction, initialState);
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers(items, prefill));
  const set = (key: string, v: ScreeningRequestAnswer | undefined) =>
    setAnswers((prev) => {
      const next = { ...prev };
      if (v) next[key] = v;
      else delete next[key];
      return next;
    });
  const disabled = readOnly || pending;
  const answeredNow = Object.keys(answers).length;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="request_id" value={requestId} />
      <input type="hidden" name="answers" value={JSON.stringify(answers)} />

      <ol className="space-y-3">
        {items.map((item, idx) => {
          const a = answers[item.key];
          return (
            <li key={item.key} className="rounded-2xl border border-default bg-surface px-4 py-3">
              <div className="flex flex-wrap items-start gap-2">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-canvas-muted text-[11px] font-semibold text-foreground-muted mx-tnum">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-foreground">{item.label}</p>
                  <p className="text-[11px] uppercase tracking-wider text-foreground-subtle">{SCREENING_REQUEST_KIND_LABEL[item.kind]}</p>
                  {item.hint && <p className="mt-0.5 text-[12px] text-foreground-muted">{item.hint}</p>}
                </div>
                {item.status === 'answered' && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${OK_TONE}`}>
                    Besvarad{item.answer_label ? `: ${item.answer_label}` : ''}
                  </span>
                )}
              </div>
              <div className="mt-2">
                {item.kind === 'condition' && item.condition && (
                  <VerdictInput meta={SCREENING_CONDITION_QUESTION[item.condition]} value={a} onChange={(v) => set(item.key, v)} disabled={disabled} />
                )}
                {item.kind === 'vinnova' && item.vinnova && (
                  <VerdictInput meta={SCREENING_VINNOVA_QUESTION[item.vinnova]} value={a} onChange={(v) => set(item.key, v)} disabled={disabled} />
                )}
                {item.kind === 'excellence' && <VerdictInput meta={SCREENING_EXCELLENCE_QUESTION} value={a} onChange={(v) => set(item.key, v)} disabled={disabled} />}

                {item.kind === 'document' && (
                  <textarea
                    aria-label={item.label}
                    rows={3}
                    disabled={disabled}
                    maxLength={SCREENING_REQUEST_DOCUMENT_MAX}
                    value={a?.note ?? ''}
                    placeholder={viewer === 'startup' ? 'Skriv svaret här (t.ex. ägare och andel enligt aktieboken, eller "aktiebok skickad per mejl 2026-10-14").' : 'Svar/underlag i text.'}
                    onChange={(e) => set(item.key, e.target.value.trim() ? { note: e.target.value } : undefined)}
                    className={inputCls}
                  />
                )}

                {item.kind === 'de_minimis' && (
                  <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
                    <input
                      aria-label={`${item.label} — EUR`}
                      inputMode="numeric"
                      placeholder="Belopp i EUR"
                      disabled={disabled}
                      value={a?.used_eur ?? ''}
                      onChange={(e) => {
                        const n = num(e.target.value);
                        set(item.key, n === undefined ? undefined : { ...(a ?? {}), used_eur: n });
                      }}
                      className={`${inputCls} mx-tnum`}
                    />
                    <input
                      aria-label={`${item.label} — intygets referens`}
                      placeholder="Intygets datum/referens (0 om inget stöd mottagits)"
                      disabled={disabled || a?.used_eur === undefined}
                      maxLength={SCREENING_NOTE_MAX}
                      value={a?.note ?? ''}
                      onChange={(e) => set(item.key, a?.used_eur === undefined ? undefined : { ...a, note: e.target.value || undefined })}
                      className={inputCls}
                    />
                  </div>
                )}

                {item.kind === 'estimate' && (
                  <div className="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    {(
                      [
                        ['employees', 'Anställda'],
                        ['revenue_sek', 'Omsättning kr'],
                        ['balance_sheet_sek', 'Balansomslutning kr']
                      ] as const
                    ).map(([key, label]) => (
                      <input
                        key={key}
                        aria-label={`${item.label} — ${label}`}
                        inputMode="decimal"
                        placeholder={label}
                        disabled={disabled}
                        value={a?.[key] ?? ''}
                        onChange={(e) => {
                          const n = num(e.target.value);
                          const next = { ...(a ?? {}) };
                          if (n === undefined) delete next[key];
                          else next[key] = n;
                          set(item.key, next.employees === undefined && next.revenue_sek === undefined && next.balance_sheet_sek === undefined ? undefined : next);
                        }}
                        className={`${inputCls} mx-tnum`}
                      />
                    ))}
                    <input
                      aria-label={`${item.label} — källa`}
                      placeholder="Källa (budget, prognos)"
                      disabled={disabled || !a}
                      maxLength={SCREENING_NOTE_MAX}
                      value={a?.note ?? ''}
                      onChange={(e) => set(item.key, a ? { ...a, note: e.target.value || undefined } : undefined)}
                      className={inputCls}
                    />
                  </div>
                )}

                {item.kind === 'irl' && (
                  <div className="space-y-1.5">
                    {IRL_AXES.map((ax) => (
                      <div key={ax} className="grid gap-2 sm:grid-cols-[150px_90px_minmax(0,1fr)] sm:items-center">
                        <span className="text-[12.5px] font-medium text-foreground">{IRL_LABEL[ax]}</span>
                        <input
                          aria-label={`${IRL_LABEL[ax]} nivå`}
                          inputMode="numeric"
                          placeholder="1–9"
                          disabled={disabled}
                          value={a?.levels?.[ax] ?? ''}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            const levels = { ...(a?.levels ?? {}) };
                            if (e.target.value === '' || !Number.isInteger(n)) delete levels[ax];
                            else levels[ax] = n;
                            const next = { ...(a ?? {}), levels };
                            set(item.key, Object.keys(levels).length === 0 && !next.notes ? undefined : next);
                          }}
                          className={`${inputCls} mx-tnum`}
                        />
                        <input
                          aria-label={`${IRL_LABEL[ax]} motivering`}
                          placeholder="Motivering (metrics)"
                          disabled={disabled}
                          maxLength={SCREENING_NOTE_MAX}
                          value={a?.notes?.[ax] ?? ''}
                          onChange={(e) => {
                            const notes = { ...(a?.notes ?? {}) };
                            if (e.target.value) notes[ax] = e.target.value;
                            else delete notes[ax];
                            set(item.key, { ...(a ?? {}), notes });
                          }}
                          className={inputCls}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {item.kind === 'founders' && (
                  <FoundersInput value={a} onChange={(v) => set(item.key, v)} disabled={disabled} viewer={viewer} />
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || answeredNow === 0}
            className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'Sparar…' : 'Skicka svar'}
          </button>
          <span className="text-[12px] text-foreground-muted">
            {answeredNow} av {items.length} punkter ifyllda — du kan spara delvis och fortsätta senare.
          </span>
        </div>
      )}
      {state.result && (
        <p className={`rounded-xl px-3 py-2 text-[12.5px] ${OK_TONE}`}>
          Sparat: {state.result.answered} av {state.result.total} punkter besvarade
          {state.result.status === 'answered' ? ' — allt är inne, tack!' : '.'}
          {state.result.rejected.length > 0 ? ` ${state.result.rejected.length} svar kunde inte tolkas och lämnades öppna.` : ''}
          {state.result.warnings.length > 0 ? ` ${state.result.warnings.join(' ')}` : ''}
        </p>
      )}
      {state.result?.factsSchemaMissing && (
        <p className={`rounded-xl px-3 py-2 text-[12.5px] ${WARN_TONE}`}>
          Fältet screening_facts saknas i PocketBase (kör migration 1700000190) — svaren finns i förfrågan men nådde inte bolagskortet.
        </p>
      )}
      {state.error && (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      )}
    </form>
  );
}

function FoundersInput({
  value,
  onChange,
  disabled,
  viewer
}: {
  value?: ScreeningRequestAnswer;
  onChange: (v: ScreeningRequestAnswer | undefined) => void;
  disabled?: boolean;
  viewer: 'coach' | 'startup';
}) {
  const rows: ScreeningFounderFact[] = value?.founders ?? [];
  const setRows = (next: ScreeningFounderFact[]) => onChange({ ...(value ?? {}), founders: next.length > 0 ? next : undefined, maturity_phase: value?.maturity_phase, research_spinoff: value?.research_spinoff });
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-foreground-muted">
        {viewer === 'startup'
          ? 'Ange varje grundare med ägarandel (inkl. ägande via holdingbolag) och hur stor del av en heltid hen arbetar i bolaget. Namn och andel räcker — inga personnummer.'
          : 'Grundare med ägarandel och engagemang i % av heltid, samt bolagets mognadsfas.'}
      </p>
      <div className="overflow-x-auto rounded-xl border border-default">
        <table className="w-full text-[12.5px]">
          <thead className="bg-canvas-subtle text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
            <tr>
              <th className="px-3 py-1.5 font-medium">Grundare</th>
              <th className="px-3 py-1.5 font-medium">% kapital</th>
              <th className="px-3 py-1.5 font-medium">% av heltid</th>
              <th className="px-3 py-1.5 font-medium">Forskare</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-default">
                <td className="px-2 py-1">
                  <input aria-label="Grundarens namn" value={r.name} maxLength={120} disabled={disabled} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={inputCls} />
                </td>
                <td className="px-2 py-1">
                  <input
                    aria-label="Ägarandel i procent"
                    inputMode="decimal"
                    disabled={disabled}
                    value={r.equity_pct ?? ''}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, equity_pct: num(e.target.value) } : x)))}
                    className={`${inputCls} mx-tnum`}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    aria-label="Engagemang i procent av heltid"
                    inputMode="decimal"
                    disabled={disabled}
                    value={r.engagement_pct ?? ''}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, engagement_pct: num(e.target.value) } : x)))}
                    className={`${inputCls} mx-tnum`}
                  />
                </td>
                <td className="px-2 py-1 text-center">
                  <input type="checkbox" aria-label="Forskare" disabled={disabled} checked={r.researcher === true} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, researcher: e.target.checked || undefined } : x)))} />
                </td>
                <td className="px-2 py-1 text-right">
                  {!disabled && (
                    <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-[11.5px] font-semibold text-foreground-subtle hover:text-foreground">
                      Ta bort
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr className="border-t border-default">
                <td colSpan={5} className="px-3 py-2 text-foreground-muted">Inga grundare angivna än.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {!disabled && (
          <button
            type="button"
            disabled={rows.length >= SCREENING_MAX_FOUNDERS}
            onClick={() => setRows([...rows, { name: '' }])}
            className="rounded-full border border-strong px-3 py-1 text-[12px] font-semibold text-foreground hover:bg-canvas-subtle disabled:opacity-50"
          >
            + Lägg till grundare
          </button>
        )}
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Mognadsfas</span>
          <select
            value={value?.maturity_phase ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ ...(value ?? {}), maturity_phase: (e.target.value || undefined) as ScreeningRequestAnswer['maturity_phase'] })}
            className={`${inputCls} mt-1`}
          >
            <option value="">Inte angiven</option>
            {MATURITY_PHASES.map((p) => (
              <option key={p} value={p}>
                {MATURITY_PHASE_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-[12.5px] text-foreground">
          <input type="checkbox" disabled={disabled} checked={value?.research_spinoff === true} onChange={(e) => onChange({ ...(value ?? {}), research_spinoff: e.target.checked || undefined })} />
          Forskningsavknoppning
        </label>
      </div>
    </div>
  );
}
