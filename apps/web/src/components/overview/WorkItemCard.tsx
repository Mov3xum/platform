'use client';

import { Icon } from '@/components/proto/Icon';
import type { WorkItem } from '@/lib/overview/status';

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

export function WorkItemCard({
  item,
  editable,
  dragging,
  pending,
  onDragStart,
  onDragEnd,
  onComplete
}: {
  item: WorkItem;
  editable: boolean;
  dragging: boolean;
  pending: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onComplete: () => void;
}) {
  const overdue = item.dueAt
    ? new Date(item.dueAt).getTime() < Date.now() && item.status !== 'done'
    : false;

  return (
    <div
      draggable={editable}
      onDragStart={
        editable
          ? (e) => {
              e.dataTransfer.setData('text/plain', item.id);
              e.dataTransfer.effectAllowed = 'move';
              onDragStart();
            }
          : undefined
      }
      onDragEnd={editable ? onDragEnd : undefined}
      className={`group rounded-xl border border-default bg-surface p-3 shadow-sm shadow-movexum-svart/5 transition ${
        editable ? 'cursor-grab hover:border-brand/40 hover:shadow-md active:cursor-grabbing' : ''
      } ${dragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-muted">
          <Icon name={KIND_ICON[item.kind] || 'dot'} size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
            {item.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-foreground-subtle">
            <span className="rounded bg-canvas-muted px-1.5 py-0.5">
              {item.source === 'task' ? 'Uppgift' : 'Aktivitet'}
            </span>
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
                <Icon name="calendar" size={10} /> {formatDue(item.dueAt)}
              </span>
            )}
          </div>
        </div>
        {item.ownerName && (
          <div
            title={item.ownerName}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-movexum-pastell-lila text-[9px] font-semibold text-movexum-lila"
          >
            {initials(item.ownerName)}
          </div>
        )}
      </div>

      {editable && item.status !== 'done' && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={onComplete}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-foreground-subtle transition hover:bg-movexum-pastell-gron hover:text-movexum-morkgron disabled:opacity-50"
          >
            <Icon name="check" size={11} /> Markera klar
          </button>
        </div>
      )}
    </div>
  );
}
