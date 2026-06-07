/**
 * Ren, IO-fri kärna för den hårda AI-kostnadsspärren (CLAUDE.md § 10.1
 * robusthet / EU AI Act art. 15, § 10.4 SOC 2). Medvetet fri från
 * `server-only`, PocketBase och `@/`-importer så att logiken kan ENHETSTESTAS
 * (samma mönster som `aggregate.ts` / `redaction.ts`). Den server-only IO:n
 * (spend-summering + enforcement mot PB) ligger i `budget.server.ts`.
 *
 * Aktiveras via env `MOVEXUM_MONTHLY_AI_BUDGET_USD` (aldrig i kod, ISO 27001
 * A.8.24). Osatt/0/ogiltigt → spärren är AV (opt-in), så en felkonfiguration
 * aldrig tyst bryter en kunds chatt mitt i månaden.
 */

export class AiBudgetExceededError extends Error {
  readonly spentUsd: number;
  readonly budgetUsd: number;
  constructor(spentUsd: number, budgetUsd: number) {
    super(
      `AI-månadsbudgeten är förbrukad (≈ $${spentUsd.toFixed(2)} av $${budgetUsd.toFixed(2)}). ` +
        'Nya AI-körningar är pausade till nästa månad. Kontakta en administratör om taket behöver höjas.'
    );
    this.name = 'AiBudgetExceededError';
    this.spentUsd = spentUsd;
    this.budgetUsd = budgetUsd;
  }
}

/** Parsar budget-env. NaN/≤0/osatt → 0 (= spärren av). */
export function resolveBudgetUsd(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Spärren slår till när ett tak är satt OCH redan förbrukat. */
export function isOverBudget(spentUsd: number, budgetUsd: number): boolean {
  return budgetUsd > 0 && spentUsd >= budgetUsd;
}

/**
 * Första millisekunden i `now`:s kalendermånad (UTC), i PB:s datumsträngformat
 * `YYYY-MM-DD HH:MM:SS.sssZ` för filterjämförelse mot `created`.
 */
export function monthStartIso(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01 00:00:00.000Z`;
}
