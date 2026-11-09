/**
 * Datumhjälpare på DAG-nivå (ÅÅÅÅ-MM-DD, lokal kalender — inga tidszoner).
 *
 * Intern modul: exporteras publikt via `procurement.ts` (bakåtkompatibelt)
 * och används av den generiska uppföljningsmotorn `followup-rules.ts`. Läggs
 * INTE i `index.ts` som `export *` — då skulle namnen kollidera med
 * procurement-re-exporten.
 */

export function parseDateOnlyLocal(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1) return null;
  return d;
}

export function toDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

/** Månadsaddition med klampning (31 jan + 1 mån = 28/29 feb). */
export function addMonths(d: Date, months: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
}

export function compareDateOnly(a: string, b: string): number {
  return a.slice(0, 10).localeCompare(b.slice(0, 10));
}

/** Hela dagar från `from` till `to` (positivt när `to` ligger efter). */
export function daysBetween(from: string, to: string): number {
  const a = parseDateOnlyLocal(from);
  const b = parseDateOnlyLocal(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
