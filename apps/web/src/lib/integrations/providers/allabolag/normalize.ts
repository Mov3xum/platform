import 'server-only';
import type { AllabolagCompany, AllabolagFinancialsYear } from './client';

// Whitelist över startups-fält som Allabolag tillåts uppdatera. org_nr
// är redan ifyllt av användaren (det är nyckeln vi söker på) och rörs
// inte här. tenant/startup-relationen sätts inte heller här — den styrs
// av handler-orkestreringen.
//
// Note (GDPR § 5 / CLAUDE.md § 9.3): org_nr exkluderas redan från
// AI-prompts via whitelisten i apps/web/src/lib/ai/context.ts:7-16.
// `isPersonal`-flaggan från klienten följer med så framtida features
// kan respektera den, men vi avstår fortfarande från att exponera
// org_nr i AI-kontext för enskild firma.
const STARTUP_FIELDS_FROM_ALLABOLAG = [
  'bolagsform',
  'kommun',
  'industri',
  'bolag_status'
] as const;

type AllowedStartupField = (typeof STARTUP_FIELDS_FROM_ALLABOLAG)[number];

export type StartupPatch = Partial<Record<AllowedStartupField, string>>;

export interface FinancialsPatch {
  year: number;
  employees?: number;
  revenue_sek?: number;
  personnel_cost_sek?: number;
  corporate_tax_sek?: number;
}

export function buildStartupPatch(company: AllabolagCompany): StartupPatch {
  const patch: StartupPatch = {};
  for (const key of STARTUP_FIELDS_FROM_ALLABOLAG) {
    const value = company[key];
    if (typeof value === 'string' && value.trim() !== '') {
      patch[key] = value.trim();
    }
  }
  return patch;
}

export function buildFinancialsPatches(
  company: AllabolagCompany
): FinancialsPatch[] {
  return company.financials
    .filter((row): row is AllabolagFinancialsYear =>
      Number.isInteger(row.year) && row.year >= 1980 && row.year <= 2100
    )
    .map((row) => ({
      year: row.year,
      employees: row.employees,
      revenue_sek: row.revenue_sek,
      personnel_cost_sek: row.personnel_cost_sek,
      corporate_tax_sek: row.corporate_tax_sek
    }));
}
