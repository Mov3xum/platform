'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { Icon } from '@/components/proto/Icon';
import { assignWorkshopToStartupAction } from '@/lib/actions/workshops';
import {
  AssignmentCollabFields,
  collabToOptions,
  EMPTY_COLLAB,
  type CollabState
} from '@/components/assignments/AssignmentCollabFields';
import type { AssignableResource } from '@/lib/assignments/types';

export interface AssignableEducation {
  id: string;
  title: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  workshop: AssignableEducation | null;
  resources: AssignableResource[];
  startupId: string;
  startupName: string;
}

/**
 * Modal för att tilldela en Movexum-utbildning till ett bolag direkt från
 * bolagets verktygs-flik. Återanvänder samarbetsfälten (CLAUDE.md § 18.4):
 * instruktioner, inbjudna Movexum-resurser och ett valfritt möte.
 */
export function EducationAssignModal({
  open,
  onClose,
  workshop,
  resources,
  startupId,
  startupName
}: Props) {
  const router = useRouter();
  const [dueDate, setDueDate] = useState('');
  const [collab, setCollab] = useState<CollabState>(EMPTY_COLLAB);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setDueDate('');
      setCollab(EMPTY_COLLAB);
      setError(null);
    }
  }, [open]);

  function submit() {
    if (!workshop) return;
    setError(null);
    startTransition(async () => {
      const result = await assignWorkshopToStartupAction(
        workshop.id,
        startupId,
        dueDate || undefined,
        collabToOptions(collab)
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-movexum-svart/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] flex max-h-[90vh] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-default bg-surface shadow-xl shadow-movexum-svart/20">
          <div className="flex items-center justify-between border-b border-default px-5 py-4">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                Tilldela utbildning
              </div>
              <Dialog.Title className="mt-0.5 truncate font-heading text-[16px] font-semibold text-foreground">
                {workshop?.title || 'Utbildning'} → {startupName}
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle hover:bg-canvas-muted"
                aria-label="Stäng"
              >
                <Icon name="x" size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <p className="text-[12.5px] text-foreground-subtle">
              Bolaget ser utbildningen i sin arbetsyta. Bjud in fler Movexum-resurser och
              skapa ett möte vid behov.
            </p>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                Förfallodatum (valfritt)
              </span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-default bg-canvas-subtle px-2.5 py-2 font-mono text-[13px] outline-none focus:border-brand"
              />
            </label>

            <AssignmentCollabFields resources={resources} value={collab} onChange={setCollab} />

            {error && (
              <div className="rounded-lg bg-movexum-pastell-orange px-3 py-2 text-[12.5px] text-movexum-morkorange">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-default px-5 py-3">
            <span className="text-[11px] text-foreground-subtle">
              Loggas på <span className="font-mono text-foreground">{startupName}</span>
            </span>
            <div className="flex items-center gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg px-3 py-1.5 text-[12.5px] hover:bg-canvas-muted"
                >
                  Avbryt
                </button>
              </Dialog.Close>
              <button
                type="button"
                onClick={submit}
                disabled={isPending || !workshop}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? 'Tilldelar…' : 'Tilldela'} <Icon name="send" size={12} />
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
