'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  FOUNDER_ENGAGEMENT_PHASES,
  EXCELLENCE_MANUAL_MAX_FOUNDERS,
  EXCELLENCE_MANUAL_NOTE_MAX,
  type ExcellenceManualReview,
  type FounderEngagementPhase,
  type ScreeningCheck,
  type ScreeningVerdict
} from '@platform/shared';
import type { ExcellenceAssessment } from '@/lib/excellence/types';

// Manuell komplettering (CLAUDE.md § 51.5): de punkter systemet inte kan
// avgöra ur registret/plattformen fylls i här — förifyllda med det som finns
// (grundare ur teamet, flaggor, readiness, bokslut) — och sparas per bolag så
// nästa bedömning bär dem. Punkter registret besvarar visas inte här:
// systemet vinner alltid. Hela formuläret skickas som EN json-sträng
// (`review_json`) till `saveExcellenceReviewAction`, som normaliserar,
// personnummer-sanerar och ger en ny bedömning + PDF.

interface Props {
  assessment: ExcellenceAssessment;
  action: (formData: FormData) => void;
  pending: boolean;
  error?: string;
}

const VERDICTS: Array<{ id: ScreeningVerdict; label: string }> = [
  { id: 'yes', label: 'Ja' },
  { id: 'no', label: 'Nej' },
  { id: 'unknown', label: 'Okänt' }
];

const SECTION_OF: Record<string, string> = {
  standalone: 'Steg 1 — Fristående och tröskelvärden',
  thresholds: 'Steg 1 — Fristående och tröskelvärden',
  de_minimis: 'Steg 1 — Fristående och tröskelvärden',
  founders_75: 'Steg 2 — Vinnovas målgrupp',
  founder_driven: 'Steg 2 — Vinnovas målgrupp',
  not_market_ready: 'Steg 2 — Vinnovas målgrupp',
  innovative: 'Steg 2 — Vinnovas målgrupp',
  other_criteria: 'Steg 2 — Vinnovas målgrupp',
  excellence: 'Steg 3 — Excellent inkubation'
};

const inputCls =
  'block w-full rounded-xl border border-default bg-canvas px-3 py-1.5 text-[12.5px] text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

type Entry = { verdict: ScreeningVerdict; note: string };
type FounderRow = { name: string; pct: string };

function sectionFor(c: ScreeningCheck): string {
  if (c.key.startsWith('cond:')) return `Steg 1 — Grundförutsättningar: ${c.scope || 'bolaget'}`;
  return SECTION_OF[c.id] ?? 'Övrigt';
}

export function ManualReviewForm({ assessment, action, pending, error }: Props) {
  const { result, subject } = assessment;
  const editable = useMemo(() => result.checks.filter((c) => c.editable), [result.checks]);

  const [entries, setEntries] = useState<Record<string, Entry>>(() => {
    const out: Record<string, Entry> = {};
    for (const c of editable) {
      const m = c.manual ?? assessment.manual?.checks[c.key];
      out[c.key] = { verdict: m?.verdict ?? 'unknown', note: m?.note ?? '' };
    }
    return out;
  });
  const [phase, setPhase] = useState<FounderEngagementPhase | ''>(assessment.manual?.engagement?.phase ?? '');
  const [founders, setFounders] = useState<FounderRow[]>(() => {
    const saved = assessment.manual?.engagement?.founders;
    if (saved && saved.length > 0) return saved.map((f) => ({ name: f.name, pct: typeof f.pct === 'number' ? String(f.pct) : '' }));
    // Förifyllt från systemet: grundarna i teamet på bolagskortet.
    return (assessment.founders ?? []).map((f) => ({ name: f.name, pct: '' }));
  });

  // Grundardrivet styrs av engagemangsblocket (deterministiskt) — en egen
  // Ja/Nej-rad vore dubbelt; punkten kan ändå överstyras när fasen är
  // forskningsavknoppning (manuell bedömning).
  const rows = editable.filter((c) => c.id !== 'founder_driven' || phase === 'research_spinoff');
  const sections = useMemo(() => {
    const map = new Map<string, ScreeningCheck[]>();
    for (const c of rows) {
      const s = sectionFor(c);
      map.set(s, [...(map.get(s) ?? []), c]);
    }
    return [...map.entries()];
  }, [rows]);

  const review: ExcellenceManualReview = useMemo(() => {
    const checks: ExcellenceManualReview['checks'] = {};
    for (const [key, e] of Object.entries(entries)) {
      if (e.verdict === 'unknown' && e.note.trim() === '') continue;
      checks[key] = { verdict: e.verdict, note: e.note.trim() || undefined };
    }
    const out: ExcellenceManualReview = { checks };
    const fs = founders
      .filter((f) => f.name.trim() !== '')
      .map((f) => ({ name: f.name.trim(), pct: f.pct.trim() === '' ? undefined : Number(f.pct.replace(',', '.')) }));
    if (phase || fs.length > 0) out.engagement = { phase: phase || undefined, founders: fs };
    return out;
  }, [entries, founders, phase]);

  const setEntry = (key: string, patch: Partial<Entry>) =>
    setEntries((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  if (!subject.startupId) {
    return (
      <section className="rounded-2xl border border-default bg-canvas-subtle px-4 py-3 text-[12.5px] text-foreground-muted">
        <h3 className="text-[13px] font-semibold text-foreground">Manuell komplettering</h3>
        <p className="mt-1">
          De punkter som inte kan avgöras ur registret fylls i manuellt och sparas per bolag — det kräver att bolaget
          finns i plattformen. Välj ett portföljbolag för att komplettera och spara.
        </p>
      </section>
    );
  }

  const canSave = assessment.manualEditable !== false;

  return (
    <form action={action} className="space-y-4 rounded-2xl border border-default bg-surface px-5 py-4">
      <input type="hidden" name="startup_id" value={subject.startupId} />
      <input type="hidden" name="review_json" value={JSON.stringify(review)} />
      <div>
        <h3 className="text-[14px] font-semibold text-foreground">Manuell komplettering</h3>
        <p className="mt-1 text-[12.5px] text-foreground-muted">
          Här finns bara de punkter som bolagsregistret och plattformen inte kan avgöra. Det systemet vet står
          förifyllt under varje punkt. Uppgifterna sparas på bolaget och används i varje ny bedömning — tills
          registret eller plattformen själv får ett svar, då gäller det i stället. Skriv aldrig personuppgifter i
          noterna (källa och datum räcker: &quot;intyg 2026-10-01&quot;, &quot;aktiebok granskad&quot;).
        </p>
        {!canSave && (
          <p className="mt-2 rounded-xl bg-movexum-pastell-gul px-3 py-1.5 text-[12.5px] text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
            Fältet <span className="mx-tnum">excellence_review</span> saknas i PocketBase-schemat (migration 1700000189) —
            uppgifterna kan fyllas i men inte sparas förrän migrationen körts.
          </p>
        )}
      </div>

      {editable.some((c) => c.id === 'founder_driven') && (
        <fieldset className="rounded-xl border border-default px-4 py-3">
          <legend className="px-1 text-[12.5px] font-semibold text-foreground">Steg 2 — Grundardrivet: engagemang i % av heltid</legend>
          <p className="text-[12px] text-foreground-muted">
            Välj bolagets mognadsfas och ange varje grundares engagemang. Tröskeln prövas automatiskt:{' '}
            {FOUNDER_ENGAGEMENT_PHASES.map((p) => `${p.label} — ${p.rule.toLowerCase()}`).join(' ')}
          </p>
          <label className="mt-2 block max-w-xs">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Mognadsfas</span>
            <select value={phase} onChange={(e) => setPhase(e.target.value as FounderEngagementPhase | '')} className={`mt-1 ${inputCls}`}>
              <option value="">Inte angiven</option>
              {FOUNDER_ENGAGEMENT_PHASES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2 space-y-1.5">
            {founders.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  value={f.name}
                  onChange={(e) => setFounders((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="Grundare"
                  aria-label="Grundarens namn"
                  className={`${inputCls} max-w-xs`}
                />
                <input
                  value={f.pct}
                  onChange={(e) => setFounders((prev) => prev.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
                  inputMode="decimal"
                  placeholder="% av heltid"
                  aria-label="Engagemang i procent av heltid"
                  className={`${inputCls} w-28 mx-tnum`}
                />
                <button
                  type="button"
                  onClick={() => setFounders((prev) => prev.filter((_, j) => j !== i))}
                  className="text-[12px] text-foreground-subtle hover:text-foreground"
                >
                  Ta bort
                </button>
              </div>
            ))}
            {founders.length < EXCELLENCE_MANUAL_MAX_FOUNDERS && (
              <button
                type="button"
                onClick={() => setFounders((prev) => [...prev, { name: '', pct: '' }])}
                className="text-[12.5px] font-semibold text-link hover:underline"
              >
                + Lägg till grundare
              </button>
            )}
          </div>
          {(assessment.founders ?? []).length > 0 && (
            <p className="mt-2 text-[11.5px] text-foreground-subtle">
              Förifyllt från systemet: grundarna ur teamet på{' '}
              <Link href={`/startups/${subject.startupId}`} className="text-link hover:underline">
                bolagskortet
              </Link>
              . Engagemanget finns inte i plattformen — ange det här.
            </p>
          )}
        </fieldset>
      )}

      {sections.map(([title, list]) => (
        <fieldset key={title} className="rounded-xl border border-default px-4 py-3">
          <legend className="px-1 text-[12.5px] font-semibold text-foreground">{title}</legend>
          <ul className="divide-y divide-default">
            {list.map((c) => {
              const e = entries[c.key] ?? { verdict: 'unknown', note: '' };
              return (
                <li key={c.key} className="py-3 first:pt-1 last:pb-1">
                  <p className="text-[13px] font-medium text-foreground">{c.label}</p>
                  {c.hint && (
                    <p className="mt-0.5 text-[12px] text-link">
                      <span className="font-semibold">Förifyllt från systemet:</span> {c.hint}
                    </p>
                  )}
                  {c.needs && <p className="mt-0.5 text-[12px] text-foreground-subtle">Underlag: {c.needs}</p>}
                  <div className="mt-1.5 flex flex-wrap items-start gap-2">
                    <div className="flex gap-1" role="radiogroup" aria-label={c.label}>
                      {VERDICTS.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          role="radio"
                          aria-checked={e.verdict === v.id}
                          onClick={() => setEntry(c.key, { verdict: v.id })}
                          className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition ${
                            e.verdict === v.id
                              ? v.id === 'yes'
                                ? 'border-movexum-morkgron bg-movexum-pastell-gron text-movexum-morkgron'
                                : v.id === 'no'
                                  ? 'border-movexum-morkorange bg-movexum-pastell-orange text-movexum-morkorange'
                                  : 'border-strong bg-canvas-muted text-foreground'
                              : 'border-default text-foreground-muted hover:bg-canvas-subtle'
                          }`}
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                    <input
                      value={e.note}
                      onChange={(ev) => setEntry(c.key, { note: ev.target.value.slice(0, EXCELLENCE_MANUAL_NOTE_MAX) })}
                      placeholder="Källa/not (t.ex. intyg 2026-10-01) — inga personuppgifter"
                      aria-label={`Not: ${c.label}`}
                      className={`${inputCls} min-w-0 flex-1 basis-64`}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      {rows.length === 0 && !editable.some((c) => c.id === 'founder_driven') && (
        <p className="text-[12.5px] text-foreground-muted">Alla punkter är besvarade av registret eller plattformen — inget att komplettera.</p>
      )}

      {error && (
        <p className="rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !canSave}
          className="inline-flex items-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Sparar och bedömer…' : 'Spara uppgifterna och bedöm på nytt'}
        </button>
        <span className="text-[12px] text-foreground-subtle">
          Bedömningen görs om på sparade data (inget uppslag hos leverantören) och en ny PDF läggs i Filer.
        </span>
      </div>
    </form>
  );
}
