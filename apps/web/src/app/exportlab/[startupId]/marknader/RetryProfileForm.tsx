'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteExportDocumentAction, runExportProfileAction } from '@/lib/actions/export-lab';
import { EXPORT_DOCUMENTS_ENDPOINT, exportHref } from '@/lib/export-lab/tabs';
import { AiSubmitButton } from '@/components/impact/AiSubmitButton';
import { FileDropInput } from '@/components/impact/FileDropInput';
import { noticeError } from '@/components/exportlab/ui';

/** "Kör om exportprofilen" — med möjlighet att lägga till underlag först. */
export function RetryProfileForm({ startupId, assessmentId }: { startupId: string; assessmentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4 space-y-4">
      <FileDropInput
        title="Komplettera underlaget (valfritt)"
        description="Dra fler dokument hit eller välj dem från datorn innan analysen körs om."
        multiple
        target={{ startupId, assessmentId, stage: 'full_information', endpoint: EXPORT_DOCUMENTS_ENDPOINT, deleteDocument: deleteExportDocumentAction }}
      />
      {error ? <p role="alert" className={noticeError}>{error}</p> : null}
      <AiSubmitButton
        tone="blue"
        type="button"
        pending={pending}
        idleLabel="Kör exportprofilen"
        pendingLabel="Analyserar underlaget..."
        pendingTitle="Exportprofil och marknadsurval tas fram"
        pendingDescription="Innovationen, ambitionen, underlaget och bolagets IRL vägs samman."
        pendingSteps={['Läser innovation, ambition och IRL', 'Väljer väg och bedömer mognad', 'Prioriterar marknader och regelverk']}
        fallbackHref={exportHref(startupId, 'marknader')}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await runExportProfileAction(startupId, assessmentId);
            if (res.error && !res.next) {
              setError(res.error);
              return;
            }
            router.push(res.next ?? exportHref(startupId, 'marknader'));
            router.refresh();
          });
        }}
      />
    </div>
  );
}
