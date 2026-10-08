'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { NOTIFICATION_CATEGORY_META, type NotificationCategory } from '@platform/shared';
import { Icon } from '@/components/proto';
import { NotificationItem } from '@/components/notifications/NotificationItem';
import { markAllRead } from '@/lib/actions/notifications';
import type { NotificationView } from '@/lib/notifications-server';

/**
 * Notislistan på "Mina uppgifter" (CLAUDE.md § 44, § 50). Visningsmodellen
 * byggs på servern (`toNotificationView`); etiketter och ikoner kommer från
 * katalogen i `@platform/shared` — ingen hårdkodad kopia här. Filter: olästa
 * och kategori.
 */
export function NotificationList({ notifications }: { notifications: NotificationView[] }) {
  const [items, setItems] = useState(notifications);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [category, setCategory] = useState<string>('all');
  const [pending, startTransition] = useTransition();

  useEffect(() => setItems(notifications), [notifications]);

  const categories = useMemo(() => {
    const present = new Set(items.map((n) => n.category));
    return (Object.keys(NOTIFICATION_CATEGORY_META) as NotificationCategory[]).filter((c) => present.has(c));
  }, [items]);

  const unreadCount = items.filter((n) => !n.read).length;
  const visible = items.filter(
    (n) => (!unreadOnly || !n.read) && (category === 'all' || n.category === category)
  );

  function updateItem(id: string, next: NotificationView | null) {
    setItems((list) => (next ? list.map((n) => (n.id === id ? next : n)) : list.filter((n) => n.id !== id)));
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-default p-8 text-center">
        <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-canvas-muted text-foreground-subtle">
          <Icon name="bell" size={18} />
        </div>
        <p className="text-[12.5px] text-foreground-subtle">Inga notiser. Du är ikapp.</p>
        <Link href="/konto#notiser" className="mt-2 inline-block text-[11.5px] text-link hover:underline">
          Välj vad du får notiser om
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={!unreadOnly} onClick={() => setUnreadOnly(false)}>
          Alla
        </FilterChip>
        <FilterChip active={unreadOnly} onClick={() => setUnreadOnly(true)}>
          Olästa{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </FilterChip>
        {categories.length > 1 && (
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filtrera på kategori"
            className="rounded-full border border-default bg-surface px-2.5 py-1 text-[11.5px] text-foreground-muted focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila"
          >
            <option value="all">Alla kategorier</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {NOTIFICATION_CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Link href="/konto#notiser" className="text-[11.5px] text-foreground-muted hover:text-foreground hover:underline">
          Inställningar
        </Link>
        {unreadCount > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setItems((list) => list.map((n) => ({ ...n, read: true, seen: true })));
              startTransition(async () => {
                await markAllRead();
              });
            }}
            className="text-[11.5px] text-foreground-muted underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60"
          >
            Markera alla som lästa ({unreadCount})
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-foreground-subtle">Inga notiser matchar filtret.</p>
      ) : (
        visible.map((n) => <NotificationItem key={n.id} item={n} onChange={(next) => updateItem(n.id, next)} />)
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-full border px-2.5 py-1 text-[11.5px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila ' +
        (active
          ? 'border-brand bg-brand text-brand-foreground'
          : 'border-default bg-surface text-foreground-muted hover:text-foreground')
      }
    >
      {children}
    </button>
  );
}
