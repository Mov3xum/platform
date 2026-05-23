'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { useLiveWorkspace } from '@/lib/realtime/tool-runs';
import { updateTaskStatusAction } from '@/lib/actions/tasks';
import { updateActivityStatusAction } from '@/lib/actions/overview-activities';
import {
  BOARD_COLUMNS,
  isDroppableForSource,
  type BoardStatus,
  type WorkItem,
  type WorkItemSource
} from '@/lib/overview/status';
import { WorkItemCard } from './WorkItemCard';

export function OverviewBoard({
  items,
  editable
}: {
  items: WorkItem[];
  editable: boolean;
}) {
  const [optimistic, setOptimistic] = useOptimistic(
    items,
    (state: WorkItem[], next: { id: string; status: BoardStatus }) =>
      state.map((it) => (it.id === next.id ? { ...it, status: next.status } : it))
  );
  const [pending, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<WorkItemSource | null>(null);
  const [overCol, setOverCol] = useState<BoardStatus | null>(null);

  // Pausa polling under interaktion så optimistiska flyttar inte flimrar.
  useLiveWorkspace(!pending && dragId === null);

  function move(item: WorkItem, status: BoardStatus) {
    if (item.status === status) return;
    if (!item.canEdit) return;
    if (!isDroppableForSource(item.source, status)) return;
    startTransition(async () => {
      setOptimistic({ id: item.id, status });
      if (item.source === 'task') {
        await updateTaskStatusAction(item.id, status);
      } else {
        await updateActivityStatusAction(item.id, status);
      }
    });
  }

  function endDrag() {
    setDragId(null);
    setDragSource(null);
    setOverCol(null);
  }

  return (
    <div
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
      style={{ opacity: pending ? 0.9 : 1, transition: 'opacity .15s' }}
    >
      {BOARD_COLUMNS.map((col) => {
        const colItems = optimistic.filter((it) => it.status === col.id);
        const canDropHere =
          dragSource !== null && isDroppableForSource(dragSource, col.id);
        return (
          <div
            key={col.id}
            onDragOver={
              editable
                ? (e) => {
                    if (canDropHere) {
                      e.preventDefault();
                      setOverCol(col.id);
                    }
                  }
                : undefined
            }
            onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
            onDrop={
              editable
                ? (e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/plain');
                    const it = optimistic.find((x) => x.id === id);
                    if (it) move(it, col.id);
                    endDrag();
                  }
                : undefined
            }
            className={`flex min-h-[180px] flex-col rounded-2xl border p-3 transition ${
              overCol === col.id
                ? 'border-brand/50 bg-brand/5'
                : dragId !== null && !canDropHere
                  ? 'border-default bg-canvas-subtle opacity-60'
                  : 'border-default bg-canvas-subtle'
            }`}
          >
            <div className="mb-3 flex items-center gap-2 px-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                {col.label}
              </span>
              <span className="font-mono text-[11px] text-foreground-subtle">
                {colItems.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2">
              {colItems.map((it) => (
                <WorkItemCard
                  key={`${it.source}-${it.id}`}
                  item={it}
                  editable={editable && it.canEdit}
                  dragging={dragId === it.id}
                  pending={pending}
                  onDragStart={() => {
                    setDragId(it.id);
                    setDragSource(it.source);
                  }}
                  onDragEnd={endDrag}
                  onComplete={() => move(it, 'done')}
                />
              ))}
              {colItems.length === 0 && (
                <div className="rounded-xl border border-dashed border-default/70 px-3 py-6 text-center text-[11px] text-foreground-subtle">
                  Tomt
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
