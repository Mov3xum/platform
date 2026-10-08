'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/proto/Icon';
import { markAllRead, markAllSeen } from '@/lib/actions/notifications';
import type { NotificationView } from '@/lib/notifications-server';
import { NotificationItem } from './NotificationItem';

/**
 * Klockan i topplisten (CLAUDE.md § 50). Siffran = olästa notiser som inte
 * setts i klockan; den nollas när panelen öppnas (notiserna förblir olästa
 * tills man öppnar dem). Pollar `/api/notifications` på fokus och var 60:e
 * sekund — inloggningscookien är httpOnly, så PocketBase-realtime kan inte
 * användas direkt från webbläsaren. I en installerad PWA (§ 35) speglas
 * siffran på hemskärmsikonen via `navigator.setAppBadge`.
 */

const POLL_MS = 60_000;

interface ApiResponse {
  unseen: number;
  items: NotificationView[];
}

async function fetchNotifications(limit: number, countOnly: boolean): Promise<ApiResponse | null> {
  try {
    const res = await fetch(`/api/notifications?limit=${limit}${countOnly ? '&count=1' : ''}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' }
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return null;
    return (await res.json()) as ApiResponse;
  } catch {
    return null;
  }
}

function setAppBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) void nav.setAppBadge?.(count);
    else void nav.clearAppBadge?.();
  } catch {
    /* stöds inte */
  }
}

export function NotificationBell({
  initialUnseen = 0,
  allHref
}: {
  initialUnseen?: number;
  /** "Visa alla" — /inkorg för den som har Mina uppgifter, annars utelämnad. */
  allHref?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(initialUnseen);
  const [items, setItems] = useState<NotificationView[] | null>(null);
  const [limit, setLimit] = useState(15);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const refreshCount = useCallback(async () => {
    const data = await fetchNotifications(1, true);
    if (data) setUnseen(data.unseen);
  }, []);

  const loadList = useCallback(async (n: number) => {
    setLoading(true);
    const data = await fetchNotifications(n, false);
    setLoading(false);
    if (data) setItems(data.items);
  }, []);

  // Pollning: fokus, synlig flik och intervall.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshCount();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshCount();
    }, POLL_MS);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [refreshCount]);

  useEffect(() => setAppBadge(unseen), [unseen]);

  // Ny sida → stäng panelen och läs om siffran (en åtgärd kan ha skapat notiser).
  useEffect(() => {
    setOpen(false);
    void refreshCount();
  }, [pathname, refreshCount]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      void loadList(limit);
      if (unseen > 0) {
        setUnseen(0);
        void markAllSeen();
      }
    }
  }

  function updateItem(id: string, next: NotificationView | null) {
    setItems((list) =>
      list ? (next ? list.map((n) => (n.id === id ? next : n)) : list.filter((n) => n.id !== id)) : list
    );
  }

  async function readAll() {
    setItems((list) => list?.map((n) => ({ ...n, read: true, seen: true })) ?? list);
    await markAllRead();
  }

  const unread = items?.filter((n) => !n.read).length ?? 0;
  const badge = unseen > 99 ? '99+' : String(unseen);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unseen > 0 ? `Notiser, ${unseen} nya` : 'Notiser'}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex h-9 w-9 items-center justify-center rounded-xl text-foreground-muted transition hover:bg-canvas-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila"
      >
        <Icon name="bell" size={17} />
        {unseen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-brand px-1 text-center text-[10.5px] font-bold leading-[18px] text-brand-foreground">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notiser"
          className="fixed inset-x-3 top-[60px] z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-2xl border border-default bg-surface shadow-xl shadow-movexum-svart/20 sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[400px]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-default px-4 py-3">
            <h2 className="font-heading text-[14px] font-semibold text-foreground">Notiser</h2>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => void readAll()}
                  className="rounded-lg px-2 py-1 text-[11.5px] text-foreground-muted transition hover:bg-canvas-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila"
                >
                  Markera alla som lästa
                </button>
              )}
              <Link
                href="/konto#notiser"
                onClick={() => setOpen(false)}
                aria-label="Notisinställningar"
                title="Välj vad du får notiser om"
                className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila"
              >
                <Icon name="gear" size={14} />
              </Link>
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {items === null && loading && (
              <p className="py-6 text-center text-[12.5px] text-foreground-subtle">Hämtar notiser…</p>
            )}
            {items !== null && items.length === 0 && (
              <div className="py-8 text-center">
                <div className="mx-auto mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-canvas-muted text-foreground-subtle">
                  <Icon name="bell" size={18} />
                </div>
                <p className="text-[12.5px] text-foreground-subtle">Inga notiser. Du är ikapp.</p>
              </div>
            )}
            {items?.map((n) => (
              <NotificationItem
                key={n.id}
                item={n}
                compact
                onChange={(next) => updateItem(n.id, next)}
                onNavigate={() => setOpen(false)}
              />
            ))}
            {items !== null && items.length >= limit && limit < 30 && (
              <button
                type="button"
                onClick={() => {
                  setLimit(30);
                  void loadList(30);
                }}
                className="w-full rounded-xl py-2 text-[12px] text-foreground-muted transition hover:bg-canvas-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila"
              >
                Visa fler
              </button>
            )}
          </div>

          {allHref && (
            <div className="border-t border-default px-4 py-2.5 text-center">
              <Link
                href={allHref}
                onClick={() => setOpen(false)}
                className="rounded text-[12px] font-medium text-link hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila"
              >
                Visa alla notiser
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
