'use client';

import { useState } from 'react';
import { Icon } from '@/components/proto/Icon';
import type { BoardStatus, WorkItem } from '@/lib/overview/status';
import { groupByDue, recentlyDone } from '@/lib/overview/group';
import type { StartupOption } from '@/lib/overview/aggregate';
import { WorkItemCard } from './WorkItemCard';
import type { WorkItemEdit } from './WorkItemEditor';

/**
 * Tidsindelad lista (default-vyn): Försenat · Idag · Denna vecka · Senare ·
 * Utan datum, samt hopfällt "Klart nyligen". Korten är samma som i tavlan.
 */
export function OverviewList({
  items,
  meId,
  now,
  editable,
  pending,
  startupOptions,
  onMove,
  onEdit,
  onDelete
}: {
  items: WorkItem[];
  meId: string;
  now: Date;
  editable: boolean;
  pending: boolean;
  startupOptions: StartupOption[];
  onMove: (item: WorkItem, status: BoardStatus) => void;
  onEdit: (item: WorkItem, edit: WorkItemEdit) => Promise<boolean>;
  onDelete: (item: WorkItem) => void;
}) {
  const groups = groupByDue(items, now);
  const done = recentlyDone(items);
  const [showDone, setShowDone] = useState(false);

  if (groups.length === 0 && done.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-default p-10 text-center">
        <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-canvas-muted text-foreground-subtle">
          <Icon name="check" size={18} />
        </div>
        <p className="text-[13px] text-foreground-subtle">
          Inga öppna uppgifter eller aktiviteter just nu. Allt klart.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.id} aria-labelledby={`due-${g.id}`}>
          <h3
            id={`due-${g.id}`}
            className={`mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] ${
              g.id === 'overdue' ? 'text-movexum-orange' : 'text-foreground-subtle'
            }`}
          >
            {g.id === 'overdue' && <Icon name="alert" size={11} />}
            {g.label}
            <span className="font-mono normal-case tracking-normal">{g.items.length}</span>
          </h3>
          <div className="grid gap-2 md:grid-cols-2">
            {g.items.map((it) => (
              <WorkItemCard
                key={`${it.source}-${it.id}`}
                item={it}
                meId={meId}
                now={now}
                editable={editable && it.canEdit}
                pending={pending}
                startupOptions={startupOptions}
                onMove={(s) => onMove(it, s)}
                onEdit={(e) => onEdit(it, e)}
                onDelete={it.source === 'task' ? () => onDelete(it) : undefined}
              />
            ))}
          </div>
        </section>
      ))}

      {done.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle transition hover:text-foreground"
          >
            <Icon name={showDone ? 'chevdown' : 'chevron'} size={11} />
            Klart nyligen
            <span className="font-mono normal-case tracking-normal">{done.length}</span>
          </button>
          {showDone && (
            <div className="grid gap-2 md:grid-cols-2">
              {done.map((it) => (
                <WorkItemCard
                  key={`${it.source}-${it.id}`}
                  item={it}
                  meId={meId}
                  now={now}
                  editable={editable && it.canEdit}
                  pending={pending}
                  startupOptions={startupOptions}
                  onMove={(s) => onMove(it, s)}
                  onEdit={(e) => onEdit(it, e)}
                  onDelete={it.source === 'task' ? () => onDelete(it) : undefined}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
