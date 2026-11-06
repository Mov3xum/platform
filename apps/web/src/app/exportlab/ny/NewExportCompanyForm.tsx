'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { createExportCompanyAction, runExportProfileAction } from '@/lib/actions/export-lab';
import { EXPORT_DOCUMENTS_ENDPOINT, exportHref } from '@/lib/export-lab/tabs';
import { phaseLabels } from '@/lib/labels';
import { AiSubmitButton } from '@/components/impact/AiSubmitButton';
import { FileDropInput, uploadImpactDocument } from '@/components/impact/FileDropInput';
import { Icon } from '@/components/proto/Icon';
import { card, hintClass, inputClass, labelClass, noticeError, noticeInfo, noticeWarn } from '@/components/exportlab/ui';
import { ALL_PHASES } from '@platform/shared';

interface StartupOption {
  id: string;
  name: string;
  phase: string;
  industry: string;
  hasAnalysis: boolean;
  ambitionText: string;
  desiredMarkets: string;
}

/**
 * Steg 1 av 4. Tre anrop (filer går via route-handlern, § 18.2):
 *   1. `createExportCompanyAction` → bolag + analysversion 1
 *   2. `uploadImpactDocument` per fil mot Export Labs endpoint
 *   3. `runExportProfileAction` → exportprofil & marknadsurval (Mistral, EU)
 */
export function NewExportCompanyForm({ startups, preselectedStartup }: { startups: StartupOption[]; preselectedStartup: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<'new' | 'existing'>(preselectedStartup ? 'existing' : 'new');
  const [startupId, setStartupId] = useState(preselectedStartup);
  const pre = startups.find((s) => s.id === preselectedStartup);
  const [ambition, setAmbition] = useState(pre?.ambitionText ?? '');
  const [markets, setMarkets] = useState(pre?.desiredMarkets ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const selected = startups.find((s) => s.id === startupId);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const input: Record<string, unknown> = { ambitionText: ambition, desiredMarkets: markets };
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
    start(async () => {
      const created = await createExportCompanyAction(input);
      if (created.error || !created.id || !created.assessmentId) {
        setError(created.error ?? 'Kunde inte skapa bolaget.');
        return;
      }
      setCreatedId(created.id);
      try {
        for (const file of files) {
          await uploadImpactDocument(file, { startupId: created.id, assessmentId: created.assessmentId, stage: 'full_information', endpoint: EXPORT_DOCUMENTS_ENDPOINT });
        }
      } catch (err) {
        setError(`Bolaget skapades, men en fil kunde inte laddas upp: ${err instanceof Error ? err.message : 'okänt fel'}. Ladda upp underlaget på bolagets sida och starta analysen där.`);
        return;
      }
      const run = await runExportProfileAction(created.id, created.assessmentId);
      if (run.error) {
        setError(`${run.error} Bolaget och underlaget är sparade — du kan köra analysen igen på bolagets sida.`);
        return;
      }
      router.push(run.next ?? exportHref(created.id, 'marknader'));
    });
  }

  return (
    <div id="company-form" className="scroll-mt-6">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-movexum-djupbla text-sm font-semibold text-movexum-vit dark:bg-movexum-bla dark:text-movexum-morkbla">1</span>
          <p className="text-sm font-medium uppercase tracking-wide text-movexum-djupbla dark:text-movexum-bla">Steg 1 av 4</p>
        </div>
        <h2 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-foreground">Berätta om innovationen och ambitionen</h2>
        <p className="mt-2 max-w-3xl leading-7 text-foreground-muted">
          Export Lab väger samman innovationen, bolagets framdrift (KTH IRL från bolagskortet) och det underlag som finns för att föreslå internationaliseringsväg, marknader och vad som behöver vara på plats. Tidiga tankar och osäkerheter är lika välkomna som fattade beslut.
        </p>
      </div>

      <form onSubmit={submit} className={`grid max-w-4xl gap-6 ${card}`}>
        {error ? (
          <p role="alert" className={noticeError}>
            {error}
            {createdId ? (
              <>
                {' '}
                <Link href={exportHref(createdId, 'marknader')} className="underline">
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
                  if (s?.ambitionText && !ambition) setAmbition(s.ambitionText);
                  if (s?.desiredMarkets && !markets) setMarkets(s.desiredMarkets);
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
                  {selected.industry ? ` · ${selected.industry}` : ''} — namn, fas, bransch och IRL följer bolagskortet.
                  {selected.hasAnalysis ? ' Bolaget har redan en analys; en ny initial version skapas.' : ''}
                </p>
              ) : null}
              <p className={`mt-2 ${noticeInfo}`}>Välj ett befintligt bolagskort när det går — då kopplas analysen till bolagets KTH IRL-bedömning, som styr vilket exportsteg som är rimligt.</p>
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

        <section aria-labelledby="company-ambition-title">
          <SectionHeading id="company-ambition-title" icon="compass" title="Innovationen och den internationella ambitionen" text="Det här är underlaget analysen utgår från." />
          <label className={labelClass}>
            Beskriv innovationen, vilket problem den löser, vilka kunder ni har i dag och vad ni vill uppnå internationellt
            <span className="mt-2 block rounded-lg bg-canvas-subtle p-3 text-sm font-normal leading-6 text-foreground-muted">
              Nämn gärna: hur produkten eller tjänsten levereras, vilka kunder/pilotkunder som finns i Sverige, förfrågningar eller kontakter utomlands, språk och erfarenhet i teamet, certifieringar ni redan har, och hur bråttom det är.
            </span>
            <textarea name="ambitionText" rows={9} value={ambition} onChange={(e) => setAmbition(e.target.value)} maxLength={20000} className={`${inputClass} mt-3`} required />
          </label>
          <label className={`${labelClass} mt-4`}>
            Marknader ni själva tänker på <span className="font-normal text-foreground-subtle">(valfritt, kommaseparerat)</span>
            <input name="desiredMarkets" value={markets} onChange={(e) => setMarkets(e.target.value)} maxLength={1000} placeholder="t.ex. Norge, Tyskland, USA" className={`${inputClass} mt-1.5`} />
          </label>
        </section>

        <section aria-labelledby="company-files-title">
          <SectionHeading id="company-files-title" icon="file-text" title="Befintligt underlag" text="Pitchdeck, affärsplan, marknadsanalys, teknisk beskrivning, kundunderlag — ladda upp det ni har." note="Filformat: PDF, DOCX, PPTX, XLSX, CSV eller TXT. Max 25 MB per fil." />
          <FileDropInput title="Underlag" description="Valfritt: dra filer till ytan eller välj dem från datorn." multiple disabled={pending} onFilesChange={setFiles} />
          <p className={`mt-3 ${noticeWarn}`}>Ladda inte upp dokument med personuppgifter — texten läses ut och går till AI-analysen (Mistral, EU).</p>
        </section>

        <AiSubmitButton
          tone="blue"
          idleLabel="Skapa exportprofil"
          pendingLabel="Analyserar..."
          pendingTitle="Exportprofil och marknadsurval tas fram"
          pendingDescription="Innovationen, ambitionen, underlaget och bolagets IRL vägs samman till internationaliseringsväg, exportmognad, kandidatmarknader (CAGE) och relevanta regelverk."
          pendingSteps={['Läser innovation, ambition och IRL', 'Väljer väg och bedömer mognad', 'Prioriterar marknader och regelverk']}
          fallbackHref={createdId ? exportHref(createdId, 'marknader') : undefined}
          pending={pending}
          className="w-fit"
        />
      </form>
    </div>
  );
}

function SectionHeading({ id, icon, title, text, note }: { id: string; icon: string; title: string; text: string; note?: string }) {
  return (
    <div className="mb-4 flex items-center gap-3 border-b border-default pb-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-morkbla/50 dark:text-movexum-pastell-bla">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <h3 id={id} className="font-heading font-semibold text-foreground">
          {title}
        </h3>
        <p className="text-sm text-foreground-muted">{text}</p>
        {note ? <p className="mt-1 text-xs text-foreground-subtle">{note}</p> : null}
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-movexum-djupbla text-movexum-vit dark:bg-movexum-bla dark:text-movexum-morkbla' : 'border border-default text-foreground-muted hover:bg-canvas-subtle'}`}>
      {children}
    </button>
  );
}
