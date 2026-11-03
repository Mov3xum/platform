'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { runMaterialityAction } from '@/lib/actions/impact';
import { AiSubmitButton } from '@/components/impact/AiSubmitButton';
import { FileDropInput } from '@/components/impact/FileDropInput';
import { noticeError } from '@/components/impact/ui';

/** "Kör om väsentlighetsanalysen" (originalets retryMaterialityAction) — med möjlighet att lägga till underlag först. */
export function RetryMaterialityForm({ startupId, assessmentId }: { startupId: string; assessmentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-4 space-y-4">
      <FileDropInput
        title="Komplettera underlaget (valfritt)"
        description="Dra fler dokument hit eller välj dem från datorn innan analysen körs om."
        multiple
        target={{ startupId, assessmentId, stage: 'full_information' }}
      />
      {error ? <p role="alert" className={noticeError}>{error}</p> : null}
      <AiSubmitButton
        type="button"
        pending={pending}
        idleLabel="Kör om väsentlighetsanalysen"
        pendingLabel="Analyserar underlaget..."
        pendingTitle="Väsentlighetsanalys skapas"
        pendingDescription="Underlaget vägs samman till bolagsspecifika väsentliga områden, evidens och osäkerheter."
        pendingSteps={['Kartlägger relevanta hållbarhetsfrågor', 'Värderar påverkan, risker och möjligheter', 'Prioriterar vad som är mest väsentligt']}
        fallbackHref={`/impactnavigator/${startupId}/vasentlighet`}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await runMaterialityAction(startupId, assessmentId);
            if (res.error && !res.next) {
              setError(res.error);
              return;
            }
            router.push(res.next ?? `/impactnavigator/${startupId}/vasentlighet`);
            router.refresh();
          });
        }}
      />
    </div>
  );
}
