// Bedömning excellens — MANUELLA svar (CLAUDE.md § 51.4).
//
// Det bolagsregistret aldrig kan svara på (börsnotering, företagskoncentration,
// övertagen verksamhet, grundarnas engagemang, innovationshöjd, de minimis-
// intyg för anknutna bolag, IRL-motivering) matar controllern in här. Svaren
// sparas per portföljbolag (`startups.screening_facts`, migration 1700000190)
// så nästa körning återanvänder dem, och skrivs in i PDF:n med källa
// "Manuell kontroll". REN modul: validering/normalisering utan IO, delad av
// PB-lagrat json (kan vara gammalt/trasigt) och klientens formulär (kan vara
// vad som helst) — allt okänt släpps, inget kastas.

export type ManualVerdict = 'yes' | 'no';

export interface ManualAnswer {
  /** Svar i checkpunktens riktning: `yes` = villkoret är uppfyllt. */
  verdict: ManualVerdict;
  /** Kort motivering/källa (aktiebok, bolagets intyg …) — personnummer-saneras på skrivvägen. */
  note?: string;
}

/** Grundförutsättningar per bolag som inte finns i något register. */
export const COMPANY_MANUAL_CONDITIONS = ['listed', 'dividend', 'concentration', 'takeover'] as const;
export type CompanyManualCondition = (typeof COMPANY_MANUAL_CONDITIONS)[number];

export type CompanyManualAnswers = Partial<Record<CompanyManualCondition, ManualAnswer>>;

export const MATURITY_PHASES = ['formation', 'problem_solution_fit', 'product_market_fit'] as const;
export type MaturityPhase = (typeof MATURITY_PHASES)[number];

export const MATURITY_PHASE_LABEL: Record<MaturityPhase, string> = {
  formation: 'Formation',
  problem_solution_fit: 'Problem/solution-fit',
  product_market_fit: 'Product/market-fit'
};

/**
 * Trösklar för grundarnas engagemang (% av heltid) per mognadsfas, enligt
 * Challes karta (PPT). Combly-dokumentet anger andra värden (50/30 resp.
 * 80/40) — tills Vinnovas metodbeskrivning låst siffrorna gäller kartans, och
 * bedömningen skriver alltid ut vilka trösklar som tillämpats
 * (docs/ai/vinnova-statsstod-screening-agent.md § 2.1).
 */
export const FOUNDER_ENGAGEMENT_THRESHOLDS: Record<MaturityPhase, { total: number; single: number }> = {
  formation: { total: 0, single: 0 },
  problem_solution_fit: { total: 40, single: 20 },
  product_market_fit: { total: 60, single: 40 }
};

export interface ScreeningFounderFact {
  name: string;
  equity_pct?: number;
  /** Engagemang i procent av heltid. */
  engagement_pct?: number;
  /** Forskare i en forskningsavknoppning (engagemanget kompletteras av teamet). */
  researcher?: boolean;
}

export const IRL_AXES = ['crl', 'brl', 'tmrl', 'srl'] as const;
export type IrlAxis = (typeof IRL_AXES)[number];

export interface ScreeningIrlFacts {
  /** Manuellt satta nivåer (1–9) när ingen readiness-bedömning finns i plattformen. */
  levels?: Partial<Record<IrlAxis, number>>;
  /** Motivering (metrics) per axel — Combly-dokumentets kolumn. */
  notes?: Partial<Record<IrlAxis, string>>;
}

export interface RelatedDeMinimisFact {
  /** Mottaget de minimis-stöd (bruttobidragsekvivalent, EUR) innevarande + två år bakåt enligt bolagets intyg. */
  used_eur: number;
  note?: string;
}

/**
 * Bolagets egen uppskattning av tröskelvärdets tal när det saknar bokslut
 * (nystartat — bilaga I art. 4.3: "uppskattning i god tro under
 * räkenskapsåret"). Nyckel = org-nr. Används BARA när registret saknar
 * årsrader för bolaget; ett bokslut vinner alltid.
 */
export interface CompanyEstimateFact {
  employees?: number;
  revenue_sek?: number;
  balance_sheet_sek?: number;
  note?: string;
}

export interface ScreeningManualFacts {
  /** Controllerns kommentar — review-radens kolumn "Kommentar". */
  comment?: string;
  /** Grundförutsättningar per bolag (nyckel = org-nr, 10 siffror). */
  companies: Record<string, CompanyManualAnswers>;
  /**
   * Grundarteamet när det inte finns i plattformen (eller ska kompletteras):
   * `undefined` ⇒ teamet på bolagskortet används.
   */
  founders?: ScreeningFounderFact[];
  maturity_phase?: MaturityPhase;
  research_spinoff?: boolean;
  /**
   * Fristående företag (bilaga I art. 3.1) efter kontroll av aktieboken:
   * `yes` = inget företag äger 25 % eller mer och bolaget äger inget sådant;
   * registret kan aldrig bevisa det för ett nyregistrerat bolag.
   */
  standalone?: ManualAnswer;
  not_market_ready?: ManualAnswer;
  innovative?: ManualAnswer;
  other_criteria?: ManualAnswer;
  excellence?: ManualAnswer;
  /** Intyg om de minimis-stöd per anknutet bolag (nyckel = org-nr). */
  de_minimis_related: Record<string, RelatedDeMinimisFact>;
  /** Egen uppskattning av anställda/omsättning/balansomslutning per bolag utan bokslut (nyckel = org-nr). */
  estimates: Record<string, CompanyEstimateFact>;
  irl?: ScreeningIrlFacts;
  /**
   * Koncernbolag controllern själv anger (aktieboken, avtal) när registret
   * inte bär koncernen — t.ex. ett nystartat bolag som ännu inte finns i
   * moderns årsredovisning. Motorn räknar dem som anknutna/partner och
   * uppslagsloopen följer deras egen koncern vidare (§ 51.8).
   */
  group_companies: ManualGroupCompanyFact[];
  /**
   * Controllerns bedömning av bolag som en ÄGARE (fysisk person) också äger
   * — "Ägarnas andra bolag" (§ 51.11). Motorn klassar dem på SNI-kod (samma
   * kod ⇒ anknutet via fysisk person, bilaga I art. 3.3 st. 4); här kan
   * controllern avgöra fallet själv (nyckel = det andra bolagets org-nr):
   * `linked` = samma eller angränsande marknad och gemensam kontroll,
   * `not_linked` = annan marknad eller ingen gemensam kontroll.
   */
  person_links?: Record<string, PersonLinkFact>;
}

export const PERSON_LINK_VERDICTS = ['linked', 'not_linked'] as const;
export type PersonLinkVerdict = (typeof PERSON_LINK_VERDICTS)[number];

export interface PersonLinkFact {
  verdict: PersonLinkVerdict;
  /** Motivering (t.ex. "konsultbolag i annan bransch") — personnummer-saneras. */
  note?: string;
}

export const MANUAL_GROUP_RELATIONS = ['linked', 'partner'] as const;
export type ManualGroupRelation = (typeof MANUAL_GROUP_RELATIONS)[number];
export const MANUAL_GROUP_DIRECTIONS = ['owner', 'holding'] as const;
export type ManualGroupDirection = (typeof MANUAL_GROUP_DIRECTIONS)[number];

export interface ManualGroupCompanyFact {
  /** Org-nr, 10 siffror — alltid en juridisk person (enskild firma avvisas). */
  org_nr: string;
  name?: string;
  /** `linked` = anknutet (> 50 % / kontroll), `partner` = partnerföretag (25–50 %). */
  relation: ManualGroupRelation;
  /** `owner` = bolaget äger startup-bolaget, `holding` = startup-bolaget äger det. */
  direction: ManualGroupDirection;
  share_pct?: number;
  /** Varifrån uppgiften kommer (t.ex. "aktieboken 2026-03") — PII-fri. */
  note?: string;
}

export const SCREENING_MAX_GROUP_COMPANIES = 20;
export const SCREENING_MAX_PERSON_LINKS = 40;

export const SCREENING_NOTE_MAX = 600;
export const SCREENING_COMMENT_MAX = 2000;
export const SCREENING_MAX_FOUNDERS = 12;
export const SCREENING_MAX_COMPANIES = 20;

const PERSONNUMMER_RE = /\b\d{6,8}[-+]?\d{4}\b/g;

function cleanText(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim().replace(PERSONNUMMER_RE, '[REDACTED]');
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanMultiline(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(PERSONNUMMER_RE, '[REDACTED]');
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanPct(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(',', '.').replace(/\s/g, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  if (n < 0 || n > 100) return undefined;
  return Math.round(n * 100) / 100;
}

function cleanEur(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(',', '.').replace(/\s/g, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

function cleanAnswer(v: unknown): ManualAnswer | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (o.verdict !== 'yes' && o.verdict !== 'no') return undefined;
  const note = cleanText(o.note, SCREENING_NOTE_MAX);
  return note ? { verdict: o.verdict, note } : { verdict: o.verdict };
}

/**
 * Personnummer-derivat: ett 10-siffrigt org-nr vars tredje siffra är < 2
 * (månad 01–12 i ÅÅMMDD) är en enskild firma — speglar `isPersonalOrgNr` i
 * webbappens org-nr-modul (juridiska personer har 2–9 som tredje siffra).
 */
function isPersonalOrgNrDigits(org: string): boolean {
  return /^\d{10}$/.test(org) && Number(org[2]) < 2;
}

function cleanOrgNr(k: string): string | null {
  const digits = k.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('16')) return digits.slice(2);
  return digits.length === 10 ? digits : null;
}

function cleanIrlLevel(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 9) return undefined;
  return n;
}

/**
 * Normaliserar vad som helst till giltiga manuella svar — okända nycklar,
 * fel typer, ogiltiga procent och personnummer försvinner tyst. Aldrig ett
 * undantag: ett trasigt lagrat json ger bara tomma svar.
 */
function cleanSek(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(',', '.').replace(/\s/g, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

function cleanCount(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(',', '.').replace(/\s/g, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100_000) return undefined;
  return Math.round(n * 10) / 10;
}

export function normalizeScreeningFacts(raw: unknown): ScreeningManualFacts {
  const out: ScreeningManualFacts = { companies: {}, de_minimis_related: {}, estimates: {}, group_companies: [], person_links: {} };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;

  out.comment = cleanMultiline(r.comment, SCREENING_COMMENT_MAX);

  if (r.companies && typeof r.companies === 'object') {
    let n = 0;
    for (const [key, val] of Object.entries(r.companies as Record<string, unknown>)) {
      const org = cleanOrgNr(key);
      if (!org || !val || typeof val !== 'object') continue;
      const answers: CompanyManualAnswers = {};
      for (const id of COMPANY_MANUAL_CONDITIONS) {
        const a = cleanAnswer((val as Record<string, unknown>)[id]);
        if (a) answers[id] = a;
      }
      if (Object.keys(answers).length === 0) continue;
      out.companies[org] = answers;
      if (++n >= SCREENING_MAX_COMPANIES) break;
    }
  }

  if (Array.isArray(r.founders)) {
    const founders: ScreeningFounderFact[] = [];
    for (const f of r.founders) {
      if (!f || typeof f !== 'object') continue;
      const o = f as Record<string, unknown>;
      const name = cleanText(o.name, 120);
      if (!name) continue;
      const row: ScreeningFounderFact = { name };
      const eq = cleanPct(o.equity_pct);
      const eng = cleanPct(o.engagement_pct);
      if (eq !== undefined) row.equity_pct = eq;
      if (eng !== undefined) row.engagement_pct = eng;
      if (o.researcher === true) row.researcher = true;
      founders.push(row);
      if (founders.length >= SCREENING_MAX_FOUNDERS) break;
    }
    if (founders.length > 0) out.founders = founders;
  }

  if (typeof r.maturity_phase === 'string' && (MATURITY_PHASES as readonly string[]).includes(r.maturity_phase)) {
    out.maturity_phase = r.maturity_phase as MaturityPhase;
  }
  if (r.research_spinoff === true) out.research_spinoff = true;

  for (const id of ['standalone', 'not_market_ready', 'innovative', 'other_criteria', 'excellence'] as const) {
    const a = cleanAnswer(r[id]);
    if (a) out[id] = a;
  }

  if (r.de_minimis_related && typeof r.de_minimis_related === 'object') {
    let n = 0;
    for (const [key, val] of Object.entries(r.de_minimis_related as Record<string, unknown>)) {
      const org = cleanOrgNr(key);
      if (!org || !val || typeof val !== 'object') continue;
      const used = cleanEur((val as Record<string, unknown>).used_eur);
      if (used === undefined) continue;
      const note = cleanText((val as Record<string, unknown>).note, SCREENING_NOTE_MAX);
      out.de_minimis_related[org] = note ? { used_eur: used, note } : { used_eur: used };
      if (++n >= SCREENING_MAX_COMPANIES) break;
    }
  }

  if (r.estimates && typeof r.estimates === 'object') {
    let n = 0;
    for (const [key, val] of Object.entries(r.estimates as Record<string, unknown>)) {
      const org = cleanOrgNr(key);
      if (!org || !val || typeof val !== 'object') continue;
      const o = val as Record<string, unknown>;
      const est: CompanyEstimateFact = {};
      const employees = cleanCount(o.employees);
      const revenue = cleanSek(o.revenue_sek);
      const balance = cleanSek(o.balance_sheet_sek);
      if (employees !== undefined) est.employees = employees;
      if (revenue !== undefined) est.revenue_sek = revenue;
      if (balance !== undefined) est.balance_sheet_sek = balance;
      if (Object.keys(est).length === 0) continue;
      const note = cleanText(o.note, SCREENING_NOTE_MAX);
      if (note) est.note = note;
      out.estimates[org] = est;
      if (++n >= SCREENING_MAX_COMPANIES) break;
    }
  }

  if (Array.isArray(r.group_companies)) {
    const seen = new Set<string>();
    for (const g of r.group_companies) {
      if (!g || typeof g !== 'object') continue;
      const o = g as Record<string, unknown>;
      const org = typeof o.org_nr === 'string' ? cleanOrgNr(o.org_nr) : null;
      // Personnummer-derivat (enskild firma) är en fysisk person — aldrig ett koncernbolag.
      if (!org || isPersonalOrgNrDigits(org) || seen.has(org)) continue;
      seen.add(org);
      const row: ManualGroupCompanyFact = {
        org_nr: org,
        relation: (MANUAL_GROUP_RELATIONS as readonly string[]).includes(String(o.relation)) ? (o.relation as ManualGroupRelation) : 'linked',
        direction: (MANUAL_GROUP_DIRECTIONS as readonly string[]).includes(String(o.direction)) ? (o.direction as ManualGroupDirection) : 'owner'
      };
      const name = cleanText(o.name, 160);
      if (name) row.name = name;
      const share = cleanPct(o.share_pct);
      if (share !== undefined) row.share_pct = share;
      const note = cleanText(o.note, SCREENING_NOTE_MAX);
      if (note) row.note = note;
      out.group_companies.push(row);
      if (out.group_companies.length >= SCREENING_MAX_GROUP_COMPANIES) break;
    }
  }

  if (r.person_links && typeof r.person_links === 'object') {
    let n = 0;
    for (const [key, val] of Object.entries(r.person_links as Record<string, unknown>)) {
      const org = cleanOrgNr(key);
      if (!org || isPersonalOrgNrDigits(org) || !val || typeof val !== 'object') continue;
      const verdict = (val as Record<string, unknown>).verdict;
      if (!(PERSON_LINK_VERDICTS as readonly unknown[]).includes(verdict)) continue;
      const note = cleanText((val as Record<string, unknown>).note, SCREENING_NOTE_MAX);
      out.person_links![org] = note ? { verdict: verdict as PersonLinkVerdict, note } : { verdict: verdict as PersonLinkVerdict };
      if (++n >= SCREENING_MAX_PERSON_LINKS) break;
    }
  }

  if (r.irl && typeof r.irl === 'object') {
    const i = r.irl as Record<string, unknown>;
    const levels: Partial<Record<IrlAxis, number>> = {};
    const notes: Partial<Record<IrlAxis, string>> = {};
    if (i.levels && typeof i.levels === 'object') {
      for (const ax of IRL_AXES) {
        const lv = cleanIrlLevel((i.levels as Record<string, unknown>)[ax]);
        if (lv !== undefined) levels[ax] = lv;
      }
    }
    if (i.notes && typeof i.notes === 'object') {
      for (const ax of IRL_AXES) {
        const t = cleanText((i.notes as Record<string, unknown>)[ax], SCREENING_NOTE_MAX);
        if (t) notes[ax] = t;
      }
    }
    const irl: ScreeningIrlFacts = {};
    if (Object.keys(levels).length > 0) irl.levels = levels;
    if (Object.keys(notes).length > 0) irl.notes = notes;
    if (irl.levels || irl.notes) out.irl = irl;
  }

  return out;
}

/** Sant när inget manuellt svar har lämnats (då skrivs inget till bolagskortet). */
export function isEmptyScreeningFacts(f: ScreeningManualFacts): boolean {
  return (
    !f.comment &&
    Object.keys(f.companies).length === 0 &&
    !f.founders &&
    !f.maturity_phase &&
    !f.research_spinoff &&
    !f.standalone &&
    !f.not_market_ready &&
    !f.innovative &&
    !f.other_criteria &&
    !f.excellence &&
    Object.keys(f.de_minimis_related).length === 0 &&
    Object.keys(f.estimates).length === 0 &&
    f.group_companies.length === 0 &&
    Object.keys(f.person_links ?? {}).length === 0 &&
    !f.irl
  );
}

/** PII-fri sammanfattning för audit-loggen: antal besvarade punkter, aldrig texter eller namn. */
export function summarizeScreeningFacts(f: ScreeningManualFacts): Record<string, number | boolean> {
  const companyAnswers = Object.values(f.companies).reduce((a, c) => a + Object.keys(c).length, 0);
  return {
    company_answers: companyAnswers,
    founders: f.founders?.length ?? 0,
    has_phase: !!f.maturity_phase,
    vinnova_answers: ['not_market_ready', 'innovative', 'other_criteria'].filter((k) => !!f[k as keyof ScreeningManualFacts]).length,
    has_excellence: !!f.excellence,
    has_standalone: !!f.standalone,
    de_minimis_related: Object.keys(f.de_minimis_related).length,
    estimates: Object.keys(f.estimates).length,
    irl_notes: Object.keys(f.irl?.notes ?? {}).length,
    group_companies: f.group_companies.length,
    person_links: Object.keys(f.person_links ?? {}).length,
    has_comment: !!f.comment
  };
}
