'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { deleteExportDocumentAction, updateExportPlanAction } from '@/lib/actions/export-lab';
import { EXPORT_DOCUMENTS_ENDPOINT, exportHref } from '@/lib/export-lab/tabs';
import { AiSubmitButton } from '@/components/impact/AiSubmitButton';
import { FileDropInput, type UploadedImpactDocument } from '@/components/impact/FileDropInput';
import { card, hintClass, inputClass, labelClass, noticeError } from '@/components/exportlab/ui';

/** "Uppdatera planen" — vad har hänt (genomförda steg, förfrågningar, partners, ny IRL) + nya dokument → ny planversion. */
export function UpdatePlanForm({ startupId }: { startupId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [docs, setDocs] = useState<UploadedImpactDocument[]>([]);
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const res = await updateExportPlanAction(startupId, { narrative: String(fd.get('narrative') ?? ''), documentIds: docs.map((d) => d.id) });
      if (res.error && !res.next) {
        setError(res.error);
        router.refresh();
        return;
      }
      router.push(res.next ?? exportHref(startupId, 'plan'));
      router.refresh();
    });
  }

  return (
    <section id="update-plan" className={card}>
      <h2 className="font-heading text-lg font-semibold text-foreground">Uppdatera planen</h2>
      <p className={`mt-1 ${hintClass}`}>Den tidigare planen jämförs med ny information — genomförda steg, nya förfrågningar, partners, certifieringar, kapital eller en ny IRL-bedömning. Bara det som faktiskt påverkas revideras.</p>
      <form onSubmit={submit} className="mt-4 grid gap-4">
        <label className={labelClass}>
          Vad har hänt sedan sist? (valfritt om du laddar upp dokument)
          <textarea name="narrative" rows={5} maxLength={20000} className={`${inputClass} mt-1`} />
        </label>
        <div>
          <p className={labelClass}>Nya dokument</p>
          <FileDropInput title="Nya dokument" description="Dra nya filer till ytan eller välj dem från datorn." multiple target={{ startupId, stage: 'update', endpoint: EXPORT_DOCUMENTS_ENDPOINT, deleteDocument: deleteExportDocumentAction }} onUploaded={setDocs} className="mt-1" />
        </div>
        <p className={hintClass}>Skriv inte personuppgifter — texten går till AI-analysen (Mistral, EU).</p>
        {error ? <p role="alert" className={noticeError}>{error}</p> : null}
        <div>
          <AiSubmitButton tone="blue" pending={pending} idleLabel="Skapa ny planversion" pendingLabel="Uppdaterar planen..." pendingTitle="Ny planversion skapas" pendingDescription="Tidigare plan jämförs med ny information för att revidera marknader, faser, risker och nästa steg." fallbackHref={exportHref(startupId, 'plan')} />
        </div>
      </form>
    </section>
  );
}
