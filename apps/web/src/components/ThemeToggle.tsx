'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/proto/Icon';
import {
  applyTheme,
  readCurrentTheme,
  readStoredTheme,
  THEME_CHANGE_EVENT,
  type Theme
} from './ThemeProvider';

/**
 * Light/dark-växlare (CLAUDE.md § 3.1). Ligger uppe till höger i sidhuvudet
 * (ProtoTopBar för inloggade, Navbar för utloggade). Renderas neutralt på
 * servern och läser det faktiska temat efter mount — `ThemeScript` har redan
 * satt `.dark` på <html>, så ingen färgblink uppstår. Följer dessutom
 * systemets `prefers-color-scheme` så länge användaren inte valt själv, och
 * andra flikar via `storage`-eventet.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readCurrentTheme());

    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Theme>).detail;
      setTheme(detail === 'dark' || detail === 'light' ? detail : readCurrentTheme());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'movexum-theme') return;
      const next = e.newValue === 'dark' ? 'dark' : e.newValue === 'light' ? 'light' : null;
      if (next) {
        document.documentElement.classList.toggle('dark', next === 'dark');
        document.documentElement.dataset.theme = next;
        setTheme(next);
      }
    };
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onMedia = (e: MediaQueryListEvent) => {
      // Bara när användaren inte gjort ett eget val följer vi systemet.
      if (readStoredTheme()) return;
      const next: Theme = e.matches ? 'dark' : 'light';
      document.documentElement.classList.toggle('dark', next === 'dark');
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };

    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    media?.addEventListener?.('change', onMedia);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
      media?.removeEventListener?.('change', onMedia);
    };
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = readCurrentTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  }, []);

  const isDark = theme === 'dark';
  const label = isDark ? 'Byt till ljust läge' : 'Byt till mörkt läge';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
      className={
        'relative flex h-9 w-9 items-center justify-center rounded-xl text-foreground-muted transition hover:bg-canvas-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-movexum-pastell-lila dark:focus-visible:ring-movexum-morklila ' +
        className
      }
    >
      {/* Innan mount vet vi inte temat — visa ikonen via CSS-varianterna så
          SSR-HTML:en stämmer i båda lägena utan hydration-varning. */}
      {theme === null ? (
        <>
          <span className="block dark:hidden">
            <Icon name="moon" size={17} />
          </span>
          <span className="hidden dark:block">
            <Icon name="sun" size={17} />
          </span>
        </>
      ) : isDark ? (
        <Icon name="sun" size={17} />
      ) : (
        <Icon name="moon" size={17} />
      )}
    </button>
  );
}
