// REN modul (ingen IO) — sammanfattar varför bolag hoppades över i en
// portföljsynk mot ett bolagsregister (§ 11.8). Utan den här sammanfattningen
// syntes bara "partial" i synk-loggen och orsaken gick förlorad.
//
// Felmeddelandena kommer från providern och skrivlagret och innehåller
// endpoint-sökväg + orsak, aldrig org-nr eller bolagsnamn (§ 11.4). Bolags-id
// tas medvetet inte med i sammanfattningen.

export interface RegistrySkipError {
  startupId: string;
  error: string;
}

/** Hur många olika orsaker som listas innan resten sammanfattas. */
const MAX_REASONS = 3;
const MAX_LENGTH = 500;

/**
 * "12 av 12 bolag kunde inte hämtas. 12 st: Roaring grunddata (...): ..."
 * Grupperar identiska orsaker, vanligaste först. Tom lista ⇒ ''.
 */
export function summarizeRegistrySkips(errors: RegistrySkipError[], total?: number): string {
  if (errors.length === 0) return '';
  const counts = new Map<string, number>();
  for (const e of errors) {
    const reason = e.error.replace(/\s+/g, ' ').trim() || 'Okänt fel';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const head =
    total !== undefined && total >= errors.length
      ? `${errors.length} av ${total} bolag kunde inte hämtas.`
      : `${errors.length} bolag kunde inte hämtas.`;
  const reasons = sorted.slice(0, MAX_REASONS).map(([reason, n]) => `${n} st: ${reason}`);
  const rest = sorted.length - MAX_REASONS;
  const tail = rest > 0 ? ` (+${rest} andra orsaker)` : '';
  const text = `${head} ${reasons.join(' | ')}${tail}`;
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}

/**
 * Status för en portföljsynk: hoppades ALLA bolag över och inget skrevs är
 * synken misslyckad, inte "partial" (en helt tom synk ska aldrig se halvlyckad ut).
 */
export function registrySyncStatus(r: {
  startupsUpdated: number;
  financialsUpserted: number;
  ownershipWritten: number;
  skipped: number;
}): 'success' | 'partial' | 'failed' {
  if (r.skipped === 0) return 'success';
  const wrote = r.startupsUpdated + r.financialsUpserted + r.ownershipWritten > 0;
  return wrote ? 'partial' : 'failed';
}
