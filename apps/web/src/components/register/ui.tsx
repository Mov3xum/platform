import type { ReactNode } from 'react';

/** Gemensamma klasser och småkomponenter för diariet (§ 60). Semantiska tokens — dark mode följer med. */
export const inputClass =
  'w-full rounded-lg border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-strong focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila disabled:bg-canvas-muted disabled:text-foreground-muted';
export const labelClass = 'mb-1 block text-xs font-semibold text-foreground-muted';
export const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila disabled:opacity-60';
export const btnGhost =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-default bg-surface px-3 py-2 text-sm font-medium text-foreground-muted transition hover:border-strong hover:text-foreground focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila disabled:opacity-60';
export const btnDanger =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-movexum-orange/40 bg-surface px-3 py-2 text-sm font-medium text-movexum-morkorange transition hover:bg-movexum-pastell-orange dark:text-movexum-pastell-orange dark:hover:bg-movexum-morkorange/30 disabled:opacity-60';
export const card = 'rounded-2xl border border-default bg-surface';
export const eyebrow = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground-subtle';

const TONES = {
  neutral: 'bg-canvas-muted text-foreground-muted',
  good: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/30 dark:text-movexum-pastell-gron',
  warn: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/25 dark:text-movexum-pastell-gul',
  bad: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/30 dark:text-movexum-pastell-orange',
  info: 'bg-movexum-pastell-bla text-movexum-djupbla dark:bg-movexum-morkbla/40 dark:text-movexum-pastell-bla'
} as const;
export type Tone = keyof typeof TONES;

export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>{children}</span>;
}

export function Notice({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-xl px-4 py-3 text-sm ${TONES[tone]}`}>
      {children}
    </div>
  );
}

/** Utfallet av en server action, visat där man klickade. */
export function ActionNotice({ state }: { state: { ok?: boolean; error?: string; notice?: string } }) {
  if (state.error) return <Notice tone="bad">{state.error}</Notice>;
  if (state.ok && state.notice) return <Notice tone="good">{state.notice}</Notice>;
  return null;
}

/** Datum i svensk tid (PB lagrar "YYYY-MM-DD HH:mm:ss.SSSZ"). */
export function formatRegisterDate(value?: string | null, withTime = false): string {
  if (!value) return '–';
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return withTime
    ? d.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}

export function retentionText(retention: string, months: number | null): string {
  if (retention !== 'dispose') return 'Bevaras';
  if (!months) return 'Gallras';
  return months % 12 === 0 ? `Gallras efter ${months / 12} år` : `Gallras efter ${months} mån`;
}
