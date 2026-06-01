'use client';

/*
 * Tema-hantering.
 *
 * Dark mode är pausat (2026-06) — systemet körs i ljust läge på alla ytor.
 * `ThemeScript` injiceras i <head> och tvingar bort ev. lagrad `.dark`-klass
 * innan React hydrerar, så även användare som tidigare valt mörkt läge får
 * ljust. Toggeln är borttagen från UI:t. Den klassbaserade dark-mappningen
 * finns kvar i tokens.css/prototype.css för att enkelt kunna återaktiveras.
 */

export type Theme = 'light';

const STORAGE_KEY = 'movexum-theme';

const themeScript = `
(function () {
  try {
    document.documentElement.classList.remove('dark');
    document.documentElement.dataset.theme = 'light';
    localStorage.setItem('${STORAGE_KEY}', 'light');
  } catch (_) {}
})();
`;

export function ThemeScript({ nonce }: { nonce?: string }) {
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
