'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { createImpactCompanyAction, runMaterialityAction } from '@/lib/actions/impact';
import { impactHref } from '@/lib/impact/tabs';
import { phaseLabels } from '@/lib/labels';
import { AiSubmitButton } from '@/components/impact/AiSubmitButton';
import { FileDropInput, uploadImpactDocument } from '@/components/impact/FileDropInput';
import { Icon } from '@/components/proto/Icon';
import { card, hintClass, inputClass, labelClass, noticeError, noticeWarn } from '@/components/impact/ui';
import { ALL_PHASES } from '@platform/shared';

interface StartupOption {
  id: string;
  name: string;
  phase: string;
  industry: string;
  hasAnalysis: boolean;
  journeyText: string;
}

/**
 * Steg 1 av 4 (originalets formulär på /companies/new). Flödet är detsamma
 * som originalets `createCompanyAction`, men i tre anrop eftersom filer går via
 * route-handlern (§ 18.2) och inte via server actions:
 *   1. `createImpactCompanyAction` → bolag + analysversion 1
 *   2. `uploadImpactDocument` per fil (idébeskrivning + övrigt underlag)
 *   3. `runMaterialityAction` → väsentlighetsanalysen (Mistral, EU)
 * Faller en uppladdning eller analysen visas felet med länk till bolagets sida,
 * där underlaget kan kompletteras och analysen köras igen.
 */
export function NewImpactCompanyForm({ startups, preselectedStartup }: { startups: StartupOption[]; preselectedStartup: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<'new' | 'existing'>(preselectedStartup ? 'existing' : 'new');
  const [startupId, setStartupId] = useState(preselectedStartup);
  const [journey, setJourney] = useState(startups.find((s) => s.id === preselectedStartup)?.journeyText ?? '');
  const [ideaFiles, setIdeaFiles] = useState<File[]>([]);
  const [supportingFiles, setSupportingFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const selected = startups.find((s) => s.id === startupId);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const input: Record<string, unknown> = { journeyText: journey };
    if (mode === 'existing') {
      if (!startupId) {
        setError('Välj ett bolag.');
        return;
      }
      input.startupId = startupId;
    } else {
      input.name = String(fd.get('name') ?? '');
      input.phase = String(fd.get('phase') ?? '');
      input.industry = String(fd.get('industry') ?? '');
    }
    if (ideaFiles.length === 0) {
      setError('Fyll i obligatoriska fält och välj en idébeskrivning.');
      return;
    }

    start(async () => {
      const created = await createImpactCompanyAction(input);
      if (created.error || !created.id || !created.assessmentId) {
        setError(created.error ?? 'Kunde inte skapa bolaget.');
        return;
      }
      setCreatedId(created.id);
      try {
        for (const file of ideaFiles) {
          await uploadImpactDocument(file, { startupId: created.id, assessmentId: created.assessmentId, stage: 'idea_description' });
        }
        for (const file of supportingFiles) {
          await uploadImpactDocument(file, { startupId: created.id, assessmentId: created.assessmentId, stage: 'full_information' });
        }
      } catch (err) {
        setError(`Bolaget skapades, men en fil kunde inte laddas upp: ${err instanceof Error ? err.message : 'okänt fel'}. Ladda upp underlaget på bolagets sida och starta analysen där.`);
        return;
      }
      const run = await runMaterialityAction(created.id, created.assessmentId);
      if (run.error) {
        setError(`${run.error} Bolaget och underlaget är sparade — du kan köra analysen igen på bolagets sida.`);
        return;
      }
      router.push(run.next ?? impactHref(created.id, 'vasentlighet'));
    });
  }

  return (
    <div id="company-form" className="scroll-mt-6">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground">1</span>
          <p className="text-sm font-medium uppercase tracking-wide text-brand">Steg 1 av 4</p>
        </div>
        <h2 id="company-form-heading" tabIndex={-1} className="mt-3 font-heading text-3xl font-semibold tracking-tight text-foreground outline-none">
          Berätta om bolaget
        </h2>
        <p className="mt-2 max-w-3xl leading-7 text-foreground-muted">
          Dela det underlag som finns redan nu. Verktyget använder informationen för att skapa en första bolagsbild och identifiera relevanta hållbarhetsområden.
        </p>
      </div>

      <form onSubmit={submit} className={`grid max-w-4xl gap-6 ${card}`}>
        {error ? (
          <p role="alert" className={noticeError}>
            {error}
            {createdId ? (
              <>
                {' '}
                <Link href={impactHref(createdId, 'vasentlighet')} className="underline">
                  Öppna bolagets sida
                </Link>
              </>
            ) : null}
          </p>
        ) : null}

        <section aria-labelledby="company-basics-title">
          <SectionHeading id="company-basics-title" icon="briefcase" title="Grunduppgifter" text="Hjälper verktyget att sätta bolaget i rätt sammanhang." />
          <div className="mb-4 flex gap-2">
            <ModeButton active={mode === 'new'} onClick={() => setMode('new')}>
              Nytt bolag
            </ModeButton>
            <ModeButton active={mode === 'existing'} onClick={() => setMode('existing')}>
              Befintligt bolagskort
            </ModeButton>
          </div>
          {mode === 'existing' ? (
            <div>
              <label className={labelClass} htmlFor="startup">
                Bolag
              </label>
              <select
                id="startup"
                className={inputClass}
                value={startupId}
                onChange={(e) => {
                  setStartupId(e.target.value);
                  const s = startups.find((x) => x.id === e.target.value);
                  if (s?.journeyText && !journey) setJourney(s.journeyText);
                }}
              >
                <option value="">Välj bolag …</option>
                {startups.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.hasAnalysis ? ' (har analys — ny version)' : ''}
                  </option>
                ))}
              </select>
              {selected ? (
                <p className={`mt-1 ${hintClass}`}>
                  {phaseLabels[selected.phase as keyof typeof phaseLabels] ?? selected.phase}
                  {selected.industry ? ` · ${selected.industry}` : ''} — namn, fas och bransch följer bolagskortet (ändras under Bolagsuppgifter).
                  {selected.hasAnalysis ? ' Bolaget har redan en analys; en ny initial version skapas.' : ''}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              <label className={`${labelClass} md:col-span-2`}>
                Bolagsnamn
                <input name="name" className={`${inputClass} mt-1.5`} required maxLength={120} />
              </label>
              <label className={labelClass}>
                Movexumfas
                <select name="phase" className={`${inputClass} mt-1.5`} defaultValue="lead">
                  {ALL_PHASES.map((p) => (
                    <option key={p} value={p}>
                      {phaseLabels[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Bransch
                <input name="industry" className={`${inputClass} mt-1.5`} required maxLength={160} />
              </label>
            </div>
          )}
        </section>

        <section aria-labelledby="company-files-title">
          <SectionHeading
            id="company-files-title"
            icon="file-text"
            title="Befintligt underlag"
            text="Ladda upp det ni har – verktyget markerar vad som fortfarande är osäkert. Filformat: PDF, DOCX, PPTX, XLSX, CSV eller TXT. Max 25 MB per fil."
          />
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">Ifylld idébeskrivning</p>
            <span className="text-xs text-foreground-subtle">Obligatorisk</span>
          </div>
          <FileDropInput title="Ifylld idébeskrivning" description="Dra filen till ytan eller välj den från datorn." required disabled={pending} onFilesChange={setIdeaFiles} />
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">Övrigt befintligt underlag</p>
              <span className="text-xs text-foreground-subtle">Valfritt</span>
            </div>
            <FileDropInput
              title="Övrigt befintligt underlag"
              description="Pitchdeck, affärsplan, marknadsanalys, teknisk beskrivning, kundunderlag eller andra dokument som redan finns."
              multiple
              disabled={pending}
              onFilesChange={setSupportingFiles}
            />
          </div>
          <p className={`mt-3 ${noticeWarn}`}>Ladda inte upp dokument med personuppgifter — texten läses ut och går till AI-analysen (Mistral, EU).</p>
        </section>

        <section aria-labelledby="company-ambitions-title">
          <SectionHeading id="company-ambitions-title" icon="spark" title="Det ni redan ser" text="Tidiga tankar och osäkerheter är lika välkomna som fattade beslut." />
          <label className={labelClass}>
            Vad kan du berätta om bolagets hållbarhetsambitioner, viktiga vägval eller arbete med miljömässiga, sociala eller styrningsfrågor?
            <span className="mt-2 block rounded-lg bg-canvas-subtle p-3 text-sm font-normal leading-6 text-foreground-muted">
              Skriv fritt även om arbetet är tidigt eller osäkert. Nämn gärna nuläge, prioriteringar, affärsmodell, kundgrupp, teknik, geografi, produktion, leverantörer, data, team och frågor ni redan ser som viktiga.
            </span>
            <textarea name="journeyText" rows={8} value={journey} onChange={(e) => setJourney(e.target.value)} maxLength={20000} className={`${inputClass} mt-3`} required />
          </label>
        </section>

        <AiSubmitButton
          idleLabel="Skapa bolag och sammanfattning"
          pendingLabel="Skapar bedömning..."
          pendingTitle="Väsentlighetsbedömning tas fram"
          pendingDescription="Idébeskrivningen, övrigt underlag, branschen och bolagets hållbarhetsambitioner vägs samman för att identifiera de mest relevanta områdena."
          pendingSteps={['Kartlägger relevanta hållbarhetsfrågor', 'Värderar påverkan, risker och möjligheter', 'Prioriterar vad som är mest väsentligt']}
          fallbackHref={createdId ? impactHref(createdId, 'vasentlighet') : undefined}
          pending={pending}
          className="w-fit"
        />
      </form>
    </div>
  );
}

function SectionHeading({ id, icon, title, text }: { id: string; icon: string; title: string; text: string }) {
  return (
    <div className="mb-4 flex items-center gap-3 border-b border-default pb-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-movexum-pastell-bla text-brand dark:bg-canvas-muted">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <h3 id={id} className="font-heading font-semibold text-foreground">
          {title}
        </h3>
        <p className="text-sm text-foreground-muted">{text}</p>
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-brand text-brand-foreground' : 'border border-default text-foreground-muted hover:bg-canvas-subtle'}`}>
      {children}
    </button>
  );
}
