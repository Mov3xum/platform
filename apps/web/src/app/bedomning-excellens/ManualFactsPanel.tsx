'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import {
  COMPANY_MANUAL_CONDITIONS,
  IRL_AXES,
  MATURITY_PHASES,
  MATURITY_PHASE_LABEL,
  SCREENING_COMMENT_MAX,
  SCREENING_MAX_FOUNDERS,
  SCREENING_NOTE_MAX,
  type CompanyManualCondition,
  type IrlAxis,
  type ManualAnswer,
  type ScreeningFounderFact,
  type ScreeningManualFacts,
  type ScreeningVerdict
} from '@platform/shared';
import { applyExcellenceFactsAction, type ExcellenceAssessment, type ExcellenceAssessmentState } from '@/lib/actions/excellence';

// Manuella svar (CLAUDE.md § 51.4): det bolagsregistret aldrig kan svara på
// fyller controllern i här efter körningen. Svaren sparas på bolagskortet
// (portföljbolag) och bedömningen räknas om på SAMMA underlag — inga nya
// debiterade anrop. Ett manuellt NEJ vinner alltid; ett manuellt JA fyller
// bara en OKÄNT-punkt (ett register-NEJ kan inte skrivas över). Skriv aldrig
// personuppgifter i motiveringarna (personnummer saneras på skrivvägen).

interface Props {
  assessment: ExcellenceAssessment;
  onUpdated: (a: ExcellenceAssessment) => void;
}

/**
 * Frågorna ställs som NATURLIGA frågor med svarsalternativ som säger vad de
 * betyder. Lagrat `verdict` är alltid i VILLKORETS riktning (`yes` = villkoret
 * uppfyllt) — alternativet "Nej — inte börsnoterat" lagras alltså som `yes`.
 * Incident 2026-10-13: med etiketten "Inte börsnoterat" + Ja/Nej svarade
 * controllern "Nej" (= inte noterat) och bedömningen läste det som "ÄR
 * börsnoterat" för Wellgo Health AB. Därför aldrig mer ett nakent Ja/Nej.
 */
interface QuestionMeta {
  question: string;
  /** Svarsalternativ som betyder "villkoret uppfyllt" (lagras som `yes`). */
  fulfilled: string;
  /** Svarsalternativ som betyder "villkoret INTE uppfyllt" (lagras som `no`). */
  failed: string;
  hint?: string;
}

const CONDITION_QUESTION: Record<CompanyManualCondition, QuestionMeta> = {
  listed: {
    question: 'Är bolaget börsnoterat?',
    fulfilled: 'Nej — inte börsnoterat',
    failed: 'Ja — aktierna är upptagna till handel',
    hint: 'Avgörs normalt ur registret: ett privat aktiebolag (utan "(publ)" i namnet) kan inte vara noterat. Svara bara för ett publikt bolag.'
  },
  dividend: {
    question: 'Har bolaget beslutat om eller delat ut vinst?',
    fulfilled: 'Nej — ingen utdelning',
    failed: 'Ja — utdelning har beslutats',
    hint: 'Avgörs ur årsredovisningens utdelningspost när bokslutet hämtats; ett intyg fyller bara en okänd punkt.'
  },
  concentration: {
    question: 'Är bolaget bildat genom företagskoncentration (fusion/sammanslagning)?',
    fulfilled: 'Nej',
    failed: 'Ja — bildat genom koncentration'
  },
  takeover: {
    question: 'Har bolaget övertagit ett annat företags verksamhet?',
    fulfilled: 'Nej',
    failed: 'Ja — övertagit verksamhet',
    hint: 'Ombildning av enskild firma till aktiebolag undantas.'
  }
};

const STANDALONE_QUESTION: QuestionMeta = {
  question: 'Är bolaget fristående enligt aktieboken — inget företag äger 25 % eller mer, och bolaget äger inget sådant?',
  fulfilled: 'Ja — fristående (aktieboken kontrollerad)',
  failed: 'Nej — det finns ägare/innehav på 25 % eller mer',
  hint: 'Ett Nej gör bolaget anknutet/partner: lägg till bolagen i koncernkartan så prövas deras grundförutsättningar och tröskelvärden.'
};

const VINNOVA_MANUAL: Array<{ id: 'not_market_ready' | 'innovative' | 'other_criteria'; meta: QuestionMeta }> = [
  {
    id: 'not_market_ready',
    meta: {
      question: 'Är bolaget fortfarande inte marknadsredo?',
      fulfilled: 'Ja — inte marknadsredo',
      failed: 'Nej — bolaget är marknadsredo',
      hint: 'Eget kapital under omkostnaderna kommande 24 mån och affärsmodellen valideras fortfarande (budget + coachens bedömning).'
    }
  },
  {
    id: 'innovative',
    meta: {
      question: 'Är bolaget innovativt?',
      fulfilled: 'Ja — unika egenskaper ger uthålliga konkurrensfördelar',
      failed: 'Nej',
      hint: 'Coachens bedömning av innovationshöjd.'
    }
  },
  {
    id: 'other_criteria',
    meta: {
      question: 'Uppfylls övriga villkor?',
      fulfilled: 'Ja — uppfyllda',
      failed: 'Nej',
      hint: 'Agenda 2030 i SRL-dimensionen, skalbarhet (tydlig från mognadsnivå 2), unika kunskapstillgångar.'
    }
  }
];

const IRL_LABEL: Record<IrlAxis, string> = { crl: 'CRL', brl: 'BRL', tmrl: 'TMRL', srl: 'SRL' };

const inputCls =
  'block w-full rounded-xl border border-default bg-canvas px-3 py-1.5 text-[12.5px] text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const VERDICT_TONE: Record<ScreeningVerdict, string> = {
  yes: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  no: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  unknown: 'bg-canvas-muted text-foreground-muted'
};
const VERDICT_LABEL: Record<ScreeningVerdict, string> = { yes: 'Ja', no: 'Nej', unknown: 'Okänt' };
const WARN_TONE = 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul';

type AnswerValue = '' | 'yes' | 'no';

function answerValue(a: ManualAnswer | undefined): AnswerValue {
  return a ? a.verdict : '';
}

function withAnswer(prev: ManualAnswer | undefined, verdict: AnswerValue, note?: string): ManualAnswer | undefined {
  const n = note ?? prev?.note;
  if (!verdict) return undefined;
  return n ? { verdict, note: n } : { verdict };
}

function AnswerRow({
  meta,
  current,
  value,
  onChange
}: {
  meta: QuestionMeta;
  /** Punkten som bedömningen räknade fram (visar vad registret redan avgjort). */
  current?: { verdict: ScreeningVerdict; source: string; detail: string };
  value: ManualAnswer | undefined;
  onChange: (v: ManualAnswer | undefined) => void;
}) {
  const label = meta.question;
  const decidedByRegister = !!current && current.verdict !== 'unknown' && current.source === 'register';
  return (
    <div className="grid gap-2 border-t border-default py-2 first:border-t-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(180px,220px)_minmax(0,1.4fr)] sm:items-start">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-foreground">
          {label}
          {current && (
            <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${VERDICT_TONE[current.verdict]}`}>
              villkoret nu: {VERDICT_LABEL[current.verdict]}
            </span>
          )}
        </p>
        {decidedByRegister ? (
          <p className="text-[11.5px] text-foreground-subtle">Avgjort ur registret: {current.detail} Svara bara om du vet något annat.</p>
        ) : meta.hint ? (
          <p className="text-[11.5px] text-foreground-subtle">{meta.hint}</p>
        ) : null}
      </div>
      <select
        aria-label={`${label} — svar`}
        value={answerValue(value)}
        onChange={(e) => onChange(withAnswer(value, e.target.value as AnswerValue))}
        className={inputCls}
      >
        <option value="">{decidedByRegister ? 'Inget eget svar (registret gäller)' : 'Okänt'}</option>
        <option value="yes">{meta.fulfilled}</option>
        <option value="no">{meta.failed}</option>
      </select>
      <input
        aria-label={`${label} — motivering`}
        value={value?.note ?? ''}
        maxLength={SCREENING_NOTE_MAX}
        placeholder="Motivering/källa (t.ex. bolagsordning, intyg)"
        onChange={(e) => onChange(value ? withAnswer(value, value.verdict, e.target.value) : undefined)}
        disabled={!value}
        className={`${inputCls} disabled:opacity-50`}
      />
    </div>
  );
}

const initialState: ExcellenceAssessmentState = {};

export function ManualFactsPanel({ assessment, onUpdated }: Props) {
  const [state, formAction, pending] = useActionState(applyExcellenceFactsAction, initialState);
  const [facts, setFacts] = useState<ScreeningManualFacts>(assessment.facts);
  const [foundersOpen, setFoundersOpen] = useState(assessment.foundersSource === 'manual');

  useEffect(() => {
    if (state.assessment) onUpdated(state.assessment);
  }, [state.assessment, onUpdated]);

  // Ny körning (annat underlag) ⇒ panelen följer den.
  useEffect(() => {
    setFacts(assessment.facts);
    setFoundersOpen(assessment.foundersSource === 'manual');
  }, [assessment.context, assessment.facts, assessment.foundersSource]);

  const companies = assessment.result.companies.filter((c) => c.role === 'subject' || (c.role === 'linked' && c.orgNr));
  const linked = companies.filter((c) => c.role === 'linked' && c.orgNr);
  // Vilka anknutna bolag redan har de minimis ur plattformen (intyg behövs inte).
  const platformDeMinimis = useMemo(() => {
    const set = new Set<string>();
    try {
      const ctx = JSON.parse(assessment.context) as { input?: { related?: Array<{ orgNr?: string; deMinimis?: { source?: string } }> } };
      for (const r of ctx.input?.related ?? []) if (r.orgNr && r.deMinimis?.source === 'platform') set.add(r.orgNr);
    } catch {
      /* underlaget visas ändå */
    }
    return set;
  }, [assessment.context]);
  // Bolag i tröskelvärdet som saknar bokslut (registret svarade "inga
  // uppgifter", eller delen hämtades inte) — kan fyllas med egen uppskattning.
  const withoutAccounts = assessment.result.thresholds.rows.filter((r) => r.orgNr && (r.estimated || (r.note && r.year === undefined)));
  const irl = assessment.result.irl;
  const platformIrl = !!irl && !irl.manualLevels && IRL_AXES.some((ax) => typeof irl[ax] === 'number');
  const founderRows: ScreeningFounderFact[] = facts.founders ?? (assessment.foundersSource === 'platform' ? (assessment.founders ?? []) : []);

  const setCompany = (orgNr: string, id: CompanyManualCondition, v: ManualAnswer | undefined) =>
    setFacts((f) => {
      const next = { ...(f.companies[orgNr] ?? {}) };
      if (v) next[id] = v;
      else delete next[id];
      const companiesNext = { ...f.companies };
      if (Object.keys(next).length > 0) companiesNext[orgNr] = next;
      else delete companiesNext[orgNr];
      return { ...f, companies: companiesNext };
    });

  const setFounders = (rows: ScreeningFounderFact[]) => {
    setFacts((f) => ({ ...f, founders: rows.length > 0 ? rows : undefined }));
    setFoundersOpen(true);
  };

  const setIrl = (patch: Partial<NonNullable<ScreeningManualFacts['irl']>>) =>
    setFacts((f) => ({ ...f, irl: { ...(f.irl ?? {}), ...patch } }));

  return (
    <form action={formAction} className="rounded-2xl border border-default bg-surface px-5 py-5">
      <input type="hidden" name="context" value={assessment.context} />
      <input type="hidden" name="facts" value={JSON.stringify(facts)} />
      <h3 className="text-[14px] font-semibold text-foreground">Manuella svar — det registret inte kan svara på</h3>
      <p className="mt-1 text-[12.5px] text-foreground-muted">
        Fyll i det controllern/coachen vet och tryck <strong>Spara svar och uppdatera bedömningen</strong>. Bedömningen räknas
        om på samma underlag (inga nya anrop hos leverantören) och svaren
        {assessment.subject.startupId ? ' sparas på bolagskortet så nästa körning återanvänder dem' : ' följer bara med i PDF:n (bolaget finns inte i plattformen)'}
        . Ett Nej väger alltid tyngst; ett Ja fyller bara en punkt som är Okänt. Skriv inga personuppgifter i motiveringarna.
      </p>

      {/* Steg 1 — grundförutsättningar per bolag */}
      {companies.map((c) => (
        <section key={c.orgNr || c.name} className="mt-4">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
            Grundförutsättningar — {c.name || c.orgNr}
            {c.role === 'linked' ? ' (anknutet bolag)' : ''}
          </p>
          <div className="mt-1">
            {COMPANY_MANUAL_CONDITIONS.map((id) => (
              <AnswerRow
                key={id}
                meta={CONDITION_QUESTION[id]}
                current={c.conditions.find((x) => x.id === id)}
                value={facts.companies[c.orgNr]?.[id]}
                onChange={(v) => setCompany(c.orgNr, id, v)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Fristående företag — aktieboken (§ 51.8) */}
      <section className="mt-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Fristående företag — aktieboken</p>
        <p className="text-[11.5px] text-foreground-subtle">
          Koncernregistret bygger på årsredovisningar och bevisar aldrig att ett nyregistrerat bolag är fristående. Ange ägarbolag/innehav på 25 % eller mer i
          koncernkartan ("Lägg till koncernbolag") — eller bekräfta här att aktieboken inte visar några.
        </p>
        <div className="mt-1">
          <AnswerRow
            meta={STANDALONE_QUESTION}
            current={assessment.result.standalone}
            value={facts.standalone}
            onChange={(a) => setFacts((f) => ({ ...f, standalone: a }))}
          />
          {facts.group_companies.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12px] text-foreground-muted">
              {facts.group_companies.map((g) => (
                <li key={g.org_nr} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{g.name || g.org_nr}</span>
                  <span className="mx-tnum">{g.org_nr}</span>
                  <span>
                    {g.direction === 'owner' ? 'äger startup-bolaget' : 'ägs av startup-bolaget'}
                    {typeof g.share_pct === 'number' ? ` ${g.share_pct} %` : ''} · {g.relation === 'linked' ? 'anknutet' : 'partner'}
                    {g.note ? ` · ${g.note}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFacts((f) => ({ ...f, group_companies: f.group_companies.filter((x) => x.org_nr !== g.org_nr) }))}
                    className="text-[11.5px] font-semibold text-foreground-subtle hover:text-foreground"
                  >
                    Ta bort
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* De minimis-intyg för anknutna bolag */}
      {linked.length > 0 && (
        <section className="mt-4">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">De minimis-intyg — anknutna bolag</p>
          <p className="text-[11.5px] text-foreground-subtle">
            Mottaget de minimis-stöd (bruttobidragsekvivalent, EUR) innevarande + två år bakåt enligt bolagets intyg. Anknutna bolag som finns i
            plattformen räknas automatiskt.
          </p>
          <div className="mt-1">
            {linked.map((c) => {
              const auto = platformDeMinimis.has(c.orgNr);
              const row = facts.de_minimis_related[c.orgNr];
              return (
                <div key={c.orgNr} className="grid gap-2 border-t border-default py-2 first:border-t-0 sm:grid-cols-[minmax(0,1.4fr)_160px_minmax(0,1.6fr)] sm:items-center">
                  <p className="text-[12.5px] font-medium text-foreground">
                    {c.name || c.orgNr}
                    {auto && <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${VERDICT_TONE.yes}`}>ur plattformen</span>}
                  </p>
                  <input
                    aria-label={`${c.name || c.orgNr} — de minimis EUR`}
                    inputMode="numeric"
                    placeholder="EUR"
                    disabled={auto}
                    value={row ? String(row.used_eur) : ''}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\s/g, '');
                      setFacts((f) => {
                        const next = { ...f.de_minimis_related };
                        if (v === '' || !/^\d+$/.test(v)) delete next[c.orgNr];
                        else next[c.orgNr] = { ...(next[c.orgNr] ?? { used_eur: 0 }), used_eur: Number(v) };
                        return { ...f, de_minimis_related: next };
                      });
                    }}
                    className={`${inputCls} mx-tnum disabled:opacity-50`}
                  />
                  <input
                    aria-label={`${c.name || c.orgNr} — intygets referens`}
                    placeholder="Intygets datum/referens"
                    disabled={auto || !row}
                    maxLength={SCREENING_NOTE_MAX}
                    value={row?.note ?? ''}
                    onChange={(e) =>
                      setFacts((f) => ({
                        ...f,
                        de_minimis_related: { ...f.de_minimis_related, [c.orgNr]: { used_eur: row?.used_eur ?? 0, note: e.target.value || undefined } }
                      }))
                    }
                    className={`${inputCls} disabled:opacity-50`}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Uppskattning för bolag utan bokslut (bilaga I art. 4.3) */}
      {withoutAccounts.length > 0 && (
        <section className="mt-4">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Tröskelvärde — bolag utan bokslut</p>
          <p className="text-[11.5px] text-foreground-subtle">
            Nystartade bolag saknar bokslut i registret. Ange bolagets egen uppskattning i god tro för innevarande räkenskapsår
            (bilaga I art. 4.3) — anställda (årsarbetskrafter), omsättning och balansomslutning i kronor. Ett bokslut vinner alltid över
            uppskattningen.
          </p>
          <div className="mt-1">
            {withoutAccounts.map((r) => {
              const est = facts.estimates[r.orgNr];
              const setEst = (patch: Partial<NonNullable<typeof est>>) =>
                setFacts((f) => {
                  const next = { ...(f.estimates[r.orgNr] ?? {}), ...patch };
                  for (const k of Object.keys(next) as Array<keyof typeof next>) if (next[k] === undefined) delete next[k];
                  const estimates = { ...f.estimates };
                  if (Object.keys(next).length > 0) estimates[r.orgNr] = next;
                  else delete estimates[r.orgNr];
                  return { ...f, estimates };
                });
              const numField = (key: 'employees' | 'revenue_sek' | 'balance_sheet_sek', label: string) => (
                <input
                  aria-label={`${r.name || r.orgNr} — ${label}`}
                  inputMode="decimal"
                  placeholder={label}
                  value={est?.[key] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\s/g, '').replace(',', '.');
                    const n = Number(v);
                    setEst({ [key]: v === '' || !Number.isFinite(n) || n < 0 ? undefined : n });
                  }}
                  className={`${inputCls} mx-tnum`}
                />
              );
              return (
                <div key={r.orgNr} className="grid gap-2 border-t border-default py-2 first:border-t-0 sm:grid-cols-[minmax(0,1.2fr)_110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
                  <p className="text-[12.5px] font-medium text-foreground">
                    {r.name || r.orgNr}
                    <span className="ml-2 text-[11px] font-normal text-foreground-subtle">{r.note}</span>
                  </p>
                  {numField('employees', 'Anställda')}
                  {numField('revenue_sek', 'Omsättning kr')}
                  {numField('balance_sheet_sek', 'Balansomslutning kr')}
                  <input
                    aria-label={`${r.name || r.orgNr} — källa för uppskattningen`}
                    placeholder="Källa (budget, bolagets uppgift)"
                    maxLength={SCREENING_NOTE_MAX}
                    value={est?.note ?? ''}
                    onChange={(e) => setEst({ note: e.target.value || undefined })}
                    className={inputCls}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Steg 2 — grundarteam, engagemang, fas */}
      <section className="mt-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Grundarteam och engagemang</p>
        <p className="text-[11.5px] text-foreground-subtle">
          {assessment.foundersSource === 'platform' && (assessment.founders?.length ?? 0) > 0
            ? 'Grundarna kommer från teamet på bolagskortet. Lägg till engagemang i % av heltid här (sparas i bedömningen, inte i teamet).'
            : 'Inga grundare i plattformen — lägg in grundarna med ägarandel och engagemang i % av heltid.'}
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-end">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Mognadsfas</span>
            <select
              value={facts.maturity_phase ?? ''}
              onChange={(e) =>
                setFacts((f) => ({ ...f, maturity_phase: (e.target.value || undefined) as ScreeningManualFacts['maturity_phase'] }))
              }
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
            <input
              type="checkbox"
              checked={facts.research_spinoff === true}
              onChange={(e) => setFacts((f) => ({ ...f, research_spinoff: e.target.checked || undefined }))}
            />
            Forskningsavknoppning
          </label>
        </div>
        <div className="mt-2 overflow-x-auto rounded-xl border border-default">
          <table className="w-full text-[12.5px]">
            <thead className="bg-canvas-subtle text-left text-[11px] uppercase tracking-wider text-foreground-subtle">
              <tr>
                <th className="px-3 py-1.5 font-medium">Grundare</th>
                <th className="px-3 py-1.5 font-medium">% kapital</th>
                <th className="px-3 py-1.5 font-medium">Engagemang % av heltid</th>
                <th className="px-3 py-1.5 font-medium">Forskare</th>
                <th className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {founderRows.map((r, i) => (
                <tr key={i} className="border-t border-default">
                  <td className="px-2 py-1">
                    <input
                      aria-label="Grundarens namn"
                      value={r.name}
                      maxLength={120}
                      onChange={(e) => setFounders(founderRows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      className={inputCls}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      aria-label="Ägarandel i procent"
                      inputMode="decimal"
                      value={r.equity_pct ?? ''}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(',', '.'));
                        setFounders(founderRows.map((x, j) => (j === i ? { ...x, equity_pct: e.target.value === '' || !Number.isFinite(n) ? undefined : n } : x)));
                      }}
                      className={`${inputCls} mx-tnum`}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      aria-label="Engagemang i procent av heltid"
                      inputMode="decimal"
                      value={r.engagement_pct ?? ''}
                      onChange={(e) => {
                        const n = Number(e.target.value.replace(',', '.'));
                        setFounders(
                          founderRows.map((x, j) => (j === i ? { ...x, engagement_pct: e.target.value === '' || !Number.isFinite(n) ? undefined : n } : x))
                        );
                      }}
                      className={`${inputCls} mx-tnum`}
                    />
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input
                      type="checkbox"
                      aria-label="Forskare"
                      checked={r.researcher === true}
                      onChange={(e) => setFounders(founderRows.map((x, j) => (j === i ? { ...x, researcher: e.target.checked || undefined } : x)))}
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => setFounders(founderRows.filter((_, j) => j !== i))}
                      className="text-[11.5px] font-semibold text-foreground-subtle hover:text-foreground"
                    >
                      Ta bort
                    </button>
                  </td>
                </tr>
              ))}
              {founderRows.length === 0 && (
                <tr className="border-t border-default">
                  <td colSpan={5} className="px-3 py-2 text-foreground-muted">Inga grundare angivna.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={founderRows.length >= SCREENING_MAX_FOUNDERS}
            onClick={() => setFounders([...founderRows, { name: '' }])}
            className="rounded-full border border-strong px-3 py-1 text-[12px] font-semibold text-foreground hover:bg-canvas-subtle disabled:opacity-50"
          >
            + Lägg till grundare
          </button>
          {foundersOpen && assessment.foundersSource === 'platform' && (
            <button
              type="button"
              onClick={() => {
                setFacts((f) => ({ ...f, founders: undefined }));
                setFoundersOpen(false);
              }}
              className="text-[12px] font-semibold text-link hover:underline"
            >
              Återgå till teamet på bolagskortet
            </button>
          )}
        </div>
      </section>

      {/* Vinnova-punkter som bedöms av coach/controller */}
      <section className="mt-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Vinnovas målgrupp — coachens bedömning</p>
        <div className="mt-1">
          {VINNOVA_MANUAL.map((v) => (
            <AnswerRow
              key={v.id}
              meta={v.meta}
              current={assessment.result.vinnovaChecks.find((c) => c.id === v.id)}
              value={facts[v.id]}
              onChange={(a) => setFacts((f) => ({ ...f, [v.id]: a }))}
            />
          ))}
        </div>
      </section>

      {/* IRL */}
      <section className="mt-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Bedömning IRL — nivå och motivering (metrics)</p>
        <p className="text-[11.5px] text-foreground-subtle">
          {platformIrl
            ? 'Nivåerna kommer från den senaste readiness-bedömningen i plattformen — här skrivs motiveringen per axel.'
            : 'Ingen readiness-bedömning i plattformen — ange nivå (1–9) och motivering per axel.'}
        </p>
        <div className="mt-1">
          {IRL_AXES.map((ax) => (
            <div key={ax} className="grid gap-2 border-t border-default py-2 first:border-t-0 sm:grid-cols-[80px_90px_minmax(0,1fr)] sm:items-center">
              <p className="text-[12.5px] font-semibold text-foreground">{IRL_LABEL[ax]}</p>
              <input
                aria-label={`${IRL_LABEL[ax]} nivå`}
                inputMode="numeric"
                placeholder="Nivå"
                disabled={platformIrl}
                value={platformIrl ? String(irl?.[ax] ?? '') : (facts.irl?.levels?.[ax] ?? '')}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const levels = { ...(facts.irl?.levels ?? {}) };
                  if (e.target.value === '' || !Number.isInteger(n)) delete levels[ax];
                  else levels[ax] = n;
                  setIrl({ levels });
                }}
                className={`${inputCls} mx-tnum disabled:opacity-50`}
              />
              <input
                aria-label={`${IRL_LABEL[ax]} motivering`}
                placeholder="Motivering (metrics)"
                maxLength={SCREENING_NOTE_MAX}
                value={facts.irl?.notes?.[ax] ?? ''}
                onChange={(e) => {
                  const notes = { ...(facts.irl?.notes ?? {}) };
                  if (e.target.value) notes[ax] = e.target.value;
                  else delete notes[ax];
                  setIrl({ notes });
                }}
                className={inputCls}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Steg 3 + kommentar */}
      <section className="mt-4">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">Excellent inkubation och kommentar</p>
        <div className="mt-1">
          <AnswerRow
            meta={{
              question: 'Uppfyller bolaget villkoren för excellent inkubation?',
              fulfilled: 'Ja — villkoren uppfyllda',
              failed: 'Nej — uppfylls inte',
              hint: 'Har något hänt som påverkar rätten att ta emot inkubationsmedel? Beslutet registreras som förut på bolagskortet.'
            }}
            current={assessment.result.excellence}
            value={facts.excellence}
            onChange={(a) => setFacts((f) => ({ ...f, excellence: a }))}
          />
        </div>
        <label className="mt-2 block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Kommentar (review-raden)</span>
          <textarea
            value={facts.comment ?? ''}
            maxLength={SCREENING_COMMENT_MAX}
            rows={3}
            onChange={(e) => setFacts((f) => ({ ...f, comment: e.target.value || undefined }))}
            placeholder="Controllerns sammanfattande kommentar — skrivs i PDF:ns review-rad."
            className={`${inputCls} mt-1`}
          />
        </label>
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? 'Räknar om…' : 'Spara svar och uppdatera bedömningen'}
        </button>
        {assessment.factsSaved && !assessment.factsSchemaMissing && (
          <span className="text-[12px] text-foreground-muted">Svaren är sparade på bolagskortet.</span>
        )}
        {assessment.factsSchemaMissing && (
          <span className={`rounded-full px-2.5 py-1 text-[12px] ${WARN_TONE}`}>
            Fältet screening_facts saknas i PocketBase (kör migration 1700000190) — svaren vägdes in men sparades inte.
          </span>
        )}
        {assessment.factsSaved === false && (
          <span className={`rounded-full px-2.5 py-1 text-[12px] ${WARN_TONE}`}>Svaren kunde inte sparas på bolagskortet — de följer med i PDF:n.</span>
        )}
      </div>
      {state.error && (
        <p className="mt-3 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange">
          {state.error}
        </p>
      )}
    </form>
  );
}
