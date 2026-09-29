'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/proto/Icon';

/**
 * Delat presentationsskal för helskärmsytor på projektorn (CLAUDE.md § 30.5,
 * § 42) — årshjulet och målcockpiten använder EXAKT samma ram: topprad med
 * logotyp/rubrik/klocka/knappar, hint-rad i botten, klocka som tickar,
 * `router.refresh()` var 5:e minut, helskärm (F) och Esc-beteendet
 * ("Esc i helskärm lämnar bara helskärmen, utanför stänger den vyn").
 * Domänens egna tangenter läggs på via `onKey`. Ren klientpresentation —
 * ingen dataväg; root-layouten tar bort railen för `PRESENTATION_PATHS`.
 */

export const PRESENTATION_REFRESH_MS = 5 * 60 * 1000;

export function usePresentationShell(opts: {
  exitHref: string;
  /** Domäntangenter (← →, O …). Körs efter skalets F/Esc; returnera true om hanterad. */
  onKey?: (e: KeyboardEvent) => boolean | void;
  refreshMs?: number;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Webbläsaren lämnar själv helskärm på Esc och kan ha nollat
  // fullscreenElement innan vår keydown körs — utan ref skulle Esc i helskärm
  // kasta ut användaren ur hela presentationen.
  const fullscreenRef = useRef(false);
  const onKeyRef = useRef(opts.onKey);
  onKeyRef.current = opts.onKey;

  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 60_000);
    const refresh = setInterval(() => router.refresh(), opts.refreshMs ?? PRESENTATION_REFRESH_MS);
    return () => {
      clearInterval(clock);
      clearInterval(refresh);
    };
  }, [router, opts.refreshMs]);

  const toggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }, []);

  const exit = useCallback(() => {
    if (fullscreenRef.current) {
      if (typeof document !== 'undefined' && document.fullscreenElement) void document.exitFullscreen();
      return;
    }
    router.push(opts.exitHref);
  }, [router, opts.exitHref]);

  useEffect(() => {
    const onChange = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      if (active) fullscreenRef.current = true;
      else setTimeout(() => (fullscreenRef.current = false), 400);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'SELECT' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
        return;
      }
      if (e.key === 'Escape') {
        exit();
        return;
      }
      onKeyRef.current?.(e);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleFullscreen, exit]);

  return { now, isFullscreen, toggleFullscreen, exit, router };
}

export function formatPresentationLongDate(date: Date): string {
  const s = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="rounded-md border border-default bg-canvas-subtle px-1.5 py-0.5 font-body text-[11px] font-medium text-foreground-muted">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

export const presentationIconButton =
  'inline-flex items-center gap-1.5 rounded-lg border border-default px-3 py-1.5 text-[13px] font-medium text-foreground-muted hover:border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila';

export function PresentationFrame({
  logoHref,
  headerLeft,
  headerCenter,
  headerRight,
  isFullscreen,
  onToggleFullscreen,
  onClose,
  hints,
  children
}: {
  logoHref: string;
  /** Rubrik + undertext (och ev. bläddringsknappar) bredvid logotypen. */
  headerLeft: ReactNode;
  /** Klocka/vecka i mitten. */
  headerCenter: ReactNode;
  /** Extra kontroller till vänster om Helskärm/Stäng. */
  headerRight?: ReactNode;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  hints: Array<{ keys: string; label: string }>;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-6 border-b border-default px-8 py-4">
        <div className="flex items-center gap-5">
          <Logo href={logoHref} width={120} height={26} />
          <div className="h-6 w-px bg-canvas-muted" aria-hidden />
          {headerLeft}
        </div>
        <div className="text-center">{headerCenter}</div>
        <div className="flex items-center gap-2">
          {headerRight}
          <button type="button" onClick={onToggleFullscreen} className={presentationIconButton} title="Helskärm (F)">
            <Icon name="external" size={14} />
            {isFullscreen ? 'Lämna helskärm' : 'Helskärm'}
          </button>
          <button type="button" onClick={onClose} className={presentationIconButton} title="Stäng (Esc)">
            <Icon name="x" size={14} />
            Stäng
          </button>
        </div>
      </header>
      {children}
      <footer className="flex shrink-0 flex-wrap items-center justify-center gap-6 border-t border-default px-8 py-2.5 text-[12px] text-foreground-subtle">
        {hints.map((h) => (
          <Hint key={h.keys} keys={h.keys} label={h.label} />
        ))}
        <Hint keys="F" label="Helskärm" />
        <Hint keys="Esc" label="Stäng" />
      </footer>
    </div>
  );
}
