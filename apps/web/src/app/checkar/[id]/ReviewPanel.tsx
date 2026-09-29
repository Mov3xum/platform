'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  FUNDING_BASES,
  FUNDING_BASIS_LABELS,
  scoreSupportCheckAssessment,
  type SupportCheckCriterion
} from '@platform/shared';
import {
  assessApplicationAction,
  closeApplicationAction,
  decideApplicationAction,
  markPaidAction,
  recordStatementAction,
  requestChangesAction,
  setFundingAction,
  withdrawApplicationAction
} from '@/lib/actions/support-checks';
import type { FundingOptions } from '../form-data';
import { Notice, btnGhost, btnPrimary, inputClass, labelClass } from '../ui';

interface Feedback {
  error?: string;
  warning?: string;
  notice?: string;
}

export interface ReviewState {
  status: string;
  coachStatement: string;
  coachStatementAt: string | null;
  controllerStatement: string;
  controllerStatementAt: string | null;
  scores: Record<string, number>;
  score: number | null;
  fundingProject: string | null;
  fundingWorkPackage: string | null;
  stateAidBasis: string | null;
  fundingNote: string;
  requestedSek: number | null;
  approvedSek: number | null;
  decisionNote: string;
  paidAt: string | null;
  finalReportAt: string | null;
  openIssues: number;
  hasArt22Period: boolean | null;
}

/**
 * Movexums handläggningspanel (§ 46.5): utlåtanden, bedömning, komplettering,
 * finansiering (ledning), beslut (ledning), utbetalning, slutrapport, avslut,
 * återkallelse. Klienten visar bara det rollen får göra — server-actionen och
 * skrivlagret är gränsen.
 */
export function ReviewPanel({
  applicationId,
  state,
  criteria,
  funding,
  isLead,
  defaultBasis,
  defaultProject,
  defaultWorkPackage
}: {
  applicationId: string;
  state: ReviewState;
  criteria: SupportCheckCriterion[];
  funding: FundingOptions;
  isLead: boolean;
  defaultBasis: string | null;
  defaultProject: string | null;
  defaultWorkPackage: string | null;
}) {
  const router = useRouter();
  const uid = useId();
  const [feedback, setFeedback] = useState<Feedback>({});
  const [pending, startTransition] = useTransition();
  const [coach, setCoach] = useState(state.coachStatement);
  const [controller, setController] = useState(state.controllerStatement);
  const [scores, setScores] = useState<Record<string, string>>(Object.fromEntries(criteria.map((c) => [c.key, state.scores[c.key] !== undefined ? String(state.scores[c.key]) : ''])));
  const [changesNote, setChangesNote] = useState('');
  const [changesDays, setChangesDays] = useState('');
  const [project, setProject] = useState(state.fundingProject ?? defaultProject ?? '');
  const [wp, setWp] = useState(state.fundingWorkPackage ?? defaultWorkPackage ?? '');
  const [basis, setBasis] = useState(state.stateAidBasis ?? defaultBasis ?? 'de_minimis');
  const [fundingNote, setFundingNote] = useState(state.fundingNote);
  const [approved, setApproved] = useState(state.approvedSek !== null ? String(state.approvedSek) : state.requestedSek !== null ? String(state.requestedSek) : '');
  const [decisionNote, setDecisionNote] = useState(state.decisionNote);
  const [paidAt, setPaidAt] = useState('');
  const [paidAmount, setPaidAmount] = useState(state.approvedSek !== null ? String(state.approvedSek) : '');
  const [paidNote, setPaidNote] = useState('');

  const run = (fn: () => Promise<Feedback & { ok?: boolean }>) =>
    startTransition(async () => {
      const res = await fn();
      setFeedback({ error: res.error, warning: res.warning, notice: res.notice });
      if (!res.error) router.refresh();
    });

  const reviewOpen = state.status === 'submitted' || state.status === 'under_review' || state.status === 'changes_requested';
  const decisionOpen = state.status === 'submitted' || state.status === 'under_review';
  const preview = scoreSupportCheckAssessment(criteria, Object.fromEntries(Object.entries(scores).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])));
  const wps = funding.workPackages.filter((w) => w.project === project);
  const fundingLocked = !(state.status === 'submitted' || state.status === 'under_review' || state.status === 'changes_requested' || state.status === 'approved');

  return (
    <div className="space-y-5">
      {feedback.error && <Notice kind="error">{feedback.error}</Notice>}
      {feedback.warning && <Notice kind="warning">{feedback.warning}</Notice>}
      {feedback.notice && <Notice kind="notice">{feedback.notice}</Notice>}

      {reviewOpen && (
        <>
          <Section title="Ansvarig affärscoach — utlåtande" meta={state.coachStatementAt ? `lämnat ${state.coachStatementAt}` : 'saknas'}>
            <textarea className={`${inputClass} min-h-[110px]`} value={coach} onChange={(e) => setCoach(e.target.value)} maxLength={8000} placeholder="Förslag till beslut och kort motivering, en per sökt insats. Bedöm insatsen, inte personerna." />
            <div className="mt-2 flex gap-2">
              <button type="button" className={btnPrimary} disabled={pending || !coach.trim()} onClick={() => run(() => recordStatementAction(applicationId, { role: 'coach', text: coach }))}>
                Spara utlåtande
              </button>
            </div>
          </Section>

          <Section title="Controller — utlåtande" meta={state.controllerStatementAt ? `lämnat ${state.controllerStatementAt}` : 'saknas'}>
            <textarea className={`${inputClass} min-h-[90px]`} value={controller} onChange={(e) => setController(e.target.value)} maxLength={8000} placeholder="Input och förslag (budget, statsstöd, rimlighet)." />
            <div className="mt-2 flex gap-2">
              <button type="button" className={btnPrimary} disabled={pending || !controller.trim()} onClick={() => run(() => recordStatementAction(applicationId, { role: 'controller', text: controller }))}>
                Spara utlåtande
              </button>
            </div>
          </Section>

          <Section title="Bedömning" meta={state.score !== null ? `${state.score.toFixed(1)} / 5` : 'ej bedömd'}>
            <div className="grid gap-2 sm:grid-cols-2">
              {criteria.map((c) => (
                <label key={c.key} className="flex items-center justify-between gap-3 rounded-xl border border-default px-3 py-2 text-sm">
                  <span className="text-foreground">
                    {c.label} <span className="text-xs text-foreground-subtle">(vikt {c.weight})</span>
                  </span>
                  <select className="rounded-lg border border-default bg-surface px-2 py-1 text-sm" value={scores[c.key] ?? ''} onChange={(e) => setScores((s) => ({ ...s, [c.key]: e.target.value }))}>
                    <option value="">–</option>
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" className={btnPrimary} disabled={pending || preview.score === null} onClick={() => run(() => assessApplicationAction(applicationId, scores))}>
                Spara bedömning
              </button>
              {preview.score !== null && <span className="text-sm text-foreground-muted mx-tnum">Viktat: {preview.score.toFixed(1)} / 5</span>}
            </div>
          </Section>

          {state.status !== 'changes_requested' && (
            <Section title="Begär komplettering">
              <textarea className={`${inputClass} min-h-[80px]`} value={changesNote} onChange={(e) => setChangesNote(e.target.value)} maxLength={4000} placeholder="Vad ska bolaget rätta eller komplettera? Lägg gärna in punkter per avsnitt i kommentarerna också." />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input className={`${inputClass} w-28`} inputMode="numeric" placeholder="dagar" value={changesDays} onChange={(e) => setChangesDays(e.target.value)} />
                <button type="button" className={btnGhost} disabled={pending || !changesNote.trim()} onClick={() => run(() => requestChangesAction(applicationId, { note: changesNote, dueDays: changesDays ? Number(changesDays) : null }))}>
                  Begär komplettering
                </button>
                <span className="text-xs text-foreground-subtle">Bolaget notifieras, ansökan låses upp och måste signeras om.</span>
              </div>
            </Section>
          )}
        </>
      )}

      {isLead && !fundingLocked && (
        <Section title="Finansiering (ledning)" meta="var pengarna tas och på vilken stödgrund">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-p`} className={labelClass}>
                Finansieringsprojekt
              </label>
              <select id={`${uid}-p`} className={inputClass} value={project} onChange={(e) => { setProject(e.target.value); setWp(''); }}>
                <option value="">– välj projekt –</option>
                {funding.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-wp`} className={labelClass}>
                Arbetspaket
              </label>
              <select id={`${uid}-wp`} className={inputClass} value={wp} onChange={(e) => setWp(e.target.value)} disabled={!project}>
                <option value="">{wps.length ? '– välj arbetspaket –' : 'inga arbetspaket'}</option>
                {wps.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${uid}-b`} className={labelClass}>
                Statsstödsgrund
              </label>
              <select id={`${uid}-b`} className={inputClass} value={basis} onChange={(e) => setBasis(e.target.value)}>
                {FUNDING_BASES.map((b) => (
                  <option key={b} value={b}>
                    {FUNDING_BASIS_LABELS[b]}
                  </option>
                ))}
              </select>
              {state.hasArt22Period === true && basis === 'de_minimis' && <p className="mt-1 text-xs text-movexum-morkgul dark:text-movexum-pastell-gul">Bolaget har en aktiv art. 22-period — motivera valet av de minimis.</p>}
              {state.hasArt22Period === false && basis === 'art22' && <p className="mt-1 text-xs text-movexum-morkgul dark:text-movexum-pastell-gul">Bolaget saknar registrerad art. 22-period.</p>}
            </div>
            <div>
              <label htmlFor={`${uid}-fn`} className={labelClass}>
                Motivering / anteckning
              </label>
              <input id={`${uid}-fn`} className={inputClass} value={fundingNote} onChange={(e) => setFundingNote(e.target.value)} maxLength={2000} />
            </div>
          </div>
          <div className="mt-2">
            <button type="button" className={btnPrimary} disabled={pending || !project} onClick={() => run(() => setFundingAction(applicationId, { projectId: project || null, workPackageId: wp || null, stateAidBasis: basis, note: fundingNote }))}>
              Spara finansiering
            </button>
          </div>
        </Section>
      )}

      {isLead && decisionOpen && (
        <Section title="Beslut (beslutsgruppen)">
          {state.openIssues > 0 && <p className="mb-2 text-xs text-movexum-morkgul dark:text-movexum-pastell-gul">{state.openIssues} olösta kompletteringspunkter — lös dem eller begär komplettering innan beslut.</p>}
          {!state.fundingProject && <p className="mb-2 text-xs text-movexum-morkgul dark:text-movexum-pastell-gul">Finansiering saknas — sätt projekt och statsstödsgrund innan ansökan kan beviljas.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-amt`} className={labelClass}>
                Beviljat belopp (kr)
              </label>
              <input id={`${uid}-amt`} className={inputClass} inputMode="numeric" value={approved} onChange={(e) => setApproved(e.target.value)} />
              {state.requestedSek !== null && <p className="mt-1 text-xs text-foreground-subtle">Sökt: {Math.round(state.requestedSek).toLocaleString('sv-SE')} kr</p>}
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${uid}-dn`} className={labelClass}>
                Beslut och kort motivering
              </label>
              <textarea id={`${uid}-dn`} className={`${inputClass} min-h-[80px]`} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} maxLength={4000} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={pending || !state.fundingProject}
              onClick={() => {
                if (!confirm('Bevilja stödet? De minimis-post och kapitalrad skapas automatiskt och bolaget notifieras.')) return;
                run(() => decideApplicationAction(applicationId, { decision: 'approved', approvedAmountSek: approved, note: decisionNote }));
              }}
            >
              Bevilja
            </button>
            <button
              type="button"
              className={btnGhost}
              disabled={pending || !decisionNote.trim()}
              onClick={() => {
                if (!confirm('Avslå ansökan? Bolaget notifieras med motiveringen.')) return;
                run(() => decideApplicationAction(applicationId, { decision: 'rejected', note: decisionNote }));
              }}
            >
              Avslå
            </button>
          </div>
        </Section>
      )}

      {isLead && state.status === 'approved' && (
        <Section title="Utbetalning">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Datum</label>
              <input type="date" className={inputClass} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Belopp (kr)</label>
              <input className={inputClass} inputMode="numeric" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Anteckning</label>
              <input className={inputClass} value={paidNote} onChange={(e) => setPaidNote(e.target.value)} maxLength={1000} />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={pending} onClick={() => run(() => markPaidAction(applicationId, { paidAt: paidAt || undefined, amountSek: paidAmount, note: paidNote }))}>
              Registrera utbetalning
            </button>
            <button
              type="button"
              className={btnGhost}
              disabled={pending}
              onClick={() => {
                const reason = prompt('Anledning till återkallelsen (de minimis-post och kapitalrad återförs):') ?? '';
                if (reason === '' && !confirm('Återkalla utan anledning?')) return;
                run(() => withdrawApplicationAction(applicationId, { reason }));
              }}
            >
              Återkalla beslutet
            </button>
          </div>
        </Section>
      )}

      {state.status === 'paid' && (
        <Section title="Slutrapport & avslut">
          <p className="mb-2 text-sm text-foreground-muted">{state.finalReportAt ? `Slutrapport mottagen ${state.finalReportAt}.` : 'Slutrapport saknas.'}</p>
          <div className="flex flex-wrap gap-2">
            {!state.finalReportAt && (
              <button type="button" className={btnGhost} disabled={pending} onClick={() => run(() => recordFinalReportViaStaff(applicationId))}>
                Markera slutrapport mottagen
              </button>
            )}
            <button type="button" className={btnPrimary} disabled={pending} onClick={() => run(() => closeApplicationAction(applicationId))}>
              Avsluta ärendet
            </button>
          </div>
        </Section>
      )}

      {(state.status === 'submitted' || state.status === 'under_review' || state.status === 'changes_requested') && isLead && (
        <div className="text-right">
          <button
            type="button"
            className="text-xs text-foreground-subtle hover:underline"
            disabled={pending}
            onClick={() => {
              const reason = prompt('Anledning till återkallelsen:') ?? '';
              if (!confirm('Återkalla ansökan å bolagets vägnar?')) return;
              run(() => withdrawApplicationAction(applicationId, { reason }));
            }}
          >
            Återkalla ansökan
          </button>
        </div>
      )}
    </div>
  );
}

async function recordFinalReportViaStaff(applicationId: string) {
  const { recordFinalReportAction } = await import('@/lib/actions/support-checks');
  return recordFinalReportAction(applicationId, {});
}

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-default p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {meta && <span className="text-xs text-foreground-subtle">{meta}</span>}
      </div>
      {children}
    </section>
  );
}
