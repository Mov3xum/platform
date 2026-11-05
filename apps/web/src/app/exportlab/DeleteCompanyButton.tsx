'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteExportCompanyAction } from '@/lib/actions/export-lab';
import { Icon } from '@/components/proto/Icon';
import { noticeError } from '@/components/exportlab/ui';

/** "Radera" på bolagskortet i listan. Tar bort exportanalysen — bolagskortet finns kvar. Bara ledning (gränsen i actionen). */
export function DeleteCompanyButton({ startupId, companyName }: { startupId: string; companyName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Radera exportanalysen för ${companyName}? All historik, dokumentkopplingar och planer tas bort. Bolagskortet finns kvar.`)) return;
          setError(null);
          start(async () => {
            const res = await deleteExportCompanyAction(startupId);
            if (res.error) {
              setError(res.error);
              return;
            }
            router.refresh();
          });
        }}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-foreground-subtle transition hover:border-movexum-orange/40 hover:bg-movexum-pastell-orange hover:text-movexum-morkorange disabled:cursor-wait disabled:opacity-60"
      >
        <Icon name={pending ? 'hourglass' : 'trash'} size={15} />
        {pending ? 'Raderar...' : 'Radera'}
      </button>
      {error ? <p role="alert" className={`${noticeError} text-xs`}>{error}</p> : null}
    </div>
  );
}
