'use client';

import { useState } from 'react';
import {
  BOARD_COLUMNS,
  isDroppableForSource,
  type BoardStatus,
  type WorkItem,
  type WorkItemSource
} from '@/lib/overview/status';
import { sortWorkItems } from '@/lib/overview/group';
import type { StartupOption } from '@/lib/overview/aggregate';
import { WorkItemCard } from './WorkItemCard';
import type { WorkItemEdit } from './WorkItemEditor';

/**
 * Kanban-vyn (fyra kolumner, drag-and-drop). Presentationell — state och
 * mutationer ägs av `OverviewWork`. Kort utan drag (tangentbord) flyttas via
 * kortets "Flytta till"-select.
 */
export function OverviewBoard({
  items,
  meId,
  now,
  editable,
  pending,
  startupOptions,
  onMove,
  onEdit,
  onDelete,
  onDraggingChange
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
  onDraggingChange: (dragging: boolean) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<WorkItemSource | null>(null);
  const [overCol, setOverCol] = useState<BoardStatus | null>(null);

  function endDrag() {
    setDragId(null);
    setDragSource(null);
    setOverCol(null);
    onDraggingChange(false);
  }

  return (
    <div
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"
      style={{ opacity: pending ? 0.9 : 1, transition: 'opacity .15s' }}
    >
      {BOARD_COLUMNS.map((col) => {
        const colItems = sortWorkItems(items.filter((it) => it.status === col.id));
        const canDropHere = dragSource !== null && isDroppableForSource(dragSource, col.id);
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
                    const it = items.find((x) => x.id === id);
                    if (it) onMove(it, col.id);
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
                  meId={meId}
                  now={now}
                  editable={editable && it.canEdit}
                  dragging={dragId === it.id}
                  pending={pending}
                  startupOptions={startupOptions}
                  onDragStart={() => {
                    setDragId(it.id);
                    setDragSource(it.source);
                    onDraggingChange(true);
                  }}
                  onDragEnd={endDrag}
                  onMove={(s) => onMove(it, s)}
                  onEdit={(e) => onEdit(it, e)}
                  onDelete={it.source === 'task' ? () => onDelete(it) : undefined}
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
