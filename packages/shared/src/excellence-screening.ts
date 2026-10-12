// Bedömning excellens — deterministisk förscreening av ett startup-bolag OCH
// dess koncern mot art. 22 GBER / de minimis och Vinnovas målgrupp
// (CLAUDE.md § 51, docs/ai/vinnova-statsstod-screening-agent.md). Följer
// Challes "Ny tankemodell för SMF-stöd samt excellens" (Bizmaker-kartan) och
// ger utdata i samma avsnittsordning som referensbedömningen "Bedömning
// Vinnova Combly".
//
// REN modul: ingen IO, ingen AI. Regelträdet appliceras på de fakta som
// finns — registerdata (Roaring/Bolagsverket) för startup-bolaget och varje
// anknutet/partnerföretag, och för portföljbolag det som redan finns i
// plattformen (grundarägande, de minimis, IRL, flaggor). Varje punkt får
// JA / NEJ / OKÄNT med motivering och källa; OKÄNT när underlaget saknas —
// vi gissar aldrig. Resultatet är ett UNDERLAG som controllern granskar;
// beslutet (statsstödsgrund, excellens) fattas alltid av en människa.

export type ScreeningVerdict = 'yes' | 'no' | 'unknown';

/** Var faktumet kommer ifrån: bolagsregistret, plattformens egna data eller manuell kontroll. */
export type ScreeningSource = 'register' | 'platform' | 'manual';

export type ScreeningOwnerKind = 'company' | 'person' | 'public_body' | 'investor' | 'other';

export interface ScreeningOwnershipEntry {
  direction: 'owner' | 'holding';
  owner_kind: ScreeningOwnerKind;
  name?: string;
  org_nr?: string;
  capital_pct?: number;
  voting_pct?: number;
  pct_min?: number;
  pct_max?: number;
  /** Fast vokabulär: shares | votes | board | agreement | other. */
  control_basis?: string;
  indirect?: boolean;
  /** Vilken datadel raden kom ur (koncernstruktur / verklig huvudman), när känt. */
  part?: 'group_structure' | 'beneficial_owners';
}

export interface ScreeningFinancialsYear {
  year: number;
  employees?: number;
  revenue_sek?: number;
  balance_sheet_sek?: number;
  equity_sek?: number;
  net_result_sek?: number;
}

export interface ScreeningBasic {
  registeredAt?: string;
  bolagStatus?: string;
  bolagsform?: string;
  isPersonal?: boolean;
}

/** Bilaga I-relation mellan startup-bolaget och ett annat företag. */
export type ScreeningRelation = 'linked' | 'partner' | 'exempt' | 'uncertain';

export interface RelatedCompanyRef {
  name?: string;
  org_nr?: string;
  direction: 'owner' | 'holding';
  relation: ScreeningRelation;
  /** Andelen i procent (högsta av kapital/röster, intervallets max) — partnerns proportion. */
  sharePct?: number;
  shareLabel: string;
  reason: string;
  indirect?: boolean;
}

/** Ett bolag i koncernen med den data som hämtats för det. */
export interface GroupCompanyFacts {
  orgNr: string;
  name?: string;
  /** Sant när ett uppslag/sparad data finns för bolaget (annars bara referensen). */
  dataFetched: boolean;
  /** `undefined` ⇒ grunddata hämtades inte. */
  basic?: ScreeningBasic;
  /** `undefined` ⇒ bokslut hämtades inte. Tom lista ⇒ hämtat men inga årsrader. */
  financials?: ScreeningFinancialsYear[];
  ownership: ScreeningOwnershipEntry[];
  groupStructureFetched: boolean;
  beneficialOwnersFetched: boolean;
}

export interface ScreeningFounderRow {
  name: string;
  equity_pct?: number;
}

export interface ScreeningIrl {
  level?: number | null;
  crl?: number | null;
  brl?: number | null;
  tmrl?: number | null;
  srl?: number | null;
  assessedAt?: string;
}

export interface ExcellenceScreeningInput {
  /** Referensdag (idag) — styr åldersgränsen. */
  refDate: Date;
  subject: GroupCompanyFacts;
  /** Anknutna/partnerföretag med den data som hämtats (matchas på org-nr). */
  related: GroupCompanyFacts[];
  /** Grundare ur bolagets team (bara portföljbolag). `undefined` = bolaget finns inte i plattformen. */
  founders?: ScreeningFounderRow[];
  /** Registrerat de minimis-stöd (bara portföljbolag). */
  deMinimis?: { usedEur: number; capEur: number } | null;
  irl?: ScreeningIrl | null;
  meetsExcellenceFlag?: boolean;
  /** SEK per EUR för tröskelvärdena. */
  sekPerEur: number;
}

export interface ScreeningCheck {
  id: string;
  label: string;
  verdict: ScreeningVerdict;
  detail: string;
  source: ScreeningSource;
  /** Vad som behövs för att avgöra punkten (bara när verdict = unknown). */
  needs?: string;
}

export interface ThresholdRow {
  orgNr: string;
  name?: string;
  role: 'subject' | 'linked' | 'partner';
  /** 1 för startup + anknutna, partnerns andel/100 för partner. */
  weight: number;
  year?: number;
  employees?: number;
  revenue_sek?: number;
  balance_sheet_sek?: number;
  /** Bokslut hämtat men utan rader (nystartat), eller inte hämtat alls. */
  note?: string;
}

export interface CompanyAssessment {
  orgNr: string;
  name?: string;
  role: 'subject' | 'linked' | 'partner';
  relation?: ScreeningRelation;
  relationLabel?: string;
  shareLabel?: string;
  reason?: string;
  indirect?: boolean;
  dataFetched: boolean;
  basic?: ScreeningBasic;
  /** Grundförutsättningarna i Comblys ordning: ekonomisk verksamhet, < 5 år, börsnoterat, utdelning, koncentration, övertagit verksamhet. */
  conditions: ScreeningCheck[];
  /** Ägarbilden för bolaget (bara `owner`-rader). */
  owners: ScreeningOwnershipEntry[];
  holdings: ScreeningOwnershipEntry[];
}

export type StateAidOutcome = 'art22_possible' | 'de_minimis' | 'not_eligible' | 'undetermined';
export type VinnovaOutcome = 'in_target_possible' | 'not_in_target' | 'undetermined';

export interface ExcellenceScreeningResult {
  /** Startup-bolaget först, sedan anknutna/partnerföretag. */
  companies: CompanyAssessment[];
  /** Fristående företag? */
  standalone: ScreeningCheck;
  thresholds: {
    rows: ThresholdRow[];
    combined: { employees?: number; revenue_sek?: number; balance_sheet_sek?: number; complete: boolean };
    check: ScreeningCheck;
  };
  deMinimis: ScreeningCheck;
  stateAid: { outcome: StateAidOutcome; text: string };
  /** Steg 2 — Vinnovas målgrupp, i Comblys ordning. */
  vinnovaChecks: ScreeningCheck[];
  vinnova: { outcome: VinnovaOutcome; text: string };
  irl: ScreeningIrl | null;
  excellence: ScreeningCheck;
  /** Underlag som saknas — en rad per OKÄNT-punkt (dedupe). */
  missing: string[];
  /** Alla punkter platt (för räkning). */
  checks: ScreeningCheck[];
}

export const SCREENING_MAX_AGE_YEARS = 5;
export const SME_MAX_EMPLOYEES = 50;
export const SME_MAX_EUR = 10_000_000;
export const PARTNER_THRESHOLD_PCT = 25;
export const LINKED_THRESHOLD_PCT = 50;
export const FOUNDER_OWNERSHIP_MIN_PCT = 75;
export const MAX_RELATED_COMPANIES = 6;

export const STATE_AID_OUTCOME_LABEL: Record<StateAidOutcome, string> = {
  art22_possible: 'Art. 22 GBER möjlig',
  de_minimis: 'De minimis',
  not_eligible: 'Inget företagsstöd',
  undetermined: 'Kan inte avgöras än'
};

export const VINNOVA_OUTCOME_LABEL: Record<VinnovaOutcome, string> = {
  in_target_possible: 'Ingår sannolikt',
  not_in_target: 'Ingår inte',
  undetermined: 'Kan inte avgöras än'
};

export const RELATION_LABEL: Record<ScreeningRelation, string> = {
  linked: 'Anknutet företag',
  partner: 'Partnerföretag',
  exempt: 'Undantagen investerare',
  uncertain: 'Oklar relation'
};

// ─── Hjälpare ────────────────────────────────────────────────────────────────

function parseIsoDate(v: string | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addYears(d: Date, years: number): Date {
  const out = new Date(d.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + years);
  // 29 feb + 5 år → 1 mar; klampa till sista februari.
  if (out.getUTCDate() !== d.getUTCDate()) out.setUTCDate(0);
  return out;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Hela år + månader mellan två datum ("3 år och 6 mån"). */
export function describeCompanyAge(from: Date, to: Date): string {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  if (months < 0) months = 0;
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mån`;
  return m === 0 ? `${y} år` : `${y} år och ${m} mån`;
}

function formatPct(v: number): string {
  return `${Number.isInteger(v) ? v : v.toLocaleString('sv-SE', { maximumFractionDigits: 2 })} %`;
}

function formatMillionEur(sek: number, sekPerEur: number): string {
  const eur = sek / sekPerEur;
  return `${(eur / 1_000_000).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} M€`;
}

function fmtInt(v: number): string {
  return Math.round(v).toLocaleString('sv-SE');
}

/**
 * Andelen som ett intervall [min, max]. Exakt kapital-/röstandel vinner
 * (den högsta av de två — bilaga I räknar kapital ELLER röster). Saknas allt
 * returneras null.
 */
export function ownershipShareRange(e: ScreeningOwnershipEntry): { min: number; max: number } | null {
  const exact = [e.capital_pct, e.voting_pct].filter((v): v is number => typeof v === 'number');
  if (exact.length > 0) {
    const v = Math.max(...exact);
    return { min: v, max: v };
  }
  if (typeof e.pct_min === 'number' || typeof e.pct_max === 'number') {
    const min = typeof e.pct_min === 'number' ? e.pct_min : 0;
    const max = typeof e.pct_max === 'number' ? e.pct_max : 100;
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }
  return null;
}

export function shareLabel(range: { min: number; max: number } | null): string {
  if (!range) return 'andel okänd';
  return range.min === range.max ? formatPct(range.min) : `${range.min}–${range.max} %`;
}

const EXEMPT_KINDS: ReadonlySet<ScreeningOwnerKind> = new Set(['public_body', 'investor']);

/**
 * Klassar EN ägar-/innehavsrad mot bilaga I (SMF-definitionen). Fysiska
 * personer klassas inte här — de gör bolaget anknutet bara via andra bolag de
 * kontrollerar, vilket registret inte visar (egen kontrollpunkt).
 */
export function classifyOwnershipEntry(
  e: ScreeningOwnershipEntry
): { relation: ScreeningRelation | 'none'; reason: string } {
  if (e.owner_kind === 'person') return { relation: 'none', reason: 'Fysisk person.' };
  const range = ownershipShareRange(e);
  const controlByInfluence = e.control_basis === 'board' || e.control_basis === 'agreement';
  const exempt = e.direction === 'owner' && EXEMPT_KINDS.has(e.owner_kind);

  if (controlByInfluence) {
    return {
      relation: 'linked',
      reason:
        e.control_basis === 'board'
          ? 'Rätt att utse/avsätta en majoritet av lednings- eller kontrollorganen.'
          : 'Bestämmande inflytande via avtal eller stadgar.'
    };
  }
  if (!range) {
    return { relation: 'uncertain', reason: 'Registret anger ingen andel — kontrollera i aktieboken.' };
  }
  if (range.min > LINKED_THRESHOLD_PCT) {
    return { relation: 'linked', reason: 'Kontrollerar mer än 50 % av kapitalet eller rösterna.' };
  }
  if (range.max < PARTNER_THRESHOLD_PCT) {
    return { relation: 'none', reason: 'Under 25 %.' };
  }
  if (range.min >= PARTNER_THRESHOLD_PCT && range.max <= LINKED_THRESHOLD_PCT) {
    return exempt
      ? {
          relation: 'exempt',
          reason: 'Undantagen investerare (offentlig aktör/VC/affärsängel) med 25–50 % — bryter inte fristående.'
        }
      : { relation: 'partner', reason: '25–50 % av kapital eller röster ⇒ partnerföretag.' };
  }
  return {
    relation: 'uncertain',
    reason: 'Intervallet korsar en tröskel (25 % eller 50 %) — kontrollera exakt andel i aktieboken.'
  };
}

/**
 * Anknutna, partner- och oklara företag ur startup-bolagets ägarbild (en rad
 * per org-nr; den starkaste relationen vinner). Används av servern för att
 * veta vilka bolag som ska slås upp och av regelträdet för klassningen.
 */
export function deriveRelatedCompanies(ownership: ScreeningOwnershipEntry[]): RelatedCompanyRef[] {
  const rank: Record<ScreeningRelation, number> = { linked: 3, partner: 2, uncertain: 1, exempt: 0 };
  const out = new Map<string, RelatedCompanyRef>();
  let anon = 0;
  for (const e of ownership) {
    const c = classifyOwnershipEntry(e);
    if (c.relation === 'none') continue;
    const range = ownershipShareRange(e);
    const ref: RelatedCompanyRef = {
      name: e.name,
      org_nr: e.org_nr,
      direction: e.direction,
      relation: c.relation,
      sharePct: range ? range.max : undefined,
      shareLabel: shareLabel(range),
      reason: c.reason,
      indirect: e.indirect === true
    };
    const key = e.org_nr || e.name || `anon-${anon++}`;
    const prev = out.get(key);
    if (!prev || rank[ref.relation] > rank[prev.relation]) out.set(key, ref);
  }
  return [...out.values()];
}

function latestFinancials(rows: ScreeningFinancialsYear[]): ScreeningFinancialsYear | null {
  const usable = rows.filter(
    (r) =>
      typeof r.employees === 'number' ||
      typeof r.revenue_sek === 'number' ||
      typeof r.balance_sheet_sek === 'number' ||
      typeof r.equity_sek === 'number'
  );
  if (usable.length === 0) return null;
  return usable.reduce((a, b) => (b.year > a.year ? b : a));
}

// ─── Grundförutsättningar per bolag ─────────────────────────────────────────

function conditionsFor(c: GroupCompanyFacts, ref: Date): ScreeningCheck[] {
  const checks: ScreeningCheck[] = [];
  const b = c.basic;
  const noData = !c.dataFetched;
  checks.push({
    id: 'economic',
    label: 'Ekonomisk verksamhet',
    verdict: b?.bolagStatus ? (b.bolagStatus === 'aktiv' ? 'yes' : 'no') : 'unknown',
    detail: b?.bolagStatus
      ? `Status i registret: ${b.bolagStatus}.`
      : noData
        ? 'Inget uppslag gjort för bolaget.'
        : 'Status saknas i svaret.',
    source: 'register',
    needs: b?.bolagStatus ? undefined : 'Bolagsstatus (registerutdrag).'
  });

  const registered = parseIsoDate(b?.registeredAt);
  if (!registered) {
    checks.push({
      id: 'age',
      label: 'Yngre än 5 år',
      verdict: 'unknown',
      detail: noData ? 'Inget uppslag gjort för bolaget.' : !b ? 'Grunddata hämtades inte.' : 'Registreringsdatum saknas i svaret.',
      source: 'register',
      needs: 'Registreringsdatum (registerutdrag).'
    });
  } else {
    const fifth = addYears(registered, SCREENING_MAX_AGE_YEARS);
    const young = ref.getTime() < fifth.getTime();
    checks.push({
      id: 'age',
      label: 'Yngre än 5 år',
      verdict: young ? 'yes' : 'no',
      detail: young
        ? `Registrerat ${isoDay(registered)} (${describeCompanyAge(registered, ref)}) — fyller 5 år ${isoDay(fifth)}.`
        : `Registrerat ${isoDay(registered)} (${describeCompanyAge(registered, ref)}) — passerade 5 år ${isoDay(fifth)}.`,
      source: 'register'
    });
  }

  for (const [id, label, needs] of [
    ['listed', 'Inte börsnoterat', 'Bolagsordning/ägarförteckning.'],
    ['dividend', 'Har inte beslutat om eller delat ut vinst', 'Årsredovisning och bolagets intyg.'],
    ['concentration', 'Inte bildat genom företagskoncentration', 'Bolagets intyg (undantag kan finnas).'],
    ['takeover', 'Har inte övertagit annat företags verksamhet (ombildad enskild firma undantas)', 'Bolagets intyg.']
  ] as const) {
    checks.push({
      id,
      label,
      verdict: 'unknown',
      detail: 'Finns inte i bolagsregistret — bekräftas av bolaget.',
      source: 'manual',
      needs
    });
  }
  return checks;
}

// ─── Regelträdet ─────────────────────────────────────────────────────────────

export function screenExcellence(input: ExcellenceScreeningInput): ExcellenceScreeningResult {
  const ref = input.refDate;
  const subject = input.subject;
  const all: ScreeningCheck[] = [];
  const push = (c: ScreeningCheck) => {
    all.push(c);
    return c;
  };

  // Startup-bolaget
  const subjectConditions = conditionsFor(subject, ref).map(push);
  const companies: CompanyAssessment[] = [
    {
      orgNr: subject.orgNr,
      name: subject.name,
      role: 'subject',
      dataFetched: subject.dataFetched,
      basic: subject.basic,
      conditions: subjectConditions,
      owners: subject.ownership.filter((o) => o.direction === 'owner'),
      holdings: subject.ownership.filter((o) => o.direction === 'holding')
    }
  ];

  // Anknutna / partner / oklara ur ägarbilden
  const refs = subject.basic?.isPersonal ? [] : deriveRelatedCompanies(subject.ownership);
  const factsByOrg = new Map(input.related.map((r) => [r.orgNr, r]));
  const linkedRefs = refs.filter((r) => r.relation === 'linked');
  const partnerRefs = refs.filter((r) => r.relation === 'partner');
  const uncertainRefs = refs.filter((r) => r.relation === 'uncertain');

  for (const r of refs) {
    if (r.relation === 'exempt') continue;
    const facts = r.org_nr ? factsByOrg.get(r.org_nr) : undefined;
    const base: GroupCompanyFacts = facts ?? {
      orgNr: r.org_nr ?? '',
      name: r.name,
      dataFetched: false,
      ownership: [],
      groupStructureFetched: false,
      beneficialOwnersFetched: false
    };
    const conditions = r.relation === 'linked' ? conditionsFor(base, ref).map(push) : [];
    companies.push({
      orgNr: base.orgNr,
      name: facts?.name ?? r.name,
      role: r.relation === 'linked' ? 'linked' : 'partner',
      relation: r.relation,
      relationLabel: RELATION_LABEL[r.relation],
      shareLabel: r.shareLabel,
      reason: r.reason,
      indirect: r.indirect,
      dataFetched: base.dataFetched,
      basic: base.basic,
      conditions,
      owners: base.ownership.filter((o) => o.direction === 'owner'),
      holdings: base.ownership.filter((o) => o.direction === 'holding')
    });
  }

  const describe = (list: RelatedCompanyRef[]) =>
    list
      .map((r) => `${r.name || r.org_nr || 'okänt bolag'} (${r.direction === 'owner' ? 'äger' : 'ägs'} ${r.shareLabel})`)
      .join(', ');

  // Fristående företag?
  let standalone: ScreeningCheck;
  if (subject.basic?.isPersonal) {
    standalone = {
      id: 'standalone',
      label: 'Fristående företag',
      verdict: 'unknown',
      detail: 'Enskild firma — ägaren är en fysisk person; ägarbild hämtas inte.',
      source: 'manual',
      needs: 'Uppgift om vilka andra företag innehavaren kontrollerar.'
    };
  } else if (linkedRefs.length > 0) {
    standalone = {
      id: 'standalone',
      label: 'Fristående företag',
      verdict: 'no',
      detail: `Finns anknutet företag: ${describe(linkedRefs)}. 100 % av det anknutna bolagets uppgifter läggs till och grundförutsättningarna prövas även för det.`,
      source: 'register'
    };
  } else if (partnerRefs.length > 0) {
    standalone = {
      id: 'standalone',
      label: 'Fristående företag',
      verdict: 'no',
      detail: `Finns partnerföretag: ${describe(partnerRefs)}. Den proportionella andelen av partnerns uppgifter läggs till.`,
      source: 'register'
    };
  } else if (!subject.groupStructureFetched) {
    standalone = {
      id: 'standalone',
      label: 'Fristående företag',
      verdict: 'unknown',
      detail: 'Koncernstrukturen hämtades inte.',
      source: 'register',
      needs: 'Hämta koncernstruktur (moder-/dotterbolag).'
    };
  } else if (uncertainRefs.length > 0) {
    standalone = {
      id: 'standalone',
      label: 'Fristående företag',
      verdict: 'unknown',
      detail: `Andelen kan inte avgöras för: ${describe(uncertainRefs)}.`,
      source: 'register',
      needs: 'Exakt kapital-/röstandel ur aktieboken.'
    };
  } else {
    // Koncernregistret visar bara majoritetsrelationer. "Inga partners" kan
    // bara bevisas när direkta personägare tillsammans har mer än 75 %.
    const directPersonMin = subject.ownership
      .filter(
        (e) =>
          e.direction === 'owner' &&
          e.owner_kind === 'person' &&
          e.indirect !== true &&
          (e.control_basis === undefined || e.control_basis === 'shares')
      )
      .reduce((sum, e) => sum + (ownershipShareRange(e)?.min ?? 0), 0);
    standalone =
      subject.beneficialOwnersFetched && directPersonMin > 100 - PARTNER_THRESHOLD_PCT
        ? {
            id: 'standalone',
            label: 'Fristående företag',
            verdict: 'yes',
            detail: `Inget moder-/dotterbolag i koncernregistret, och fysiska personer äger direkt minst ${formatPct(directPersonMin)} — det ryms ingen bolagsägare med 25 % eller mer. Kontrollera att ingen ägare är knuten till annat företag på samma marknad.`,
            source: 'register'
          }
        : {
            id: 'standalone',
            label: 'Fristående företag',
            verdict: 'unknown',
            detail:
              'Inget moder-/dotterbolag i koncernregistret, men minoritetsägande bolag (25–50 %) och bolagets egna innehav under 50 % syns inte där.',
            source: 'manual',
            needs: 'Aktiebok (ägare med 25–50 %) och bolagets egna innehav i andra bolag.'
          };
  }
  push(standalone);

  // Tröskelvärden — startup + 100 % anknutna + partnerns andel
  const rows: ThresholdRow[] = [];
  const rowFor = (c: GroupCompanyFacts, role: ThresholdRow['role'], weight: number): ThresholdRow => {
    const fin = c.financials ? latestFinancials(c.financials) : null;
    return {
      orgNr: c.orgNr,
      name: c.name,
      role,
      weight,
      year: fin?.year,
      employees: fin?.employees,
      revenue_sek: fin?.revenue_sek,
      balance_sheet_sek: fin?.balance_sheet_sek,
      note: !c.dataFetched
        ? 'Inget uppslag'
        : !c.financials
          ? 'Bokslut hämtades inte'
          : !fin
            ? 'Inget bokslut i registret (nystartat?)'
            : undefined
    };
  };
  rows.push(rowFor(subject, 'subject', 1));
  for (const r of linkedRefs) {
    const facts = r.org_nr ? factsByOrg.get(r.org_nr) : undefined;
    rows.push(
      rowFor(
        facts ?? { orgNr: r.org_nr ?? '', name: r.name, dataFetched: false, ownership: [], groupStructureFetched: false, beneficialOwnersFetched: false },
        'linked',
        1
      )
    );
  }
  for (const r of partnerRefs) {
    const facts = r.org_nr ? factsByOrg.get(r.org_nr) : undefined;
    rows.push(
      rowFor(
        facts ?? { orgNr: r.org_nr ?? '', name: r.name, dataFetched: false, ownership: [], groupStructureFetched: false, beneficialOwnersFetched: false },
        'partner',
        (r.sharePct ?? 100) / 100
      )
    );
  }
  const sumField = (f: 'employees' | 'revenue_sek' | 'balance_sheet_sek') => {
    let total = 0;
    let any = false;
    let complete = true;
    for (const row of rows) {
      const v = row[f];
      if (typeof v === 'number') {
        total += v * row.weight;
        any = true;
      } else complete = false;
    }
    return { value: any ? total : undefined, complete };
  };
  const emp = sumField('employees');
  const rev = sumField('revenue_sek');
  const bal = sumField('balance_sheet_sek');
  const capSek = SME_MAX_EUR * input.sekPerEur;
  const allRowsComplete = emp.complete && (rev.complete || bal.complete);
  let thresholdCheck: ScreeningCheck;
  const parts: string[] = [];
  if (emp.value !== undefined) parts.push(`${fmtInt(emp.value)} anställda`);
  if (rev.value !== undefined) parts.push(`omsättning ${formatMillionEur(rev.value, input.sekPerEur)}`);
  if (bal.value !== undefined) parts.push(`balansomslutning ${formatMillionEur(bal.value, input.sekPerEur)}`);
  const basis = parts.length > 0 ? `Sammanlagt: ${parts.join(', ')}.` : 'Inga tal i underlaget.';
  const moneyOk =
    (rev.value !== undefined && rev.value <= capSek) || (bal.value !== undefined && bal.value <= capSek);
  const moneyFail =
    rev.value !== undefined && bal.value !== undefined && rev.value > capSek && bal.value > capSek;
  if (emp.value !== undefined && emp.value >= SME_MAX_EMPLOYEES) {
    thresholdCheck = {
      id: 'thresholds',
      label: 'Klarar tröskelvärdet för småföretag (< 50 anställda, ≤ 10 M€ omsättning eller balansomslutning)',
      verdict: 'no',
      detail: `${basis} 50 anställda eller fler.`,
      source: 'register'
    };
  } else if (moneyFail) {
    thresholdCheck = {
      id: 'thresholds',
      label: 'Klarar tröskelvärdet för småföretag (< 50 anställda, ≤ 10 M€ omsättning eller balansomslutning)',
      verdict: 'no',
      detail: `${basis} Både omsättning och balansomslutning över 10 M€.`,
      source: 'register'
    };
  } else if (emp.value !== undefined && moneyOk && allRowsComplete) {
    thresholdCheck = {
      id: 'thresholds',
      label: 'Klarar tröskelvärdet för småföretag (< 50 anställda, ≤ 10 M€ omsättning eller balansomslutning)',
      verdict: 'yes',
      detail: basis,
      source: 'register'
    };
  } else {
    const missingRows = rows.filter((r) => r.note).map((r) => `${r.name || r.orgNr}: ${r.note}`);
    thresholdCheck = {
      id: 'thresholds',
      label: 'Klarar tröskelvärdet för småföretag (< 50 anställda, ≤ 10 M€ omsättning eller balansomslutning)',
      verdict: 'unknown',
      detail:
        missingRows.length > 0
          ? `${basis} Saknas: ${missingRows.join('; ')}.`
          : `${basis} Anställda eller omsättning/balansomslutning saknas för något bolag.`,
      source: 'register',
      needs: 'Senaste bokslut (anställda, omsättning, balansomslutning) för varje bolag i koncernen — eller bolagets egna uppgifter när inget bokslut finns.'
    };
  }
  push(thresholdCheck);

  // De minimis-intyg
  let deMinimis: ScreeningCheck;
  if (input.deMinimis) {
    const remaining = input.deMinimis.capEur - input.deMinimis.usedEur;
    deMinimis = {
      id: 'de_minimis',
      label: 'Intyg: mindre än 300 000 € de minimis innevarande år + två år bakåt (inkl. anknutna företag)',
      verdict: remaining > 0 ? 'yes' : 'no',
      detail: `Registrerat i plattformen: ${fmtInt(input.deMinimis.usedEur)} € — kvar ${fmtInt(Math.max(0, remaining))} €. Anknutna företags stöd ingår inte; intyg från bolaget krävs.`,
      source: 'platform',
      needs: linkedRefs.length > 0 ? 'Intyg om de minimis-stöd till de anknutna bolagen.' : undefined
    };
  } else {
    deMinimis = {
      id: 'de_minimis',
      label: 'Intyg: mindre än 300 000 € de minimis innevarande år + två år bakåt (inkl. anknutna företag)',
      verdict: 'unknown',
      detail: 'Inget registrerat stöd i plattformen för bolaget.',
      source: 'manual',
      needs: 'Intyg om mottaget de minimis-stöd (innevarande + två år bakåt, inkl. anknutna företag).'
    };
  }
  push(deMinimis);

  // Sammanfattande bedömning art. 22 GBER
  const v = (list: ScreeningCheck[], id: string) => list.find((c) => c.id === id)?.verdict ?? 'unknown';
  const reasonsNo: string[] = [];
  if (v(subjectConditions, 'age') === 'no') reasonsNo.push(`${subject.name || 'startup-bolaget'} är äldre än 5 år`);
  if (v(subjectConditions, 'economic') === 'no') reasonsNo.push(`${subject.name || 'startup-bolaget'} är inte aktivt`);
  for (const c of companies) {
    if (c.role !== 'linked') continue;
    if (v(c.conditions, 'age') === 'no') reasonsNo.push(`anknutna ${c.name || c.orgNr} är äldre än 5 år`);
    if (v(c.conditions, 'economic') === 'no') reasonsNo.push(`anknutna ${c.name || c.orgNr} är inte aktivt`);
  }
  if (thresholdCheck.verdict === 'no') reasonsNo.push('koncernen överskrider tröskelvärdet för småföretag');

  const linkedUnknownAge = companies.some((c) => c.role === 'linked' && v(c.conditions, 'age') === 'unknown');
  const subjectName = subject.name || 'Startup-bolaget';
  let stateAid: ExcellenceScreeningResult['stateAid'];
  if (reasonsNo.length > 0) {
    stateAid =
      deMinimis.verdict === 'no'
        ? {
            outcome: 'not_eligible',
            text: `${subjectName} uppfyller inte kraven för art. 22 GBER (${reasonsNo.join('; ')}) och de minimis-utrymmet är förbrukat.`
          }
        : {
            outcome: 'de_minimis',
            text: `${subjectName} kan få företagsstöd men uppfyller inte kraven för art. 22 GBER (${reasonsNo.join('; ')}). Bolaget får ta emot stöd av mindre betydelse — de minimis — mot intyg.`
          };
  } else if (
    v(subjectConditions, 'age') === 'yes' &&
    v(subjectConditions, 'economic') === 'yes' &&
    standalone.verdict !== 'unknown' &&
    !linkedUnknownAge &&
    thresholdCheck.verdict === 'yes'
  ) {
    stateAid = {
      outcome: 'art22_possible',
      text: `${subjectName} kan uppfylla kraven för art. 22 GBER — förutsatt de manuella kontrollerna (börsnotering, vinstutdelning, företagskoncentration, övertagen verksamhet${standalone.verdict === 'yes' ? '' : ' och partnerföretagens andel'}).`
    };
  } else {
    const open: string[] = [];
    if (v(subjectConditions, 'age') === 'unknown') open.push('ålder');
    if (v(subjectConditions, 'economic') === 'unknown') open.push('status');
    if (standalone.verdict === 'unknown') open.push('ägarbild');
    if (linkedUnknownAge) open.push('anknutna bolags ålder');
    if (thresholdCheck.verdict === 'unknown') open.push('tröskelvärden');
    stateAid = { outcome: 'undetermined', text: `Underlag saknas för: ${open.join(', ')}.` };
  }

  // Steg 2 — Vinnovas målgrupp
  const vinnovaChecks: ScreeningCheck[] = [];
  const founders = input.founders;
  if (founders === undefined) {
    vinnovaChecks.push({
      id: 'founders_75',
      label: 'Grundarteamet äger minst 75 % av startup-bolaget',
      verdict: 'unknown',
      detail: 'Bolaget finns inte i plattformen — grundarnas ägande finns inte i registret (verklig huvudman visas utan namn).',
      source: 'manual',
      needs: 'Grundare och ägarandelar (aktiebok).'
    });
  } else if (founders.length === 0) {
    vinnovaChecks.push({
      id: 'founders_75',
      label: 'Grundarteamet äger minst 75 % av startup-bolaget',
      verdict: 'unknown',
      detail: 'Inga grundare med ägarandel i teamet på bolagskortet.',
      source: 'platform',
      needs: 'Grundare och ägarandelar läggs in i teamet på bolagskortet.'
    });
  } else {
    const sum = founders.reduce((a, f) => a + (typeof f.equity_pct === 'number' ? f.equity_pct : 0), 0);
    const withPct = founders.filter((f) => typeof f.equity_pct === 'number').length;
    vinnovaChecks.push({
      id: 'founders_75',
      label: 'Grundarteamet äger minst 75 % av startup-bolaget',
      verdict: sum >= FOUNDER_OWNERSHIP_MIN_PCT ? 'yes' : withPct === 0 ? 'unknown' : 'no',
      detail: `${founders.length} grundare i teamet, sammanlagt ${formatPct(Math.round(sum * 100) / 100)}${
        withPct < founders.length ? ` (${founders.length - withPct} utan angiven andel)` : ''
      }.${sum < FOUNDER_OWNERSHIP_MIN_PCT && withPct > 0 ? ' Undantag: kapitalintensiv bransch med giltigt skäl för emission.' : ''}`,
      source: 'platform',
      needs: withPct === 0 ? 'Ägarandel per grundare.' : undefined
    });
  }
  vinnovaChecks.push({
    id: 'founder_driven',
    label: 'Grundardrivet (engagemang i % av heltid)',
    verdict: 'unknown',
    detail:
      'Formation: inget krav. Problem/solution-fit: sammantaget minst 40 % och en grundare minst 20 %. Product/market-fit: sammantaget minst 60 % och en grundare minst 40 %. Forskningsavknoppning: forskarnas engagemang kompletteras av teamet.',
    source: 'manual',
    needs: 'Grundarnas engagemang i % av heltid och bolagets mognadsfas.'
  });

  const subjFin = subject.financials ? latestFinancials(subject.financials) : null;
  if (
    subjFin &&
    typeof subjFin.equity_sek === 'number' &&
    typeof subjFin.revenue_sek === 'number' &&
    typeof subjFin.net_result_sek === 'number'
  ) {
    const annualCosts = Math.max(0, subjFin.revenue_sek - subjFin.net_result_sek);
    const ok = subjFin.equity_sek < 2 * annualCosts;
    vinnovaChecks.push({
      id: 'not_market_ready',
      label: 'Inte marknadsredo (eget kapital under omkostnaderna kommande 24 mån, validerar fortfarande affären)',
      verdict: ok ? 'yes' : 'unknown',
      detail: `Bokslut ${subjFin.year}: eget kapital ${fmtInt(subjFin.equity_sek)} kr mot ungefärliga kostnader ${fmtInt(2 * annualCosts)} kr för 24 mån (omsättning − resultat, × 2).${
        ok ? '' : ' Eget kapital täcker kostnaderna enligt bokslutet — bekräfta mot budget.'
      } Att affärsmodellen fortfarande valideras bedöms av coachen.`,
      source: 'register',
      needs: ok ? undefined : 'Budget kommande 24 månader och coachens bedömning.'
    });
  } else {
    vinnovaChecks.push({
      id: 'not_market_ready',
      label: 'Inte marknadsredo (eget kapital under omkostnaderna kommande 24 mån, validerar fortfarande affären)',
      verdict: 'unknown',
      detail: 'Bokslut med eget kapital, omsättning och resultat saknas — nystartade bolag har sällan något.',
      source: 'manual',
      needs: 'Budget kommande 24 månader och coachens bedömning av affärsmodellen.'
    });
  }
  vinnovaChecks.push({
    id: 'innovative',
    label: 'Innovativt — unika egenskaper som ger uthålliga konkurrensfördelar',
    verdict: 'unknown',
    detail: 'Bedöms av coach/controller.',
    source: 'manual',
    needs: 'Coachens bedömning av innovationshöjd.'
  });
  vinnovaChecks.push({
    id: 'other_criteria',
    label: 'Övriga villkor: Agenda 2030 i SRL-dimensionen, skalbarhet (tydlig från mognadsnivå 2), unika kunskapstillgångar',
    verdict: 'unknown',
    detail: 'Bedöms av coach/controller.',
    source: 'manual',
    needs: 'Coachens bedömning av Agenda 2030, skalbarhet och kunskapstillgångar.'
  });
  vinnovaChecks.forEach(push);

  const f75 = vinnovaChecks[0].verdict;
  const vinnova: ExcellenceScreeningResult['vinnova'] =
    stateAid.outcome === 'not_eligible'
      ? { outcome: 'not_in_target', text: 'Bolaget kan inte ta emot företagsstöd — Vinnovas bidragsmedel får inte användas.' }
      : f75 === 'no'
        ? {
            outcome: 'not_in_target',
            text: 'Grundarteamet äger mindre än 75 % — ingår inte i målgruppen om inte undantaget för kapitalintensiv bransch med giltigt skäl för emission gäller.'
          }
        : f75 === 'yes' && stateAid.outcome !== 'undetermined'
          ? {
              outcome: 'in_target_possible',
              text: 'Grundarägandet är uppfyllt och bolaget kan ta emot företagsstöd eller de minimis. Återstår: grundarengagemang, marknadsredo, innovationshöjd och övriga villkor bedöms av coach/controller.'
            }
          : {
              outcome: 'undetermined',
              text: 'Kräver grundarägande, statsstödsgrund och manuell bedömning av engagemang, innovationshöjd och mognadsnivå.'
            };

  const excellence = push({
    id: 'excellence',
    label: 'Uppfyller villkoren för excellent inkubation',
    verdict: input.meetsExcellenceFlag === true ? 'yes' : 'unknown',
    detail:
      input.meetsExcellenceFlag === true
        ? 'Markerat "uppfyller excellenskriterier" på bolagskortet.'
        : input.meetsExcellenceFlag === false
          ? 'Inte markerat på bolagskortet. Stäm av villkoren och om något hänt som påverkar rätten till inkubationsmedel.'
          : 'Bolaget finns inte i plattformen.',
    source: input.meetsExcellenceFlag === undefined ? 'manual' : 'platform',
    needs: input.meetsExcellenceFlag === true ? undefined : 'Stäm av excellensvillkoren och markera på bolagskortet.'
  });

  const missing = all
    .filter((c) => c.verdict === 'unknown' && c.needs)
    .map((c) => c.needs as string)
    .filter((n, i, arr) => arr.indexOf(n) === i);

  return {
    companies,
    standalone,
    thresholds: {
      rows,
      combined: { employees: emp.value, revenue_sek: rev.value, balance_sheet_sek: bal.value, complete: allRowsComplete },
      check: thresholdCheck
    },
    deMinimis,
    stateAid,
    vinnovaChecks,
    vinnova,
    irl: input.irl ?? null,
    excellence,
    missing,
    checks: all
  };
}
