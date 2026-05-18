import Link from 'next/link';
import { Icon } from '@/components/proto';
import type { Notification, NotificationKind } from '@platform/shared';
import { markReadFormAction, markAllReadFormAction } from '@/lib/actions/notifications';

const KIND_LABEL: Record<NotificationKind, string> = {
  comment: 'Ny kommentar',
  mention: 'Du blev nämnd',
  assigned: 'Tilldelad',
  status_change: 'Status ändrad',
  stage_advance: 'Steg klart',
  due_soon: 'Deadline närmar sig'
};

const KIND_ICON: Record<NotificationKind, string> = {
  comment: 'message',
  mention: 'spark',
  assigned: 'inbox',
  status_change: 'badge-check',
  stage_advance: 'check',
  due_soon: 'clock'
};

function fmtRelative(iso: string) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just nu';
  if (mins < 60) return `${mins} min sedan`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} tim sedan`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} dgr sedan`;
  return new Date(iso).toLocaleDateString('sv-SE');
}

export function NotificationList({ notifications }: { notifications: Notification[] }) {
  if (notifications.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-default p-8 text-center">
        <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-canvas-muted text-foreground-subtle">
          <Icon name="bell" size={18} />
        </div>
        <p className="text-[12.5px] text-foreground-subtle">
          Inga nya notiser. Du är ikapp.
        </p>
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <div className="space-y-2">
      {unreadCount > 0 && (
        <form action={markAllReadFormAction} className="flex justify-end">
          <button
            type="submit"
            className="text-[11.5px] text-foreground-muted underline-offset-2 hover:text-foreground hover:underline"
          >
            Markera alla som lästa ({unreadCount})
          </button>
        </form>
      )}
      {notifications.map((n) => {
        const unread = !n.read_at;
        const actor = n.expand?.actor;
        const actorName = actor?.display_name || actor?.email?.split('@')[0] || 'Någon';
        const href = n.payload_json?.href || (n.mission ? `/uppdrag/${n.mission}` : '/inkorg');
        return (
          <div
            key={n.id}
            className={
              'flex items-start gap-3 rounded-2xl border p-3 transition ' +
              (unread
                ? 'border-brand/40 bg-movexum-pastell-lila/40 dark:bg-movexum-morklila/20'
                : 'border-default bg-surface')
            }
          >
            <div
              className={
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ' +
                (unread
                  ? 'bg-brand text-brand-foreground'
                  : 'bg-canvas-muted text-foreground-muted')
              }
            >
              <Icon name={KIND_ICON[n.kind]} size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-foreground">
                  {KIND_LABEL[n.kind]}
                </span>
                <span className="text-[11px] text-foreground-subtle">
                  · {actorName} · {fmtRelative(n.created)}
                </span>
              </div>
              <Link
                href={href}
                className="mt-0.5 block text-[13px] font-medium text-foreground hover:underline"
              >
                {n.payload_json?.title || 'Uppdrag'}
              </Link>
              {n.payload_json?.snippet && (
                <p className="mt-0.5 line-clamp-2 text-[12px] text-foreground-muted">
                  {n.payload_json.snippet}
                </p>
              )}
            </div>
            {unread && (
              <form action={markReadFormAction}>
                <input type="hidden" name="id" value={n.id} />
                <button
                  type="submit"
                  className="text-[11px] text-foreground-subtle transition hover:text-foreground"
                  aria-label="Markera som läst"
                >
                  Markera läst
                </button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
