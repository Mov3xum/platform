'use client';

import { useOptimistic, useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/proto/Icon';
import {
  STARTUP_BOARD_COLUMNS,
  type BoardAssignee,
  type StartupBoardStatus,
  type StartupBoardTask
} from '@/lib/startup-board/board';
import type { AssignableResource } from '@/lib/assignments/types';

// Återanvändbar 6-kolumners kanban (Miro-stil) över `tasks`. Driver både
// bolagskanbanen (§ 15.7) och uppdragskanbanen (§ 29) — ingen divergerande
// kopia. Scopet (bolag/uppdrag) injiceras som action-callbacks från en tunn
// wrapper, så själva tavlan inte känner till om korten hör till en startup
// eller en mission.

export type BoardActionResult = { ok: boolean; error?: string };

export interface TaskKanbanActions {
  onCreate: (input: {
    description: string;
    status: StartupBoardStatus;
  }) => Promise<BoardActionResult>;
  onMove: (taskId: string, status: StartupBoardStatus) => Promise<BoardActionResult>;
  onAssign: (taskId: string, assigneeIds: string[]) => Promise<BoardActionResult>;
}

const KIND_ICON: Record<string, string> = {
  call: 'message',
  meeting: 'people',
  email: 'message',
  prep: 'doc',
  followup: 'rotate-ccw',
  admin: 'gear',
  other: 'dot'
};

const KIND_LABEL: Record<string, string> = {
  call: 'Samtal',
  meeting: 'Möte',
  email: 'E-post',
  prep: 'Förberedelse',
  followup: 'Uppföljning',
  admin: 'Administration',
  other: 'Uppgift'
};

function initials(name?: string): string {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/);
  const out = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  return out || '··';
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.round(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      dayMs
  );
  if (diff === 0) return 'idag';
  if (diff === 1) return 'imorgon';
  if (diff === -1) return 'igår';
  if (diff < 0) return `${Math.abs(diff)}d sen`;
  if (diff < 7) return `om ${diff}d`;
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
}

type OptimisticPatch =
  | { type: 'move'; id: string; status: StartupBoardStatus }
  | { type: 'assign'; id: string; assignees: BoardAssignee[] };

export function TaskKanban({
  tasks,
  resources,
  canManage,
  actions
}: {
  tasks: StartupBoardTask[];
  resources: AssignableResource[];
  canManage: boolean;
  actions: TaskKanbanActions;
}) {
  const [optimistic, setOptimistic] = useOptimistic(
    tasks,
    (state: StartupBoardTask[], patch: OptimisticPatch) =>
      state.map((t) => {
        if (t.id !== patch.id) return t;
        return patch.type === 'move'
          ? { ...t, status: patch.status }
          : { ...t, assignees: patch.assignees };
      })
  );
  const [pending, startTransition] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<StartupBoardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  function move(task: StartupBoardTask, status: StartupBoardStatus) {
    if (task.status === status || !task.canEdit) return;
    startTransition(async () => {
      setOptimistic({ type: 'move', id: task.id, status });
      const res = await actions.onMove(task.id, status);
      if (!res.ok) setError(res.error || 'Kunde inte flytta kortet.');
    });
  }

  function assign(task: StartupBoardTask, next: BoardAssignee[]) {
    startTransition(async () => {
      setOptimistic({ type: 'assign', id: task.id, assignees: next });
      const res = await actions.onAssign(
        task.id,
        next.map((a) => a.id)
      );
      if (!res.ok) setError(res.error || 'Kunde inte uppdatera tilldelningen.');
    });
  }

  function endDrag() {
    setDragId(null);
    setOverCol(null);
  }

  return (
    <div style={{ opacity: pending ? 0.9 : 1, transition: 'opacity .15s' }}>
      {error && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-movexum-pastell-orange px-3 py-2 text-[12px] text-movexum-morkorange">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Stäng">
            <Icon name="x" size={12} />
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-6">
        {STARTUP_BOARD_COLUMNS.map((col) => {
          const colTasks = optimistic.filter((t) => t.status === col.id);
          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                if (dragId !== null) {
                  e.preventDefault();
                  setOverCol(col.id);
                }
              }}
              onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                const task = optimistic.find((t) => t.id === id);
                if (task) move(task, col.id);
                endDrag();
              }}
              className={`flex min-h-[220px] flex-col rounded-2xl border p-3 transition ${
                overCol === col.id
                  ? 'border-brand/50 bg-brand/5'
                  : 'border-default bg-canvas-subtle'
              }`}
            >
              <div className="mb-3 flex items-center gap-2 px-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                  {col.label}
                </span>
                <span className="font-mono text-[11px] text-foreground-subtle">
                  {colTasks.length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {colTasks.map((task) => (
                  <KanbanCard
                    key={task.id}
                    task={task}
                    resources={resources}
                    canManage={canManage}
                    dragging={dragId === task.id}
                    pending={pending}
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={endDrag}
                    onAssign={(next) => assign(task, next)}
                  />
                ))}
                {colTasks.length === 0 && (
                  <div className="rounded-xl border border-dashed border-default/70 px-3 py-6 text-center text-[11px] text-foreground-subtle">
                    Tomt
                  </div>
                )}
              </div>
              {canManage && (
                <QuickAdd status={col.id} onCreate={actions.onCreate} onError={setError} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KanbanCard({
  task,
  resources,
  canManage,
  dragging,
  pending,
  onDragStart,
  onDragEnd,
  onAssign
}: {
  task: StartupBoardTask;
  resources: AssignableResource[];
  canManage: boolean;
  dragging: boolean;
  pending: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onAssign: (next: BoardAssignee[]) => void;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const overdue = task.dueAt
    ? new Date(task.dueAt).getTime() < Date.now() && task.status !== 'done'
    : false;
  const assignedIds = new Set(task.assignees.map((a) => a.id));

  function toggle(resource: AssignableResource) {
    const next = assignedIds.has(resource.id)
      ? task.assignees.filter((a) => a.id !== resource.id)
      : [...task.assignees, { id: resource.id, name: resource.name }];
    onAssign(next);
  }

  return (
    <div
      draggable={task.canEdit}
      onDragStart={
        task.canEdit
          ? (e) => {
              e.dataTransfer.setData('text/plain', task.id);
              e.dataTransfer.effectAllowed = 'move';
              onDragStart();
            }
          : undefined
      }
      onDragEnd={task.canEdit ? onDragEnd : undefined}
      className={`group rounded-xl border border-default bg-surface p-3 shadow-sm shadow-movexum-svart/5 transition ${
        task.canEdit
          ? 'cursor-grab hover:border-brand/40 hover:shadow-md active:cursor-grabbing'
          : ''
      } ${dragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-muted">
          <Icon name={KIND_ICON[task.kind] || 'dot'} size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 text-[13px] font-medium leading-snug text-foreground">
            {task.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-foreground-subtle">
            <span className="rounded bg-canvas-muted px-1.5 py-0.5">
              {KIND_LABEL[task.kind] || 'Uppgift'}
            </span>
            {task.dueAt && (
              <span
                className={`inline-flex items-center gap-1 ${
                  overdue ? 'font-semibold text-movexum-orange' : ''
                }`}
              >
                <Icon name="calendar" size={10} /> {formatDue(task.dueAt)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex -space-x-1.5">
          {task.assignees.map((a) => (
            <span
              key={a.id}
              title={a.name}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-movexum-pastell-lila text-[9px] font-semibold text-movexum-lila ring-2 ring-surface"
            >
              {initials(a.name)}
            </span>
          ))}
          {task.assignees.length === 0 && task.ownerName && (
            <span
              title={`Skapad av ${task.ownerName}`}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-canvas-muted text-[9px] font-semibold text-foreground-subtle ring-2 ring-surface"
            >
              {initials(task.ownerName)}
            </span>
          )}
        </div>
        {canManage && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setAssignOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-foreground-subtle transition hover:bg-movexum-pastell-lila hover:text-movexum-lila disabled:opacity-50"
          >
            <Icon name="people" size={11} /> Tilldela
          </button>
        )}
      </div>

      {assignOpen && canManage && (
        <div className="mt-2 rounded-xl border border-default bg-canvas p-2">
          <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle">
            Movexum-kollegor
          </p>
          {resources.length === 0 && (
            <p className="px-1 pb-1 text-[11px] text-foreground-subtle">
              Inga kollegor att tilldela.
            </p>
          )}
          <ul className="max-h-44 space-y-0.5 overflow-y-auto">
            {resources.map((r) => {
              const checked = assignedIds.has(r.id);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggle(r)}
                    className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12px] transition hover:bg-canvas-muted disabled:opacity-50 ${
                      checked ? 'text-foreground' : 'text-foreground-muted'
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked
                          ? 'border-brand bg-brand text-brand-foreground'
                          : 'border-strong bg-surface'
                      }`}
                    >
                      {checked && <Icon name="check" size={10} />}
                    </span>
                    <span className="truncate">{r.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function QuickAdd({
  status,
  onCreate,
  onError
}: {
  status: StartupBoardStatus;
  onCreate: TaskKanbanActions['onCreate'];
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const description = inputRef.current?.value.trim() || '';
    if (!description) return;
    startTransition(async () => {
      const res = await onCreate({ description, status });
      if (!res.ok) {
        onError(res.error || 'Kunde inte skapa uppgiften.');
        return;
      }
      if (inputRef.current) inputRef.current.value = '';
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
      >
        <Icon name="plus" size={11} /> Ny uppgift
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-default bg-surface p-2">
      <input
        ref={inputRef}
        autoFocus
        maxLength={500}
        disabled={saving}
        placeholder="Vad ska göras?"
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') setOpen(false);
        }}
        className="w-full rounded-lg border border-default bg-canvas px-2 py-1.5 text-[12.5px] text-foreground outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
      />
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        <button
          type="button"
          disabled={saving}
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1 text-[11px] text-foreground-subtle hover:bg-canvas-muted"
        >
          Avbryt
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={submit}
          className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
        >
          {saving ? 'Sparar…' : 'Lägg till'}
        </button>
      </div>
    </div>
  );
}
