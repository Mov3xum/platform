// Bedömning excellens — HISTORIK på bolagskortet (CLAUDE.md § 51.6).
//
// Varje körning sparas som en rad i `startup_screenings` (staff/observer-
// RLS) med en KOMPAKT, PII-fri sammanfattning: utfall (art. 22 / Vinnova /
// excellens), varje punkts utfall och källa, saknat underlag, koncernens
// bolag och det viktade tröskelvärdet. Två på varandra följande rader
// jämförs med `diffScreeningRuns` → "vad ändrades sedan senast". REN modul:
// sammanfattning, normalisering (PB-json kan vara gammal) och diff utan IO.

import {
  STATE_AID_OUTCOME_LABEL,
  VINNOVA_OUTCOME_LABEL,
  type ExcellenceScreeningResult,
  type ScreeningRelation,
  type ScreeningSource,
  type ScreeningVerdict,
  type StateAidOutcome,
  type VinnovaOutcome
} from './excellence-screening';

export const SCREENING_RUN_SUMMARY_VERSION = 1;

export interface ScreeningRunCheck {
  /** Org-nr när punkten gäller ett bolag (grundförutsättningar), annars tomt. */
  scope: string;
  id: string;
  label: string;
  verdict: ScreeningVerdict;
  source: ScreeningSource;
}

export interface ScreeningRunCompany {
  org_nr: string;
  name?: string;
  role: 'subject' | 'linked' | 'partner';
  relation?: ScreeningRelation;
}

export interface ScreeningRunSummary {
  version: number;
  state_aid: StateAidOutcome;
  vinnova: VinnovaOutcome;
  excellence: ScreeningVerdict;
  counts: { yes: number; no: number; unknown: number };
  checks: ScreeningRunCheck[];
  missing: string[];
  companies: ScreeningRunCompany[];
  thresholds: { employees?: number; revenue_sek?: number; balance_sheet_sek?: number; complete: boolean };
  /** Registerläget: uppskattad kostnad för uppslagen (§ 11.8). */
  cost?: { credits: number | null; sek: number | null; complete: boolean };
}

export const SCREENING_RUN_MAX_CHECKS = 400;
export const SCREENING_RUN_MAX_MISSING = 60;
export const SCREENING_RUN_MAX_COMPANIES = 40;

const STATE_AID: readonly StateAidOutcome[] = ['art22_possible', 'de_minimis', 'not_eligible', 'undetermined'];
const VINNOVA: readonly VinnovaOutcome[] = ['in_target_possible', 'not_in_target', 'undetermined'];
const VERDICTS: readonly ScreeningVerdict[] = ['yes', 'no', 'unknown'];
const SOURCES: readonly ScreeningSource[] = ['register', 'platform', 'manual'];
const ROLES = ['subject', 'linked', 'partner'] as const;
const RELATIONS: readonly ScreeningRelation[] = ['linked', 'partner', 'exempt', 'uncertain'];

function cap(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Sammanfattar en bedömning till det som sparas på bolagskortet. `detail`
 * tas INTE med (kan bära grundarnamn ur teamet) — etikett, utfall och källa
 * räcker för historik och diff; hela underlaget finns i PDF:en.
 */
export function summarizeScreeningRun(
  result: ExcellenceScreeningResult,
  extras: { cost?: { credits: number | null; sek: number | null; complete: boolean } } = {}
): ScreeningRunSummary {
  const checks: ScreeningRunCheck[] = [];
  for (const c of result.companies) {
    for (const cond of c.conditions) {
      checks.push({ scope: c.orgNr, id: cond.id, label: cap(cond.label, 200), verdict: cond.verdict, source: cond.source });
    }
  }
  const globals = [result.standalone, result.thresholds.check, result.deMinimis, ...result.vinnovaChecks, result.excellence];
  for (const g of globals) checks.push({ scope: '', id: g.id, label: cap(g.label, 200), verdict: g.verdict, source: g.source });
  const counts = { yes: 0, no: 0, unknown: 0 };
  for (const c of result.checks) counts[c.verdict]++;
  const summary: ScreeningRunSummary = {
    version: SCREENING_RUN_SUMMARY_VERSION,
    state_aid: result.stateAid.outcome,
    vinnova: result.vinnova.outcome,
    excellence: result.excellence.verdict,
    counts,
    checks: checks.slice(0, SCREENING_RUN_MAX_CHECKS),
    missing: result.missing.map((m) => cap(m, 300)).slice(0, SCREENING_RUN_MAX_MISSING),
    companies: result.companies
      .map((c) => {
        const row: ScreeningRunCompany = { org_nr: c.orgNr, role: c.role };
        if (c.name) row.name = cap(c.name, 200);
        if (c.relation) row.relation = c.relation;
        return row;
      })
      .slice(0, SCREENING_RUN_MAX_COMPANIES),
    thresholds: {
      employees: result.thresholds.combined.employees,
      revenue_sek: result.thresholds.combined.revenue_sek,
      balance_sheet_sek: result.thresholds.combined.balance_sheet_sek,
      complete: result.thresholds.combined.complete
    }
  };
  if (extras.cost) summary.cost = { credits: extras.cost.credits, sek: extras.cost.sek, complete: extras.cost.complete };
  return summary;
}

/** Tolkar en sparad sammanfattning tolerant — okänt släpps, aldrig ett undantag. */
export function normalizeScreeningRunSummary(raw: unknown): ScreeningRunSummary | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const stateAid = STATE_AID.find((s) => s === o.state_aid);
  const vinnova = VINNOVA.find((v) => v === o.vinnova);
  const excellence = VERDICTS.find((v) => v === o.excellence);
  if (!stateAid || !vinnova || !excellence) return null;
  const countsRaw = typeof o.counts === 'object' && o.counts !== null ? (o.counts as Record<string, unknown>) : {};
  const checks: ScreeningRunCheck[] = [];
  if (Array.isArray(o.checks)) {
    for (const c of o.checks) {
      if (typeof c !== 'object' || c === null) continue;
      const r = c as Record<string, unknown>;
      const verdict = VERDICTS.find((v) => v === r.verdict);
      const source = SOURCES.find((s) => s === r.source);
      if (typeof r.id !== 'string' || !verdict || !source) continue;
      checks.push({
        scope: typeof r.scope === 'string' ? r.scope : '',
        id: r.id,
        label: typeof r.label === 'string' ? cap(r.label, 200) : r.id,
        verdict,
        source
      });
      if (checks.length >= SCREENING_RUN_MAX_CHECKS) break;
    }
  }
  const companies: ScreeningRunCompany[] = [];
  if (Array.isArray(o.companies)) {
    for (const c of o.companies) {
      if (typeof c !== 'object' || c === null) continue;
      const r = c as Record<string, unknown>;
      const role = ROLES.find((x) => x === r.role);
      if (typeof r.org_nr !== 'string' || !role) continue;
      const row: ScreeningRunCompany = { org_nr: r.org_nr, role };
      if (typeof r.name === 'string' && r.name) row.name = cap(r.name, 200);
      const rel = RELATIONS.find((x) => x === r.relation);
      if (rel) row.relation = rel;
      companies.push(row);
      if (companies.length >= SCREENING_RUN_MAX_COMPANIES) break;
    }
  }
  const th = typeof o.thresholds === 'object' && o.thresholds !== null ? (o.thresholds as Record<string, unknown>) : {};
  const summary: ScreeningRunSummary = {
    version: typeof o.version === 'number' ? o.version : SCREENING_RUN_SUMMARY_VERSION,
    state_aid: stateAid,
    vinnova,
    excellence,
    counts: {
      yes: numOrUndef(countsRaw.yes) ?? checks.filter((c) => c.verdict === 'yes').length,
      no: numOrUndef(countsRaw.no) ?? checks.filter((c) => c.verdict === 'no').length,
      unknown: numOrUndef(countsRaw.unknown) ?? checks.filter((c) => c.verdict === 'unknown').length
    },
    checks,
    missing: Array.isArray(o.missing) ? o.missing.filter((m): m is string => typeof m === 'string').map((m) => cap(m, 300)).slice(0, SCREENING_RUN_MAX_MISSING) : [],
    companies,
    thresholds: {
      employees: numOrUndef(th.employees),
      revenue_sek: numOrUndef(th.revenue_sek),
      balance_sheet_sek: numOrUndef(th.balance_sheet_sek),
      complete: th.complete === true
    }
  };
  if (typeof o.cost === 'object' && o.cost !== null) {
    const c = o.cost as Record<string, unknown>;
    summary.cost = { credits: numOrNull(c.credits), sek: numOrNull(c.sek), complete: c.complete === true };
  }
  return summary;
}

// ─── Diff ─────────────────────────────────────────────────────────────────

export type ScreeningRunChangeKind = 'outcome' | 'check' | 'missing_resolved' | 'missing_added' | 'company_added' | 'company_removed' | 'threshold';

export interface ScreeningRunChange {
  kind: ScreeningRunChangeKind;
  /** Läsbar rad ("Art. 22 GBER: Kan inte avgöras än → Art. 22 GBER möjlig"). */
  text: string;
  /** Riktning för färgsättning: bättre (okänt→ja, nej→ja), sämre (→nej) eller neutral. */
  tone: 'better' | 'worse' | 'neutral';
  from?: string;
  to?: string;
}

export interface ScreeningRunDiff {
  changes: ScreeningRunChange[];
  /** Antal punkter som gick från okänt till känt (ja/nej). */
  resolved: number;
  /** Antal punkter som gick från känt till okänt. */
  regressed: number;
}

const VERDICT_SV: Record<ScreeningVerdict, string> = { yes: 'Ja', no: 'Nej', unknown: 'Okänt' };

function verdictTone(from: ScreeningVerdict, to: ScreeningVerdict): ScreeningRunChange['tone'] {
  if (to === 'no') return 'worse';
  if (to === 'yes') return 'better';
  return from === 'unknown' ? 'neutral' : 'worse';
}

function outcomeTone(fromRank: number, toRank: number): ScreeningRunChange['tone'] {
  if (toRank === fromRank) return 'neutral';
  return toRank > fromRank ? 'better' : 'worse';
}

const STATE_AID_RANK: Record<StateAidOutcome, number> = { not_eligible: 0, undetermined: 1, de_minimis: 2, art22_possible: 3 };
const VINNOVA_RANK: Record<VinnovaOutcome, number> = { not_in_target: 0, undetermined: 1, in_target_possible: 2 };

function checkKey(c: ScreeningRunCheck): string {
  return `${c.scope}|${c.id}`;
}

function companyName(c: ScreeningRunCompany): string {
  return c.name || (/^\d{10}$/.test(c.org_nr) ? `${c.org_nr.slice(0, 6)}-${c.org_nr.slice(6)}` : c.org_nr);
}

function fmtInt(v?: number): string {
  return typeof v === 'number' ? v.toLocaleString('sv-SE') : '–';
}

/**
 * Vad ändrades mellan två körningar (föregående → denna). Utfall först,
 * sedan punkter vars utfall bytte, saknat underlag som tillkom/försvann,
 * bolag som kom in i/föll ur koncernen och tröskelvärdets tal.
 */
export function diffScreeningRuns(prev: ScreeningRunSummary, next: ScreeningRunSummary): ScreeningRunDiff {
  const changes: ScreeningRunChange[] = [];
  let resolved = 0;
  let regressed = 0;

  if (prev.state_aid !== next.state_aid) {
    changes.push({
      kind: 'outcome',
      text: `Statsstöd: ${STATE_AID_OUTCOME_LABEL[prev.state_aid]} → ${STATE_AID_OUTCOME_LABEL[next.state_aid]}`,
      tone: outcomeTone(STATE_AID_RANK[prev.state_aid], STATE_AID_RANK[next.state_aid]),
      from: STATE_AID_OUTCOME_LABEL[prev.state_aid],
      to: STATE_AID_OUTCOME_LABEL[next.state_aid]
    });
  }
  if (prev.vinnova !== next.vinnova) {
    changes.push({
      kind: 'outcome',
      text: `Vinnovas målgrupp: ${VINNOVA_OUTCOME_LABEL[prev.vinnova]} → ${VINNOVA_OUTCOME_LABEL[next.vinnova]}`,
      tone: outcomeTone(VINNOVA_RANK[prev.vinnova], VINNOVA_RANK[next.vinnova]),
      from: VINNOVA_OUTCOME_LABEL[prev.vinnova],
      to: VINNOVA_OUTCOME_LABEL[next.vinnova]
    });
  }
  if (prev.excellence !== next.excellence) {
    changes.push({
      kind: 'outcome',
      text: `Excellent inkubation: ${VERDICT_SV[prev.excellence]} → ${VERDICT_SV[next.excellence]}`,
      tone: verdictTone(prev.excellence, next.excellence),
      from: VERDICT_SV[prev.excellence],
      to: VERDICT_SV[next.excellence]
    });
  }

  const prevChecks = new Map(prev.checks.map((c) => [checkKey(c), c]));
  const nameByOrg = new Map<string, string>();
  for (const c of [...prev.companies, ...next.companies]) if (!nameByOrg.has(c.org_nr)) nameByOrg.set(c.org_nr, companyName(c));
  for (const c of next.checks) {
    const before = prevChecks.get(checkKey(c));
    if (!before || before.verdict === c.verdict) continue;
    if (before.verdict === 'unknown') resolved++;
    if (c.verdict === 'unknown') regressed++;
    const scope = c.scope ? `${nameByOrg.get(c.scope) ?? c.scope}: ` : '';
    changes.push({
      kind: 'check',
      text: `${scope}${c.label}: ${VERDICT_SV[before.verdict]} → ${VERDICT_SV[c.verdict]}${c.source !== before.source ? ` (källa: ${sourceLabel(c.source)})` : ''}`,
      tone: verdictTone(before.verdict, c.verdict),
      from: VERDICT_SV[before.verdict],
      to: VERDICT_SV[c.verdict]
    });
  }

  const prevMissing = new Set(prev.missing);
  const nextMissing = new Set(next.missing);
  for (const m of prev.missing) if (!nextMissing.has(m)) changes.push({ kind: 'missing_resolved', text: `Underlag på plats: ${m}`, tone: 'better' });
  for (const m of next.missing) if (!prevMissing.has(m)) changes.push({ kind: 'missing_added', text: `Nytt saknat underlag: ${m}`, tone: 'neutral' });

  const prevOrgs = new Set(prev.companies.map((c) => c.org_nr));
  const nextOrgs = new Set(next.companies.map((c) => c.org_nr));
  for (const c of next.companies) {
    if (!prevOrgs.has(c.org_nr)) changes.push({ kind: 'company_added', text: `Nytt bolag i koncernen: ${companyName(c)}`, tone: 'neutral' });
  }
  for (const c of prev.companies) {
    if (!nextOrgs.has(c.org_nr)) changes.push({ kind: 'company_removed', text: `Bolag inte längre med i koncernen: ${companyName(c)}`, tone: 'neutral' });
  }

  const t0 = prev.thresholds;
  const t1 = next.thresholds;
  if (t0.employees !== t1.employees || t0.revenue_sek !== t1.revenue_sek || t0.balance_sheet_sek !== t1.balance_sheet_sek || t0.complete !== t1.complete) {
    changes.push({
      kind: 'threshold',
      text: `Tröskelvärde (viktat): ${fmtInt(t0.employees)} anställda / ${fmtInt(t0.revenue_sek)} kr / ${fmtInt(t0.balance_sheet_sek)} kr${t0.complete ? '' : ' (ofullständigt)'} → ${fmtInt(t1.employees)} / ${fmtInt(t1.revenue_sek)} kr / ${fmtInt(t1.balance_sheet_sek)} kr${t1.complete ? '' : ' (ofullständigt)'}`,
      tone: !t0.complete && t1.complete ? 'better' : 'neutral'
    });
  }

  return { changes, resolved, regressed };
}

function sourceLabel(s: ScreeningSource): string {
  return s === 'register' ? 'bolagsregister' : s === 'platform' ? 'plattformen' : 'manuell kontroll';
}

/** En rad för listor: "Art. 22 GBER möjlig · Ingår sannolikt · 14 ja / 2 nej / 3 okänt". */
export function screeningRunHeadline(s: ScreeningRunSummary): string {
  return `${STATE_AID_OUTCOME_LABEL[s.state_aid]} · Vinnova: ${VINNOVA_OUTCOME_LABEL[s.vinnova]} · ${s.counts.yes} ja / ${s.counts.no} nej / ${s.counts.unknown} okänt`;
}
