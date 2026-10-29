'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import {
  addImpactNoteAction,
  answerGapQuestionAction,
  confirmMaterialityAction,
  createUpdateAction,
  deleteImpactDocumentAction,
  runFinalAction,
  runMaterialityAction,
  runSufficiencyAction,
  runUpdateAnalysisAction,
  updateImpactCompanyAction,
  type ImpactActionState
} from '@/lib/actions/impact';
import type {
  ImpactAssessment,
  ImpactCompany,
  ImpactDocument,
  ImpactGapQuestion,
  ImpactJob,
  ImpactNote,
  ImpactOverride,
  ImpactUpdateEvent
} from '@/lib/impact/data';
import {
  IMPACT_CATEGORY_LABELS,
  IMPACT_GAP_SEVERITY_LABELS,
  IMPACT_GAP_STATUS_LABELS,
  IMPACT_JOB_TYPE_LABELS,
  IMPACT_MATERIALITY_LABELS,
  IMPACT_MATERIALITY_STATUSES,
  IMPACT_UPLOAD_STAGES,
  IMPACT_UPLOAD_STAGE_LABELS,
  impactNextStep,
  type ImpactMaterialityStatus,
  type ImpactUploadStage
} from '@platform/shared';
import { AssessmentStatusChip, Chip, GradeChip } from '@/components/impact/chips';
import { DashboardView } from '@/components/impact/DashboardView';

const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover disabled:opacity-60';
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle disabled:opacity-60';
const btnDanger =
  'inline-flex items-center gap-1.5 rounded-full border border-movexum-orange/40 bg-movexum-pastell-orange px-3 py-1.5 text-xs font-medium text-movexum-morkorange transition hover:bg-movexum-pastell-orange/70 disabled:opacity-60 dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange';

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
}

function Card({ id, title, description, action, children }: { id: string; title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-1 text-sm text-foreground-muted">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Notice({ state }: { state: ImpactActionState | null }) {
  if (!state) return null;
  if (state.error) return <p className="rounded-xl border border-movexum-orange/40 bg-movexum-pastell-orange px-3 py-2 text-sm text-movexum-morkorange">{state.error}</p>;
  if (state.warning) return <p className="rounded-xl border border-movexum-gul/40 bg-movexum-pastell-gul px-3 py-2 text-sm text-movexum-morkgul">{state.warning}</p>;
  return null;
}

interface Props {
  company: ImpactCompany;
  assessments: ImpactAssessment[];
  gaps: ImpactGapQuestion[];
  overrides: ImpactOverride[];
  updateEvents: ImpactUpdateEvent[];
  documents: ImpactDocument[];
  jobs: ImpactJob[];
  notes: ImpactNote[];
  staff: Array<{ id: string; name: string }>;
  canManage: boolean;
}

/**
 * Arbetsytan (§ 56). All behörighet prövas i server-actionerna; flaggorna
 * här styr bara vad som visas. Människa-i-loopen: varje AI-steg startas med
 * ett klick, väsentligheten bekräftas av en människa innan underlaget prövas,
 * och slutanalysen startas uttryckligen.
 */
export function ImpactWorkspace({ company, assessments, gaps, overrides, updateEvents, documents, jobs, notes, staff, canManage }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<ImpactActionState | null>(null);
  const latest = assessments[0] ?? null;
  const [viewId, setViewId] = useState<string>(latest?.id ?? '');
  const viewed = assessments.find((a) => a.id === viewId) ?? latest;

  const latestGaps = useMemo(() => (latest ? gaps.filter((g) => g.assessment === latest.id) : []), [gaps, latest]);
  const openRequired = latestGaps.filter((g) => g.status === 'open' && g.severity === 'required').length;
  const step = latest ? impactNextStep(latest.status, openRequired) : null;

  function run(label: string, fn: () => Promise<ImpactActionState>) {
    setBusy(label);
    setNotice(null);
    start(async () => {
      try {
        const res = await fn();
        setNotice(res);
        if (res.ok) router.refresh();
      } catch {
        setNotice({ error: 'Något gick fel. Försök igen.' });
      } finally {
        setBusy(null);
      }
    });
  }

  const working = pending || busy !== null;

  return (
    <div className="space-y-6">
      {/* Nästa steg */}
      {latest ? (
        <Card
          id="steg"
          title={`Analys version ${latest.version} — ${latest.type === 'update' ? 'uppdatering' : 'ursprunglig'}`}
          description="Stegen körs ett i taget av en människa: väsentlighet → granskning → prövning av underlaget → (kompletteringar) → slutanalys."
          action={<AssessmentStatusChip status={latest.status} />}
        >
          <Stepper status={latest.status} isUpdate={latest.type === 'update'} />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canManage && latest.type === 'update' && latest.status !== 'complete' ? (
              <button className={btnPrimary} disabled={working} onClick={() => run('update', () => runUpdateAnalysisAction(company.id, latest.id))}>
                {busy === 'update' ? 'Analyserar …' : 'Kör uppdateringsanalysen'}
              </button>
            ) : null}
            {canManage && latest.type !== 'update' && (step === 'run_materiality' || (step === 'retry' && !latest.materiality)) ? (
              <button className={btnPrimary} disabled={working || documents.filter((d) => d.hasText).length === 0} onClick={() => run('materiality', () => runMaterialityAction(company.id, latest.id))}>
                {busy === 'materiality' ? 'Analyserar …' : 'Kör väsentlighetsanalysen'}
              </button>
            ) : null}
            {canManage && latest.type !== 'update' && step === 'review_materiality' ? (
              <a href="#vasentlighet" className={btnPrimary}>Granska väsentligheten</a>
            ) : null}
            {canManage && latest.type !== 'update' && (step === 'run_sufficiency' || (step === 'retry' && latest.materiality && !latest.dashboard)) ? (
              <button className={btnPrimary} disabled={working} onClick={() => run('sufficiency', () => runSufficiencyAction(company.id, latest.id))}>
                {busy === 'sufficiency' ? 'Prövar underlaget …' : latest.status === 'needs_more_info' ? 'Pröva underlaget igen' : 'Pröva underlaget'}
              </button>
            ) : null}
            {canManage && latest.type !== 'update' && step === 'answer_gaps' ? (
              <>
                <a href="#kompletteringar" className={btnPrimary}>Svara på kompletteringar ({openRequired} krävs)</a>
                <button className={btnGhost} disabled={working} onClick={() => run('sufficiency', () => runSufficiencyAction(company.id, latest.id))}>Pröva underlaget igen</button>
              </>
            ) : null}
            {canManage && latest.type !== 'update' && (step === 'run_final' || (latest.status === 'needs_more_info' && openRequired === 0)) ? (
              <button className={btnPrimary} disabled={working} onClick={() => run('final', () => runFinalAction(company.id, latest.id))}>
                {busy === 'final' ? 'Skriver slutanalysen …' : 'Kör slutanalysen'}
              </button>
            ) : null}
            {canManage && step === 'done' && latest.type !== 'update' ? (
              <button className={btnGhost} disabled={working} onClick={() => run('final', () => runFinalAction(company.id, latest.id))}>Kör om slutanalysen</button>
            ) : null}
            {latest.type !== 'update' && step === 'run_materiality' && documents.filter((d) => d.hasText).length === 0 ? (
              <span className="text-sm text-foreground-muted">Ladda upp minst ett dokument med text (idébeskrivning) innan analysen startas.</span>
            ) : null}
          </div>
          <div className="mt-3"><Notice state={notice} /></div>
          {working ? <p className="mt-2 text-xs text-foreground-subtle">AI-steget körs — det kan ta upp till någon minut. Lämna inte sidan.</p> : null}
        </Card>
      ) : (
        <Card id="steg" title="Ingen analys ännu">
          <p className="text-sm text-foreground-muted">Starta en analys via <a className="text-link underline" href={`/impactnavigator/ny?startup=${company.id}`}>Ny analys</a>.</p>
        </Card>
      )}

      {/* Underlag */}
      <Card id="underlag" title="Underlag" description="Bolagets resa och uppladdade dokument är det analysen utgår från. Skriv inte personuppgifter.">
        <JourneyEditor company={company} canManage={canManage} staff={staff} onDone={() => router.refresh()} />
        <DocumentsPanel company={company} assessment={latest} documents={documents} canManage={canManage} onChanged={() => router.refresh()} />
      </Card>

      {/* Väsentlighet */}
      {viewed?.materiality ? (
        <Card
          id="vasentlighet"
          title="Väsentliga hållbarhetsaspekter"
          description={viewed.status === 'materiality_review' ? 'AI:ns förslag — justera status per aspekt och bekräfta. Det du bekräftar styr resten av analysen.' : 'Bekräftad väsentlighet för den visade versionen.'}
        >
          <MaterialityPanel
            assessment={viewed}
            overrides={overrides.filter((o) => o.assessment === viewed.id)}
            editable={canManage && viewed.id === latest?.id && viewed.status === 'materiality_review'}
            busy={working}
            onConfirm={(ov) => run('confirm', () => confirmMaterialityAction(company.id, viewed.id, ov))}
          />
        </Card>
      ) : null}

      {/* Kompletteringar */}
      {viewed && (gaps.some((g) => g.assessment === viewed.id) || viewed.sufficiency) ? (
        <Card id="kompletteringar" title="Underlagets tillräcklighet" description="AI:n prövar om underlaget räcker och ställer frågor till bolaget. Svaren matas in i slutanalysen.">
          {viewed.sufficiency ? (
            <div className="mb-4 rounded-2xl border border-default bg-canvas-subtle p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Chip tone={viewed.sufficiency.readyForFinalAnalysis ? 'green' : 'yellow'}>{viewed.sufficiency.readyForFinalAnalysis ? 'Redo för slutanalys' : 'Behöver komplettering'}</Chip>
                <Chip tone="neutral">Underlagskvalitet {viewed.sufficiency.overallInformationQuality} %</Chip>
              </div>
              <p className="text-sm text-foreground">{viewed.sufficiency.userMessage}</p>
              {viewed.sufficiency.generalMissingInformation.length ? <ul className="mt-2 list-disc pl-5 text-sm text-foreground-muted">{viewed.sufficiency.generalMissingInformation.map((m, i) => <li key={i}>{m}</li>)}</ul> : null}
            </div>
          ) : null}
          <GapPanel gaps={gaps.filter((g) => g.assessment === viewed.id)} canManage={canManage && viewed.id === latest?.id} busy={working} onAnswer={(id, input) => run(`gap-${id}`, () => answerGapQuestionAction(company.id, id, input))} />
        </Card>
      ) : null}

      {/* Slutanalys */}
      {viewed?.dashboard ? (
        <Card
          id="slutanalys"
          title={`Slutanalys — version ${viewed.version}`}
          description={`${viewed.completedAt ? `Klar ${fmtDate(viewed.completedAt)}. ` : ''}Modell: ${viewed.modelName || 'okänd'}. Genererat av AI – verifiera innan delning.`}
        >
          <DashboardView dashboard={viewed.dashboard} delta={viewed.updateDelta} />
        </Card>
      ) : null}

      {/* Uppdatering */}
      {canManage && assessments.some((a) => a.status === 'complete' && a.dashboard) ? (
        <Card id="uppdatering" title="Uppdatering" description="Beskriv vad som hänt sedan senaste analysen (och ladda upp nya dokument under Underlag med steget Uppdatering). En ny version skapas och slutanalysen uppdateras.">
          <UpdateForm busy={working} disabled={latest ? latest.status !== 'complete' : true} onSubmit={(narrative) => run('newupdate', async () => {
            const res = await createUpdateAction(company.id, { narrative });
            if (res.error || !res.assessmentId) return res;
            return runUpdateAnalysisAction(company.id, res.assessmentId);
          })} />
          {updateEvents.length ? (
            <ul className="mt-4 space-y-2">
              {updateEvents.map((e) => (
                <li key={e.id} className="rounded-xl border border-default bg-canvas-subtle p-3 text-sm">
                  <div className="mb-1 text-xs text-foreground-subtle">{fmtDate(e.createdAt)}{e.createdByName ? ` · ${e.createdByName}` : ''}</div>
                  <p className="whitespace-pre-wrap text-foreground">{e.narrative || <span className="text-foreground-subtle">(utan beskrivning)</span>}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {/* Historik */}
      {assessments.length > 0 ? (
        <Card id="historik" title="Versioner" description="Varje analys sparas som en egen version. Välj en version för att visa den ovan.">
          <ul className="divide-y divide-default">
            {assessments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <button className={`text-left font-medium ${a.id === viewed?.id ? 'text-link' : 'text-foreground hover:text-link'}`} onClick={() => setViewId(a.id)}>
                  Version {a.version} · {a.type === 'update' ? 'uppdatering' : 'ursprunglig'}
                </button>
                <span className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                  <AssessmentStatusChip status={a.status} />
                  {a.informationQualityScore != null ? <span className="mx-tnum">{a.informationQualityScore} %</span> : null}
                  <span>{fmtDate(a.completedAt ?? a.createdAt)}</span>
                  {a.createdByName ? <span>· {a.createdByName}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Anteckningar */}
      <Card id="anteckningar" title="Anteckningar" description="Delas med bolagskortet (ej konfidentiella). Skriv inte personuppgifter.">
        {canManage ? <NoteForm busy={working} onSubmit={(body) => run('note', () => addImpactNoteAction(company.id, { body }))} /> : null}
        <ul className="mt-3 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-xl border border-default bg-canvas-subtle p-3 text-sm">
              <div className="mb-1 text-xs text-foreground-subtle">{fmtDate(n.createdAt)}{n.authorName ? ` · ${n.authorName}` : ''}{n.confidential ? ' · konfidentiell' : ''}</div>
              <p className="whitespace-pre-wrap text-foreground">{n.body}</p>
            </li>
          ))}
          {notes.length === 0 ? <li className="text-sm text-foreground-subtle">Inga anteckningar ännu.</li> : null}
        </ul>
      </Card>

      {/* AI-körningar */}
      {jobs.length ? (
        <details className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">AI-körningar ({jobs.length})</summary>
          <ul className="mt-3 divide-y divide-default text-sm">
            {jobs.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-foreground">{IMPACT_JOB_TYPE_LABELS[j.jobType]}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                  <Chip tone={j.status === 'complete' ? 'green' : j.status === 'failed' ? 'orange' : 'neutral'}>{j.status}</Chip>
                  <span>{j.modelName || '–'}</span>
                  <span>{fmtDate(j.completedAt ?? j.createdAt)}</span>
                  {j.error ? <span className="text-movexum-morkorange">{j.error}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Stepper({ status, isUpdate }: { status: ImpactAssessment['status']; isUpdate: boolean }) {
  const steps = isUpdate
    ? [{ key: 'update', label: 'Uppdateringsanalys' }, { key: 'complete', label: 'Klar' }]
    : [
        { key: 'materiality', label: 'Väsentlighet' },
        { key: 'review', label: 'Granskning' },
        { key: 'sufficiency', label: 'Underlag' },
        { key: 'final', label: 'Slutanalys' },
        { key: 'complete', label: 'Klar' }
      ];
  const reached: Record<string, number> = isUpdate
    ? { final_pending: 0, failed: 0, complete: 1 }
    : { materiality_pending: 0, failed: 0, materiality_review: 1, info_pending: 2, needs_more_info: 2, final_pending: 3, complete: 4 };
  const current = reached[status] ?? 0;
  return (
    <ol className="flex flex-wrap gap-2">
      {steps.map((s, i) => {
        const done = i < current || status === 'complete';
        const active = i === current && status !== 'complete';
        return (
          <li key={s.key} className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${done ? 'border-movexum-gron/40 bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron' : active ? 'border-brand bg-brand text-brand-foreground' : 'border-default text-foreground-subtle'}`}>
            <span className="mx-tnum">{i + 1}</span> {s.label}
          </li>
        );
      })}
    </ol>
  );
}

function JourneyEditor({ company, canManage, staff, onDone }: { company: ImpactCompany; canManage: boolean; staff: Array<{ id: string; name: string }>; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(company.journeyText);
  const [assigned, setAssigned] = useState(company.assignedTo ?? '');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (!editing) {
    return (
      <div className="mb-5 rounded-2xl border border-default bg-canvas-subtle p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Bolagets resa</h3>
          {canManage ? <button className={btnGhost} onClick={() => setEditing(true)}>Ändra</button> : null}
        </div>
        <p className="whitespace-pre-wrap text-sm text-foreground-muted">{company.journeyText || 'Ingen beskrivning ännu.'}</p>
      </div>
    );
  }
  return (
    <form
      className="mb-5 space-y-3 rounded-2xl border border-default bg-canvas-subtle p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const res = await updateImpactCompanyAction(company.id, { journeyText: text, assignedTo: assigned });
          if (res.error) setErr(res.error);
          else {
            setEditing(false);
            onDone();
          }
        });
      }}
    >
      <textarea className={inputClass} rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} />
      <div>
        <label className="mb-1 block text-xs font-semibold text-foreground-muted">Ansvarig</label>
        <select className={inputClass} value={assigned} onChange={(e) => setAssigned(e.target.value)}>
          <option value="">Ingen</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {err ? <p className="text-sm text-movexum-morkorange">{err}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={pending}>Spara</button>
        <button type="button" className={btnGhost} onClick={() => setEditing(false)}>Avbryt</button>
      </div>
    </form>
  );
}

function DocumentsPanel({ company, assessment, documents, canManage, onChanged }: { company: ImpactCompany; assessment: ImpactAssessment | null; documents: ImpactDocument[]; canManage: boolean; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<ImpactUploadStage>(documents.length === 0 ? 'idea_description' : 'full_information');
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setMsg(null);
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('startup_id', company.id);
      if (assessment) fd.append('assessment_id', assessment.id);
      fd.append('stage', stage);
      try {
        const res = await fetch('/api/impactnavigator/documents', { method: 'POST', body: fd });
        const json = (await res.json().catch(() => ({}))) as { error?: string; warning?: string; hasText?: boolean };
        if (!res.ok) problems.push(`${file.name}: ${json.error ?? `HTTP ${res.status}`}`);
        else if (json.warning) problems.push(`${file.name}: ${json.warning}`);
        else if (json.hasText === false) problems.push(`${file.name}: ingen text kunde läsas ut — dokumentet matar inte analysen.`);
      } catch {
        problems.push(`${file.name}: uppladdningen misslyckades.`);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    setMsg(problems.length ? problems.join(' ') : null);
    onChanged();
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Dokument ({documents.length})</h3>
      </div>
      {canManage ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select className="rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground" value={stage} onChange={(e) => setStage(e.target.value as ImpactUploadStage)}>
            {IMPACT_UPLOAD_STAGES.map((s) => <option key={s} value={s}>{IMPACT_UPLOAD_STAGE_LABELS[s]}</option>)}
          </select>
          <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv" className="text-sm text-foreground-muted" onChange={(e) => upload(e.target.files)} disabled={uploading} />
          {uploading ? <span className="text-xs text-foreground-subtle">Laddar upp och läser ut text …</span> : null}
        </div>
      ) : null}
      {msg ? <p className="mb-3 rounded-xl border border-movexum-gul/40 bg-movexum-pastell-gul px-3 py-2 text-sm text-movexum-morkgul">{msg}</p> : null}
      <ul className="divide-y divide-default">
        {documents.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0">
              {d.file ? <a className="font-medium text-foreground hover:text-link" href={`/api/impactnavigator/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer">{d.name}</a> : <span className="font-medium text-foreground">{d.name}</span>}
              <span className="ml-2 text-xs text-foreground-subtle">{IMPACT_UPLOAD_STAGE_LABELS[d.stage]} · {fmtDate(d.createdAt)}{d.uploadedByName ? ` · ${d.uploadedByName}` : ''}</span>
            </span>
            <span className="flex items-center gap-2 text-xs">
              {!d.hasText ? <Chip tone="yellow">Ingen text</Chip> : <Chip tone="neutral">{Math.round(d.charCount / 1000)} k tecken</Chip>}
              {!d.file ? <Chip tone="neutral">Importerad (fil saknas)</Chip> : null}
              {canManage ? (
                <button className={btnDanger} disabled={pending} onClick={() => { if (window.confirm(`Ta bort "${d.name}"?`)) start(async () => { const r = await deleteImpactDocumentAction(company.id, d.id); if (r.error) setMsg(r.error); else onChanged(); }); }}>
                  Ta bort
                </button>
              ) : null}
            </span>
          </li>
        ))}
        {documents.length === 0 ? <li className="py-2 text-sm text-foreground-subtle">Inga dokument ännu. Börja med idébeskrivningen.</li> : null}
      </ul>
    </div>
  );
}

function MaterialityPanel({ assessment, overrides, editable, busy, onConfirm }: { assessment: ImpactAssessment; overrides: ImpactOverride[]; editable: boolean; busy: boolean; onConfirm: (ov: Array<{ aspectCode: string; newStatus: ImpactMaterialityStatus; comment: string }>) => void }) {
  const m = assessment.materiality!;
  const [choices, setChoices] = useState<Record<string, { status: ImpactMaterialityStatus; comment: string }>>({});
  const all = [
    ...m.selectedAspects.map((a) => ({ ...a, current: a.status as ImpactMaterialityStatus })),
    ...m.consideredButNotMaterial.map((a) => ({ code: a.code, name: a.name, category: a.category, rationale: a.rationale, startupSpecificReason: '', futureDevelopmentRelevance: '', materialityStrength: null, confidence: null, materialityDrivers: [], underlyingAspects: [], uncertaintyNotes: [], evidence: [], status: 'NOT_MATERIAL' as const, current: 'NOT_MATERIAL' as ImpactMaterialityStatus }))
  ];
  return (
    <div className="space-y-4">
      {m.companySummary ? <p className="text-sm text-foreground">{m.companySummary}</p> : null}
      {m.sustainabilityPerspectiveSummary ? <p className="text-sm text-foreground-muted">{m.sustainabilityPerspectiveSummary}</p> : null}
      {m.warnings.length ? <ul className="list-disc rounded-xl border border-movexum-gul/40 bg-movexum-pastell-gul/50 p-3 pl-7 text-xs text-movexum-morkgul dark:bg-movexum-morkgul/20">{m.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
      <div className="space-y-3">
        {all.map((a) => {
          const choice = choices[a.code]?.status ?? a.current;
          return (
            <article key={a.code} className={`rounded-xl border p-4 ${choice === 'NOT_MATERIAL' ? 'border-default bg-canvas-subtle opacity-80' : 'border-default bg-surface'}`}>
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-xs text-foreground-subtle mx-tnum">{a.code}</span>
                <h4 className="text-sm font-semibold text-foreground">{a.name}</h4>
                <Chip tone="neutral">{IMPACT_CATEGORY_LABELS[a.category]}</Chip>
                {a.materialityStrength ? <GradeChip grade={a.materialityStrength} positive /> : null}
                {!editable ? <Chip tone={choice === 'MATERIAL' ? 'green' : choice === 'UNCERTAIN' ? 'yellow' : 'neutral'}>{IMPACT_MATERIALITY_LABELS[choice]}</Chip> : null}
              </div>
              <p className="text-sm text-foreground-muted">{a.rationale}</p>
              {a.startupSpecificReason ? <p className="mt-1 text-sm text-foreground-muted"><span className="font-semibold text-foreground">För just detta bolag: </span>{a.startupSpecificReason}</p> : null}
              {a.futureDevelopmentRelevance ? <p className="mt-1 text-sm text-foreground-muted"><span className="font-semibold text-foreground">Framåt: </span>{a.futureDevelopmentRelevance}</p> : null}
              {a.evidence.length ? (
                <details className="mt-2 text-xs text-foreground-subtle">
                  <summary className="cursor-pointer">Underlag ({a.evidence.length})</summary>
                  <ul className="mt-1 space-y-1 pl-4">{a.evidence.map((e, i) => <li key={i}>{e.note}{e.excerpt ? <> — <em>”{e.excerpt}”</em></> : null}{e.documentName ? <span className="text-foreground-subtle"> ({e.documentName})</span> : null}</li>)}</ul>
                </details>
              ) : null}
              {editable ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select className="rounded-xl border border-default bg-surface px-3 py-1.5 text-sm text-foreground" value={choice} onChange={(e) => setChoices((c) => ({ ...c, [a.code]: { status: e.target.value as ImpactMaterialityStatus, comment: c[a.code]?.comment ?? '' } }))}>
                    {IMPACT_MATERIALITY_STATUSES.map((s) => <option key={s} value={s}>{IMPACT_MATERIALITY_LABELS[s]}</option>)}
                  </select>
                  {choice !== a.current ? (
                    <input className="min-w-[16rem] flex-1 rounded-xl border border-default bg-surface px-3 py-1.5 text-sm text-foreground" placeholder="Motivering (valfri)" value={choices[a.code]?.comment ?? ''} onChange={(e) => setChoices((c) => ({ ...c, [a.code]: { status: choice, comment: e.target.value } }))} maxLength={5000} />
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {overrides.length ? (
        <div className="rounded-xl border border-default bg-canvas-subtle p-3 text-xs text-foreground-muted">
          <span className="font-semibold text-foreground">Personalens justeringar: </span>
          {overrides.map((o) => `${o.aspectCode} ${o.originalStatus} → ${o.newStatus}${o.comment ? ` (${o.comment})` : ''}${o.createdByName ? ` · ${o.createdByName}` : ''}`).join('; ')}
        </div>
      ) : null}
      {editable ? (
        <div className="flex justify-end">
          <button className={btnPrimary} disabled={busy} onClick={() => onConfirm(Object.entries(choices).map(([aspectCode, c]) => ({ aspectCode, newStatus: c.status, comment: c.comment })))}>
            Bekräfta väsentligheten och gå vidare
          </button>
        </div>
      ) : null}
    </div>
  );
}

function GapPanel({ gaps, canManage, busy, onAnswer }: { gaps: ImpactGapQuestion[]; canManage: boolean; busy: boolean; onAnswer: (id: string, input: Record<string, unknown>) => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (gaps.length === 0) return <p className="text-sm text-foreground-subtle">Inga kompletteringsfrågor.</p>;
  return (
    <ul className="space-y-3">
      {gaps.map((g) => (
        <li key={g.id} className="rounded-xl border border-default bg-surface p-4">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-xs text-foreground-subtle mx-tnum">{g.aspectCode}</span>
            <Chip tone={g.severity === 'required' ? 'orange' : 'yellow'}>{IMPACT_GAP_SEVERITY_LABELS[g.severity]}</Chip>
            <Chip tone={g.status === 'answered' ? 'green' : g.status === 'not_available' ? 'neutral' : 'blue'}>{IMPACT_GAP_STATUS_LABELS[g.status]}</Chip>
          </div>
          <p className="text-sm font-medium text-foreground">{g.question}</p>
          {g.missingInformation ? <p className="mt-1 text-xs text-foreground-muted">{g.missingInformation}</p> : null}
          {g.answerText ? <p className="mt-2 whitespace-pre-wrap rounded-lg bg-canvas-subtle p-2 text-sm text-foreground">{g.answerText}</p> : null}
          {canManage && g.status === 'open' ? (
            <div className="mt-2 space-y-2">
              <textarea className={inputClass} rows={3} placeholder="Bolagets svar …" value={drafts[g.id] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [g.id]: e.target.value }))} maxLength={10000} />
              <div className="flex flex-wrap gap-2">
                <button className={btnPrimary} disabled={busy || !(drafts[g.id] ?? '').trim()} onClick={() => onAnswer(g.id, { answer: drafts[g.id] ?? '' })}>Spara svar</button>
                <button className={btnGhost} disabled={busy} onClick={() => onAnswer(g.id, { notAvailable: true, answer: drafts[g.id] ?? '' })}>Uppgiften finns inte</button>
              </div>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function UpdateForm({ busy, disabled, onSubmit }: { busy: boolean; disabled: boolean; onSubmit: (narrative: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!text.trim()) return;
        onSubmit(text);
        setText('');
      }}
      className="space-y-2"
    >
      <textarea className={inputClass} rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} placeholder="Vad har hänt sedan senaste analysen? Pilot, nya kunder, policy, mätningar …" disabled={disabled} />
      {disabled ? <p className="text-xs text-foreground-subtle">En uppdatering kan skapas när den senaste versionen är klar.</p> : null}
      <div className="flex justify-end">
        <button type="submit" className={btnPrimary} disabled={busy || disabled || !text.trim()}>Skapa uppdatering och analysera</button>
      </div>
    </form>
  );
}

function NoteForm({ busy, onSubmit }: { busy: boolean; onSubmit: (body: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (!text.trim()) return;
        onSubmit(text);
        setText('');
      }}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <textarea className={inputClass} rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={20000} placeholder="Ny anteckning …" />
      <button type="submit" className={btnPrimary} disabled={busy || !text.trim()}>Spara</button>
    </form>
  );
}
