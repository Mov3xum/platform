/**
 * Gemensamma klasser för Export Lab (Movexums tokens, § 3.3).
 *
 * Modulen bär Movexums BLÅ toner — djupblå `#005470` som primär knapp,
 * Movexum blå `#00a8de` som accent/prick (aldrig som stor bakgrundsyta,
 * § 2.3), pastell blå sparsamt på chips. Fokusringar följer § 3.4.
 * Samma namn som `components/impact/ui.ts` så sidorna kan byta modul utan
 * att byta klassnamn.
 */
export const inputClass =
  'w-full rounded-xl border border-default bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-movexum-djupbla/50 focus:ring-2 focus:ring-movexum-pastell-lila disabled:bg-canvas-muted disabled:text-foreground-muted dark:focus:ring-movexum-morklila';
export const labelClass = 'block text-sm font-medium text-foreground';
export const hintClass = 'text-xs text-foreground-subtle';
export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-movexum-djupbla px-4 py-2.5 text-sm font-semibold text-movexum-vit shadow-sm shadow-movexum-djupbla/20 transition hover:-translate-y-0.5 hover:bg-movexum-morkbla hover:shadow-md focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0 dark:bg-movexum-bla dark:text-movexum-morkbla dark:hover:bg-movexum-pastell-bla dark:focus:ring-movexum-morklila';
export const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-default bg-surface px-3 py-2 text-sm font-semibold text-foreground-muted shadow-sm transition hover:border-movexum-djupbla/40 hover:bg-movexum-pastell-bla hover:text-movexum-morkbla focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila disabled:opacity-60 dark:hover:bg-movexum-morkbla/40 dark:hover:text-movexum-pastell-bla dark:focus:ring-movexum-morklila';
export const btnDanger =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-movexum-orange/40 bg-surface px-3 py-2 text-sm font-semibold text-movexum-morkorange transition hover:bg-movexum-pastell-orange disabled:opacity-60';
export const card = 'rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5';
export const noticeWarn = 'rounded-xl border border-movexum-gul/40 bg-movexum-pastell-gul px-4 py-3 text-sm text-movexum-morkgul dark:bg-movexum-morkgul/20 dark:text-movexum-pastell-gul';
export const noticeError = 'rounded-xl border border-movexum-orange/40 bg-movexum-pastell-orange px-4 py-3 text-sm font-medium text-movexum-morkorange dark:bg-movexum-morkorange/20 dark:text-movexum-pastell-orange';
export const noticeGood = 'rounded-xl border border-movexum-gron/40 bg-movexum-pastell-gron px-4 py-3 text-sm text-movexum-morkgron dark:bg-movexum-morkgron/20 dark:text-movexum-pastell-gron';
export const noticeInfo = 'rounded-xl border border-movexum-bla/30 bg-movexum-pastell-bla px-4 py-3 text-sm text-movexum-djupbla dark:bg-movexum-morkbla/40 dark:text-movexum-pastell-bla';
export const eyebrow = 'text-xs font-semibold uppercase tracking-[0.14em] text-foreground-subtle';
export const eyebrowAccent = 'flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-movexum-djupbla dark:text-movexum-bla';
export const accentText = 'text-movexum-djupbla dark:text-movexum-bla';
export const accentBg = 'bg-movexum-djupbla text-movexum-vit dark:bg-movexum-bla dark:text-movexum-morkbla';
export const accentSoft = 'bg-movexum-pastell-bla text-movexum-morkbla dark:bg-movexum-morkbla/40 dark:text-movexum-pastell-bla';

/** Datum i svensk form (serverdata är "YYYY-MM-DD HH:mm:ss.SSSZ"). */
export function formatExportDate(value?: string | null, withTime = false): string {
  if (!value) return '–';
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return withTime
    ? d.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}
