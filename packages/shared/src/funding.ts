// Finansieringsprojekt & arbetspaket (CLAUDE.md § 46) — ren, React-/server-
// fri domänlogik som delas av UI, skrivlager och stödcheck-modulen.
//
// Ett finansieringsprojekt är den KASSA ett stöd tas ur (Vinnova Excellens,
// ett TVV-projekt, EoI, Bas/egen finansiering). Arbetspaket (AP) är projektets
// redovisningsenheter — TVV och strukturfondsprojekt rekvireras alltid per AP.
// Statsstödsgrunden (de minimis / art. 22 / inget) är en SEPARAT axel som
// projektet bara ger en default för — den avgörs per ansökan (§ 46.3).

import { daysBetween } from './date-only';

export const FUNDING_PROJECT_KINDS = ['vinnova', 'tillvaxtverket', 'region', 'eu', 'own', 'other'] as const;
export type FundingProjectKind = (typeof FUNDING_PROJECT_KINDS)[number];

export const FUNDING_PROJECT_KIND_LABELS: Record<FundingProjectKind, string> = {
  vinnova: 'Vinnova',
  tillvaxtverket: 'Tillväxtverket (TVV)',
  region: 'Region',
  eu: 'EU-program',
  own: 'Egen finansiering / Bas',
  other: 'Annan finansiär'
};

export function isFundingProjectKind(v: unknown): v is FundingProjectKind {
  return typeof v === 'string' && (FUNDING_PROJECT_KINDS as readonly string[]).includes(v);
}

export const FUNDING_PROJECT_STATUSES = ['planned', 'active', 'ended', 'cancelled'] as const;
export type FundingProjectStatus = (typeof FUNDING_PROJECT_STATUSES)[number];

export const FUNDING_PROJECT_STATUS_LABELS: Record<FundingProjectStatus, string> = {
  planned: 'Planerat',
  active: 'Pågår',
  ended: 'Avslutat',
  cancelled: 'Avbrutet'
};

export function isFundingProjectStatus(v: unknown): v is FundingProjectStatus {
  return typeof v === 'string' && (FUNDING_PROJECT_STATUSES as readonly string[]).includes(v);
}

/** Statsstödsgrund för stöd som lämnas till ett bolag ur projektet. */
export const FUNDING_BASES = ['de_minimis', 'art22', 'none'] as const;
export type FundingBasis = (typeof FUNDING_BASES)[number];

export const FUNDING_BASIS_LABELS: Record<FundingBasis, string> = {
  de_minimis: 'De minimis (stöd av mindre betydelse)',
  art22: 'Artikel 22 GBER (nystartade företag)',
  none: 'Inget statsstöd'
};

export const FUNDING_BASIS_SHORT: Record<FundingBasis, string> = {
  de_minimis: 'De minimis',
  art22: 'Art. 22',
  none: 'Ej statsstöd'
};

export function isFundingBasis(v: unknown): v is FundingBasis {
  return typeof v === 'string' && (FUNDING_BASES as readonly string[]).includes(v);
}

export interface FundingProjectLike {
  id: string;
  title: string;
  kind: FundingProjectKind;
  status: FundingProjectStatus;
  funder?: string | null;
  budget_sek?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  default_state_aid_basis?: FundingBasis | null;
}

export interface FundingWorkPackageLike {
  id: string;
  project: string;
  code?: string | null;
  title: string;
  budget_sek?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

/** Visningsnamn "AP3 Internationalisering" (kod + titel). */
export function workPackageLabel(wp: Pick<FundingWorkPackageLike, 'code' | 'title'>): string {
  const code = (wp.code ?? '').trim();
  return code ? `${code} ${wp.title}`.trim() : wp.title;
}

export interface FundingBurnInput {
  budgetSek: number | null | undefined;
  /** Beviljat (inkl. utbetalt). */
  grantedSek: number;
  paidSek: number;
  startsAt?: string | null;
  endsAt?: string | null;
  today: string;
}

export interface FundingBurn {
  budgetSek: number | null;
  grantedSek: number;
  paidSek: number;
  /** Budget − beviljat (null utan budget). */
  remainingSek: number | null;
  /** Beviljat / budget i procent (null utan budget). */
  pctGranted: number | null;
  /** Andel av perioden som passerat, 0–100 (null utan period). */
  pctElapsed: number | null;
  /**
   * 'over' = beviljat överstiger budget; 'behind' = upparbetning ligger ≥ 20
   * procentenheter under periodens andel; 'ok' annars; 'none' utan budget.
   */
  signal: 'ok' | 'behind' | 'over' | 'none';
}

export const FUNDING_BEHIND_THRESHOLD_PCT = 20;

/** Ren upparbetningsberäkning per projekt/arbetspaket — deterministisk, enhetstestad. */
export function fundingBurn(input: FundingBurnInput): FundingBurn {
  const budget = typeof input.budgetSek === 'number' && Number.isFinite(input.budgetSek) && input.budgetSek > 0 ? input.budgetSek : null;
  const granted = Math.max(0, input.grantedSek || 0);
  const paid = Math.max(0, input.paidSek || 0);
  const remaining = budget === null ? null : Math.round((budget - granted) * 100) / 100;
  const pctGranted = budget === null ? null : Math.round((granted / budget) * 1000) / 10;

  let pctElapsed: number | null = null;
  if (input.startsAt && input.endsAt) {
    const total = daysBetween(input.startsAt, input.endsAt);
    if (total > 0) {
      const elapsed = daysBetween(input.startsAt, input.today);
      pctElapsed = Math.round(Math.max(0, Math.min(100, (elapsed / total) * 100)) * 10) / 10;
    }
  }

  let signal: FundingBurn['signal'] = 'none';
  if (budget !== null) {
    if (granted > budget) signal = 'over';
    else if (pctElapsed !== null && pctElapsed - (pctGranted ?? 0) >= FUNDING_BEHIND_THRESHOLD_PCT) signal = 'behind';
    else signal = 'ok';
  }
  return { budgetSek: budget, grantedSek: granted, paidSek: paid, remainingSek: remaining, pctGranted, pctElapsed, signal };
}

export interface FundingLedgerRow {
  project?: string | null;
  work_package?: string | null;
  /** Beviljat belopp (0/null om inte beviljad). */
  granted_sek?: number | null;
  paid_at?: string | null;
  /** Utbetalt belopp; saknas → beviljat räknas när paid_at finns. */
  paid_sek?: number | null;
}

export interface FundingTotals {
  grantedSek: number;
  paidSek: number;
  count: number;
}

/** Summerar beviljat/utbetalt per projekt eller arbetspaket ur ansökningsrader. */
export function sumFundingLedger(
  rows: readonly FundingLedgerRow[],
  key: { project?: string; workPackage?: string }
): FundingTotals {
  let granted = 0;
  let paid = 0;
  let count = 0;
  for (const r of rows) {
    if (key.workPackage && (r.work_package ?? '') !== key.workPackage) continue;
    if (key.project && (r.project ?? '') !== key.project) continue;
    const g = typeof r.granted_sek === 'number' && Number.isFinite(r.granted_sek) ? r.granted_sek : 0;
    if (g <= 0) continue;
    count++;
    granted += g;
    if (r.paid_at) paid += typeof r.paid_sek === 'number' && Number.isFinite(r.paid_sek) ? r.paid_sek : g;
  }
  return { grantedSek: Math.round(granted * 100) / 100, paidSek: Math.round(paid * 100) / 100, count };
}

export interface FundingProjectInputRaw {
  title?: unknown;
  kind?: unknown;
  status?: unknown;
  funder?: unknown;
  diarienummer?: unknown;
  description?: unknown;
  budget_sek?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  default_state_aid_basis?: unknown;
  default_stodgivare?: unknown;
}

export interface FundingProjectInput {
  title: string;
  kind: FundingProjectKind;
  status: FundingProjectStatus;
  funder: string | null;
  diarienummer: string | null;
  description: string | null;
  budget_sek: number | null;
  starts_at: string | null;
  ends_at: string | null;
  default_state_aid_basis: FundingBasis;
  default_stodgivare: string | null;
}

function optText(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function optDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function optNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

export function validateFundingProjectInput(
  raw: FundingProjectInputRaw
): { ok: true; value: FundingProjectInput } | { ok: false; error: string } {
  const title = optText(raw.title, 200);
  if (!title) return { ok: false, error: 'Projektet måste ha en titel.' };
  const kind = raw.kind === undefined || raw.kind === null || raw.kind === '' ? 'other' : String(raw.kind);
  if (!isFundingProjectKind(kind)) {
    return { ok: false, error: `Finansiärstyp måste vara en av: ${FUNDING_PROJECT_KINDS.join(', ')}.` };
  }
  const status = raw.status === undefined || raw.status === null || raw.status === '' ? 'active' : String(raw.status);
  if (!isFundingProjectStatus(status)) {
    return { ok: false, error: `Status måste vara en av: ${FUNDING_PROJECT_STATUSES.join(', ')}.` };
  }
  const budget = optNumber(raw.budget_sek);
  if (budget !== null && (Number.isNaN(budget) || budget < 0)) return { ok: false, error: 'Budgeten måste vara ett belopp ≥ 0 i kronor.' };
  const startsAt = optDate(raw.starts_at);
  if (raw.starts_at && !startsAt) return { ok: false, error: 'Startdatum måste vara ÅÅÅÅ-MM-DD.' };
  const endsAt = optDate(raw.ends_at);
  if (raw.ends_at && !endsAt) return { ok: false, error: 'Slutdatum måste vara ÅÅÅÅ-MM-DD.' };
  if (startsAt && endsAt && endsAt < startsAt) return { ok: false, error: 'Projektets slut måste ligga efter starten.' };
  const basisRaw =
    raw.default_state_aid_basis === undefined || raw.default_state_aid_basis === null || raw.default_state_aid_basis === ''
      ? 'de_minimis'
      : String(raw.default_state_aid_basis);
  if (!isFundingBasis(basisRaw)) {
    return { ok: false, error: `Statsstödsgrund måste vara en av: ${FUNDING_BASES.join(', ')}.` };
  }
  return {
    ok: true,
    value: {
      title,
      kind,
      status,
      funder: optText(raw.funder, 200),
      diarienummer: optText(raw.diarienummer, 80),
      description: optText(raw.description, 5000),
      budget_sek: budget,
      starts_at: startsAt,
      ends_at: endsAt,
      default_state_aid_basis: basisRaw,
      default_stodgivare: optText(raw.default_stodgivare, 200)
    }
  };
}

export interface FundingWorkPackageInputRaw {
  code?: unknown;
  title?: unknown;
  description?: unknown;
  budget_sek?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  sort_order?: unknown;
}

export interface FundingWorkPackageInput {
  code: string | null;
  title: string;
  description: string | null;
  budget_sek: number | null;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
}

export function validateFundingWorkPackageInput(
  raw: FundingWorkPackageInputRaw
): { ok: true; value: FundingWorkPackageInput } | { ok: false; error: string } {
  const title = optText(raw.title, 200);
  if (!title) return { ok: false, error: 'Arbetspaketet måste ha en titel.' };
  const budget = optNumber(raw.budget_sek);
  if (budget !== null && (Number.isNaN(budget) || budget < 0)) return { ok: false, error: 'Budgeten måste vara ett belopp ≥ 0 i kronor.' };
  const startsAt = optDate(raw.starts_at);
  if (raw.starts_at && !startsAt) return { ok: false, error: 'Startdatum måste vara ÅÅÅÅ-MM-DD.' };
  const endsAt = optDate(raw.ends_at);
  if (raw.ends_at && !endsAt) return { ok: false, error: 'Slutdatum måste vara ÅÅÅÅ-MM-DD.' };
  if (startsAt && endsAt && endsAt < startsAt) return { ok: false, error: 'Arbetspaketets slut måste ligga efter starten.' };
  const sort = optNumber(raw.sort_order);
  return {
    ok: true,
    value: {
      code: optText(raw.code, 20),
      title,
      description: optText(raw.description, 2000),
      budget_sek: budget,
      starts_at: startsAt,
      ends_at: endsAt,
      sort_order: sort === null || Number.isNaN(sort) ? 0 : Math.round(sort)
    }
  };
}

/** Är arbetspaketets period öppen ett visst datum (tom period = alltid)? */
export function workPackageCoversDate(wp: Pick<FundingWorkPackageLike, 'starts_at' | 'ends_at'>, date: string): boolean {
  if (wp.starts_at && date < wp.starts_at) return false;
  if (wp.ends_at && date > wp.ends_at) return false;
  return true;
}
