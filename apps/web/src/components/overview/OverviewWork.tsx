'use client';

import { useEffect, useOptimistic, useState, useTransition } from 'react';
import { Icon } from '@/components/proto/Icon';
import { useLiveWorkspace } from '@/lib/realtime/tool-runs';
import {
  deleteTaskAction,
  updateTaskDetailsAction,
  updateTaskStatusAction
} from '@/lib/actions/tasks';
import {
  updateActivityDetailsAction,
  updateActivityStatusAction
} from '@/lib/actions/overview-activities';
import { isDroppableForSource, type BoardStatus, type WorkItem } from '@/lib/overview/status';
import type { StartupOption } from '@/lib/overview/aggregate';
import { OverviewBoard } from './OverviewBoard';
import { OverviewList } from './OverviewList';
import type { WorkItemEdit } from './WorkItemEditor';

export type OverviewView = 'list' | 'board';

const VIEW_KEY = 'movexum-overview-view';

function readStoredView(): OverviewView | null {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    return v === 'board' || v === 'list' ? v : null;
  } catch {
    return null;
  }
}

function storeView(v: OverviewView) {
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* bekvämlighet, ingen datakälla */
  }
}

type OptimisticPatch =
  | { kind: 'status'; id: string; status: BoardStatus }
  | { kind: 'edit'; id: string; title: string; dueAt?: string; startupId?: string; startupName?: string }
  | { kind: 'remove'; id: string };

/**
 * Container för "Mina uppgifter": äger optimistiskt state + alla mutationer
 * och växlar mellan tidsindelad lista (default) och kanban. Vyvalet sparas
 * per webbläsare i localStorage (bekvämlighet — ingen datakälla).
 */
export function OverviewWork({
  items,
  editable,
  meId,
  startupOptions
}: {
  items: WorkItem[];
  editable: boolean;
  meId: string;
  startupOptions: StartupOption[];
}) {
  const [view, setView] = useState<OverviewView>('list');
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  useEffect(() => {
    const stored = readStoredView();
    if (stored) setView(stored);
  }, []);

  const [optimistic, applyOptimistic] = useOptimistic(
    items,
    (state: WorkItem[], patch: OptimisticPatch) => {
      if (patch.kind === 'remove') return state.filter((it) => it.id !== patch.id);
      return state.map((it) => {
        if (it.id !== patch.id) return it;
        if (patch.kind === 'status') return { ...it, status: patch.status };
        return {
          ...it,
          title: patch.title,
          dueAt: patch.dueAt,
          startupId: patch.startupId,
          startupName: patch.startupName
        };
      });
    }
  );
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);

  // Fokus + intervall (60 s) — pausas under interaktion så optimistiska
  // flyttar inte flimrar.
  useLiveWorkspace(!pending && !dragging, 60_000);

  function move(item: WorkItem, status: BoardStatus) {
    if (item.status === status) return;
    if (!item.canEdit) return;
    if (!isDroppableForSource(item.source, status)) return;
    startTransition(async () => {
      applyOptimistic({ kind: 'status', id: item.id, status });
      const res =
        item.source === 'task'
          ? await updateTaskStatusAction(item.id, status)
          : await updateActivityStatusAction(item.id, status);
      setError(res.ok ? null : res.error || 'Kunde inte flytta.');
    });
  }

  function edit(item: WorkItem, e: WorkItemEdit): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const startupName = e.startupId
          ? startupOptions.find((s) => s.id === e.startupId)?.name ?? item.startupName
          : undefined;
        applyOptimistic({
          kind: 'edit',
          id: item.id,
          title: e.title,
          dueAt: e.dueAt || undefined,
          startupId: item.source === 'task' ? e.startupId || undefined : item.startupId,
          startupName: item.source === 'task' ? startupName : item.startupName
        });
        const res =
          item.source === 'task'
            ? await updateTaskDetailsAction({
                taskId: item.id,
                description: e.title,
                dueAt: e.dueAt,
                startupId: e.startupId
              })
            : await updateActivityDetailsAction({
                activityId: item.id,
                title: e.title,
                dueDate: e.dueAt
              });
        setError(res.ok ? null : res.error || 'Kunde inte spara.');
        resolve(res.ok);
      });
    });
  }

  function remove(item: WorkItem) {
    if (item.source !== 'task') return;
    startTransition(async () => {
      applyOptimistic({ kind: 'remove', id: item.id });
      const res = await deleteTaskAction(item.id);
      setError(res.ok ? null : res.error || 'Kunde inte ta bort.');
    });
  }

  const handlers = {
    meId,
    now,
    editable,
    pending,
    startupOptions,
    onMove: move,
    onEdit: edit,
    onDelete: remove
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Vy"
          className="inline-flex rounded-lg border border-default bg-canvas-subtle p-0.5"
        >
          {(
            [
              { id: 'list', label: 'Lista', icon: 'list-ul' },
              { id: 'board', label: 'Tavla', icon: 'flow' }
            ] as { id: OverviewView; label: string; icon: string }[]
          ).map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => {
                setView(v.id);
                storeView(v.id);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-medium transition ${
                view === v.id
                  ? 'bg-surface text-foreground shadow-sm shadow-movexum-svart/5'
                  : 'text-foreground-subtle hover:text-foreground'
              }`}
            >
              <Icon name={v.icon} size={12} /> {v.label}
            </button>
          ))}
        </div>
        {error && (
          <p className="inline-flex items-center gap-1.5 text-[11.5px] text-movexum-orange">
            <Icon name="alert" size={12} /> {error}
          </p>
        )}
      </div>

      {view === 'board' ? (
        <OverviewBoard items={optimistic} onDraggingChange={setDragging} {...handlers} />
      ) : (
        <OverviewList items={optimistic} {...handlers} />
      )}
    </div>
  );
}
