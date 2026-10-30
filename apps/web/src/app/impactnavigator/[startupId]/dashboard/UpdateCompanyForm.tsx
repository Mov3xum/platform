'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { updateCompanyAction } from '@/lib/actions/impact';
import { AiSubmitButton } from '@/components/impact/AiSubmitButton';
import { FileDropInput, type UploadedImpactDocument } from '@/components/impact/FileDropInput';
import { card, hintClass, inputClass, labelClass, noticeError } from '@/components/impact/ui';

/** "Uppdatera bolag" — vad har hänt + nya dokument → ny analysversion (originalets updateCompanyAction). */
export function UpdateCompanyForm({ startupId }: { startupId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [docs, setDocs] = useState<UploadedImpactDocument[]>([]);
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const narrative = String(fd.get('narrative') ?? '');
    setError(null);
    start(async () => {
      const res = await updateCompanyAction(startupId, { narrative, documentIds: docs.map((d) => d.id) });
      if (res.error && !res.next) {
        setError(res.error);
        router.refresh();
        return;
      }
      router.push(res.next ?? `/impactnavigator/${startupId}/dashboard`);
      router.refresh();
    });
  }

  return (
    <section id="update-company" className={card}>
      <h2 className="font-heading text-lg font-semibold text-foreground">Uppdatera bolag</h2>
      <p className={`mt-1 ${hintClass}`}>Tidigare dashboard jämförs med ny information — bara det som underlaget faktiskt ändrar revideras.</p>
      <form onSubmit={submit} className="mt-4 grid gap-4">
        <label className={labelClass}>
          Vad har hänt sedan sist? (valfritt om du laddar upp dokument)
          <textarea name="narrative" rows={5} maxLength={20000} className={`${inputClass} mt-1`} />
        </label>
        <div>
          <p className={labelClass}>Nya dokument</p>
          <FileDropInput title="Nya dokument" description="Dra nya filer till ytan eller välj dem från datorn." multiple target={{ startupId, stage: 'update' }} onUploaded={setDocs} className="mt-1" />
        </div>
        <p className={hintClass}>Skriv inte personuppgifter — texten går till AI-analysen (Mistral, EU).</p>
        {error ? <p role="alert" className={noticeError}>{error}</p> : null}
        <div>
          <AiSubmitButton
            pending={pending}
            idleLabel="Skapa ny analysversion"
            pendingLabel="Uppdaterar analys..."
            pendingTitle="Ny analysversion skapas"
            pendingDescription="Tidigare dashboard jämförs med ny information för att markera förändrade risker, möjligheter, bedömningstexter och diskussionsfrågor."
            fallbackHref={`/impactnavigator/${startupId}/dashboard`}
          />
        </div>
      </form>
    </section>
  );
}
