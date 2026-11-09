'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/proto/Icon';
import { BOARD_COLUMNS, isDroppableForSource, type BoardStatus, type WorkItem } from '@/lib/overview/status';
import { formatDueLabel, isOverdue } from '@/lib/overview/group';
import { WorkItemEditor, type WorkItemEdit } from './WorkItemEditor';
import type { StartupOption } from '@/lib/overview/aggregate';

const KIND_ICON: Record<string, string> = {
  call: 'message',
  meeting: 'people',
  email: 'message',
  prep: 'doc',
  followup: 'rotate-ccw',
  admin: 'gear',
  other: 'dot',
  task: 'check',
  workshop: 'cap',
  note: 'doc'
};

function initials(name?: string): string {
  if (!name) return '··';
  const parts = name.trim().split(/\s+/);
  const out = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  return out || '··';
}

/** Vart "Öppna" leder: bolagskortet, uppdraget — eller ingenstans (fristående). */
export function workItemHref(item: WorkItem): string | null {
  if (item.startupId) {
    return item.source === 'task'
      ? `/startups/${item.startupId}/aktiviteter`
      : `/startups/${item.startupId}`;
  }
  if (item.missionId) return `/uppdrag/${item.missionId}`;
  return null;
}

export interface WorkItemCardProps {
  item: WorkItem;
  /** Inloggad användare — avataren visas bara när ägaren är någon annan. */
  meId: string;
  now: Date;
  editable: boolean;
  dragging?: boolean;
  pending: boolean;
  startupOptions: StartupOption[];
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onMove: (status: BoardStatus) => void;
  onEdit: (edit: WorkItemEdit) => Promise<boolean>;
  onDelete?: () => void;
}

export function WorkItemCard({
  item,
  meId,
  now,
  editable,
  dragging = false,
  pending,
  startupOptions,
  onDragStart,
  onDragEnd,
  onMove,
  onEdit,
  onDelete
}: WorkItemCardProps) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const overdue = isOverdue(item, now);
  const href = workItemHref(item);
  const draggable = editable && Boolean(onDragStart);
  const showOwner = Boolean(item.ownerName) && item.ownerId !== meId;
  const done = item.status === 'done';

  return (
    <div
      draggable={draggable}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData('text/plain', item.id);
              e.dataTransfer.effectAllowed = 'move';
              onDragStart?.();
            }
          : undefined
      }
      onDragEnd={draggable ? onDragEnd : undefined}
      className={`group rounded-xl border bg-surface p-3 shadow-sm shadow-movexum-svart/5 transition ${
        overdue ? 'border-movexum-orange/50' : 'border-default'
      } ${draggable ? 'cursor-grab hover:border-brand/40 hover:shadow-md active:cursor-grabbing' : ''} ${
        dragging ? 'opacity-40' : ''
      } ${done ? 'opacity-70' : ''}`}
    >
      {editing ? (
        <WorkItemEditor
          item={item}
          startupOptions={startupOptions}
          pending={pending}
          onCancel={() => setEditing(false)}
          onSave={async (edit) => {
            const ok = await onEdit(edit);
            if (ok) setEditing(false);
            return ok;
          }}
        />
      ) : (
        <>
          <div className="flex items-start gap-2.5">
            <div
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                done
                  ? 'bg-movexum-pastell-gron text-movexum-morkgron'
                  : 'bg-canvas-muted text-foreground-muted'
              }`}
            >
              <Icon name={done ? 'check' : KIND_ICON[item.kind] || 'dot'} size={13} />
            </div>
            <div className="min-w-0 flex-1">
              {href ? (
                <Link
                  href={href}
                  className={`line-clamp-2 text-[13px] font-medium leading-snug text-foreground hover:underline ${
                    done ? 'line-through' : ''
                  }`}
                >
                  {item.title}
                </Link>
              ) : (
                <p
                  className={`line-clamp-2 text-[13px] font-medium leading-snug text-foreground ${
                    done ? 'line-through' : ''
                  }`}
                >
                  {item.title}
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-foreground-subtle">
                {item.source === 'activity' && (
                  <span className="rounded bg-canvas-muted px-1.5 py-0.5">Aktivitet</span>
                )}
                {item.startupName && (
                  <span className="inline-flex items-center gap-1">
                    <Icon name="briefcase" size={10} /> {item.startupName}
                  </span>
                )}
                {item.contactName && (
                  <span className="inline-flex items-center gap-1">
                    <Icon name="user" size={10} /> {item.contactName}
                  </span>
                )}
                {item.dueAt && (
                  <span
                    className={`inline-flex items-center gap-1 ${
                      overdue ? 'font-semibold text-movexum-orange' : ''
                    }`}
                  >
                    <Icon name="calendar" size={10} /> {formatDueLabel(item.dueAt, now)}
                    {overdue ? ' · försenad' : ''}
                  </span>
                )}
              </div>
            </div>
            {showOwner && (
              <div
                title={item.ownerName}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-movexum-pastell-lila text-[9px] font-semibold text-movexum-lila"
              >
                {initials(item.ownerName)}
              </div>
            )}
          </div>

          {editable && (
            <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
              <label className="sr-only" htmlFor={`move-${item.source}-${item.id}`}>
                Flytta till
              </label>
              <select
                id={`move-${item.source}-${item.id}`}
                value={item.status}
                disabled={pending}
                onChange={(e) => onMove(e.target.value as BoardStatus)}
                className="rounded-md border border-default bg-surface px-1.5 py-0.5 text-[10.5px] text-foreground-muted outline-none focus:border-brand/50 focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
                title="Flytta till"
              >
                {BOARD_COLUMNS.filter((c) => isDroppableForSource(item.source, c.id)).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setConfirmDelete(false);
                  setEditing(true);
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground disabled:opacity-50"
                title="Redigera"
                aria-label="Redigera"
              >
                <Icon name="pencil" size={11} />
              </button>
              {onDelete &&
                (confirmDelete ? (
                  <span className="inline-flex items-center gap-1 text-[10.5px]">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={onDelete}
                      className="rounded-md bg-movexum-pastell-orange px-1.5 py-0.5 font-medium text-movexum-morkorange disabled:opacity-50"
                    >
                      Ta bort
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-md px-1.5 py-0.5 text-foreground-subtle hover:text-foreground"
                    >
                      Ångra
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirmDelete(true)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-foreground-subtle transition hover:bg-movexum-pastell-orange hover:text-movexum-morkorange disabled:opacity-50"
                    title="Ta bort"
                    aria-label="Ta bort"
                  >
                    <Icon name="trash" size={11} />
                  </button>
                ))}
              {!done && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onMove('done')}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-foreground-subtle transition hover:bg-movexum-pastell-gron hover:text-movexum-morkgron disabled:opacity-50"
                >
                  <Icon name="check" size={11} /> Markera klar
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
