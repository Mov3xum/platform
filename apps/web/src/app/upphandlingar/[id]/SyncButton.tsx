'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto';
import { syncFollowupsAction } from '@/lib/actions/procurements';
import { btnGhost } from '../ui';

/** Manuell körning av uppföljningssynken (samma som sker efter varje ändring). */
export function SyncButton({ procurementId }: { procurementId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className={btnGhost}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await syncFollowupsAction(procurementId);
            setMsg(r.error ?? r.warning ?? r.notice ?? null);
            router.refresh();
          })
        }
        title="Kör uppföljningsreglerna nu"
      >
        <Icon name="zap" size={12} /> {pending ? 'Synkar…' : 'Synka uppföljning'}
      </button>
      {msg && <span className="text-xs text-foreground-subtle">{msg}</span>}
    </span>
  );
}
