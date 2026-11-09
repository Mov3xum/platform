'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/proto';
import { TimeAgo } from '@/components/home/TimeAgo';
import {
  deleteNotification,
  markRead,
  markUnread,
  setNotificationEntityMutedAction
} from '@/lib/actions/notifications';
import type { NotificationView } from '@/lib/notifications-server';

/**
 * En notisrad (CLAUDE.md § 50) — delas av klockan i topplisten och listan på
 * "Mina uppgifter". Klick på rubriken markerar notisen som läst och öppnar
 * länken (alltid en intern sökväg, `safeNotificationHref`). Menyn: läst/oläst,
 * "Tysta notiser om detta" (inte för obligatoriska typer — där väntar någon på
 * dig) och "Ta bort".
 */
export function NotificationItem({
  item,
  compact = false,
  onChange,
  onNavigate
}: {
  item: NotificationView;
  compact?: boolean;
  /** Lokal uppdatering efter en åtgärd (null = borttagen). */
  onChange?: (next: NotificationView | null) => void;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const unread = !item.read;

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  function run(task: () => Promise<{ ok?: boolean; error?: string }>, optimistic: NotificationView | null) {
    setMenuOpen(false);
    setError(null);
    const previous = item;
    onChange?.(optimistic);
    startTransition(async () => {
      const res = await task();
      if (res.error || res.ok === false) {
        onChange?.(previous);
        setError(res.error ?? 'Något gick fel.');
      } else {
        router.refresh();
      }
    });
  }

  function open() {
    if (unread) {
      onChange?.({ ...item, read: true, seen: true });
      void markRead(item.id);
    }
    onNavigate?.();
    router.push(item.href);
  }

  return (
    <div
      className={
        'group relative flex items-start gap-3 rounded-2xl border p-3 transition ' +
        (unread
          ? 'border-brand/30 bg-canvas-subtle'
          : 'border-default bg-surface') +
        (pending ? ' opacity-60' : '')
      }
    >
      <div
        className={
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ' +
          (unread ? 'bg-brand text-brand-foreground' : 'bg-canvas-muted text-foreground-muted')
        }
        aria-hidden
      >
        <Icon name={item.icon} size={14} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[12px] font-semibold text-foreground">
            {item.label}
            {item.count > 1 && (
              <span className="ml-1 rounded-full bg-canvas-muted px-1.5 py-px text-[10.5px] font-semibold text-foreground-muted">
                {item.count}
              </span>
            )}
          </span>
          <span className="text-[11px] text-foreground-subtle">
            {item.actorName ? `${item.actorName} · ` : ''}
            <TimeAgo iso={item.at} />
          </span>
          {unread && <span className="sr-only">Oläst</span>}
        </div>
        <button
          type="button"
          onClick={open}
          className="mt-0.5 block w-full rounded text-left text-[13px] font-medium text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila"
        >
          {item.title}
        </button>
        {item.snippet && (
          <p className={`mt-0.5 text-[12px] text-foreground-muted ${compact ? 'line-clamp-2' : 'line-clamp-3'}`}>
            {item.snippet}
          </p>
        )}
        {error && <p className="mt-1 text-[11.5px] text-movexum-morkorange dark:text-movexum-orange">{error}</p>}
      </div>

      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Fler val för notisen"
          aria-expanded={menuOpen}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila"
        >
          <Icon name="more" size={14} />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-8 z-20 w-56 overflow-hidden rounded-xl border border-default bg-surface py-1 text-[12.5px] shadow-lg shadow-movexum-svart/10"
          >
            <MenuButton
              onClick={() =>
                run(
                  () => (unread ? markRead(item.id) : markUnread(item.id)),
                  { ...item, read: unread, seen: true }
                )
              }
            >
              {unread ? 'Markera som läst' : 'Markera som oläst'}
            </MenuButton>
            {item.entity && !item.mandatory && (
              <MenuButton
                onClick={() =>
                  run(
                    () =>
                      setNotificationEntityMutedAction(
                        { type: item.entity!.type, id: item.entity!.id, label: item.entity!.label },
                        true
                      ),
                    item
                  )
                }
              >
                Tysta notiser om detta
              </MenuButton>
            )}
            <MenuButton onClick={() => run(() => deleteNotification(item.id), null)}>Ta bort</MenuButton>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left text-foreground transition hover:bg-canvas-muted focus:bg-canvas-muted focus:outline-none"
    >
      {children}
    </button>
  );
}
