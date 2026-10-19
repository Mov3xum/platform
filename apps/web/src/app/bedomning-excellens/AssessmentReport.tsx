'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { STATE_AID_OUTCOME_LABEL, VINNOVA_OUTCOME_LABEL, type ManualAnswer, type ScreeningFounderFact, type ScreeningManualFacts } from '@platform/shared';
import { applyExcellenceFactsAction, type ExcellenceAssessment } from '@/lib/actions/excellence';
import { logRegistryDiagnostics } from '@/lib/integrations/company-registry/console-diagnostics';
import { ScreeningRequestComposer } from './ScreeningRequestComposer';
import { CompanyBlock } from './report/CompanyBlock';
import { FoundersTable } from './report/FoundersTable';
import { GroupMap } from './report/GroupMap';
import { IrlTable } from './report/IrlTable';
import { OwnerEngagements } from './report/OwnerEngagements';
import { EvidenceSummary, RegistryEvidence, evidenceCounts } from './report/RegistryEvidence';
import { ReportNav } from './report/ReportNav';
import { ThresholdsTable } from './report/ThresholdsTable';
import { VerdictSummary } from './report/VerdictSummary';
import {
  CheckList,
  CheckRow,
  ERROR_TONE,
  EXCELLENCE_QUESTION,
  FACTS_FORM_ID,
  ReportSection,
  STANDALONE_QUESTION,
  VERDICT_TONE,
  VINNOVA_MANUAL_IDS,
  VINNOVA_QUESTION,
  WARN_TONE,
  initialActionState,
  type Editable,
  type FetchMoreConfig,
  type QuestionMeta,
  type VinnovaManualId
} from './report/shared';

export type { FetchMoreConfig } from './report/shared';

// EN interaktiv rapport (CLAUDE.md § 51.9, § 51.12). Den här filen är bara
// LAYOUTEN: utfallet överst, sex numrerade sektioner med hopp-nav i samma
// ordning som referensbedömningen "Bedömning Vinnova Combly", saknat underlag
// med begäran om komplettering, underlaget från registret hopfällt sist och
// en klistrad sparknapp. Varje punkt som registret inte kan avgöra besvaras
// DIREKT i raden (väljare till höger + motivering); grundarteam,
// uppskattningar, de minimis-intyg, IRL och kommentaren redigeras i sin egen
// tabell. Ändringarna samlas i ett enda "Spara och räkna om": samma
// underlag, inga nya debiterade anrop (`applyExcellenceFactsAction`). Ett
// manuellt NEJ väger alltid tyngst; ett JA fyller bara en OKÄNT-punkt.
// Huvudet (bolag, status, PDF, klarmarkera) ritas av `ExcellenceWorkspace`.
// Byggstenarna bor i `report/`.

interface Props {
  assessment: ExcellenceAssessment;
  fetchMore?: FetchMoreConfig;
  onUpdated: (a: ExcellenceAssessment) => void;
  /** Kollegor en begäran om komplettering kan gå till (§ 51.6). */
  coaches: Array<{ id: string; name: string }>;
  senderName?: string;
}

/** Redigeringsläge per tabell — en i taget, så rapporten förblir lugn. */
type EditKey = 'founders' | 'irl' | 'comment' | 'de_minimis' | null;

function StepLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">{children}</p>;
}

export function AssessmentReport({ assessment, fetchMore, onUpdated, coaches, senderName }: Props) {
  const [state, formAction, pending] = useActionState(applyExcellenceFactsAction, initialActionState);
  const [facts, setFacts] = useState<ScreeningManualFacts>(assessment.facts);
  const [editing, setEditing] = useState<EditKey>(null);

  useEffect(() => {
    if (state.assessment) onUpdated(state.assessment);
  }, [state.assessment, onUpdated]);

  // Felsökning mot live: leverantörens svar per bolag i DevTools-konsolen.
  useEffect(() => {
    if (assessment.mode !== 'register') return;
    logRegistryDiagnostics({
      title: `${assessment.providerName ?? 'Bolagsregistret'}: Bedömning excellens — ${assessment.subject.name || assessment.subject.orgNr}`,
      notes: assessment.notes.map((n) => ({ label: `${n.name || ''} ${n.orgNr}`.trim(), notes: n.notes })),
      warnings: assessment.lookupWarnings,
      data: {
        Kostnad: assessment.cost,
        'Ägarnas andra bolag': assessment.result.ownerEngagements,
        'Bolag i bedömningen': assessment.result.companies.map((c) => ({
          bolag: c.name,
          orgNr: c.orgNr,
          relation: c.relationLabel ?? 'startup-bolaget',
          sni: c.basic?.sni?.map((x) => x.code).join(', '),
          uppslag: c.dataFetched
        }))
      }
    });
  }, [assessment]);

  // Ny körning/omräkning ⇒ rapporten följer den och alla redigeringar stängs.
  useEffect(() => {
    setFacts(assessment.facts);
    setEditing(null);
  }, [assessment.context, assessment.facts]);

  const { subject, result } = assessment;
  const subjectName = subject.name || 'Startup-bolaget';
  const dirty = useMemo(() => JSON.stringify(facts) !== JSON.stringify(assessment.facts), [facts, assessment.facts]);
  const toggle = (key: Exclude<EditKey, null>) => setEditing((k) => (k === key ? null : key));
  const answerEdit = (key: 'standalone' | VinnovaManualId | 'excellence', meta: QuestionMeta): Editable => ({
    meta,
    value: facts[key] as ManualAnswer | undefined,
    onChange: (v) => setFacts((f) => ({ ...f, [key]: v }))
  });

  // Anknutna bolag vars de minimis redan kommer ur plattformen (intyg behövs inte).
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
  const linkedForIntyg = result.companies.filter((c) => c.role === 'linked' && c.orgNr && !platformDeMinimis.has(c.orgNr));

  const founderRows: ScreeningFounderFact[] = facts.founders ?? (assessment.foundersSource === 'platform' ? (assessment.founders ?? []) : []);
  const setFounders = (rows: ScreeningFounderFact[]) => setFacts((f) => ({ ...f, founders: rows.length > 0 ? rows : undefined }));

  const related = result.companies.slice(1);
  const evidence = evidenceCounts(assessment);
  const stateAidTone =
    result.stateAid.outcome === 'art22_possible'
      ? VERDICT_TONE.yes
      : result.stateAid.outcome === 'undetermined'
        ? VERDICT_TONE.unknown
        : result.stateAid.outcome === 'not_eligible'
          ? VERDICT_TONE.no
          : WARN_TONE;
  const vinnovaTone =
    result.vinnova.outcome === 'in_target_possible' ? VERDICT_TONE.yes : result.vinnova.outcome === 'not_in_target' ? VERDICT_TONE.no : VERDICT_TONE.unknown;

  const nav = [
    { href: '#sammanfattning', label: 'Sammanfattning' },
    { href: '#grundforutsattningar', label: '1 Grundförutsättningar' },
    { href: '#koncern', label: '2 Koncern & ägare', count: related.length || undefined },
    { href: '#fristaende', label: '3 Fristående' },
    { href: '#troskel', label: '4 Tröskelvärden & de minimis' },
    { href: '#vinnova', label: '5 Vinnova' },
    { href: '#excellens', label: '6 Excellens' },
    { href: '#saknas', label: 'Saknat underlag', count: result.missing.length || undefined },
    { href: '#underlag', label: 'Underlag', count: evidence.notes + evidence.warnings || undefined }
  ];

  return (
    <section className="space-y-7">
      {/* Formuläret bär bara de dolda fälten; alla kontroller i rapporten är
          state som serialiseras hit. Så kan koncernkartans egna formulär
          (lägg till / hämta mer) ligga inne i rapporten utan nästlade <form>. */}
      <form id={FACTS_FORM_ID} action={formAction}>
        <input type="hidden" name="context" value={assessment.context} />
        <input type="hidden" name="case_id" value={assessment.caseId ?? ''} />
        <input type="hidden" name="facts" value={JSON.stringify(facts)} />
      </form>

      {assessment.history?.error && <p className={`rounded-xl px-3 py-2 text-[12.5px] ${WARN_TONE}`}>{assessment.history.error}</p>}
      <EvidenceSummary assessment={assessment} />
      <ReportNav items={nav} />

      <VerdictSummary
        result={result}
        comment={facts.comment}
        onCommentChange={(v) => setFacts((f) => ({ ...f, comment: v }))}
        editingComment={editing === 'comment'}
        onToggleComment={() => toggle('comment')}
      />

      {/* Steg 1 */}
      <div className="space-y-6">
        <StepLabel>Steg 1 · Företagsstöd enligt art. 22 GBER eller de minimis</StepLabel>

        <ReportSection id="grundforutsattningar" number="1" title="Grundförutsättningar">
          <CompanyBlock c={result.companies[0]} subjectName={subjectName} facts={facts} setFacts={setFacts} />
        </ReportSection>

        <ReportSection id="koncern" number="2" title="Koncern & ägare" aside={related.length > 0 ? `${related.length} bolag räknas in utöver ${subjectName}` : 'Inga andra bolag räknas in'}>
          <GroupMap companies={result.companies} subjectName={subjectName} assessment={assessment} facts={facts} fetchMore={fetchMore} onUpdated={onUpdated} />
          {related.length > 0 && (
            <div className="space-y-5 border-t border-default pt-4">
              {related.map((c) => (
                <CompanyBlock key={c.orgNr || c.name} c={c} subjectName={subjectName} facts={facts} setFacts={setFacts} />
              ))}
            </div>
          )}
          <div className="border-t border-default pt-4">
            <OwnerEngagements
              engagements={result.ownerEngagements}
              subjectName={subjectName}
              subjectSni={result.companies[0]?.basic?.sni}
              registerMode={assessment.mode === 'register'}
              facts={facts}
              setFacts={setFacts}
            />
          </div>
        </ReportSection>

        <ReportSection id="fristaende" number="3" title="Fristående företag?">
          <CheckList>
            <CheckRow check={result.standalone} edit={answerEdit('standalone', STANDALONE_QUESTION)} />
          </CheckList>
        </ReportSection>

        <ReportSection id="troskel" number="4" title="Tröskelvärden & de minimis">
          <ThresholdsTable
            result={result}
            facts={facts}
            setFacts={setFacts}
            linkedForIntyg={linkedForIntyg}
            editingIntyg={editing === 'de_minimis'}
            onToggleIntyg={() => toggle('de_minimis')}
          />
        </ReportSection>

        <div className="rounded-2xl border border-default bg-canvas-subtle px-4 py-3">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">Sammanfattande bedömning av art. 22 GBER</p>
          <p className="mt-1 text-[13px] text-foreground">
            <span className={`mr-2 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${stateAidTone}`}>{STATE_AID_OUTCOME_LABEL[result.stateAid.outcome]}</span>
            {result.stateAid.text}
          </p>
        </div>
      </div>

      {/* Steg 2 */}
      <div className="space-y-6">
        <StepLabel>Steg 2 · Vinnovas målgrupp</StepLabel>
        <ReportSection id="vinnova" number="5" title={`Ingår ${subjectName} i målgruppen för Vinnova?`}>
          <FoundersTable
            rows={founderRows}
            setRows={setFounders}
            facts={facts}
            setFacts={setFacts}
            foundersSource={assessment.foundersSource}
            editing={editing === 'founders'}
            onToggle={() => toggle('founders')}
          />
          <CheckList>
            {result.vinnovaChecks.map((check) => {
              const meta = VINNOVA_QUESTION[check.id];
              const id = check.id as VinnovaManualId;
              const isFounderCheck = check.id === 'founders_75' || check.id === 'founder_driven';
              return (
                <CheckRow
                  key={check.id}
                  check={check}
                  edit={meta && VINNOVA_MANUAL_IDS.includes(id) ? answerEdit(id, meta) : undefined}
                  action={isFounderCheck ? { label: 'Ändra grundare', onClick: () => setEditing('founders') } : undefined}
                />
              );
            })}
          </CheckList>
          <IrlTable irl={result.irl} facts={facts} setFacts={setFacts} startupId={subject.startupId} editing={editing === 'irl'} onToggle={() => toggle('irl')} />
          <div className="rounded-2xl border border-default bg-canvas-subtle px-4 py-3">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-foreground-subtle">Ingår {subjectName} i målgruppen</p>
            <p className="mt-1 text-[13px] text-foreground">
              <span className={`mr-2 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${vinnovaTone}`}>{VINNOVA_OUTCOME_LABEL[result.vinnova.outcome]}</span>
              {result.vinnova.text}
            </p>
          </div>
        </ReportSection>
      </div>

      {/* Steg 3 */}
      <div className="space-y-6">
        <StepLabel>Steg 3 · Excellent inkubation</StepLabel>
        <ReportSection id="excellens" number="6" title="Excellent inkubation">
          <CheckList>
            <CheckRow check={result.excellence} edit={answerEdit('excellence', EXCELLENCE_QUESTION)} />
          </CheckList>
        </ReportSection>
      </div>

      {/* Saknat underlag + begäran om komplettering — punkterna kommer härifrån. */}
      <section id="saknas" className="scroll-mt-24 rounded-2xl border border-default bg-canvas-subtle px-4 py-3">
        <h3 className="text-[13px] font-semibold text-foreground">Saknat underlag{result.missing.length > 0 ? ` (${result.missing.length})` : ''}</h3>
        {result.missing.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-foreground-muted">Inget saknat underlag — alla punkter är avgjorda.</p>
        ) : (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-foreground-muted">
            {result.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        {result.missing.length > 0 && (
          <div className="mt-3">
            <ScreeningRequestComposer assessment={assessment} coaches={coaches} senderName={senderName} />
          </div>
        )}
      </section>

      <RegistryEvidence assessment={assessment} />

      {/* Spara — ett enda ställe för alla ändringar i rapporten. Klistrad så den
          alltid är nåbar; ovanför mobilens bottenmeny. Sist på sidan så den
          inte ligger över något annat formulär. */}
      <div
        className="sticky z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-2xl border border-default bg-surface px-4 py-3 shadow-movexum-svart/10 shadow-lg"
        style={{ bottom: 'calc(var(--mx-bnav-total, 0px) + 8px)' }}
      >
        <button
          type="submit"
          form={FACTS_FORM_ID}
          disabled={pending || !dirty}
          className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Räknar om…' : 'Spara och räkna om'}
        </button>
        <span className="text-[12px] text-foreground-muted">
          {dirty ? 'Osparade ändringar' : assessment.subject.startupId ? 'Allt sparat' : 'Bolaget finns inte i plattformen — svaren följer bara med i PDF:n'}
        </span>
        {dirty && (
          <button type="button" onClick={() => setFacts(assessment.facts)} className="text-[12px] font-semibold text-foreground-subtle hover:text-foreground">
            Ångra
          </button>
        )}
        {assessment.factsSchemaMissing && (
          <span className={`rounded-full px-2.5 py-1 text-[12px] ${WARN_TONE}`}>
            Fältet screening_facts saknas i PocketBase (kör migration 1700000190) — svaren vägdes in men sparades inte.
          </span>
        )}
        {assessment.factsSaved === false && !assessment.factsSchemaMissing && (
          <span className={`rounded-full px-2.5 py-1 text-[12px] ${WARN_TONE}`}>Svaren kunde inte sparas på bolagskortet — de följer med i PDF:n.</span>
        )}
        {state.error && <span className={`rounded-full px-2.5 py-1 text-[12px] ${ERROR_TONE}`}>{state.error}</span>}
      </div>
    </section>
  );
}
