/**
 * Bolagsnytt (CLAUDE.md § 37.1) — REN urvalslogik, delad av läsvägen
 * (`lib/feed/activity-feed.ts`) och enhetstestad.
 *
 * Bolagsnytt ska BARA innehålla nyheter om våra startups som publicerats av
 * någon i organisationen: en `activities`-rad knuten till ett bolag, skriven
 * av en människa (manuellt via chatten `create_startup_activity`, ett sparat
 * mötesprotokoll, en anteckning) — aldrig systemhändelser (verktygskörningar,
 * integrationssynkar, tilldelningar, onboarding, stödcheckar …) och aldrig
 * skrivlagrets ändringslogg (`agent_actions`), som fortsatt visas i sin helhet
 * på `/aktivitet` (§ 32).
 */

/** Aktivitetstyper en människa publicerar själv. `''` = legacy-rader utan kind. */
export const COMPANY_NEWS_KINDS = ['manual', '', 'note', 'meeting'] as const;

/**
 * PB-filter (bundna parametrar: `{:tenant}`). Rader knutna till en
 * verktygskörning (t.ex. "Begärde ändringar på <verktyg>") är arbetsflöde,
 * inte nyheter — de har `tool_run` satt och hoppas över.
 */
export const COMPANY_NEWS_FILTER =
  'startup.tenant = {:tenant} && startup != "" && (kind = "manual" || kind = "" || kind = "note" || kind = "meeting") && tool_run = "" && tool = ""';

export interface CompanyNewsCandidate {
  kind?: string | null;
  startup?: string | null;
  tool?: string | null;
  tool_run?: string | null;
}

/**
 * Samma regel som filtret, i JS — defense-in-depth mot en instans där ett
 * fält saknas/tolkas annorlunda, och den funktion testerna låser.
 */
export function isCompanyNewsActivity(row: CompanyNewsCandidate): boolean {
  if (!row.startup) return false;
  if (row.tool || row.tool_run) return false;
  const kind = row.kind ?? '';
  return (COMPANY_NEWS_KINDS as readonly string[]).includes(kind);
}
