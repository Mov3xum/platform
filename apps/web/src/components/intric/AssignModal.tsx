'use client';

import { useEffect, useState, useTransition } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Icon } from '@/components/proto/Icon';
import { assignToolAction } from '@/lib/actions/tools';
import { daysUntil, formatDeadline } from './constants';

export interface AssignableTool {
  id: string;
  name: string;
  category?: string;
}

export interface AssignableUser {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  defaultToolId?: string;
  tools: AssignableTool[];
  assignees: AssignableUser[];
  startupId: string;
  startupName: string;
}

export function AssignModal({
  open,
  onClose,
  defaultToolId,
  tools,
  assignees,
  startupId,
  startupName
}: Props) {
  const [toolId, setToolId] = useState(defaultToolId || tools[0]?.id || '');
  const [assigneeId, setAssigneeId] = useState(assignees[0]?.id || '');
  const [deadline, setDeadline] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setToolId(defaultToolId || tools[0]?.id || '');
      setAssigneeId(assignees[0]?.id || '');
      const d = new Date();
      d.setDate(d.getDate() + 7);
      setDeadline(d.toISOString().slice(0, 10));
      setInstruction('');
      setError(null);
    }
  }, [open, defaultToolId, tools, assignees]);

  const days = daysUntil(deadline);

  function submit() {
    if (!toolId) {
      setError('Välj ett verktyg.');
      return;
    }
    if (!assigneeId) {
      setError('Välj vem som ska köra verktyget.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await assignToolAction({
        toolId,
        startupId,
        assigneeId,
        deadline,
        instruction
      });
      if (result.error) setError(result.error);
      else onClose();
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
                Nytt uppdrag
              </div>
              <Dialog.Title className="mt-0.5 truncate font-heading text-[16px] font-semibold text-foreground">
                Tilldela verktyg till {startupName}
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
            {/* Verktyg */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                Verktyg
              </label>
              <div className="grid grid-cols-2 gap-2">
                {tools.length === 0 ? (
                  <div className="col-span-2 rounded-xl border border-dashed border-default px-3 py-4 text-center text-[12px] text-foreground-subtle">
                    Inga verktyg tillgängliga för denna roll.
                  </div>
                ) : (
                  tools.map((t) => {
                    const on = t.id === toolId;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setToolId(t.id)}
                        className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${on ? 'border-brand bg-canvas-subtle shadow-sm' : 'border-default hover:bg-canvas-muted'}`}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-movexum-pastell-lila text-movexum-lila">
                          <Icon name="sparkle" size={14} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-heading text-[12px] font-semibold">
                            {t.name}
                          </span>
                          {t.category && (
                            <span className="block truncate text-[10.5px] text-foreground-subtle">
                              {t.category}
                            </span>
                          )}
                        </span>
                        {on && <Icon name="check" size={12} className="text-brand" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                  Tilldelad till
                </label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full rounded-lg border border-default bg-canvas-subtle px-2.5 py-2 text-[13px] outline-none focus:border-brand"
                >
                  {assignees.length === 0 ? (
                    <option value="">Inga teammedlemmar</option>
                  ) : (
                    assignees.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                  Deadline
                </label>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  className="w-full rounded-lg border border-default bg-canvas-subtle px-2.5 py-2 font-mono text-[13px] outline-none focus:border-brand"
                />
                <div className="mt-1 font-mono text-[10.5px] text-foreground-subtle">
                  {days === null
                    ? '—'
                    : days === 0
                      ? 'idag'
                      : days > 0
                        ? `om ${days} dgr`
                        : `${Math.abs(days)} dgr försenad`}{' '}
                  · {formatDeadline(deadline)}
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
                Instruktion
              </label>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={3}
                placeholder="Vad ska personen fokusera på? Vad är kontexten?"
                className="w-full resize-none rounded-lg border border-default bg-canvas-subtle px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-brand"
              />
            </div>

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
                disabled={isPending}
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
