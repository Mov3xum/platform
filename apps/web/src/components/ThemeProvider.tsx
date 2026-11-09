'use client';

/*
 * Tema-hantering (CLAUDE.md § 3.1).
 *
 * Klassbaserat: `<html class="dark">` aktiverar dark mode. `ThemeScript`
 * injiceras i <head> och sätter klassen FÖRE hydration (ingen färgblink):
 *   1. `localStorage['movexum-theme']` om användaren valt själv,
 *   2. annars **ljust tema** (beslut 2026-10-27: standard är ljust för
 *      alla — systemets `prefers-color-scheme` följs INTE; mörkt läge är
 *      ett aktivt val via `ThemeToggle`).
 * `ThemeToggle` (uppe till höger i sidhuvudet) växlar och sparar valet.
 * Valet är en bekvämlighet per webbläsare — ingen datakälla, ingen PII.
 */

export const DEFAULT_THEME: Theme = 'light';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'movexum-theme';
/** Fyras på `window` när temat byts, så alla toggles/komponenter följer med. */
export const THEME_CHANGE_EVENT = 'movexum-theme-change';

// Körs inline i <head> innan React hydrerar. Håll den dependency-fri och
// defensiv — localStorage kan kasta i privata fönster.
const themeScript = `
(function () {
  try {
    var stored = null;
    try { stored = localStorage.getItem('${THEME_STORAGE_KEY}'); } catch (_) {}
    var theme = stored === 'dark' || stored === 'light' ? stored : '${DEFAULT_THEME}';
    var root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
    root.dataset.theme = theme;
  } catch (_) {}
})();
`;

export function ThemeScript({ nonce }: { nonce?: string }) {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />;
}

/** Läser temat som faktiskt gäller i dokumentet just nu (klient). */
export function readCurrentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Läser användarens sparade val (null = inget eget val ⇒ ljust tema). */
export function readStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    return null;
  }
}

/** Applicerar temat på <html>, sparar valet och meddelar lyssnare. */
export function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* privat fönster / blockerad lagring — temat gäller ändå för sidan */
  }
  window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: theme }));
}
