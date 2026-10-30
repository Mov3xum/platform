'use client';

import { useState } from 'react';
import type { ImpactGapStatus } from '@platform/shared';
import { FileDropInput, type UploadedImpactDocument } from './FileDropInput';
import { hintClass, inputClass } from './ui';

/**
 * Svarsfälten för en kompletteringsfråga (originalets GapResponseFields):
 * svarstext, status (Besvarad / Obesvarad / Ej tillgänglig) och bifogade
 * dokument. Statusen blir Besvarad så snart man skriver eller bifogar.
 * Fältnamn som i originalet (`answer-<id>`, `status-<id>`, `file-<id>` med
 * dokument-id:n) så formuläret läses med FormData.
 */
export function GapResponseFields({
  questionId,
  startupId,
  assessmentId,
  answerText,
  initialStatus,
  disabled
}: {
  questionId: string;
  startupId: string;
  assessmentId: string;
  answerText: string;
  initialStatus: ImpactGapStatus;
  disabled: boolean;
}) {
  const [status, setStatus] = useState<ImpactGapStatus>(answerText.trim() ? 'answered' : initialStatus);
  const [docs, setDocs] = useState<UploadedImpactDocument[]>([]);

  return (
    <>
      <textarea
        name={`answer-${questionId}`}
        rows={4}
        defaultValue={answerText}
        disabled={disabled}
        placeholder="Svara med det ni vet. Det går att gå vidare även om svaret saknas."
        onChange={(e) => {
          if (e.currentTarget.value.trim()) setStatus('answered');
        }}
        className={`${inputClass} mt-3`}
      />
      <input type="hidden" name={`file-${questionId}`} value={docs.map((d) => d.id).join(',')} />
      {!disabled ? (
        <>
          <div className="mt-3 grid gap-3 md:grid-cols-[auto_1fr]">
            <select name={`status-${questionId}`} value={status} aria-label="Svarstatus" onChange={(e) => setStatus(e.currentTarget.value as ImpactGapStatus)} className={`${inputClass} w-auto`}>
              <option value="answered">Besvarad</option>
              <option value="open">Obesvarad</option>
              <option value="not_available">Ej tillgänglig</option>
            </select>
            <FileDropInput
              title="Kompletterande filer"
              description="Valfritt: bifoga dokument som stöd för svaret."
              multiple
              target={{ startupId, assessmentId, gapQuestionId: questionId, stage: 'gap_response' }}
              onUploaded={(next) => {
                setDocs(next);
                if (next.length) setStatus('answered');
              }}
            />
          </div>
          <p className={`mt-2 ${hintClass}`}>Statusen ändras automatiskt till Besvarad när du skriver ett svar eller väljer en fil.</p>
        </>
      ) : (
        <p className={`mt-2 ${hintClass}`}>Status: {status === 'answered' ? 'Besvarad' : status === 'not_available' ? 'Ej tillgänglig' : 'Obesvarad'}</p>
      )}
    </>
  );
}
