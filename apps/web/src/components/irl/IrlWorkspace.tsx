'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  KTH_IRL_AXES,
  IRL_AXIS_NOTE_MAX,
  IRL_EXTRA_AXIS,
  IRL_NOTE_MAX,
  IRL_SOURCE_NOTE,
  diffIrlProfiles,
  irlAxis,
  irlLevelDescription,
  irlNextStep,
  summarizeIrl,
  type IrlAxisKey,
  type IrlAxisNotes,
  type IrlProfile
} from '@platform/shared';
import { saveIrlAssessmentAction } from '@/lib/actions/irl';
import { IrlRadar } from './IrlRadar';
import { irlLevelTone } from './tone';

export interface IrlAssessmentView {
  id: string;
  assessedAt: string;
  assessorName?: string;
  profile: IrlProfile;
  srl: number | null;
  axisNotes: IrlAxisNotes;
  note?: string;
}

/**
 * KTH IRL på bolagskortet: radar + de sex axlarna med nivåbeskrivning och
 * "nästa nivå", editor för en ny bedömning (Movexum-personal) och historik
 * med förändring per axel. Varje sparning skapar en NY rad — historiken
 * skrivs aldrig över.
 */
export function IrlWorkspace({
  startupId,
  assessments,
  canEdit,
  fallbackIrl,
  loadError
}: {
  startupId: string;
  /** Nyast först. */
  assessments: IrlAssessmentView[];
  canEdit: boolean;
  /** Bolagskortets sammanfattande `irl_level` när ingen KTH-bedömning finns. */
  fallbackIrl?: number;
  loadError?: string;
}) {
  const router = useRouter();
  const latest = assessments[0] ?? null;
  const previous = assessments[1] ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<IrlProfile>(latest?.profile ?? {});
  const [notes, setNotes] = useState<IrlAxisNotes>(latest?.axisNotes ?? {});
  const [srl, setSrl] = useState<number | null>(latest?.srl ?? null);
  const [note, setNote] = useState('');
  const [assessedAt, setAssessedAt] = useState(() => todayStockholm());
  const [activeAxis, setActiveAxis] = useState<IrlAxisKey>('crl');
  const [message, setMessage] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = useMemo(() => (editing ? draft : latest?.profile ?? {}), [editing, draft, latest]);
  const summary = useMemo(() => summarizeIrl(shown), [shown]);
  const deltas = useMemo(
    () => (latest && previous ? Object.fromEntries(diffIrlProfiles(previous.profile, latest.profile).map((d) => [d.key, d.delta])) : {}),
    [latest, previous]
  );

  const startEdit = () => {
    setDraft(latest?.profile ?? {});
    setNotes(latest?.axisNotes ?? {});
    setSrl(latest?.srl ?? null);
    setNote('');
    setAssessedAt(todayStockholm());
    setMessage(null);
    setEditing(true);
  };

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const res = await saveIrlAssessmentAction(startupId, {
        levels: { ...draft },
        srl,
        axisNotes: notes,
        note,
        assessedAt
      });
      if (!res.ok) {
        setMessage({ kind: 'error', text: res.error });
        return;
      }
      setEditing(false);
      setMessage(res.warning ? { kind: 'warn', text: res.warning } : { kind: 'ok', text: 'Bedömningen är sparad.' });
      router.refresh();
    });
  };

  const axis = irlAxis(activeAxis);
  const activeLevel = draft[activeAxis] ?? null;

  return (
    <div className="space-y-6">
      {loadError ? (
        <p className="rounded-2xl border border-movexum-orange/40 bg-movexum-pastell-orange px-4 py-3 text-sm text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {loadError}
        </p>
      ) : null}
      {message ? (
        <p
          className={`rounded-2xl px-4 py-3 text-sm ${
            message.kind === 'ok'
              ? 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
              : message.kind === 'warn'
                ? 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul'
                : 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange'
          }`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Radar + sammanfattning (klistrad medan axlarna redigeras) */}
        <div className={editing ? 'lg:sticky lg:top-4 lg:self-start' : undefined}>
          <IrlRadar
            profile={shown}
            previous={editing ? latest?.profile : previous?.profile}
            size="lg"
            activeAxis={editing ? activeAxis : null}
            onAxisClick={editing ? setActiveAxis : undefined}
          />
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <Figure label="Snitt" value={summary.average !== null ? summary.average.toLocaleString('sv-SE') : '–'} hint="av 9" />
            <Figure
              label="Svagast"
              value={summary.weakest.length > 0 ? summary.weakest.map((k) => irlAxis(k).label).join(', ') : '–'}
              hint={summary.min !== null ? `nivå ${summary.min}` : undefined}
            />
            <Figure label="Bedömda axlar" value={`${summary.assessed}/6`} />
          </div>
          <p className="mt-3 text-center text-xs text-foreground-subtle">
            {editing
              ? latest
                ? 'Streckad kontur = senaste sparade bedömning. Klicka på en axel för att välja den.'
                : 'Klicka på en axel för att välja den.'
              : latest
                ? `Senast bedömd ${formatDate(latest.assessedAt)}${latest.assessorName ? ` av ${latest.assessorName}` : ''}${previous ? ` · streckad = ${formatDate(previous.assessedAt)}` : ''}`
                : fallbackIrl
                  ? `Ingen KTH-bedömning än. Bolagskortets sammanfattande IRL-nivå är ${fallbackIrl}.`
                  : 'Ingen KTH-bedömning än.'}
          </p>
        </div>

        {/* Axlarna */}
        <div>
          {editing ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="IRL-axlar">
                {KTH_IRL_AXES.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    role="tab"
                    aria-selected={activeAxis === a.key}
                    onClick={() => setActiveAxis(a.key)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                      activeAxis === a.key
                        ? 'border-brand bg-brand text-brand-foreground'
                        : 'border-default bg-surface text-foreground-muted hover:bg-canvas-subtle'
                    }`}
                  >
                    {a.label} {draft[a.key] ? <span className="mx-tnum">· {draft[a.key]}</span> : null}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-default p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                  {axis.short} · {axis.labelEn} Readiness Level
                </p>
                <h3 className="mt-1 text-base font-semibold text-foreground">{axis.label}</h3>
                <p className="mt-1 text-sm text-foreground-muted">{axis.question}</p>
                <ol className="mt-4 space-y-1.5">
                  {axis.levels.map((text, i) => {
                    const lvl = i + 1;
                    const selected = activeLevel === lvl;
                    return (
                      <li key={lvl}>
                        <button
                          type="button"
                          onClick={() => setDraft((d) => ({ ...d, [activeAxis]: selected ? undefined : lvl }))}
                          aria-pressed={selected}
                          className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
                            selected
                              ? 'border-brand bg-canvas-subtle text-foreground ring-1 ring-brand'
                              : activeLevel !== null && lvl < activeLevel
                                ? 'border-default bg-canvas-subtle/60 text-foreground-muted hover:bg-canvas-subtle'
                                : 'border-default text-foreground-muted hover:bg-canvas-subtle'
                          }`}
                        >
                          <span
                            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold mx-tnum ${
                              selected ? 'bg-brand text-brand-foreground' : 'bg-canvas-muted text-foreground-muted'
                            }`}
                          >
                            {lvl}
                          </span>
                          <span>{text}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <label className="mt-4 block text-xs font-semibold text-foreground-muted">
                  Motivering för {axis.label.toLowerCase()} (valfritt)
                  <textarea
                    value={notes[activeAxis] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [activeAxis]: e.target.value.slice(0, IRL_AXIS_NOTE_MAX) }))}
                    rows={2}
                    placeholder="Vad stödjer nivån? T.ex. antal kundintervjuer, testresultat, ansökningsnummer."
                    className="mt-1 w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm font-normal text-foreground focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
                  />
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-foreground-muted">
                  Bedömningsdatum
                  <input
                    type="date"
                    value={assessedAt}
                    max={todayStockholm()}
                    onChange={(e) => setAssessedAt(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm font-normal text-foreground"
                  />
                </label>
                <label className="block text-xs font-semibold text-foreground-muted" title={IRL_EXTRA_AXIS.question}>
                  {IRL_EXTRA_AXIS.label} ({IRL_EXTRA_AXIS.short}) — Vinnova-tillägg
                  <select
                    value={srl ?? ''}
                    onChange={(e) => setSrl(e.target.value ? Number(e.target.value) : null)}
                    className="mt-1 w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm font-normal text-foreground"
                  >
                    <option value="">Ej bedömd</option>
                    {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-xs font-semibold text-foreground-muted">
                Kommentar till bedömningen (valfritt)
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, IRL_NOTE_MAX))}
                  rows={2}
                  placeholder="Sammanhang, t.ex. efter coachmöte. Skriv inte personuppgifter."
                  className="mt-1 w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm font-normal text-foreground"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={pending || Object.values(draft).every((v) => !v)}
                  className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
                >
                  {pending ? 'Sparar…' : 'Spara bedömning'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={pending}
                  className="rounded-full border border-default px-5 py-2 text-sm font-semibold text-foreground-muted transition hover:bg-canvas-subtle"
                >
                  Avbryt
                </button>
                <span className="text-xs text-foreground-subtle">Sparas som en ny bedömning — historiken behålls.</span>
              </div>
            </div>
          ) : (
            <div>
              <ul className="divide-y divide-default">
                {KTH_IRL_AXES.map((a) => {
                  const lvl = latest?.profile[a.key] ?? null;
                  const d = deltas[a.key] as number | null | undefined;
                  const next = lvl !== null ? irlNextStep(a.key, lvl) : null;
                  const axisNote = latest?.axisNotes[a.key];
                  return (
                    <li key={a.key} className="flex gap-3 py-3">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold mx-tnum ${
                          lvl === null ? 'bg-canvas-muted text-foreground-subtle' : irlLevelTone(lvl)
                        }`}
                        aria-label={lvl === null ? 'Ej bedömd' : `Nivå ${lvl}`}
                      >
                        {lvl ?? '–'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-foreground">
                          {a.label}
                          <span className="text-[11px] font-medium text-foreground-subtle">{a.short}</span>
                          {typeof d === 'number' && d !== 0 ? (
                            <span
                              className={`text-[11px] font-semibold mx-tnum ${
                                d > 0 ? 'text-movexum-gron dark:text-movexum-ljusgron' : 'text-movexum-orange'
                              }`}
                            >
                              {d > 0 ? `+${d}` : d} sedan förra
                            </span>
                          ) : null}
                        </p>
                        <p className="text-sm text-foreground-muted">
                          {lvl !== null ? irlLevelDescription(a.key, lvl) : 'Ej bedömd.'}
                        </p>
                        {axisNote ? <p className="mt-0.5 text-xs italic text-foreground-subtle">”{axisNote}”</p> : null}
                        {next ? (
                          <p className="mt-1 text-xs text-foreground-subtle">
                            <span className="font-semibold text-foreground-muted">Nästa nivå:</span> {next}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {latest?.srl ? (
                <p className="mt-2 text-xs text-foreground-subtle">
                  {IRL_EXTRA_AXIS.label} ({IRL_EXTRA_AXIS.short}, Vinnova): nivå {latest.srl}
                </p>
              ) : null}
              {latest?.note ? <p className="mt-2 text-xs text-foreground-subtle">Kommentar: {latest.note}</p> : null}
              {canEdit ? (
                <button
                  type="button"
                  onClick={startEdit}
                  className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
                >
                  {latest ? 'Ny bedömning' : 'Gör första bedömningen'}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {assessments.length > 1 ? <IrlHistory assessments={assessments} /> : null}

      <p className="text-[11px] text-foreground-subtle">{IRL_SOURCE_NOTE}</p>
    </div>
  );
}

function IrlHistory({ assessments }: { assessments: IrlAssessmentView[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-foreground">Historik</h3>
      <div className="overflow-x-auto rounded-2xl border border-default">
        <table className="w-full text-sm">
          <thead className="bg-canvas-subtle text-left text-xs uppercase tracking-wider text-foreground-subtle">
            <tr>
              <th className="px-3 py-2 font-medium">Datum</th>
              {KTH_IRL_AXES.map((a) => (
                <th key={a.key} className="px-2 py-2 text-center font-medium" title={a.label}>
                  {a.short}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">Snitt</th>
              <th className="px-3 py-2 font-medium">Av</th>
            </tr>
          </thead>
          <tbody>
            {assessments.map((a, i) => {
              const older = assessments[i + 1];
              const diff = older ? Object.fromEntries(diffIrlProfiles(older.profile, a.profile).map((d) => [d.key, d.delta])) : {};
              const s = summarizeIrl(a.profile);
              return (
                <tr key={a.id} className="border-t border-default">
                  <td className="whitespace-nowrap px-3 py-2 text-foreground mx-tnum">{formatDate(a.assessedAt)}</td>
                  {KTH_IRL_AXES.map((ax) => {
                    const v = a.profile[ax.key];
                    const d = diff[ax.key] as number | null | undefined;
                    return (
                      <td key={ax.key} className="px-2 py-2 text-center text-foreground-muted mx-tnum">
                        {v ?? '–'}
                        {typeof d === 'number' && d !== 0 ? (
                          <sup className={`ml-0.5 ${d > 0 ? 'text-movexum-gron dark:text-movexum-ljusgron' : 'text-movexum-orange'}`}>
                            {d > 0 ? `+${d}` : d}
                          </sup>
                        ) : null}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-foreground-muted mx-tnum">{s.average?.toLocaleString('sv-SE') ?? '–'}</td>
                  <td className="px-3 py-2 text-foreground-subtle">{a.assessorName ?? '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <span className="text-center">
      <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">{label}</span>
      <span className="font-heading text-lg font-semibold text-foreground mx-tnum">{value}</span>
      {hint ? <span className="ml-1 text-xs text-foreground-subtle">{hint}</span> : null}
    </span>
  );
}

function todayStockholm(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}
