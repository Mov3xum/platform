/**
 * Generiskt analys-lease (CLAUDE.md § 56/§ 58). Medan ett AI-steg körs bär
 * analysversionens `input_hash` ett lease `analysis-lease:<steg>:<startedAt>:<token>`
 * så att en andra begäran (dubbelklick, ny flik) inte startar samma steg
 * igen. Ett lease räknas som övergivet ("stale") först efter stegets
 * tidsgräns + 60 s, dock minst 330 s, och får då återtas.
 *
 * Samma format som `impact-lease.ts` (som behåller sitt API med fasta steg);
 * den här modulen tar valfria stegnamn (`[a-z_]+`) och används av Export Lab.
 * Ren modul utan IO — enhetstestad i export-lab.test.ts.
 */
export const ANALYSIS_LEASE_GRACE_MS = 60_000;
export const ANALYSIS_LEASE_MIN_LIFETIME_MS = 330_000;

function randomToken(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createAnalysisLease(step: string, now: number = Date.now(), token: string = randomToken()): string {
  if (!/^[a-z_]+$/.test(step)) throw new Error('Ogiltigt stegnamn för lease.');
  return `analysis-lease:${step}:${now}:${token}`;
}

export function readAnalysisLease(value: string | null | undefined): { step: string; startedAt: number; token: string } | null {
  if (!value) return null;
  const match = value.match(/^analysis-lease:([a-z_]+):(\d+):(.+)$/);
  if (!match) return null;
  const startedAt = Number(match[2]);
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) return null;
  return { step: match[1], startedAt, token: match[3] };
}

export function isAnalysisLease(value: string | null | undefined, step?: string): boolean {
  const lease = readAnalysisLease(value);
  return Boolean(lease && (!step || lease.step === step));
}

export function isStaleAnalysisLease(value: string | null | undefined, step: string, timeoutMs: number, now: number = Date.now()): boolean {
  const lease = readAnalysisLease(value);
  const staleAfterMs = Math.max(timeoutMs + ANALYSIS_LEASE_GRACE_MS, ANALYSIS_LEASE_MIN_LIFETIME_MS);
  return Boolean(lease && lease.step === step && now - lease.startedAt > staleAfterMs);
}
