/**
 * Impact Navigator — analys-lease (CLAUDE.md § 56), porterad från originalets
 * `src/lib/ai/lease.ts`. Medan ett AI-steg körs bär analysversionens
 * `input_hash` ett lease `analysis-lease:<steg>:<startedAt>:<token>` så att en
 * andra begäran (dubbelklick, ny flik) inte startar samma steg igen. Ett lease
 * räknas som övergivet ("stale") först efter stegets tidsgräns + 60 s, dock
 * minst 330 s (originalets Vercel-gräns 300 s + 30 s), och får då återtas.
 */
export type ImpactLeaseStep = 'materiality' | 'sufficiency' | 'final' | 'update';

export const IMPACT_LEASE_GRACE_MS = 60_000;
export const IMPACT_LEASE_MIN_LIFETIME_MS = 330_000;

function randomToken(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createImpactLease(step: ImpactLeaseStep, now: number = Date.now(), token: string = randomToken()): string {
  return `analysis-lease:${step}:${now}:${token}`;
}

export function readImpactLease(value: string | null | undefined): { step: ImpactLeaseStep; startedAt: number; token: string } | null {
  if (!value) return null;
  const match = value.match(/^analysis-lease:(materiality|sufficiency|final|update):(\d+):(.+)$/);
  if (!match) return null;
  const startedAt = Number(match[2]);
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) return null;
  return { step: match[1] as ImpactLeaseStep, startedAt, token: match[3] };
}

export function isImpactLease(value: string | null | undefined, step?: ImpactLeaseStep): boolean {
  const lease = readImpactLease(value);
  return Boolean(lease && (!step || lease.step === step));
}

export function isStaleImpactLease(value: string | null | undefined, step: ImpactLeaseStep, timeoutMs: number, now: number = Date.now()): boolean {
  const lease = readImpactLease(value);
  const staleAfterMs = Math.max(timeoutMs + IMPACT_LEASE_GRACE_MS, IMPACT_LEASE_MIN_LIFETIME_MS);
  return Boolean(lease && lease.step === step && now - lease.startedAt > staleAfterMs);
}
