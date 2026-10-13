import {
  MAX_GROUP_COMPANIES,
  MAX_RELATED_COMPANIES,
  type ExcellenceScreeningInput,
  type GroupCompanyFacts,
  type ScreeningBasic,
  type ScreeningFinancialsYear,
  type ScreeningFounderRow,
  type ScreeningGroupMember,
  type ScreeningIrl,
  type ScreeningOwnerKind,
  type ScreeningOwnershipEntry
} from '@platform/shared';
// Relativa importer: modulen är ren och körs i Node-testrunnern (ingen `@/`-alias där).
import { REGISTRY_PART_IDS, type RegistryPartId } from '../integrations/company-registry/parts';
import type { RegistryCostEstimate } from '../integrations/company-registry/pricing';
import type { ExcellenceAssessmentSubject } from './types';

// Bedömningens UNDERLAG som rundtur (§ 51.4). Ett registeruppslag kostar
// credits, så när controllern fyller i manuella svar efter en körning får
// bedömningen räknas om på SAMMA underlag utan nya anrop. Underlaget går
// därför med i resultatet till klienten och tillbaka i "Spara svar" — och
// eftersom det då är klientdata byggs det om fält för fält här (typ, enum,
// intervall, längd, antal) innan motorn ser det. Allt okänt släpps; ett
// trasigt underlag ger `null` (ny körning krävs), aldrig ett undantag.
// Innehållet är bara det vyn redan visade (fysiska personer utan namn) och
// hamnar i den inloggades egna Filer — ingen ny dataväg.

export const ASSESSMENT_CONTEXT_MAX_BYTES = 800_000;

export interface AssessmentContext {
  mode: 'register' | 'saved';
  providerName?: string;
  /** Leverantörens slug (register-läget) — för fler uppslag ur koncernkartan (§ 51.7). */
  providerSlug?: string;
  subject: ExcellenceAssessmentSubject;
  /** Motorns input utan referensdag (sätts vid omräkning) och utan manuella svar (kommer separat). */
  input: Omit<ExcellenceScreeningInput, 'refDate' | 'manual' | 'founders' | 'foundersSource'>;
  /** Grundare ur teamet på bolagskortet (`null` = bolaget finns inte i plattformen). */
  platformFounders: ScreeningFounderRow[] | null;
  financialsByOrg: Record<string, ScreeningFinancialsYear[]>;
  notes: Array<{ orgNr: string; name?: string; notes: string[] }>;
  lookupWarnings: string[];
  cost?: RegistryCostEstimate;
  /** Tidpunkten för den ursprungliga körningen (= referensdag). */
  assessedAt: string;
}

const OWNER_KINDS: ReadonlySet<string> = new Set(['company', 'person', 'public_body', 'investor', 'other']);
const PART_IDS: ReadonlySet<string> = new Set(REGISTRY_PART_IDS);

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function pct(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined || n < 0 || n > 100 ? undefined : n;
}

function orgNr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const digits = v.replace(/\D/g, '');
  return digits.length === 10 ? digits : undefined;
}

function isoDay(v: unknown): string | undefined {
  const s = str(v, 32);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
}

function isoStamp(v: unknown): string | undefined {
  const s = str(v, 40);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function basic(v: unknown): ScreeningBasic | undefined {
  const o = obj(v);
  if (!o) return undefined;
  const out: ScreeningBasic = {};
  const reg = isoDay(o.registeredAt);
  if (reg) out.registeredAt = reg;
  const status = str(o.bolagStatus, 40);
  if (status) out.bolagStatus = status;
  const form = str(o.bolagsform, 60);
  if (form) out.bolagsform = form;
  if (o.isPersonal === true) out.isPersonal = true;
  return out;
}

function financialsRows(v: unknown): ScreeningFinancialsYear[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const rows: ScreeningFinancialsYear[] = [];
  for (const r of v.slice(0, 40)) {
    const o = obj(r);
    const year = num(o?.year);
    if (!o || year === undefined || !Number.isInteger(year) || year < 1900 || year > 2200) continue;
    const row: ScreeningFinancialsYear = { year };
    for (const k of ['employees', 'revenue_sek', 'balance_sheet_sek', 'equity_sek', 'net_result_sek', 'dividend_sek'] as const) {
      const n = num(o[k]);
      if (n !== undefined) row[k] = n;
    }
    if (o.dividend_reported === true) row.dividend_reported = true;
    else delete row.dividend_sek;
    rows.push(row);
  }
  return rows;
}

function ownership(v: unknown): ScreeningOwnershipEntry[] {
  if (!Array.isArray(v)) return [];
  const out: ScreeningOwnershipEntry[] = [];
  for (const e of v.slice(0, 200)) {
    const o = obj(e);
    if (!o) continue;
    const kind = typeof o.owner_kind === 'string' && OWNER_KINDS.has(o.owner_kind) ? (o.owner_kind as ScreeningOwnerKind) : 'other';
    const entry: ScreeningOwnershipEntry = { direction: o.direction === 'holding' ? 'holding' : 'owner', owner_kind: kind };
    // Fysiska personer bär aldrig namn/org-nr (§ 11.8 GDPR) — tvingas här igen.
    // Huvudmannens namn följer bara med TRANSIENT (`person_name`, § 51.7):
    // samma session, samma skärm — aldrig PDF/historik/DB.
    if (kind !== 'person') {
      const name = str(o.name, 200);
      if (name) entry.name = name;
      const nr = orgNr(o.org_nr);
      if (nr) entry.org_nr = nr;
    } else {
      const pn = str(o.person_name, 120);
      if (pn) entry.person_name = pn;
    }
    const cap = pct(o.capital_pct);
    if (cap !== undefined) entry.capital_pct = cap;
    const vot = pct(o.voting_pct);
    if (vot !== undefined) entry.voting_pct = vot;
    const min = pct(o.pct_min);
    if (min !== undefined) entry.pct_min = min;
    const max = pct(o.pct_max);
    if (max !== undefined) entry.pct_max = max;
    const basis = str(o.control_basis, 20);
    if (basis && /^[a-z_]{1,20}$/.test(basis)) entry.control_basis = basis;
    if (o.indirect === true) entry.indirect = true;
    if (o.part === 'group_structure' || o.part === 'beneficial_owners') entry.part = o.part;
    out.push(entry);
  }
  return out;
}

function groupMembers(v: unknown): ScreeningGroupMember[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ScreeningGroupMember[] = [];
  for (const m of v.slice(0, MAX_GROUP_COMPANIES * 2)) {
    const o = obj(m);
    if (!o) continue;
    const member: ScreeningGroupMember = {};
    const nr = orgNr(o.org_nr);
    if (nr) member.org_nr = nr;
    const name = str(o.name, 200);
    if (name) member.name = name;
    if (!member.org_nr && !member.name) continue;
    const level = num(o.level);
    if (level !== undefined && Number.isInteger(level) && level >= 0 && level <= 20) member.level = level;
    const mother = orgNr(o.mother_org_nr);
    if (mother) member.mother_org_nr = mother;
    const motherName = str(o.mother_name, 200);
    if (motherName) member.mother_name = motherName;
    const owned = pct(o.owned_pct);
    if (owned !== undefined) member.owned_pct = owned;
    out.push(member);
  }
  return out;
}

function groupFacts(v: unknown): GroupCompanyFacts | null {
  const o = obj(v);
  if (!o) return null;
  const nr = orgNr(o.orgNr) ?? (o.orgNr === '' ? '' : undefined);
  if (nr === undefined) return null;
  const facts: GroupCompanyFacts = {
    orgNr: nr,
    name: str(o.name, 200),
    dataFetched: o.dataFetched === true,
    basic: basic(o.basic),
    financials: financialsRows(o.financials),
    ownership: ownership(o.ownership),
    groupStructureFetched: o.groupStructureFetched === true,
    beneficialOwnersFetched: o.beneficialOwnersFetched === true
  };
  const members = groupMembers(o.groupMembers);
  if (members) facts.groupMembers = members;
  const dm = obj(o.deMinimis);
  const used = num(dm?.usedEur);
  if (dm && used !== undefined && used >= 0 && (dm.source === 'platform' || dm.source === 'certificate')) {
    facts.deMinimis = { usedEur: used, source: dm.source };
    const note = str(dm.note, 600);
    if (note) facts.deMinimis.note = note;
  }
  return facts;
}

function founders(v: unknown): ScreeningFounderRow[] | null {
  if (v === null) return null;
  if (!Array.isArray(v)) return null;
  const out: ScreeningFounderRow[] = [];
  for (const f of v.slice(0, 50)) {
    const o = obj(f);
    const name = str(o?.name, 200);
    if (!o || !name) continue;
    const row: ScreeningFounderRow = { name };
    const eq = pct(o.equity_pct);
    if (eq !== undefined) row.equity_pct = eq;
    out.push(row);
  }
  return out;
}

function irl(v: unknown): ScreeningIrl | null {
  const o = obj(v);
  if (!o) return null;
  const lvl = (x: unknown) => {
    const n = num(x);
    return n === undefined ? null : n;
  };
  const out: ScreeningIrl = { level: lvl(o.level), crl: lvl(o.crl), brl: lvl(o.brl), tmrl: lvl(o.tmrl), srl: lvl(o.srl) };
  const at = isoDay(o.assessedAt);
  if (at) out.assessedAt = at;
  return out;
}

function cost(v: unknown): RegistryCostEstimate | undefined {
  const o = obj(v);
  if (!o) return undefined;
  const parts = Array.isArray(o.parts) ? (o.parts.filter((p) => typeof p === 'string' && PART_IDS.has(p)) as RegistryPartId[]) : [];
  const companies = num(o.companies);
  const calls = num(o.calls);
  if (companies === undefined || calls === undefined) return undefined;
  const unpriced = Array.isArray(o.unpricedParts)
    ? (o.unpricedParts.filter((p) => typeof p === 'string' && PART_IDS.has(p)) as RegistryPartId[])
    : [];
  return {
    companies: Math.max(0, Math.floor(companies)),
    parts,
    calls: Math.max(0, Math.floor(calls)),
    credits: num(o.credits) ?? null,
    sek: num(o.sek) ?? null,
    unpricedParts: unpriced,
    complete: o.complete === true
  };
}

/** Bygger underlaget till en JSON-sträng för rundturen (`<input type=hidden>`). */
export function serializeAssessmentContext(ctx: AssessmentContext): string {
  return JSON.stringify(ctx);
}

/**
 * Underlaget för LAGRING på bolagskortet (`startup_screenings.context`,
 * § 51.8): verklig huvudmans namn är transient (visas bara på skärmen,
 * § 51.7) och strippas ur varje ägarrad innan något persisteras.
 */
export function stripTransientNames(ctx: AssessmentContext): AssessmentContext {
  const strip = (c: GroupCompanyFacts): GroupCompanyFacts => ({
    ...c,
    ownership: c.ownership.map((o) => {
      if (!('person_name' in o)) return o;
      const { person_name: _n, ...rest } = o;
      void _n;
      return rest;
    })
  });
  return { ...ctx, input: { ...ctx.input, subject: strip(ctx.input.subject), related: ctx.input.related.map(strip) } };
}

/**
 * Tolkar underlaget från klienten. `null` ⇒ ogiltigt/för stort — bedömningen
 * måste köras om (inget räknas på ett underlag som inte kunde verifieras).
 */
export function parseAssessmentContext(json: string): AssessmentContext | null {
  if (typeof json !== 'string' || json.length === 0 || json.length > ASSESSMENT_CONTEXT_MAX_BYTES) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const o = obj(raw);
  if (!o) return null;
  const inputRaw = obj(o.input);
  const subjectRaw = obj(o.subject);
  if (!inputRaw || !subjectRaw) return null;
  const subjectFacts = groupFacts(inputRaw.subject);
  if (!subjectFacts) return null;
  const sekPerEur = num(inputRaw.sekPerEur);
  if (sekPerEur === undefined || sekPerEur <= 0) return null;
  const assessedAt = isoStamp(o.assessedAt);
  if (!assessedAt) return null;
  const subjectOrg = orgNr(subjectRaw.orgNr) ?? (subjectRaw.orgNr === '' ? '' : undefined);
  if (subjectOrg === undefined) return null;

  const related: GroupCompanyFacts[] = [];
  if (Array.isArray(inputRaw.related)) {
    for (const r of inputRaw.related.slice(0, MAX_RELATED_COMPANIES * 2)) {
      const g = groupFacts(r);
      if (g) related.push(g);
    }
  }

  const dmRaw = obj(inputRaw.deMinimis);
  const dmUsed = num(dmRaw?.usedEur);
  const dmCap = num(dmRaw?.capEur);
  const deMinimis = dmRaw && dmUsed !== undefined && dmCap !== undefined && dmUsed >= 0 && dmCap > 0 ? { usedEur: dmUsed, capEur: dmCap } : null;

  const financialsByOrg: Record<string, ScreeningFinancialsYear[]> = {};
  const fbo = obj(o.financialsByOrg);
  if (fbo) {
    for (const [k, v] of Object.entries(fbo).slice(0, MAX_RELATED_COMPANIES * 2 + 1)) {
      const nr = orgNr(k) ?? (k === '' ? '' : undefined);
      if (nr === undefined) continue;
      financialsByOrg[nr] = financialsRows(v) ?? [];
    }
  }

  const notes: AssessmentContext['notes'] = [];
  if (Array.isArray(o.notes)) {
    for (const n of o.notes.slice(0, MAX_RELATED_COMPANIES * 2 + 1)) {
      const no = obj(n);
      const nr = orgNr(no?.orgNr) ?? (no?.orgNr === '' ? '' : undefined);
      if (!no || nr === undefined) continue;
      const list = Array.isArray(no.notes) ? no.notes.map((t) => str(t, 600)).filter((t): t is string => !!t).slice(0, 60) : [];
      notes.push({ orgNr: nr, name: str(no.name, 200), notes: list });
    }
  }
  const lookupWarnings = Array.isArray(o.lookupWarnings)
    ? o.lookupWarnings.map((t) => str(t, 400)).filter((t): t is string => !!t).slice(0, 30)
    : [];

  const subject: ExcellenceAssessmentSubject = { orgNr: subjectOrg };
  const sName = str(subjectRaw.name, 200);
  if (sName) subject.name = sName;
  const sid = str(subjectRaw.startupId, 30);
  if (sid && /^[a-z0-9]{1,30}$/i.test(sid)) subject.startupId = sid;
  for (const k of ['bolagsform', 'kommun', 'industri', 'bolagStatus'] as const) {
    const s = str(subjectRaw[k], 200);
    if (s) subject[k] = s;
  }
  const reg = isoDay(subjectRaw.registeredAt);
  if (reg) subject.registeredAt = reg;

  return {
    mode: o.mode === 'register' ? 'register' : 'saved',
    providerName: str(o.providerName, 60),
    ...(() => {
      const v = str(o.providerSlug, 40);
      return v && /^[a-z0-9_-]+$/.test(v) ? { providerSlug: v } : {};
    })(),
    subject,
    input: {
      subject: subjectFacts,
      related,
      deMinimis,
      irl: irl(inputRaw.irl),
      meetsExcellenceFlag: typeof inputRaw.meetsExcellenceFlag === 'boolean' ? inputRaw.meetsExcellenceFlag : undefined,
      sekPerEur
    },
    platformFounders: founders(o.platformFounders),
    financialsByOrg,
    notes,
    lookupWarnings,
    cost: cost(o.cost),
    assessedAt
  };
}
