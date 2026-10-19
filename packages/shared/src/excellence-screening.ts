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

import {
  FOUNDER_ENGAGEMENT_THRESHOLDS,
  MATURITY_PHASE_LABEL,
  type CompanyManualAnswers,
  type ManualAnswer,
  type ScreeningManualFacts,
  type ManualGroupCompanyFact,
  type PersonLinkFact
} from './excellence-facts';

export type ScreeningVerdict = 'yes' | 'no' | 'unknown';

/** Var faktumet kommer ifrån: bolagsregistret, plattformens egna data eller manuell kontroll. */
export type ScreeningSource = 'register' | 'platform' | 'manual';

export type ScreeningOwnerKind = 'company' | 'person' | 'public_body' | 'investor' | 'other';

export interface ScreeningOwnershipEntry {
  direction: 'owner' | 'holding';
  owner_kind: ScreeningOwnerKind;
  name?: string;
  org_nr?: string;
  /**
   * Fysisk persons namn (för- och efternamn) ur verklig huvudman/koncernlistan.
   * Visas i bedömningen, PDF:n och ärendet så ägarbilden går att läsa
   * (§ 51.11); personnummer bär raden aldrig.
   */
  person_name?: string;
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
  /** Beslutad vinstutdelning enligt årsredovisningen (0 = ingen). Bara meningsfull med `dividend_reported`. */
  dividend_sek?: number;
  /** Sant när bokslutet svarade på utdelningsfrågan (`dividend` i economy-overview /extended, § 11.8). */
  dividend_reported?: boolean;
}

/** En SNI-kod (svensk näringsgrensindelning) ur bolagsregistret. */
export interface ScreeningSni {
  /** Koden som leverantören gav den (oftast 5 siffror, t.ex. "62010"). */
  code: string;
  text?: string;
  /** Bolagets huvudsakliga näringsgren. */
  primary?: boolean;
}

export interface ScreeningBasic {
  registeredAt?: string;
  bolagStatus?: string;
  bolagsform?: string;
  isPersonal?: boolean;
  /** Bolagets SNI-koder (huvudsaklig först) — avgör "samma marknad" för ägarnas andra bolag (§ 51.11). */
  sni?: ScreeningSni[];
}

/**
 * Ett annat bolag som en ägare (fysisk person) till startup-bolaget äger eller
 * kontrollerar — ur verklig huvudman per person (§ 51.11). Personens andel
 * av bolaget som intervall/exakt; grunddata (SNI) när den hämtades.
 */
export interface ScreeningEngagementCompany {
  org_nr?: string;
  name?: string;
  capital_pct?: number;
  pct_min?: number;
  pct_max?: number;
  /** Fast vokabulär: shares | votes | board | agreement | other. */
  control_basis?: string;
  /** Grunddata för bolaget (SNI, ålder, status). `undefined` ⇒ hämtades inte. */
  basic?: ScreeningBasic;
  /** Varför grunddata saknas (PII-fritt). */
  note?: string;
}

export interface ScreeningOwnerEngagement {
  /** Ägarens namn (fysisk person). */
  person_name?: string;
  /** Ägarens andel av startup-bolaget (ur verklig huvudman). */
  subject_capital_pct?: number;
  subject_pct_min?: number;
  subject_pct_max?: number;
  /**
   * Uppslaget per person: `ok` = bolag hittades, `none` = personen äger inga
   * andra bolag enligt registret, `no_id` = personnummer saknades i
   * huvudmannens post (kan inte sökas), `failed` = anropet föll.
   */
  status: 'ok' | 'none' | 'no_id' | 'failed';
  /** PII-fri orsak vid `failed`/`no_id`. */
  reason?: string;
  companies: ScreeningEngagementCompany[];
}

export type SniMatch = 'same' | 'near' | 'different' | 'unknown';

export const SNI_MATCH_LABEL: Record<SniMatch, string> = {
  same: 'Samma SNI-kod',
  near: 'Närliggande bransch',
  different: 'Annan bransch',
  unknown: 'SNI-kod saknas'
};

/** Hur ett av ägarnas andra bolag klassades (§ 51.11). */
export interface OwnerEngagementCompanyView extends ScreeningEngagementCompany {
  sniMatch: SniMatch;
  /** Koden som matchade (samma kod eller samma SNI-grupp). */
  matchedCode?: string;
  /** `linked` = anknutet via fysisk person, `uncertain` = oklart, `none` = räknas inte. */
  relation: 'linked' | 'uncertain' | 'none';
  reason: string;
  /** Controllerns bedömning när den finns. */
  manual?: PersonLinkFact;
  shareLabel: string;
}

export interface OwnerEngagementView extends Omit<ScreeningOwnerEngagement, 'companies'> {
  subjectShareLabel: string;
  companies: OwnerEngagementCompanyView[];
}

/** Bilaga I-relation mellan startup-bolaget och ett annat företag. */
export type ScreeningRelation = 'linked' | 'partner' | 'exempt' | 'uncertain';

/**
 * Plats i koncernen relativt startup-bolaget (ur koncernregistrets platta
 * lista): moderbolag (direkt eller högre upp), dotterbolag, eller systerbolag
 * / annat bolag i samma koncern (anknutet via gemensam moder — bilaga I
 * art. 3.3: företag som är anknutna via ett eller flera andra företag).
 */
export type ScreeningGroupRole = 'parent' | 'subsidiary' | 'sibling';

export const GROUP_ROLE_LABEL: Record<ScreeningGroupRole, string> = {
  parent: 'Moderbolag',
  subsidiary: 'Dotterbolag',
  sibling: 'Systerbolag / annat bolag i koncernen'
};

/**
 * Ett bolag i koncernregistrets platta lista (Roaring group-structure:
 * `groupCompanies[]` med `motherCompanyId`/`ownedPercentage`/`companyLevel`).
 * Alla bolag i listan ingår i samma koncern = majoritetskontroll i varje led
 * ⇒ anknutna företag enligt bilaga I. Bara juridiska personer (org-nr/namn),
 * aldrig fysiska personer.
 */
export interface ScreeningGroupMember {
  org_nr?: string;
  name?: string;
  /** Nivå i koncernen enligt leverantören (0 = yttersta moder). */
  level?: number;
  mother_org_nr?: string;
  mother_name?: string;
  /** Moderns andel av bolaget i procent. */
  owned_pct?: number;
}

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
  /** Plats i koncernen när bolaget kommer ur koncernregistret. */
  groupRole?: ScreeningGroupRole;
  /** Via vilket bolag relationen går (moder, partnerföretag) — namn. */
  via?: string;
  level?: number;
  /** Sant när bolaget kom från ett ANNAT bolags ägarbild/koncern (andra ledet), inte startup-bolagets egen. */
  transitive?: boolean;
  /** Sant när controllern själv angett bolaget (aktiebok/avtal) — registret bar det inte (§ 51.8). */
  manualDeclared?: boolean;
  /** Bolaget kom med via en ägare (fysisk person) som också äger det — "Ägarnas andra bolag" (§ 51.11). */
  personLink?: PersonLinkRef;
}

export interface PersonLinkRef {
  personName?: string;
  sniMatch: SniMatch;
  matchedCode?: string;
  /** Controllern avgjorde relationen själv. */
  manual?: boolean;
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
  /**
   * HELA koncernen enligt koncernregistret (inkl. moderbolag, syskon och
   * dotterbolag — inte bara ägarkedjan). `undefined` ⇒ inte känd (sparade
   * data eller koncernstruktur inte hämtad).
   */
  groupMembers?: ScreeningGroupMember[];
  /**
   * Anknutet bolags de minimis-stöd (EUR, innevarande + två år bakåt) — ur
   * plattformen när bolaget är ett portföljbolag, annars ur bolagets intyg
   * (manuellt svar). `undefined` ⇒ okänt.
   */
  deMinimis?: { usedEur: number; source: 'platform' | 'certificate'; note?: string };
  /**
   * Ägarnas andra bolag (bara startup-bolaget, § 51.11): per fysisk ägare de
   * bolag personen äger/kontrollerar utanför koncernen. `undefined` ⇒ inte
   * hämtat (datadelen "Ägarnas andra bolag").
   */
  ownerEngagements?: ScreeningOwnerEngagement[];
}

export interface ScreeningFounderRow {
  name: string;
  equity_pct?: number;
  /** Engagemang i procent av heltid (manuellt svar). */
  engagement_pct?: number;
  /** Forskare i en forskningsavknoppning. */
  researcher?: boolean;
}

export interface ScreeningIrl {
  level?: number | null;
  crl?: number | null;
  brl?: number | null;
  tmrl?: number | null;
  srl?: number | null;
  /** Övriga KTH-axlar ur bolagskortets bedömning (§ 52.2) — visas, prövas inte. */
  trl?: number | null;
  iprl?: number | null;
  frl?: number | null;
  assessedAt?: string;
  /** Motivering (metrics) per axel — bolagskortets KTH-bedömning, överstyrd av manuella svar. */
  notes?: Partial<Record<'crl' | 'brl' | 'tmrl' | 'srl', string>>;
  /** Sant när nivåerna sattes manuellt i bedömningen (ingen readiness-rad i plattformen). */
  manualLevels?: boolean;
}

export interface ExcellenceScreeningInput {
  /** Referensdag (idag) — styr åldersgränsen. */
  refDate: Date;
  subject: GroupCompanyFacts;
  /** Anknutna/partnerföretag med den data som hämtats (matchas på org-nr). */
  related: GroupCompanyFacts[];
  /** Grundare ur bolagets team (bara portföljbolag). `undefined` = bolaget finns inte i plattformen. */
  founders?: ScreeningFounderRow[];
  /** Var grundarraderna kommer ifrån (teamet på bolagskortet eller manuellt inmatade). */
  foundersSource?: 'platform' | 'manual';
  /** Controllerns manuella svar (§ 51.4) — fyller det registret inte kan svara på. */
  manual?: ScreeningManualFacts;
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
  /** Talen är bolagets egen uppskattning (bilaga I art. 4.3 — nystartat utan bokslut), skriven i rapporten. */
  estimated?: boolean;
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
  /** Plats i koncernen (moder/dotter/syster) när bolaget kommer ur koncernregistret. */
  groupRole?: ScreeningGroupRole;
  via?: string;
  level?: number;
  transitive?: boolean;
  /** Angivet manuellt av controllern (aktiebok/avtal), inte ur registret. */
  manualDeclared?: boolean;
  /** Kom med via en ägare som också äger bolaget (samma marknad, § 51.11). */
  personLink?: PersonLinkRef;
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
  /** Controllerns kommentar (review-raden). */
  comment?: string;
  /** Underlag som saknas — en rad per OKÄNT-punkt (dedupe). */
  missing: string[];
  /** Ägarnas andra bolag med SNI-jämförelse och klassning (`undefined` ⇒ inte hämtat). */
  ownerEngagements?: OwnerEngagementView[];
  /** Alla punkter platt (för räkning). */
  checks: ScreeningCheck[];
}

export const SCREENING_MAX_AGE_YEARS = 5;
export const SME_MAX_EMPLOYEES = 50;
export const SME_MAX_EUR = 10_000_000;
export const PARTNER_THRESHOLD_PCT = 25;
export const LINKED_THRESHOLD_PCT = 50;
export const FOUNDER_OWNERSHIP_MIN_PCT = 75;
/** Högsta antal koncern-/partnerbolag som slås upp hos leverantören per bedömning (varje uppslag debiteras). */
export const MAX_RELATED_COMPANIES = 8;
/** Tak för hur många bolag regelträdet listar (koncernkartan) — skydd mot explosion i stora koncerner. */
export const MAX_GROUP_COMPANIES = 30;
/** Koncernregistrets eftersläpning (årsredovisningar): yngre bolag än så bevisas aldrig fristående ur registret. */
export const GROUP_REGISTER_LAG_MS = 2 * 365 * 24 * 3600 * 1000;

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

/**
 * SNI-kod → bara siffror (2–5). "00000"/"0" (uppgift saknas hos SCB) och
 * annat som inte är en kod blir null.
 */
export function normalizeSniCode(code: string | undefined | null): string | null {
  if (!code) return null;
  const digits = String(code).replace(/\D/g, '');
  if (digits.length < 2 || digits.length > 5) return null;
  if (/^0+$/.test(digits)) return null;
  return digits;
}

/**
 * Jämför två bolags SNI-koder (§ 51.11). `same` = någon kod är identisk
 * (bilaga I art. 3.3 st. 4: samma relevanta marknad — SNI är plattformens
 * mått på det), `near` = samma SNI-grupp (tre första siffrorna — kan vara
 * samma eller angränsande marknad), `different` = ingen gemensam grupp,
 * `unknown` = någon sida saknar kod.
 */
export function compareSni(
  a: readonly ScreeningSni[] | undefined,
  b: readonly ScreeningSni[] | undefined
): { match: SniMatch; code?: string } {
  const ca = (a ?? []).map((x) => normalizeSniCode(x.code)).filter((x): x is string => !!x);
  const cb = (b ?? []).map((x) => normalizeSniCode(x.code)).filter((x): x is string => !!x);
  if (ca.length === 0 || cb.length === 0) return { match: 'unknown' };
  for (const x of ca) if (cb.includes(x)) return { match: 'same', code: x };
  for (const x of ca) {
    if (x.length < 3) continue;
    const hit = cb.find((y) => y.length >= 3 && y.slice(0, 3) === x.slice(0, 3));
    if (hit) return { match: 'near', code: x.slice(0, 3) };
  }
  return { match: 'different' };
}

/** "62010 Dataprogrammering" — kod + text, för visning. */
export function formatSni(s: ScreeningSni): string {
  const code = normalizeSniCode(s.code) ?? s.code;
  return s.text ? `${code} ${s.text}` : code;
}

function engagementShare(c: ScreeningEngagementCompany): { min: number; max: number } | null {
  return ownershipShareRange({ direction: 'owner', owner_kind: 'person', capital_pct: c.capital_pct, pct_min: c.pct_min, pct_max: c.pct_max });
}

/**
 * Ägarnas andra bolag (§ 51.11) — bilaga I art. 3.3 fjärde stycket: företag
 * som har en kontrollrelation genom en fysisk person (eller personer som
 * agerar gemensamt) är också anknutna om de bedriver verksamhet på samma
 * relevanta marknad eller angränsande marknader. Plattformen mäter marknaden
 * med SNI-koden:
 *   samma kod      ⇒ anknutet — båda bolagen prövas mot kriterierna
 *   samma grupp    ⇒ oklart (samma eller angränsande marknad?)
 *   kod saknas     ⇒ oklart (hämta grunddata för bolaget)
 *   annan bransch  ⇒ räknas inte (listas)
 * Controllerns bedömning (`person_links`) vinner alltid.
 */
export function classifyOwnerEngagements(
  subject: Pick<GroupCompanyFacts, 'orgNr' | 'name' | 'basic' | 'ownerEngagements'>,
  personLinks?: Record<string, PersonLinkFact>
): OwnerEngagementView[] | undefined {
  if (!subject.ownerEngagements) return undefined;
  const subjectName = subject.name || 'startup-bolaget';
  return subject.ownerEngagements.map((p) => {
    const person = p.person_name || 'Ägaren';
    const subjectRange = ownershipShareRange({
      direction: 'owner',
      owner_kind: 'person',
      capital_pct: p.subject_capital_pct,
      pct_min: p.subject_pct_min,
      pct_max: p.subject_pct_max
    });
    const companies = p.companies
      .filter((c) => !(c.org_nr && c.org_nr === subject.orgNr))
      .map((c): OwnerEngagementCompanyView => {
        const cmp = compareSni(subject.basic?.sni, c.basic?.sni);
        const share = engagementShare(c);
        // Personuppslaget (Roaring 2.1) anger ingen andel — bara att personen
        // är verklig huvudman (> 25 % eller kontroll på annat sätt).
        const shareText = share ? shareLabel(share) : 'verklig huvudman (> 25 %)';
        const manual = c.org_nr ? personLinks?.[c.org_nr] : undefined;
        const base = { ...c, sniMatch: cmp.match, matchedCode: cmp.code, shareLabel: shareText, manual };
        const other = c.name || c.org_nr || 'bolaget';
        const who = `${person} äger ${shareLabel(subjectRange)} av ${subjectName} och ${share ? `${shareText} av ${other}` : `är verklig huvudman i ${other} (mer än 25 % eller kontroll)`}`;
        if (manual) {
          return manual.verdict === 'linked'
            ? { ...base, relation: 'linked', reason: `Bedömt av controllern: anknutet via ${person} (samma eller angränsande marknad)${manual.note ? ` — ${manual.note}` : ''}.` }
            : { ...base, relation: 'none', reason: `Bedömt av controllern: inte anknutet${manual.note ? ` — ${manual.note}` : ''}.` };
        }
        if (cmp.match === 'same') {
          return {
            ...base,
            relation: 'linked',
            reason: `${who}; båda har SNI-kod ${cmp.code} ⇒ samma relevanta marknad. Anknutna via fysisk person (bilaga I art. 3.3 st. 4) — båda bolagen ska klara kriterierna och räknas samman.`
          };
        }
        if (cmp.match === 'near') {
          return {
            ...base,
            relation: 'uncertain',
            reason: `${who}; samma SNI-grupp (${cmp.code}) men olika koder — avgör om bolagen verkar på samma eller angränsande marknad.`
          };
        }
        if (cmp.match === 'unknown') {
          return {
            ...base,
            relation: 'uncertain',
            reason: `${who}; SNI-kod saknas för ${c.basic?.sni?.length ? subjectName : (c.name || 'bolaget')} — kan inte jämföra marknaderna.`
          };
        }
        return { ...base, relation: 'none', reason: `${who}; annan bransch — räknas inte som anknutet (om marknaden inte är angränsande).` };
      });
    return { ...p, subjectShareLabel: shareLabel(subjectRange), companies };
  });
}

/**
 * HELA koncernen — bilaga I i tre lager, i den ordning servern och regelträdet
 * behöver den:
 *
 * 1. Startup-bolagets egen ägarbild (`deriveRelatedCompanies`): ägare och
 *    innehav med andel ⇒ anknutet / partner / oklart.
 * 2. Koncernregistrets platta lista (`subject.groupMembers`): VARJE bolag i
 *    listan — moderbolag, moderns moder, dotterbolag OCH systerbolag — är
 *    anknutet till startup-bolaget (koncern = majoritetskontroll i varje led;
 *    art. 3.3 sista stycket: anknutna via ett eller flera andra företag).
 *    Tidigare räknades bara ägarkedjan uppåt och de direkta innehaven, så ett
 *    systerbolag under samma holdingbolag (ofta det äldsta i gruppen) föll
 *    bort ur både grundförutsättningarna och tröskelvärdet.
 * 3. Andra ledet ur de bolag som faktiskt slagits upp (`related`): ett
 *    anknutet bolags egna anknutna (via dess ägarbild/koncern) är anknutna
 *    till startup-bolaget; ett partnerföretags anknutna räknas med partnerns
 *    andel (art. 6.3 — partnerns uppgifter är dess konsoliderade uppgifter).
 *
 * En rad per org-nr; starkaste relationen vinner; aldrig startup-bolaget
 * självt. Capat till `MAX_GROUP_COMPANIES`.
 */
export function deriveGroupCompanies(
  subject: GroupCompanyFacts,
  related: GroupCompanyFacts[],
  manual: readonly ManualGroupCompanyFact[] = [],
  personLinks?: Record<string, PersonLinkFact>
): RelatedCompanyRef[] {
  const rank: Record<ScreeningRelation, number> = { linked: 3, partner: 2, uncertain: 1, exempt: 0 };
  const out = new Map<string, RelatedCompanyRef>();
  const keyOf = (orgNr: string | undefined, name: string | undefined, fallback: string) => orgNr || (name ? `name:${name.trim().toLowerCase()}` : fallback);
  const isSubject = (orgNr?: string, name?: string) =>
    (!!orgNr && orgNr === subject.orgNr) || (!orgNr && !!name && !!subject.name && name.trim().toLowerCase() === subject.name.trim().toLowerCase());
  const add = (ref: RelatedCompanyRef, key: string) => {
    if (isSubject(ref.org_nr, ref.name)) return;
    const prev = out.get(key);
    if (!prev) {
      if (out.size >= MAX_GROUP_COMPANIES) return;
      out.set(key, ref);
      return;
    }
    const stronger = rank[ref.relation] > rank[prev.relation];
    out.set(key, {
      ...prev,
      ...(stronger ? { relation: ref.relation, reason: ref.reason, sharePct: ref.sharePct ?? prev.sharePct, shareLabel: ref.shareLabel } : {}),
      name: prev.name ?? ref.name,
      org_nr: prev.org_nr ?? ref.org_nr,
      groupRole: prev.groupRole ?? ref.groupRole,
      via: prev.via ?? ref.via,
      level: prev.level ?? ref.level,
      transitive: prev.transitive && ref.transitive,
      manualDeclared: prev.manualDeclared || ref.manualDeclared || undefined,
      personLink: prev.personLink ?? ref.personLink
    });
  };

  // 0. Manuellt angivna koncernbolag (aktiebok/avtal) — registret bygger
  // koncernstrukturen ur årsredovisningar, så ett nystartat bolag saknas ofta
  // där. Angivna bolag räknas som anknutna/partner och slås upp som vilket
  // koncernbolag som helst; deras egen koncern (andra ledet) följs vidare.
  for (const m of manual) {
    const share = typeof m.share_pct === 'number' ? m.share_pct : undefined;
    add(
      {
        name: m.name,
        org_nr: m.org_nr,
        direction: m.direction,
        relation: m.relation,
        sharePct: share,
        shareLabel: share !== undefined ? formatPct(share) : 'andel okänd',
        reason: `Angivet manuellt av controllern${m.note ? ` (${m.note})` : ''}: ${m.direction === 'owner' ? 'äger startup-bolaget' : 'ägs av startup-bolaget'}${share !== undefined ? ` ${formatPct(share)}` : ''} — ${m.relation === 'linked' ? 'anknutet företag' : 'partnerföretag'} enligt bilaga I.`,
        indirect: false,
        transitive: false,
        manualDeclared: true
      },
      keyOf(m.org_nr, m.name, m.org_nr)
    );
  }

  // 1. Egen ägarbild.
  let anon = 0;
  for (const r of deriveRelatedCompanies(subject.ownership)) add(r, keyOf(r.org_nr, r.name, `anon-${anon++}`));

  // 2. Koncernregistret — hela listan.
  const members = subject.groupMembers ?? [];
  if (members.length > 0) {
    const byKey = new Map<string, ScreeningGroupMember>();
    for (const m of members) {
      const k = keyOf(m.org_nr, m.name, '');
      if (k) byKey.set(k, m);
    }
    const subjectKey = keyOf(subject.orgNr, subject.name, '');
    const motherKey = (m: ScreeningGroupMember | undefined) =>
      m ? (m.mother_org_nr ?? (m.mother_name ? `name:${m.mother_name.trim().toLowerCase()}` : undefined)) : undefined;
    // Ägarkedjan uppåt från startup-bolaget (direkt moder först).
    const ancestors: string[] = [];
    let cur = motherKey(byKey.get(subjectKey));
    while (cur && !ancestors.includes(cur) && ancestors.length < 12) {
      ancestors.push(cur);
      cur = motherKey(byKey.get(cur));
    }
    const descendantOf = (m: ScreeningGroupMember): boolean => {
      let mk = motherKey(m);
      let g = 0;
      while (mk && g++ < 12) {
        if (mk === subjectKey) return true;
        mk = motherKey(byKey.get(mk));
      }
      return false;
    };
    for (const m of members) {
      const k = keyOf(m.org_nr, m.name, '');
      if (!k || k === subjectKey) continue;
      const role: ScreeningGroupRole = ancestors.includes(k) ? 'parent' : descendantOf(m) ? 'subsidiary' : 'sibling';
      const mk = motherKey(m);
      const motherLabel = m.mother_name || (mk ? byKey.get(mk)?.name : undefined) || m.mother_org_nr;
      // Andelen: för ett moderbolag = dess andel av bolaget UNDER det i kedjan
      // (direkt moder ⇒ startup-bolagets egen post); annars moderns andel av
      // bolaget självt.
      const childKey = role === 'parent' ? (ancestors.indexOf(k) === 0 ? subjectKey : ancestors[ancestors.indexOf(k) - 1]) : k;
      const shareRaw = byKey.get(childKey)?.owned_pct;
      const share = typeof shareRaw === 'number' ? shareRaw : undefined;
      const reason =
        role === 'parent'
          ? `Moderbolag enligt koncernregistret${share !== undefined ? ` (${formatPct(share)} av ${ancestors.indexOf(k) === 0 ? 'startup-bolaget' : byKey.get(childKey)?.name ?? 'bolaget under'})` : ''}${motherLabel ? `, ägs i sin tur av ${motherLabel}` : ''} — kontrollerar startup-bolaget i majoritetsled.`
          : role === 'subsidiary'
            ? `Dotterbolag enligt koncernregistret${motherLabel ? ` (ägs av ${motherLabel}${share !== undefined ? ` ${formatPct(share)}` : ''})` : ''}.`
            : `Ingår i samma koncern enligt koncernregistret${motherLabel ? ` (ägs av ${motherLabel}${share !== undefined ? ` ${formatPct(share)}` : ''})` : ''} — anknutet via gemensam moder (bilaga I art. 3.3).`;
      add(
        {
          name: m.name,
          org_nr: m.org_nr,
          direction: role === 'parent' ? 'owner' : 'holding',
          relation: 'linked',
          sharePct: share,
          shareLabel: share !== undefined ? formatPct(share) : 'andel okänd',
          reason,
          indirect: role === 'parent' ? ancestors[0] !== k : role === 'sibling',
          groupRole: role,
          via: motherLabel,
          level: m.level,
          transitive: false
        },
        k
      );
    }
  }

  // 3. Andra ledet ur uppslagna bolag.
  const firstLevel = [...out.values()];
  for (const ref of firstLevel) {
    if (!ref.org_nr || (ref.relation !== 'linked' && ref.relation !== 'partner')) continue;
    const facts = related.find((r) => r.orgNr === ref.org_nr);
    if (!facts) continue;
    const viaName = facts.name ?? ref.name ?? ref.org_nr;
    const second: Array<{ name?: string; org_nr?: string; share?: number; label: string }> = [];
    for (const e of deriveRelatedCompanies(facts.ownership)) {
      if (e.relation !== 'linked') continue;
      second.push({ name: e.name, org_nr: e.org_nr, share: e.sharePct, label: `${e.direction === 'owner' ? 'äger' : 'ägs av'} ${viaName} ${e.shareLabel}` });
    }
    for (const m of facts.groupMembers ?? []) {
      if (m.org_nr === facts.orgNr) continue;
      second.push({ name: m.name, org_nr: m.org_nr, share: m.owned_pct, label: `ingår i ${viaName}s koncern` });
    }
    for (const s of second) {
      const k = keyOf(s.org_nr, s.name, '');
      if (!k) continue;
      if (ref.relation === 'linked') {
        add(
          {
            name: s.name,
            org_nr: s.org_nr,
            direction: 'holding',
            relation: 'linked',
            sharePct: s.share,
            shareLabel: s.share !== undefined ? formatPct(s.share) : 'andel okänd',
            reason: `Anknutet i andra ledet: ${s.label} — och ${viaName} är anknutet till startup-bolaget.`,
            indirect: true,
            via: viaName,
            transitive: true
          },
          k
        );
      } else {
        add(
          {
            name: s.name,
            org_nr: s.org_nr,
            direction: 'holding',
            relation: 'partner',
            sharePct: ref.sharePct,
            shareLabel: ref.shareLabel,
            reason: `Anknutet till partnerföretaget ${viaName} (${s.label}) — räknas med partnerns andel (bilaga I art. 6.3).`,
            indirect: true,
            via: viaName,
            transitive: true
          },
          k
        );
      }
    }
  }

  // 4. Ägarnas andra bolag (fysisk person + samma marknad, § 51.11).
  for (const p of classifyOwnerEngagements(subject, personLinks) ?? []) {
    for (const c of p.companies) {
      if (c.relation === 'none') continue;
      const k = keyOf(c.org_nr, c.name, '');
      if (!k) continue;
      add(
        {
          name: c.name,
          org_nr: c.org_nr,
          direction: 'holding',
          relation: c.relation,
          sharePct: undefined,
          shareLabel: c.shareLabel,
          reason: c.reason,
          indirect: true,
          via: p.person_name,
          transitive: false,
          personLink: { personName: p.person_name, sniMatch: c.sniMatch, matchedCode: c.matchedCode, manual: c.manual ? true : undefined }
        },
        k
      );
    }
  }
  return [...out.values()];
}

/** Grunddata för ett av ägarnas andra bolag ur engagemangsuppslaget (SNI m.m.). */
function engagementBasicFor(subject: GroupCompanyFacts, orgNr: string | undefined): ScreeningBasic | undefined {
  if (!orgNr) return undefined;
  for (const p of subject.ownerEngagements ?? []) {
    const hit = p.companies.find((c) => c.org_nr === orgNr && c.basic);
    if (hit) return hit.basic;
  }
  return undefined;
}

/**
 * Art. 22 GBER: bolaget får inte vara börsnoterat. Avgörs ur registret så
 * långt lagen tillåter: bara ett PUBLIKT aktiebolag kan ta upp aktier till
 * handel, och ett publikt aktiebolags namn ska följas av "(publ)" (ABL
 * 28 kap. 7 §). Ett privat aktiebolag (namn utan "(publ)"), ett handels-/
 * kommanditbolag, en ekonomisk förening eller en enskild firma kan därför
 * inte vara börsnoterat ⇒ JA ur registret. Ett "(publ)"-bolag ⇒ OKÄNT —
 * kontrollera om aktierna faktiskt är upptagna till handel.
 */
export function listedCheck(c: GroupCompanyFacts): ScreeningCheck {
  const id = 'listed';
  const label = 'Inte börsnoterat';
  const name = (c.name ?? '').trim();
  const form = (c.basic?.bolagsform ?? '').trim();
  if (c.basic?.isPersonal) {
    return { id, label, verdict: 'yes', detail: 'Enskild firma — kan inte vara börsnoterad.', source: 'register' };
  }
  const publ = /\(publ\)|\bpubl\b/i.test(name) || /publik/i.test(form);
  if (publ) {
    return {
      id,
      label,
      verdict: 'unknown',
      detail: `Publikt aktiebolag (${/publik/i.test(form) ? form : 'beteckningen (publ) i namnet'}) — ett publikt bolag KAN ha aktier upptagna till handel; kontrollera.`,
      source: 'manual',
      needs: 'Är aktierna upptagna till handel på en börs/reglerad marknad? (bolaget, Finansinspektionen/börsens lista).'
    };
  }
  const nonAbForm = /handelsbolag|kommanditbolag|ekonomisk förening|ekonomisk forening|enskild|ideell|stiftelse|bostadsrätt|^(hb|kb|ef|brf)$/i.test(form);
  if (nonAbForm) {
    return { id, label, verdict: 'yes', detail: `${form} — bolagsformen kan inte vara börsnoterad.`, source: 'register' };
  }
  const abByForm = /aktiebolag|^ab$/i.test(form);
  const abByName = /\bAB\b|aktiebolag/i.test(name);
  if (abByForm || abByName) {
    return {
      id,
      label,
      verdict: 'yes',
      detail: `Privat aktiebolag — ${abByForm ? `bolagsform "${form}" och ` : ''}namnet saknar beteckningen (publ) (ABL 28 kap. 7 §). Bara publika aktiebolag kan ta upp aktier till handel.`,
      source: 'register'
    };
  }
  return {
    id,
    label,
    verdict: 'unknown',
    detail: !c.dataFetched ? 'Inget uppslag gjort för bolaget.' : 'Bolagsform och namn saknas i underlaget — kan inte avgöras ur registret.',
    source: 'register',
    needs: 'Bolagsform/namn ur registret (grunddata) eller bolagets intyg.'
  };
}

/**
 * Indirekt ägande av fysiska personer i startup-bolaget via ägarkedjan: för
 * varje direkt bolagsägare med andel s hämtas DESS verklig huvudman (fysiska
 * personer, direkt, minsta intervallgräns) ⇒ s × p / 100, rekursivt uppåt
 * (Combly ← Wellgo 100 % ← Ewell 90 % ← personer). Används som LEDTRÅD i
 * punkten "grundarteamet äger ≥ 75 %" — registret vet inte att personerna är
 * grundarna, så svaret blir aldrig JA av detta ensamt.
 */
export function indirectPersonOwnership(
  subject: GroupCompanyFacts,
  factsByOrg: Map<string, GroupCompanyFacts>
): { minPct: number; via: string[] } | null {
  let total = 0;
  const via: string[] = [];
  const visited = new Set<string>([subject.orgNr]);
  const walk = (c: GroupCompanyFacts, factor: number, depth: number) => {
    if (depth > 4) return;
    for (const e of c.ownership) {
      if (e.direction !== 'owner' || e.indirect === true) continue;
      if (e.owner_kind === 'person') {
        if (c !== subject && (e.control_basis === undefined || e.control_basis === 'shares' || e.control_basis === 'votes')) {
          total += (factor * (ownershipShareRange(e)?.min ?? 0)) / 100;
        }
        continue;
      }
      if (!e.org_nr || visited.has(e.org_nr)) continue;
      const share = ownershipShareRange(e);
      const owner = factsByOrg.get(e.org_nr);
      if (!owner || !share) continue;
      visited.add(e.org_nr);
      via.push(owner.name ?? e.name ?? e.org_nr);
      walk(owner, (factor * share.max) / 100, depth + 1);
    }
  };
  walk(subject, 100, 0);
  if (via.length === 0 || total <= 0) return null;
  return { minPct: Math.round(total * 100) / 100, via };
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

/**
 * Lägger ett manuellt svar på en punkt. Konservativt: ett manuellt NEJ vinner
 * alltid (controllern vet något registret inte visar), ett manuellt JA fyller
 * bara en OKÄNT-punkt — ett register-NEJ (t.ex. beslutad utdelning i
 * årsredovisningen) kan inte skrivas över med ett intyg. Källan blir
 * "manuell kontroll" så PDF:n visar varifrån svaret kom.
 */
export function applyManualAnswer(check: ScreeningCheck, answer: ManualAnswer | undefined): ScreeningCheck {
  if (!answer) return check;
  const note = answer.note ? ` (${answer.note})` : '';
  if (answer.verdict === 'no') {
    return {
      ...check,
      verdict: 'no',
      detail: `Manuellt svar: Nej${note}.${check.source === 'register' && check.verdict !== 'unknown' ? ` Registret: ${check.detail}` : ''}`,
      source: 'manual',
      needs: undefined
    };
  }
  if (check.verdict === 'unknown') {
    return { ...check, verdict: 'yes', detail: `Manuellt svar: Ja${note}.`, source: 'manual', needs: undefined };
  }
  if (check.verdict === 'no') {
    return { ...check, detail: `${check.detail} Manuellt svar Ja${note} avviker från registret — registret gäller.` };
  }
  return check;
}

function conditionsFor(c: GroupCompanyFacts, ref: Date, manual?: CompanyManualAnswers): ScreeningCheck[] {
  const checks: ScreeningCheck[] = [];
  const b = c.basic;
  const noData = !c.dataFetched;
  const push = (check: ScreeningCheck) => checks.push(applyManualAnswer(check, manual?.[check.id as keyof CompanyManualAnswers]));
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

  // Börsnotering: ett register-JA (privat aktiebolag, annan bolagsform) är
  // ett rättsligt faktum — ett manuellt svar kan inte göra ett privat AB
  // noterat. Undantag från "manuellt NEJ vinner" (incident 2026-10-13: ett
  // inverterat svar hade gjort Wellgo Health AB "börsnoterat").
  const listed = listedCheck(c);
  if (listed.verdict === 'yes' && listed.source === 'register') {
    checks.push(
      manual?.listed?.verdict === 'no'
        ? { ...listed, detail: `${listed.detail} (Ett manuellt svar "börsnoterat" bortses från — ett privat aktiebolag kan inte vara noterat; ta bort svaret på punkten i rapporten.)` }
        : listed
    );
  } else {
    push(listed);
  }
  push(dividendCheck(c.financials ?? [], registered, ref, noData));
  for (const [id, label, needs] of [
    ['concentration', 'Inte bildat genom företagskoncentration', 'Bolagets intyg (undantag kan finnas).'],
    ['takeover', 'Har inte övertagit annat företags verksamhet (ombildad enskild firma undantas)', 'Bolagets intyg.']
  ] as const) {
    push({
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

const DIVIDEND_LABEL = 'Har inte beslutat om eller delat ut vinst';
const DIVIDEND_NEEDS = 'Bokslut med utdelningspost (datadelen Bokslut hos Roaring, /extended) eller bolagets intyg (svara på punkten i rapporten).';

/**
 * Art. 22 GBER: bolaget får inte ha delat ut vinst. Avgörs ur årsredovisningens
 * beslutade utdelning (`dividend_reported`/`dividend_sek`, § 11.8) — INTE ur
 * resultatet (en vinst som behålls i bolaget är tillåten):
 *   någon rapporterad utdelning > 0        ⇒ NEJ (registret)
 *   0 kr i VARJE räkenskapsår sedan start  ⇒ JA  (registret)
 *   0 kr men år saknas, eller inget svar   ⇒ OKÄNT med vad som saknas;
 *                                            resultatet ges som ledtråd
 *                                            (förlustår ⇒ utdelning osannolik).
 * Täckning = varje kalenderår från året efter registreringen t.o.m. senaste
 * rapporterade år; registreringsåret räknas inte (första räkenskapsåret
 * slutar oftast året efter) och ett ännu inte inlämnat innevarande år
 * noteras utan att fälla punkten.
 */
export function dividendCheck(
  rows: ScreeningFinancialsYear[],
  registered: Date | null,
  ref: Date,
  noData: boolean
): ScreeningCheck {
  const reported = rows.filter((r) => r.dividend_reported === true && typeof r.dividend_sek === 'number');
  const paid = reported.filter((r) => (r.dividend_sek ?? 0) > 0).sort((a, b) => a.year - b.year);
  if (paid.length > 0) {
    const total = paid.reduce((sum, r) => sum + (r.dividend_sek ?? 0), 0);
    return {
      id: 'dividend',
      label: DIVIDEND_LABEL,
      verdict: 'no',
      detail: `Årsredovisningen visar beslutad utdelning ${paid.map((r) => `${r.year}: ${fmtInt(r.dividend_sek ?? 0)} kr`).join(', ')} (totalt ${fmtInt(total)} kr).`,
      source: 'register'
    };
  }
  if (reported.length > 0) {
    const years = reported.map((r) => r.year).sort((a, b) => a - b);
    const latest = years[years.length - 1];
    const missing: number[] = [];
    if (registered) {
      for (let y = registered.getUTCFullYear() + 1; y <= latest; y++) if (!years.includes(y)) missing.push(y);
    }
    const notYetFiled = latest < ref.getUTCFullYear() - 1 ? ` Senaste årsredovisning avser ${latest}; senare år är inte inlämnade/hämtade.` : '';
    if (registered && missing.length === 0) {
      return {
        id: 'dividend',
        label: DIVIDEND_LABEL,
        verdict: 'yes',
        detail: `Ingen utdelning i årsredovisningarna för ${years.join(', ')} — täcker varje räkenskapsår sedan registreringen ${isoDay(registered)}.${notYetFiled}`,
        source: 'register'
      };
    }
    return {
      id: 'dividend',
      label: DIVIDEND_LABEL,
      verdict: 'unknown',
      detail: `Ingen utdelning i årsredovisningarna för ${years.join(', ')}, men ${
        registered ? `år ${missing.join(', ')} saknas` : 'registreringsdatum saknas så täckningen kan inte bekräftas'
      }.${notYetFiled}`,
      source: 'register',
      needs: registered ? `Årsredovisning för ${missing.join(', ')} (eller bolagets intyg).` : DIVIDEND_NEEDS
    };
  }
  const withResult = rows.filter((r) => typeof r.net_result_sek === 'number').sort((a, b) => a.year - b.year);
  const profitYears = withResult.filter((r) => (r.net_result_sek ?? 0) > 0).map((r) => r.year);
  let hint = '';
  if (withResult.length > 0) {
    hint =
      profitYears.length === 0
        ? ` Bokslutet visar bara förlustår (${withResult.map((r) => r.year).join(', ')}) — utdelning är osannolik men inte utesluten.`
        : ` Bokslutet visar vinst ${profitYears.join(', ')} — kontrollera vinstdispositionen i årsredovisningen.`;
  }
  return {
    id: 'dividend',
    label: DIVIDEND_LABEL,
    verdict: 'unknown',
    detail: `${noData ? 'Inget uppslag gjort för bolaget.' : 'Bokslut med utdelningspost hämtades inte.'}${hint}`,
    source: 'manual',
    needs: DIVIDEND_NEEDS
  };
}

// ─── Regelträdet ─────────────────────────────────────────────────────────────

export function screenExcellence(input: ExcellenceScreeningInput): ExcellenceScreeningResult {
  const ref = input.refDate;
  const subject = input.subject;
  const manual = input.manual;
  const all: ScreeningCheck[] = [];
  const push = (c: ScreeningCheck) => {
    all.push(c);
    return c;
  };

  // Startup-bolaget
  const subjectConditions = conditionsFor(subject, ref, manual?.companies[subject.orgNr]).map(push);
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

  // Anknutna / partner / oklara — hela koncernen (egen ägarbild +
  // koncernregistrets lista + andra ledet ur uppslagna bolag).
  const refs = subject.basic?.isPersonal ? [] : deriveGroupCompanies(subject, input.related, manual?.group_companies ?? [], manual?.person_links);
  const factsByOrg = new Map(input.related.map((r) => [r.orgNr, r]));
  const emptyFacts = (r: RelatedCompanyRef): GroupCompanyFacts => ({
    orgNr: r.org_nr ?? '',
    name: r.name,
    dataFetched: false,
    ownership: [],
    groupStructureFetched: false,
    beneficialOwnersFetched: false
  });
  // Ägarnas andra bolag bär sin grunddata (SNI, ålder, status) ur
  // engagemangsuppslaget — den används när bolaget inte slagits upp separat.
  const factsFor = (r: RelatedCompanyRef): GroupCompanyFacts => {
    const facts = r.org_nr ? factsByOrg.get(r.org_nr) : undefined;
    const eng = r.personLink ? engagementBasicFor(subject, r.org_nr) : undefined;
    if (!eng) return facts ?? emptyFacts(r);
    const base = facts ?? emptyFacts(r);
    return base.basic ? base : { ...base, basic: eng, dataFetched: true };
  };
  const linkedRefs = refs.filter((r) => r.relation === 'linked');
  const partnerRefs = refs.filter((r) => r.relation === 'partner');
  const uncertainRefs = refs.filter((r) => r.relation === 'uncertain');

  for (const r of refs) {
    if (r.relation === 'exempt') continue;
    const facts = r.org_nr ? factsByOrg.get(r.org_nr) : undefined;
    const base = factsFor(r);
    const conditions = r.relation === 'linked' ? conditionsFor(base, ref, manual?.companies[base.orgNr]).map(push) : [];
    companies.push({
      orgNr: base.orgNr,
      name: facts?.name ?? r.name,
      role: r.relation === 'linked' ? 'linked' : 'partner',
      relation: r.relation,
      relationLabel: RELATION_LABEL[r.relation],
      shareLabel: r.shareLabel,
      reason: r.reason,
      indirect: r.indirect,
      groupRole: r.groupRole,
      via: r.via,
      level: r.level,
      transitive: r.transitive,
      manualDeclared: r.manualDeclared,
      personLink: r.personLink,
      dataFetched: base.dataFetched,
      basic: base.basic,
      conditions,
      owners: base.ownership.filter((o) => o.direction === 'owner'),
      holdings: base.ownership.filter((o) => o.direction === 'holding')
    });
  }

  const describe = (list: RelatedCompanyRef[]) =>
    list
      .map((r) => {
        const name = r.name || r.org_nr || 'okänt bolag';
        if (r.groupRole === 'parent') return `${name} (moderbolag${r.indirect ? ', indirekt' : ''}, ${r.shareLabel})`;
        if (r.groupRole === 'subsidiary') return `${name} (dotterbolag, ${r.shareLabel})`;
        if (r.groupRole === 'sibling') return `${name} (systerbolag${r.via ? ` under ${r.via}` : ''})`;
        if (r.transitive) return `${name} (via ${r.via ?? 'annat bolag'})`;
        if (r.manualDeclared) return `${name} (angivet manuellt, ${r.direction === 'owner' ? 'äger' : 'ägs'} ${r.shareLabel})`;
        if (r.personLink) {
          const why = r.personLink.manual
            ? 'bedömt av controllern'
            : r.personLink.sniMatch === 'same'
              ? `samma SNI-kod ${r.personLink.matchedCode ?? ''}`.trim()
              : r.personLink.sniMatch === 'near'
                ? `närliggande bransch ${r.personLink.matchedCode ?? ''}`.trim()
                : 'SNI-kod saknas';
          return `${name} (ägs av ${r.personLink.personName ?? 'en ägare'} ${r.shareLabel}, ${why})`;
        }
        return `${name} (${r.direction === 'owner' ? 'äger' : 'ägs'} ${r.shareLabel})`;
      })
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
    const fromGroup = linkedRefs.filter((r) => r.groupRole).length;
    const onlyManual = linkedRefs.every((r) => r.manualDeclared);
    standalone = {
      id: 'standalone',
      label: 'Fristående företag',
      verdict: 'no',
      detail: `Finns anknutet företag: ${describe(linkedRefs)}. 100 % av varje anknutet bolags uppgifter läggs till och grundförutsättningarna prövas även för dem.${
        fromGroup > 0
          ? ` Koncernregistret visar ${linkedRefs.length === 1 ? 'ett bolag' : `${linkedRefs.length} bolag`} i samma koncern (moder-, dotter- och systerbolag räknas alla som anknutna, bilaga I art. 3.3).`
          : subject.groupMembers === undefined && subject.groupStructureFetched
            ? ' Systerbolag under samma moder syns bara när koncernstrukturen hämtas färskt från registret (sparade data bär bara ägarkedjan).'
            : ''
      }${onlyManual ? ' Koncernregistret bar inte bolaget — uppgiften är controllerns (aktiebok/avtal).' : ''}`,
      source: onlyManual ? 'manual' : 'register'
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
    const viaPerson = uncertainRefs.filter((r) => r.personLink);
    const viaShare = uncertainRefs.filter((r) => !r.personLink);
    standalone = {
      id: 'standalone',
      label: 'Fristående företag',
      verdict: 'unknown',
      detail: [
        viaShare.length > 0 ? `Andelen kan inte avgöras för: ${describe(viaShare)}.` : '',
        viaPerson.length > 0
          ? `Ägarnas andra bolag som kan verka på samma marknad: ${describe(viaPerson)} — avgör relationen under "Ägarnas andra bolag".`
          : ''
      ]
        .filter(Boolean)
        .join(' '),
      source: 'register',
      needs: [
        viaShare.length > 0 ? 'Exakt kapital-/röstandel ur aktieboken.' : '',
        viaPerson.length > 0 ? 'Om ägarnas andra bolag verkar på samma eller angränsande marknad (SNI-kod / verksamhet).' : ''
      ]
        .filter(Boolean)
        .join(' ')
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
    // Koncernregistret byggs ur årsredovisningar: ett bolag som registrerats
    // de senaste två åren hinner ofta inte in i moderns koncernredovisning,
    // så en tom koncernlista bevisar inget för det — aktieboken avgör.
    const registeredAt = subject.basic?.registeredAt ? new Date(`${subject.basic.registeredAt.slice(0, 10)}T00:00:00Z`) : null;
    const tooYoungForGroupRegister =
      !!registeredAt && !Number.isNaN(registeredAt.getTime()) && ref.getTime() - registeredAt.getTime() < GROUP_REGISTER_LAG_MS;
    standalone =
      tooYoungForGroupRegister
        ? {
            id: 'standalone',
            label: 'Fristående företag',
            verdict: 'unknown',
            detail: `Koncernregistret visar ingen koncern, men det bygger på årsredovisningar och bolaget registrerades ${subject.basic?.registeredAt?.slice(0, 10)} — ett så nytt bolag finns sällan i moderns koncernredovisning ännu. Ägs bolaget av ett annat bolag (aktieboken) anges det under "Lägg till koncernbolag" i koncernkartan, så hämtas det bolagets koncern.`,
            source: 'manual',
            needs: 'Aktiebok: äger något bolag 25 % eller mer? Ange det som koncernbolag.'
          }
        : subject.beneficialOwnersFetched && directPersonMin > 100 - PARTNER_THRESHOLD_PCT
        ? {
            id: 'standalone',
            label: 'Fristående företag',
            verdict: 'yes',
            detail: `Inget moder-/dotterbolag i koncernregistret, och fysiska personer äger direkt minst ${formatPct(directPersonMin)} — det ryms ingen bolagsägare med 25 % eller mer. ${
              subject.ownerEngagements
                ? 'Ägarnas andra bolag är kontrollerade: inget av dem verkar på samma marknad enligt SNI-koden.'
                : 'Kontrollera att ingen ägare äger annat företag på samma marknad (datadelen "Ägarnas andra bolag").'
            }`,
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
  // Aktieboken är den enda säkra källan för 25 %-gränsen: ett manuellt Nej
  // väger alltid tyngst, ett manuellt Ja fyller bara en OKÄNT-punkt.
  standalone = applyManualAnswer(standalone, manual?.standalone);
  push(standalone);

  // Tröskelvärden — startup + 100 % anknutna + partnerns andel
  const rows: ThresholdRow[] = [];
  const rowFor = (c: GroupCompanyFacts, role: ThresholdRow['role'], weight: number): ThresholdRow => {
    const fin = c.financials ? latestFinancials(c.financials) : null;
    if (!fin) {
      // Nystartat bolag utan bokslut: bilaga I art. 4.3 — uppgifterna tas ur
      // en uppskattning i god tro under räkenskapsåret (skrivs direkt i tröskelvärdets rad).
      const est = manual?.estimates?.[c.orgNr];
      if (est && (est.employees !== undefined || est.revenue_sek !== undefined || est.balance_sheet_sek !== undefined)) {
        return {
          orgNr: c.orgNr,
          name: c.name,
          role,
          weight,
          employees: est.employees,
          revenue_sek: est.revenue_sek,
          balance_sheet_sek: est.balance_sheet_sek,
          note: `Bolagets egen uppskattning${est.note ? `: ${est.note}` : ''}`,
          estimated: true
        };
      }
    }
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
  for (const r of linkedRefs) rows.push(rowFor(factsFor(r), 'linked', 1));
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
  const anyEstimated = rows.some((r) => r.estimated);
  const thresholdSource: ScreeningSource = anyEstimated ? 'manual' : 'register';
  let thresholdCheck: ScreeningCheck;
  const parts: string[] = [];
  if (emp.value !== undefined) parts.push(`${fmtInt(emp.value)} anställda`);
  if (rev.value !== undefined) parts.push(`omsättning ${formatMillionEur(rev.value, input.sekPerEur)}`);
  if (bal.value !== undefined) parts.push(`balansomslutning ${formatMillionEur(bal.value, input.sekPerEur)}`);
  const basis = `${parts.length > 0 ? `Sammanlagt (${rows.length === 1 ? 'startup-bolaget' : `${rows.length} bolag`}): ${parts.join(', ')}.` : 'Inga tal i underlaget.'}${
    anyEstimated ? ' Bolagets egen uppskattning ingår (bilaga I art. 4.3).' : ''
  }`;
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
      source: thresholdSource
    };
  } else if (moneyFail) {
    thresholdCheck = {
      id: 'thresholds',
      label: 'Klarar tröskelvärdet för småföretag (< 50 anställda, ≤ 10 M€ omsättning eller balansomslutning)',
      verdict: 'no',
      detail: `${basis} Både omsättning och balansomslutning över 10 M€.`,
      source: thresholdSource
    };
  } else if (emp.value !== undefined && moneyOk && allRowsComplete) {
    thresholdCheck = {
      id: 'thresholds',
      label: 'Klarar tröskelvärdet för småföretag (< 50 anställda, ≤ 10 M€ omsättning eller balansomslutning)',
      verdict: 'yes',
      detail: basis,
      source: thresholdSource
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
      source: thresholdSource,
      needs: 'Senaste bokslut (anställda, omsättning, balansomslutning) för varje bolag i koncernen — eller bolagets egna uppgifter när inget bokslut finns.'
    };
  }
  push(thresholdCheck);

  // De minimis-intyg — "ett enda företag": startup-bolaget + anknutna
  // (partners räknas inte). Plattformens egna de minimis-register för
  // portföljbolag, annars bolagets intyg (manuellt svar) per anknutet bolag.
  const DE_MINIMIS_LABEL = 'Intyg: mindre än 300 000 € de minimis innevarande år + två år bakåt (inkl. anknutna företag)';
  const linkedForDeMinimis = companies.filter((c) => c.role === 'linked');
  const linkedKnown: string[] = [];
  const linkedUnknown: string[] = [];
  let linkedUsedEur = 0;
  for (const c of linkedForDeMinimis) {
    const facts = factsByOrg.get(c.orgNr);
    const dm = facts?.deMinimis ?? (manual?.de_minimis_related[c.orgNr]
      ? { usedEur: manual.de_minimis_related[c.orgNr].used_eur, source: 'certificate' as const, note: manual.de_minimis_related[c.orgNr].note }
      : undefined);
    const label = c.name || c.orgNr;
    if (dm) {
      linkedUsedEur += dm.usedEur;
      linkedKnown.push(`${label} ${fmtInt(dm.usedEur)} € (${dm.source === 'platform' ? 'plattformen' : 'intyg'}${dm.note ? `: ${dm.note}` : ''})`);
    } else linkedUnknown.push(label);
  }
  let deMinimis: ScreeningCheck;
  if (input.deMinimis) {
    const cap = input.deMinimis.capEur;
    const total = input.deMinimis.usedEur + linkedUsedEur;
    const remaining = cap - total;
    const linkedText =
      linkedForDeMinimis.length === 0
        ? ''
        : ` Anknutna: ${[...linkedKnown, ...linkedUnknown.map((n) => `${n} okänt`)].join('; ')}.`;
    deMinimis = {
      id: 'de_minimis',
      label: DE_MINIMIS_LABEL,
      verdict: remaining <= 0 ? 'no' : linkedUnknown.length > 0 ? 'unknown' : 'yes',
      detail: `${subject.name || 'Startup-bolaget'}: ${fmtInt(input.deMinimis.usedEur)} € registrerat i plattformen.${linkedText} Sammanlagt ${fmtInt(total)} € — kvar ${fmtInt(Math.max(0, remaining))} € av ${fmtInt(cap)} €.`,
      source: linkedKnown.length > 0 && linkedKnown.some((t) => t.includes('intyg')) ? 'manual' : 'platform',
      needs: remaining > 0 && linkedUnknown.length > 0 ? `Intyg om de minimis-stöd till ${linkedUnknown.join(', ')}.` : undefined
    };
  } else {
    deMinimis = {
      id: 'de_minimis',
      label: DE_MINIMIS_LABEL,
      verdict: 'unknown',
      detail: `Inget registrerat stöd i plattformen för bolaget (bolaget finns inte i plattformen).${
        linkedKnown.length > 0 ? ` Anknutna: ${linkedKnown.join('; ')}.` : ''
      }`,
      source: 'manual',
      needs: 'Intyg om mottaget de minimis-stöd (innevarande + två år bakåt, inkl. anknutna företag).'
    };
  }
  push(deMinimis);

  // Sammanfattande bedömning art. 22 GBER
  const v = (list: ScreeningCheck[], id: string) => list.find((c) => c.id === id)?.verdict ?? 'unknown';
  const reasonsNo: string[] = [];
  const CONDITION_NO_TEXT: Record<string, string> = {
    age: 'är äldre än 5 år',
    economic: 'är inte aktivt',
    listed: 'är börsnoterat',
    dividend: 'har delat ut vinst',
    concentration: 'är bildat genom företagskoncentration',
    takeover: 'har övertagit annat företags verksamhet'
  };
  for (const [id, text] of Object.entries(CONDITION_NO_TEXT)) {
    if (v(subjectConditions, id) === 'no') reasonsNo.push(`${subject.name || 'startup-bolaget'} ${text}`);
  }
  for (const c of companies) {
    if (c.role !== 'linked') continue;
    for (const [id, text] of Object.entries(CONDITION_NO_TEXT)) {
      if (v(c.conditions, id) === 'no') reasonsNo.push(`anknutna ${c.name || c.orgNr} ${text}`);
    }
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
    // Bara de punkter som fortfarande är obesvarade listas som manuella.
    const manualOpen: string[] = [];
    const openLabel: Record<string, string> = {
      listed: 'börsnotering',
      dividend: 'vinstutdelning',
      concentration: 'företagskoncentration',
      takeover: 'övertagen verksamhet'
    };
    for (const [id, label] of Object.entries(openLabel)) {
      if (v(subjectConditions, id) !== 'yes') manualOpen.push(label);
      else if (companies.some((c) => c.role === 'linked' && v(c.conditions, id) !== 'yes')) manualOpen.push(`${label} (anknutna bolag)`);
    }
    if (standalone.verdict !== 'yes') manualOpen.push('partnerföretagens andel');
    const dividendNote = v(subjectConditions, 'dividend') === 'yes' && subjectConditions.find((c) => c.id === 'dividend')?.source === 'register'
      ? ' (ingen vinstutdelning enligt årsredovisningarna)'
      : '';
    stateAid =
      manualOpen.length === 0
        ? {
            outcome: 'art22_possible',
            text: `${subjectName} uppfyller kraven för art. 22 GBER enligt underlaget${dividendNote} — alla grundförutsättningar är besvarade (register + manuella svar).`
          }
        : {
            outcome: 'art22_possible',
            text: `${subjectName} kan uppfylla kraven för art. 22 GBER${dividendNote} — förutsatt de manuella kontrollerna (${manualOpen.join(', ')}).`
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
  const founderSource: ScreeningSource = input.foundersSource === 'manual' ? 'manual' : 'platform';
  // Indirekt ägande via holdingbolag (Combly ← Wellgo ← personer): registret
  // visar att FYSISKA PERSONER äger via kedjan, men inte att de är grundarna
  // — därför en ledtråd, aldrig ett JA av sig självt.
  const indirect = subject.basic?.isPersonal ? null : indirectPersonOwnership(subject, factsByOrg);
  const directCompanyOwned = subject.ownership
    .filter((e) => e.direction === 'owner' && e.indirect !== true && e.owner_kind !== 'person')
    .reduce((a, e) => a + (ownershipShareRange(e)?.max ?? 0), 0);
  const indirectHint = indirect
    ? ` Indirekt ägande: via ${indirect.via.join(' → ')} äger fysiska personer minst ${formatPct(indirect.minPct)} av startup-bolaget enligt verklig huvudman — är det grundarteamet räknas det (direkt eller indirekt); ange då grundarnas totala andel inkl. indirekt i grundartabellen.`
    : directCompanyOwned >= PARTNER_THRESHOLD_PCT
      ? ` Startup-bolaget ägs till ${formatPct(directCompanyOwned)} av bolag — grundarnas andel kan vara indirekt (via holdingbolag); hämta verklig huvudman för ägarbolagen eller ange andelen inkl. indirekt ägande i grundartabellen.`
      : '';
  if (founders === undefined) {
    vinnovaChecks.push({
      id: 'founders_75',
      label: 'Grundarteamet äger minst 75 % av startup-bolaget (direkt eller indirekt)',
      verdict: 'unknown',
      detail: `Bolaget finns inte i plattformen — grundarnas ägande finns inte i registret (verklig huvudman visas utan namn). Lägg in grundarna i grundartabellen.${indirectHint}`,
      source: 'manual',
      needs: 'Grundare och ägarandelar (aktiebok, inkl. indirekt ägande via holdingbolag).'
    });
  } else if (founders.length === 0) {
    vinnovaChecks.push({
      id: 'founders_75',
      label: 'Grundarteamet äger minst 75 % av startup-bolaget (direkt eller indirekt)',
      verdict: 'unknown',
      detail: `Inga grundare med ägarandel i teamet på bolagskortet. Lägg in grundarna i grundartabellen eller i teamet på bolagskortet.${indirectHint}`,
      source: 'platform',
      needs: 'Grundare och ägarandelar läggs in i teamet på bolagskortet (inkl. indirekt ägande via holdingbolag).'
    });
  } else {
    const sum = founders.reduce((a, f) => a + (typeof f.equity_pct === 'number' ? f.equity_pct : 0), 0);
    const withPct = founders.filter((f) => typeof f.equity_pct === 'number').length;
    const below = sum < FOUNDER_OWNERSHIP_MIN_PCT && withPct > 0;
    vinnovaChecks.push({
      id: 'founders_75',
      label: 'Grundarteamet äger minst 75 % av startup-bolaget (direkt eller indirekt)',
      verdict: sum >= FOUNDER_OWNERSHIP_MIN_PCT ? 'yes' : withPct === 0 ? 'unknown' : 'no',
      detail: `${founders.length} grundare${founderSource === 'manual' ? ' (manuellt inmatade)' : ' i teamet'}, sammanlagt ${formatPct(Math.round(sum * 100) / 100)}${
        withPct < founders.length ? ` (${founders.length - withPct} utan angiven andel)` : ''
      }.${below ? ' Undantag: kapitalintensiv bransch med giltigt skäl för emission.' : ''}${below || withPct === 0 ? indirectHint : ''}`,
      source: founderSource,
      needs: withPct === 0 ? 'Ägarandel per grundare (inkl. indirekt via holdingbolag).' : undefined
    });
  }
  vinnovaChecks.push(founderDrivenCheck(founders, manual?.maturity_phase, manual?.research_spinoff === true, founderSource));

  const subjFin = subject.financials ? latestFinancials(subject.financials) : null;
  let marketReady: ScreeningCheck;
  if (
    subjFin &&
    typeof subjFin.equity_sek === 'number' &&
    typeof subjFin.revenue_sek === 'number' &&
    typeof subjFin.net_result_sek === 'number'
  ) {
    const annualCosts = Math.max(0, subjFin.revenue_sek - subjFin.net_result_sek);
    const ok = subjFin.equity_sek < 2 * annualCosts;
    marketReady = {
      id: 'not_market_ready',
      label: 'Inte marknadsredo (eget kapital under omkostnaderna kommande 24 mån, validerar fortfarande affären)',
      verdict: ok ? 'yes' : 'unknown',
      detail: `Bokslut ${subjFin.year}: eget kapital ${fmtInt(subjFin.equity_sek)} kr mot ungefärliga kostnader ${fmtInt(2 * annualCosts)} kr för 24 mån (omsättning − resultat, × 2).${
        ok ? '' : ' Eget kapital täcker kostnaderna enligt bokslutet — bekräfta mot budget.'
      } Att affärsmodellen fortfarande valideras bedöms av coachen.`,
      source: 'register',
      needs: ok ? undefined : 'Budget kommande 24 månader och coachens bedömning.'
    };
  } else {
    marketReady = {
      id: 'not_market_ready',
      label: 'Inte marknadsredo (eget kapital under omkostnaderna kommande 24 mån, validerar fortfarande affären)',
      verdict: 'unknown',
      detail: 'Bokslut med eget kapital, omsättning och resultat saknas — nystartade bolag har sällan något.',
      source: 'manual',
      needs: 'Budget kommande 24 månader och coachens bedömning av affärsmodellen.'
    };
  }
  vinnovaChecks.push(applyManualAnswer(marketReady, manual?.not_market_ready));
  vinnovaChecks.push(
    applyManualAnswer(
      {
        id: 'innovative',
        label: 'Innovativt — unika egenskaper som ger uthålliga konkurrensfördelar',
        verdict: 'unknown',
        detail: 'Bedöms av coach/controller.',
        source: 'manual',
        needs: 'Coachens bedömning av innovationshöjd.'
      },
      manual?.innovative
    )
  );
  vinnovaChecks.push(
    applyManualAnswer(
      {
        id: 'other_criteria',
        label: 'Övriga villkor: Agenda 2030 i SRL-dimensionen, skalbarhet (tydlig från mognadsnivå 2), unika kunskapstillgångar',
        verdict: 'unknown',
        detail: 'Bedöms av coach/controller.',
        source: 'manual',
        needs: 'Coachens bedömning av Agenda 2030, skalbarhet och kunskapstillgångar.'
      },
      manual?.other_criteria
    )
  );
  vinnovaChecks.forEach(push);

  const f75 = vinnovaChecks[0].verdict;
  const restChecks = vinnovaChecks.slice(1);
  const restNo = restChecks.filter((c) => c.verdict === 'no');
  const restOpen = restChecks.filter((c) => c.verdict !== 'yes');
  const vinnova: ExcellenceScreeningResult['vinnova'] =
    stateAid.outcome === 'not_eligible'
      ? { outcome: 'not_in_target', text: 'Bolaget kan inte ta emot företagsstöd — Vinnovas bidragsmedel får inte användas.' }
      : f75 === 'no'
        ? {
            outcome: 'not_in_target',
            text: 'Grundarteamet äger mindre än 75 % — ingår inte i målgruppen om inte undantaget för kapitalintensiv bransch med giltigt skäl för emission gäller.'
          }
        : restNo.length > 0
          ? {
              outcome: 'not_in_target',
              text: `Uppfyller inte: ${restNo.map((c) => c.label.split(' — ')[0].split(' (')[0].split(':')[0]).join(', ')}.`
            }
          : f75 === 'yes' && stateAid.outcome !== 'undetermined' && restOpen.length === 0
            ? {
                outcome: 'in_target_possible',
                text: 'Grundarägande, grundardrivet, inte marknadsredo, innovationshöjd och övriga villkor är uppfyllda enligt underlaget, och bolaget kan ta emot företagsstöd eller de minimis.'
              }
            : f75 === 'yes' && stateAid.outcome !== 'undetermined'
              ? {
                  outcome: 'in_target_possible',
                  text: `Grundarägandet är uppfyllt och bolaget kan ta emot företagsstöd eller de minimis. Återstår: ${restOpen
                    .map((c) => c.label.split(' — ')[0].split(' (')[0].split(':')[0].toLowerCase())
                    .join(', ')}.`
                }
              : {
                  outcome: 'undetermined',
                  text: 'Kräver grundarägande, statsstödsgrund och bedömning av engagemang, innovationshöjd och mognadsnivå.'
                };

  // IRL — bolagskortets KTH-bedömning (§ 52.2) per axel; en axel bolagskortet
  // saknar fylls av manuellt angiven nivå (bolag utanför plattformen, eller
  // SRL som KTH-bedömningen inte bär). Motivering per axel ur manuella svar.
  let irl: ScreeningIrl | null = input.irl ? { ...input.irl } : null;
  const irlFacts = manual?.irl;
  if (irlFacts?.levels) {
    const base: ScreeningIrl = irl ?? { level: null };
    let fromManual = false;
    const pick = (ax: 'crl' | 'brl' | 'tmrl' | 'srl'): number | null => {
      if (typeof base[ax] === 'number') return base[ax] as number;
      const m = irlFacts.levels?.[ax];
      if (typeof m === 'number') {
        fromManual = true;
        return m;
      }
      return null;
    };
    const next: ScreeningIrl = { ...base, crl: pick('crl'), brl: pick('brl'), tmrl: pick('tmrl'), srl: pick('srl') };
    if (fromManual) next.manualLevels = true;
    irl = next;
  }
  if (irlFacts?.notes && Object.keys(irlFacts.notes).length > 0) {
    irl = { ...(irl ?? { level: null }), notes: { ...(irl?.notes ?? {}), ...irlFacts.notes } };
  }

  const excellenceBase: ScreeningCheck = {
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
  };
  const excellence = push(applyManualAnswer(excellenceBase, manual?.excellence));

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
    irl,
    excellence,
    comment: manual?.comment,
    missing,
    checks: all,
    ownerEngagements: subject.basic?.isPersonal ? undefined : classifyOwnerEngagements(subject, manual?.person_links)
  };
}

/**
 * Grundardrivet: engagemang i % av heltid mot fasens trösklar
 * (`FOUNDER_ENGAGEMENT_THRESHOLDS`, Challes karta). Formation har inget krav.
 * Forskningsavknoppning: forskarnas engagemang räknas men noteras — teamet
 * ska komplettera. OKÄNT när fas eller engagemang saknas.
 */
export function founderDrivenCheck(
  founders: ScreeningFounderRow[] | undefined,
  phase: ScreeningManualFacts['maturity_phase'],
  researchSpinoff: boolean,
  source: ScreeningSource
): ScreeningCheck {
  const label = 'Grundardrivet (engagemang i % av heltid)';
  const rule =
    'Trösklar enligt kartan: formation inget krav; problem/solution-fit sammantaget ≥ 40 % och en grundare ≥ 20 %; product/market-fit sammantaget ≥ 60 % och en grundare ≥ 40 %.';
  const needs = 'Grundarnas engagemang i % av heltid och bolagets mognadsfas (grundartabellen i rapporten).';
  if (!phase) {
    return { id: 'founder_driven', label, verdict: 'unknown', detail: `Mognadsfas inte angiven. ${rule}`, source: 'manual', needs };
  }
  const t = FOUNDER_ENGAGEMENT_THRESHOLDS[phase];
  const phaseLabel = MATURITY_PHASE_LABEL[phase];
  if (phase === 'formation') {
    return {
      id: 'founder_driven',
      label,
      verdict: 'yes',
      detail: `Fas ${phaseLabel}: inget krav på engagemang i denna fas.${researchSpinoff ? ' Forskningsavknoppning — forskarnas engagemang ska kompletteras av teamet.' : ''}`,
      source: 'manual'
    };
  }
  const withEng = (founders ?? []).filter((f) => typeof f.engagement_pct === 'number');
  if (withEng.length === 0) {
    return {
      id: 'founder_driven',
      label,
      verdict: 'unknown',
      detail: `Fas ${phaseLabel} (krav: sammantaget ≥ ${t.total} %, en grundare ≥ ${t.single} %), men inget engagemang är angivet per grundare.`,
      source: 'manual',
      needs: 'Engagemang i % av heltid per grundare (grundartabellen i rapporten).'
    };
  }
  const total = withEng.reduce((a, f) => a + (f.engagement_pct ?? 0), 0);
  const max = Math.max(...withEng.map((f) => f.engagement_pct ?? 0));
  const ok = total >= t.total && max >= t.single;
  const list = withEng.map((f) => `${f.name} ${formatPct(f.engagement_pct ?? 0)}${f.researcher ? ' (forskare)' : ''}`).join(', ');
  return {
    id: 'founder_driven',
    label,
    verdict: ok ? 'yes' : 'no',
    detail: `Fas ${phaseLabel}: sammantaget ${formatPct(Math.round(total * 100) / 100)} (krav ≥ ${t.total} %), högst ${formatPct(max)} (krav ≥ ${t.single} %) — ${list}.${
      researchSpinoff ? ' Forskningsavknoppning — forskarnas engagemang kompletteras av teamet.' : ''
    } Trösklarna följer kartan; Vinnovas metodbeskrivning kan ange andra värden (se dokumentationen).`,
    source
  };
}
