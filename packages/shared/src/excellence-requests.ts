// Bedömning excellens — BEGÄRAN OM KOMPLETTERING (CLAUDE.md § 51.6).
//
// Listan över OKÄNT-punkter i en bedömning blir en färdig förfrågan till
// coachen eller till bolaget: varje punkt är ett "ärende" (item) som
// mottagaren besvarar direkt i systemet. Svaren slås ihop till de manuella
// svaren (`ScreeningManualFacts`, § 51.4) så nästa omräkning väger in dem —
// ingen parallell sanning. REN modul: härledning, normalisering och
// sammanslagning utan IO, delad av server-action, skrivlager, formulär och
// tester. Allt okänt släpps, inget kastas.

import {
  COMPANY_MANUAL_CONDITIONS,
  IRL_AXES,
  SCREENING_MAX_FOUNDERS,
  SCREENING_NOTE_MAX,
  normalizeScreeningFacts,
  type CompanyManualCondition,
  type IrlAxis,
  type ManualAnswer,
  type ScreeningFounderFact,
  type ScreeningManualFacts
} from './excellence-facts';
import type { ExcellenceScreeningResult, ScreeningCheck } from './excellence-screening';

// ─── Frågetexter (delade av Manuella svar och kompletteringsformuläret) ────

/**
 * Frågorna ställs som NATURLIGA frågor med svarsalternativ som säger vad de
 * betyder. Lagrat `verdict` är alltid i VILLKORETS riktning (`yes` = villkoret
 * uppfyllt) — alternativet "Nej — inte börsnoterat" lagras alltså som `yes`.
 * Incident 2026-10-13: med etiketten "Inte börsnoterat" + Ja/Nej svarade
 * controllern "Nej" (= inte noterat) och bedömningen läste det som "ÄR
 * börsnoterat". Därför aldrig mer ett nakent Ja/Nej.
 */
export interface ScreeningQuestionMeta {
  question: string;
  /** Svarsalternativ som betyder "villkoret uppfyllt" (lagras som `yes`). */
  fulfilled: string;
  /** Svarsalternativ som betyder "villkoret INTE uppfyllt" (lagras som `no`). */
  failed: string;
  hint?: string;
}

export const SCREENING_CONDITION_QUESTION: Record<CompanyManualCondition, ScreeningQuestionMeta> = {
  listed: {
    question: 'Är bolaget börsnoterat?',
    fulfilled: 'Nej — inte börsnoterat',
    failed: 'Ja — aktierna är upptagna till handel',
    hint: 'Avgörs normalt ur registret: ett privat aktiebolag (utan "(publ)" i namnet) kan inte vara noterat. Svara bara för ett publikt bolag.'
  },
  dividend: {
    question: 'Har bolaget beslutat om eller delat ut vinst?',
    fulfilled: 'Nej — ingen utdelning',
    failed: 'Ja — utdelning har beslutats',
    hint: 'Avgörs ur årsredovisningens utdelningspost när bokslutet hämtats; ett intyg fyller bara en okänd punkt.'
  },
  concentration: {
    question: 'Är bolaget bildat genom företagskoncentration (fusion/sammanslagning)?',
    fulfilled: 'Nej',
    failed: 'Ja — bildat genom koncentration'
  },
  takeover: {
    question: 'Har bolaget övertagit ett annat företags verksamhet?',
    fulfilled: 'Nej',
    failed: 'Ja — övertagit verksamhet',
    hint: 'Ombildning av enskild firma till aktiebolag undantas.'
  }
};

export const SCREENING_VINNOVA_IDS = ['not_market_ready', 'innovative', 'other_criteria'] as const;
export type ScreeningVinnovaId = (typeof SCREENING_VINNOVA_IDS)[number];

export const SCREENING_VINNOVA_QUESTION: Record<ScreeningVinnovaId, ScreeningQuestionMeta> = {
  not_market_ready: {
    question: 'Är bolaget fortfarande inte marknadsredo?',
    fulfilled: 'Ja — inte marknadsredo',
    failed: 'Nej — bolaget är marknadsredo',
    hint: 'Eget kapital under omkostnaderna kommande 24 mån och affärsmodellen valideras fortfarande (budget + coachens bedömning).'
  },
  innovative: {
    question: 'Är bolaget innovativt?',
    fulfilled: 'Ja — unika egenskaper ger uthålliga konkurrensfördelar',
    failed: 'Nej',
    hint: 'Coachens bedömning av innovationshöjd.'
  },
  other_criteria: {
    question: 'Uppfylls övriga villkor?',
    fulfilled: 'Ja — uppfyllda',
    failed: 'Nej',
    hint: 'Agenda 2030 i SRL-dimensionen, skalbarhet (tydlig från mognadsnivå 2), unika kunskapstillgångar.'
  }
};

export const SCREENING_EXCELLENCE_QUESTION: ScreeningQuestionMeta = {
  question: 'Uppfyller bolaget villkoren för excellent inkubation?',
  fulfilled: 'Ja — villkoren uppfyllda',
  failed: 'Nej — uppfylls inte',
  hint: 'Har något hänt som påverkar rätten att ta emot inkubationsmedel? Beslutet registreras som förut på bolagskortet.'
};

// ─── Modellen ─────────────────────────────────────────────────────────────

export const SCREENING_REQUEST_RECIPIENTS = ['coach', 'startup'] as const;
export type ScreeningRequestRecipient = (typeof SCREENING_REQUEST_RECIPIENTS)[number];

export const SCREENING_REQUEST_RECIPIENT_LABEL: Record<ScreeningRequestRecipient, string> = {
  coach: 'Coachen',
  startup: 'Bolaget'
};

export const SCREENING_REQUEST_STATUSES = ['open', 'partially_answered', 'answered', 'closed'] as const;
export type ScreeningRequestStatus = (typeof SCREENING_REQUEST_STATUSES)[number];

export const SCREENING_REQUEST_STATUS_LABEL: Record<ScreeningRequestStatus, string> = {
  open: 'Väntar på svar',
  partially_answered: 'Delvis besvarad',
  answered: 'Besvarad',
  closed: 'Avslutad'
};

/**
 * Vilken sorts uppgift mottagaren ska lämna. `condition` = grundförutsättning
 * per bolag, `founders` = grundarteam (ägarandel, engagemang, fas),
 * `de_minimis` = intyg per anknutet bolag, `estimate` = tröskelvärdets tal
 * för ett bolag utan bokslut, `vinnova` = coachens målgruppsbedömning,
 * `irl` = IRL-nivåer/motivering, `excellence` = excellensvillkoren,
 * `document` = ett underlag som inte kan struktureras (aktiebok, bekräftelse)
 * — svaret är text och går bara in i förfrågan, aldrig i de manuella svaren.
 */
export const SCREENING_REQUEST_ITEM_KINDS = [
  'condition',
  'founders',
  'de_minimis',
  'estimate',
  'vinnova',
  'irl',
  'excellence',
  'document'
] as const;
export type ScreeningRequestItemKind = (typeof SCREENING_REQUEST_ITEM_KINDS)[number];

/** Vem som rimligen kan svara: bolaget vet sina egna förhållanden, coachen bedömer. */
export const SCREENING_REQUEST_ITEM_AUDIENCE: Record<ScreeningRequestItemKind, ScreeningRequestRecipient[]> = {
  condition: ['coach', 'startup'],
  founders: ['coach', 'startup'],
  de_minimis: ['coach', 'startup'],
  estimate: ['coach', 'startup'],
  vinnova: ['coach'],
  irl: ['coach'],
  excellence: ['coach'],
  document: ['coach', 'startup']
};

export interface ScreeningRequestAnswer {
  /** condition/vinnova/excellence */
  verdict?: 'yes' | 'no';
  /** Motivering/källa, eller hela svaret för `document`. */
  note?: string;
  /** founders */
  founders?: ScreeningFounderFact[];
  maturity_phase?: ScreeningManualFacts['maturity_phase'];
  research_spinoff?: boolean;
  /** de_minimis */
  used_eur?: number;
  /** estimate */
  employees?: number;
  revenue_sek?: number;
  balance_sheet_sek?: number;
  /** irl */
  levels?: Partial<Record<IrlAxis, number>>;
  notes?: Partial<Record<IrlAxis, string>>;
}

export interface ScreeningRequestItem {
  /** Stabil nyckel inom förfrågan (`condition:<orgNr>:<villkor>`, `founders`, `de_minimis:<orgNr>` …). */
  key: string;
  kind: ScreeningRequestItemKind;
  /** Vad som efterfrågas — visas för mottagaren. */
  label: string;
  /** Varför/hur (checkpunktens `needs`). */
  hint?: string;
  /** Bolaget punkten gäller (grundförutsättning/intyg/uppskattning). */
  org_nr?: string;
  org_name?: string;
  /** Villkoret (kind = condition) resp. Vinnova-punkten (kind = vinnova). */
  condition?: CompanyManualCondition;
  vinnova?: ScreeningVinnovaId;
  status: 'open' | 'answered';
  answer?: ScreeningRequestAnswer;
  /** Kort, PII-fri sammanfattning av svaret för översikten ("Nej — ingen utdelning", "3 grundare"). */
  answer_label?: string;
  answered_at?: string;
  answered_by?: string;
}

export const SCREENING_REQUEST_MAX_ITEMS = 40;
export const SCREENING_REQUEST_MESSAGE_MAX = 2000;
export const SCREENING_REQUEST_DOCUMENT_MAX = 2000;

const PERSONNUMMER_RE = /\b\d{6,8}[-+]?\d{4}\b/g;
const ORG_NR_RE = /^\d{10}$/;

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
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim()
    .replace(PERSONNUMMER_RE, '[REDACTED]');
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) : s;
}

function cleanPct(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n * 100) / 100;
}

function cleanSek(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v.replace(/\s/g, '').replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e13) return undefined;
  return Math.round(n);
}

function cleanLevel(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 9) return undefined;
  return n;
}

function cleanOrgNr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const digits = v.replace(/\D/g, '');
  const ten = digits.length === 12 && digits.startsWith('16') ? digits.slice(2) : digits;
  return ORG_NR_RE.test(ten) ? ten : undefined;
}

function cleanVerdict(v: unknown): 'yes' | 'no' | undefined {
  return v === 'yes' || v === 'no' ? v : undefined;
}

export const SCREENING_REQUEST_KIND_LABEL: Record<ScreeningRequestItemKind, string> = {
  condition: 'Grundförutsättning',
  founders: 'Grundarteam',
  de_minimis: 'De minimis-intyg',
  estimate: 'Uppskattning (bolag utan bokslut)',
  vinnova: 'Vinnovas målgrupp',
  irl: 'IRL-nivåer',
  excellence: 'Excellent inkubation',
  document: 'Underlag'
};

// ─── Härledning ur en bedömning ──────────────────────────────────────────

export interface DeriveRequestOptions {
  /** Anknutna bolag som redan har de minimis ur plattformen (intyg behövs inte). */
  deMinimisFromPlatform?: readonly string[];
  /** Startup-bolagets namn (etiketter). */
  subjectName?: string;
}

function companyLabel(name: string | undefined, orgNr: string): string {
  return name || formatOrgNrLoose(orgNr) || 'bolaget';
}

function formatOrgNrLoose(v: string | undefined): string {
  if (!v) return '';
  return ORG_NR_RE.test(v) ? `${v.slice(0, 6)}-${v.slice(6)}` : v;
}

function conditionItem(orgNr: string, name: string | undefined, c: CompanyManualCondition, check: ScreeningCheck): ScreeningRequestItem {
  return {
    key: `condition:${orgNr}:${c}`,
    kind: 'condition',
    label: `${companyLabel(name, orgNr)} — ${SCREENING_CONDITION_QUESTION[c].question}`,
    hint: check.needs ?? SCREENING_CONDITION_QUESTION[c].hint,
    org_nr: orgNr,
    org_name: name,
    condition: c,
    status: 'open'
  };
}

/**
 * Bygger kompletteringspunkterna ur en bedömning: varje OKÄNT som en
 * människa faktiskt kan svara på blir ett ärende. Punkter registret ska
 * avgöra (ålder, status, ekonomisk verksamhet) tas INTE med — där är
 * åtgärden att hämta grunddata, inte att fråga bolaget. Ordningen följer
 * bedömningens steg (grundförutsättningar → ägande → tröskel → de minimis →
 * Vinnova → IRL → excellens).
 */
export function deriveScreeningRequestItems(result: ExcellenceScreeningResult, opts: DeriveRequestOptions = {}): ScreeningRequestItem[] {
  const items: ScreeningRequestItem[] = [];
  const platformDm = new Set(opts.deMinimisFromPlatform ?? []);
  const subject = result.companies.find((c) => c.role === 'subject');
  const subjectName = opts.subjectName ?? subject?.name;

  // Steg 1 — grundförutsättningar som bara en människa kan svara på.
  for (const c of result.companies) {
    if (!c.orgNr || c.role === 'partner') continue;
    for (const cond of COMPANY_MANUAL_CONDITIONS) {
      const check = c.conditions.find((x) => x.id === cond);
      if (check && check.verdict === 'unknown') items.push(conditionItem(c.orgNr, c.name, cond, check));
    }
  }

  // Fristående? / ägarbild — underlag (aktiebok) när registret inte räcker.
  if (result.standalone.verdict === 'unknown') {
    items.push({
      key: 'document:aktiebok',
      kind: 'document',
      label: `Aktiebok för ${subjectName || 'bolaget'} — ägare med andel, inkl. ägande via holdingbolag`,
      hint: result.standalone.needs,
      status: 'open'
    });
  }

  // Tröskelvärde — bolag utan bokslut (uppskattning i god tro, bilaga I art. 4.3).
  for (const r of result.thresholds.rows) {
    if (!r.orgNr) continue;
    const noAccounts = r.estimated || (r.note && r.year === undefined);
    if (!noAccounts || r.estimated) continue;
    items.push({
      key: `estimate:${r.orgNr}`,
      kind: 'estimate',
      label: `${companyLabel(r.name, r.orgNr)} — anställda, omsättning och balansomslutning (uppskattning, inget bokslut finns)`,
      hint: r.note,
      org_nr: r.orgNr,
      org_name: r.name,
      status: 'open'
    });
  }

  // De minimis-intyg per anknutet bolag utan känt stöd.
  if (result.deMinimis.verdict === 'unknown') {
    for (const c of result.companies) {
      if (c.role !== 'linked' || !c.orgNr || platformDm.has(c.orgNr)) continue;
      items.push({
        key: `de_minimis:${c.orgNr}`,
        kind: 'de_minimis',
        label: `${companyLabel(c.name, c.orgNr)} — intyg om mottaget de minimis-stöd (innevarande + två år bakåt)`,
        hint: result.deMinimis.needs,
        org_nr: c.orgNr,
        org_name: c.name,
        status: 'open'
      });
    }
  }

  // Steg 2 — grundarteam (ägarandel, engagemang, fas).
  const foundersUnknown = result.vinnovaChecks.some((c) => (c.id === 'founders_75' || c.id === 'founder_driven') && c.verdict === 'unknown');
  if (foundersUnknown) {
    const f75 = result.vinnovaChecks.find((c) => c.id === 'founders_75');
    const fd = result.vinnovaChecks.find((c) => c.id === 'founder_driven');
    items.push({
      key: 'founders',
      kind: 'founders',
      label: 'Grundarteamet — ägarandel och engagemang i % av heltid per grundare, mognadsfas',
      hint: [f75?.verdict === 'unknown' ? f75.needs : undefined, fd?.verdict === 'unknown' ? fd.needs : undefined].filter(Boolean).join(' '),
      status: 'open'
    });
  }

  for (const id of SCREENING_VINNOVA_IDS) {
    const check = result.vinnovaChecks.find((c) => c.id === id);
    if (check && check.verdict === 'unknown') {
      items.push({
        key: `vinnova:${id}`,
        kind: 'vinnova',
        label: SCREENING_VINNOVA_QUESTION[id].question,
        hint: check.needs ?? SCREENING_VINNOVA_QUESTION[id].hint,
        vinnova: id,
        status: 'open'
      });
    }
  }

  const irl = result.irl;
  const irlMissing = !irl || IRL_AXES.some((ax) => typeof irl[ax] !== 'number');
  if (irlMissing) {
    items.push({
      key: 'irl',
      kind: 'irl',
      label: 'IRL-nivåer (CRL/BRL/TMRL/SRL) med motivering per axel',
      hint: 'Ingen fullständig readiness-bedömning i plattformen — ange nivå 1–9 och motivering.',
      status: 'open'
    });
  }

  // Steg 3
  if (result.excellence.verdict === 'unknown') {
    items.push({
      key: 'excellence',
      kind: 'excellence',
      label: SCREENING_EXCELLENCE_QUESTION.question,
      hint: result.excellence.needs ?? SCREENING_EXCELLENCE_QUESTION.hint,
      status: 'open'
    });
  }

  return items.slice(0, SCREENING_REQUEST_MAX_ITEMS);
}

/** Punkter mottagaren rimligen kan svara på (bolaget bedömer inte sig självt mot Vinnova/IRL). */
export function screeningRequestItemsFor(items: readonly ScreeningRequestItem[], recipient: ScreeningRequestRecipient): ScreeningRequestItem[] {
  return items.filter((i) => SCREENING_REQUEST_ITEM_AUDIENCE[i.kind].includes(recipient));
}

// ─── Normalisering (PB-json och klientformulär) ──────────────────────────

function normalizeFounders(raw: unknown): ScreeningFounderFact[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows: ScreeningFounderFact[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    const name = cleanText(o.name, 120);
    if (!name) continue;
    const row: ScreeningFounderFact = { name };
    const eq = cleanPct(o.equity_pct);
    if (eq !== undefined) row.equity_pct = eq;
    const eng = cleanPct(o.engagement_pct);
    if (eng !== undefined) row.engagement_pct = eng;
    if (o.researcher === true) row.researcher = true;
    rows.push(row);
    if (rows.length >= SCREENING_MAX_FOUNDERS) break;
  }
  return rows.length > 0 ? rows : undefined;
}

function normalizeAnswer(kind: ScreeningRequestItemKind, raw: unknown): ScreeningRequestAnswer | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const a: ScreeningRequestAnswer = {};
  switch (kind) {
    case 'condition':
    case 'vinnova':
    case 'excellence': {
      const v = cleanVerdict(o.verdict);
      if (!v) return undefined;
      a.verdict = v;
      const note = cleanText(o.note, SCREENING_NOTE_MAX);
      if (note) a.note = note;
      return a;
    }
    case 'founders': {
      const founders = normalizeFounders(o.founders);
      if (founders) a.founders = founders;
      if (o.maturity_phase === 'formation' || o.maturity_phase === 'problem_solution_fit' || o.maturity_phase === 'product_market_fit') {
        a.maturity_phase = o.maturity_phase;
      }
      if (o.research_spinoff === true) a.research_spinoff = true;
      const note = cleanText(o.note, SCREENING_NOTE_MAX);
      if (note) a.note = note;
      return a.founders || a.maturity_phase ? a : undefined;
    }
    case 'de_minimis': {
      const used = cleanSek(o.used_eur);
      if (used === undefined) return undefined;
      a.used_eur = used;
      const note = cleanText(o.note, SCREENING_NOTE_MAX);
      if (note) a.note = note;
      return a;
    }
    case 'estimate': {
      const emp = o.employees === '' ? undefined : cleanSek(o.employees);
      const rev = cleanSek(o.revenue_sek);
      const bal = cleanSek(o.balance_sheet_sek);
      if (emp === undefined && rev === undefined && bal === undefined) return undefined;
      if (emp !== undefined) a.employees = emp;
      if (rev !== undefined) a.revenue_sek = rev;
      if (bal !== undefined) a.balance_sheet_sek = bal;
      const note = cleanText(o.note, SCREENING_NOTE_MAX);
      if (note) a.note = note;
      return a;
    }
    case 'irl': {
      const levelsRaw = typeof o.levels === 'object' && o.levels !== null ? (o.levels as Record<string, unknown>) : {};
      const notesRaw = typeof o.notes === 'object' && o.notes !== null ? (o.notes as Record<string, unknown>) : {};
      const levels: Partial<Record<IrlAxis, number>> = {};
      const notes: Partial<Record<IrlAxis, string>> = {};
      for (const ax of IRL_AXES) {
        const l = cleanLevel(levelsRaw[ax]);
        if (l !== undefined) levels[ax] = l;
        const n = cleanText(notesRaw[ax], SCREENING_NOTE_MAX);
        if (n) notes[ax] = n;
      }
      if (Object.keys(levels).length === 0 && Object.keys(notes).length === 0) return undefined;
      if (Object.keys(levels).length > 0) a.levels = levels;
      if (Object.keys(notes).length > 0) a.notes = notes;
      return a;
    }
    case 'document': {
      const note = cleanMultiline(o.note, SCREENING_REQUEST_DOCUMENT_MAX);
      if (!note) return undefined;
      a.note = note;
      return a;
    }
  }
}

/** PII-fri etikett för översikten — aldrig namn, belopp avrundat. */
export function screeningAnswerLabel(item: Pick<ScreeningRequestItem, 'kind' | 'condition' | 'vinnova'>, a: ScreeningRequestAnswer): string {
  switch (item.kind) {
    case 'condition': {
      const meta = item.condition ? SCREENING_CONDITION_QUESTION[item.condition] : undefined;
      return a.verdict === 'yes' ? (meta?.fulfilled ?? 'Ja') : (meta?.failed ?? 'Nej');
    }
    case 'vinnova': {
      const meta = item.vinnova ? SCREENING_VINNOVA_QUESTION[item.vinnova] : undefined;
      return a.verdict === 'yes' ? (meta?.fulfilled ?? 'Ja') : (meta?.failed ?? 'Nej');
    }
    case 'excellence':
      return a.verdict === 'yes' ? SCREENING_EXCELLENCE_QUESTION.fulfilled : SCREENING_EXCELLENCE_QUESTION.failed;
    case 'founders': {
      const n = a.founders?.length ?? 0;
      const withEng = a.founders?.filter((f) => typeof f.engagement_pct === 'number').length ?? 0;
      return `${n} grundare${withEng > 0 ? `, engagemang angivet för ${withEng}` : ''}${a.maturity_phase ? `, fas angiven` : ''}`;
    }
    case 'de_minimis':
      return `${Math.round(a.used_eur ?? 0).toLocaleString('sv-SE')} €`;
    case 'estimate': {
      const bits = [
        a.employees !== undefined ? `${a.employees} anställda` : null,
        a.revenue_sek !== undefined ? 'omsättning' : null,
        a.balance_sheet_sek !== undefined ? 'balansomslutning' : null
      ].filter(Boolean);
      return bits.length > 0 ? `Uppskattning: ${bits.join(', ')}` : 'Uppskattning lämnad';
    }
    case 'irl': {
      const n = a.levels ? Object.keys(a.levels).length : 0;
      return n > 0 ? `${n} av 4 nivåer angivna` : 'Motivering lämnad';
    }
    case 'document':
      return 'Underlag lämnat';
  }
}

/**
 * Normaliserar en item-lista ur PB-json (kan vara gammal/trasig) eller ur
 * klienten. Okända kinds/nycklar släpps; dubbletter på `key` tas bort; svaren
 * normaliseras per kind (fritext personnummer-saneras).
 */
export function normalizeScreeningRequestItems(raw: unknown): ScreeningRequestItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ScreeningRequestItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    const kind = SCREENING_REQUEST_ITEM_KINDS.find((k) => k === o.kind);
    const key = cleanText(o.key, 120);
    const label = cleanText(o.label, 300);
    if (!kind || !key || !label || seen.has(key)) continue;
    seen.add(key);
    const item: ScreeningRequestItem = { key, kind, label, status: o.status === 'answered' ? 'answered' : 'open' };
    const hint = cleanText(o.hint, 400);
    if (hint) item.hint = hint;
    const orgNr = cleanOrgNr(o.org_nr);
    if (orgNr) item.org_nr = orgNr;
    const orgName = cleanText(o.org_name, 200);
    if (orgName) item.org_name = orgName;
    if (kind === 'condition') {
      const cond = COMPANY_MANUAL_CONDITIONS.find((c) => c === o.condition);
      if (!cond || !orgNr) continue;
      item.condition = cond;
    }
    if (kind === 'vinnova') {
      const v = SCREENING_VINNOVA_IDS.find((c) => c === o.vinnova);
      if (!v) continue;
      item.vinnova = v;
    }
    if ((kind === 'de_minimis' || kind === 'estimate') && !orgNr) continue;
    const answer = normalizeAnswer(kind, o.answer);
    if (answer) {
      item.answer = answer;
      item.answer_label = cleanText(o.answer_label, 160) ?? screeningAnswerLabel(item, answer);
      const at = cleanText(o.answered_at, 40);
      if (at) item.answered_at = at;
      const by = cleanText(o.answered_by, 64);
      if (by) item.answered_by = by;
    } else {
      item.status = 'open';
    }
    out.push(item);
    if (out.length >= SCREENING_REQUEST_MAX_ITEMS) break;
  }
  return out;
}

export interface ApplyAnswersInput {
  /** Svar per item-nyckel (råa, ur klienten). */
  answers: Record<string, unknown>;
  answeredAt: string;
  answeredBy: string;
}

export interface ApplyAnswersOutcome {
  items: ScreeningRequestItem[];
  /** Nycklar som faktiskt fick ett (nytt) giltigt svar. */
  answeredKeys: string[];
  /** Nycklar vars svar var ogiltiga/tomma (ignorerade). */
  rejectedKeys: string[];
}

/**
 * Lägger in svar på en lista av punkter. Ett giltigt svar markerar punkten
 * besvarad (även om den redan var det — ett nytt svar ersätter), ett ogiltigt
 * svar lämnar punkten orörd. Svaret `{ clear: true }` tar bort ett tidigare
 * svar (punkten blir öppen igen).
 */
export function applyScreeningRequestAnswers(items: readonly ScreeningRequestItem[], input: ApplyAnswersInput): ApplyAnswersOutcome {
  const answeredKeys: string[] = [];
  const rejectedKeys: string[] = [];
  const out = items.map((item) => {
    if (!(item.key in input.answers)) return item;
    const raw = input.answers[item.key];
    if (typeof raw === 'object' && raw !== null && (raw as Record<string, unknown>).clear === true) {
      const { answer: _a, answer_label: _l, answered_at: _at, answered_by: _by, ...rest } = item;
      void _a;
      void _l;
      void _at;
      void _by;
      return { ...rest, status: 'open' as const };
    }
    const answer = normalizeAnswer(item.kind, raw);
    if (!answer) {
      rejectedKeys.push(item.key);
      return item;
    }
    answeredKeys.push(item.key);
    return {
      ...item,
      status: 'answered' as const,
      answer,
      answer_label: screeningAnswerLabel(item, answer),
      answered_at: input.answeredAt,
      answered_by: input.answeredBy
    };
  });
  return { items: out, answeredKeys, rejectedKeys };
}

/** Status ur punkterna: alla besvarade ⇒ answered, några ⇒ partially_answered, inga ⇒ open. */
export function screeningRequestStatusFor(items: readonly ScreeningRequestItem[]): Exclude<ScreeningRequestStatus, 'closed'> {
  if (items.length === 0) return 'open';
  const answered = items.filter((i) => i.status === 'answered').length;
  if (answered === 0) return 'open';
  return answered === items.length ? 'answered' : 'partially_answered';
}

/**
 * Slår ihop besvarade punkter till de manuella svaren (§ 51.4) — EN sanning:
 * nästa omräkning av bedömningen väger in dem. `document`-svar rör inte
 * facts (fri text, bara i förfrågan). Returnerar nya facts (normaliserade).
 */
export function mergeScreeningRequestAnswersIntoFacts(
  facts: ScreeningManualFacts,
  items: readonly ScreeningRequestItem[],
  onlyKeys?: readonly string[]
): ScreeningManualFacts {
  const next: ScreeningManualFacts = {
    ...facts,
    companies: { ...facts.companies },
    de_minimis_related: { ...facts.de_minimis_related },
    estimates: { ...facts.estimates }
  };
  const wanted = onlyKeys ? new Set(onlyKeys) : null;
  for (const item of items) {
    if (item.status !== 'answered' || !item.answer) continue;
    if (wanted && !wanted.has(item.key)) continue;
    const a = item.answer;
    switch (item.kind) {
      case 'condition': {
        if (!item.org_nr || !item.condition || !a.verdict) break;
        const ans: ManualAnswer = a.note ? { verdict: a.verdict, note: a.note } : { verdict: a.verdict };
        next.companies[item.org_nr] = { ...(next.companies[item.org_nr] ?? {}), [item.condition]: ans };
        break;
      }
      case 'vinnova': {
        if (!item.vinnova || !a.verdict) break;
        next[item.vinnova] = a.note ? { verdict: a.verdict, note: a.note } : { verdict: a.verdict };
        break;
      }
      case 'excellence': {
        if (!a.verdict) break;
        next.excellence = a.note ? { verdict: a.verdict, note: a.note } : { verdict: a.verdict };
        break;
      }
      case 'founders': {
        if (a.founders) next.founders = a.founders;
        if (a.maturity_phase) next.maturity_phase = a.maturity_phase;
        if (a.research_spinoff !== undefined) next.research_spinoff = a.research_spinoff;
        break;
      }
      case 'de_minimis': {
        if (!item.org_nr || a.used_eur === undefined) break;
        next.de_minimis_related[item.org_nr] = a.note ? { used_eur: a.used_eur, note: a.note } : { used_eur: a.used_eur };
        break;
      }
      case 'estimate': {
        if (!item.org_nr) break;
        const est: NonNullable<ScreeningManualFacts['estimates'][string]> = {};
        if (a.employees !== undefined) est.employees = a.employees;
        if (a.revenue_sek !== undefined) est.revenue_sek = a.revenue_sek;
        if (a.balance_sheet_sek !== undefined) est.balance_sheet_sek = a.balance_sheet_sek;
        if (a.note) est.note = a.note;
        next.estimates[item.org_nr] = est;
        break;
      }
      case 'irl': {
        const prev = next.irl ?? {};
        next.irl = {
          ...prev,
          levels: a.levels ? { ...(prev.levels ?? {}), ...a.levels } : prev.levels,
          notes: a.notes ? { ...(prev.notes ?? {}), ...a.notes } : prev.notes
        };
        break;
      }
      case 'document':
        break;
    }
  }
  return normalizeScreeningFacts(next);
}

// ─── Färdig text (mejl/checklista) ───────────────────────────────────────

export interface ScreeningRequestTextInput {
  subjectName: string;
  recipient: ScreeningRequestRecipient;
  items: readonly ScreeningRequestItem[];
  message?: string;
  /** Länk till svarsformuläret i systemet (valfri). */
  answerUrl?: string;
  dueDate?: string;
  senderName?: string;
}

/**
 * Checklistan som text — klistras in i ett mejl eller läses upp i ett möte.
 * Samma punkter som i systemet, så svaren kan matas in där när de kommer.
 */
export function screeningRequestText(input: ScreeningRequestTextInput): string {
  const lines: string[] = [];
  lines.push(
    input.recipient === 'startup'
      ? `Hej! Inför bedömningen av statsstöd (art. 22 GBER / de minimis) och Vinnovas målgrupp för ${input.subjectName} behöver vi några uppgifter från er:`
      : `Hej! Inför bedömningen av ${input.subjectName} mot art. 22 GBER / de minimis och Vinnovas målgrupp behöver controllern din hjälp med följande punkter:`
  );
  if (input.message) lines.push('', input.message);
  lines.push('');
  input.items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.label}${item.status === 'answered' ? ' (besvarad)' : ''}`);
    if (item.hint) lines.push(`   ${item.hint}`);
  });
  lines.push('');
  if (input.dueDate) lines.push(`Svar önskas senast ${input.dueDate}.`);
  if (input.answerUrl) lines.push(`Svara direkt i systemet: ${input.answerUrl}`);
  lines.push('Skriv inga personnummer — bara namn, andelar och belopp.');
  if (input.senderName) lines.push('', `Vänliga hälsningar`, input.senderName);
  return lines.join('\n');
}

/** Validering av en ny förfrågan (server-side; klienten är aldrig gränsen). */
export function validateScreeningRequestInput(input: {
  recipient: unknown;
  items: unknown;
  message?: unknown;
  dueDate?: unknown;
}): { ok: true; value: { recipient: ScreeningRequestRecipient; items: ScreeningRequestItem[]; message?: string; dueDate?: string } } | { ok: false; error: string } {
  const recipient = SCREENING_REQUEST_RECIPIENTS.find((r) => r === input.recipient);
  if (!recipient) return { ok: false, error: 'Välj mottagare: coachen eller bolaget.' };
  const items = screeningRequestItemsFor(normalizeScreeningRequestItems(input.items), recipient).map((i) => {
    const { answer: _a, answer_label: _l, answered_at: _at, answered_by: _by, ...rest } = i;
    void _a;
    void _l;
    void _at;
    void _by;
    return { ...rest, status: 'open' as const };
  });
  if (items.length === 0) return { ok: false, error: 'Välj minst en punkt som mottagaren kan svara på.' };
  const message = cleanMultiline(input.message, SCREENING_REQUEST_MESSAGE_MAX);
  let dueDate: string | undefined;
  if (typeof input.dueDate === 'string' && input.dueDate.trim() !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate.trim())) return { ok: false, error: 'Ogiltigt datum.' };
    dueDate = input.dueDate.trim();
  }
  return { ok: true, value: { recipient, items, message, dueDate } };
}
