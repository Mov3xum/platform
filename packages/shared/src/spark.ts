// SPARK — energimatchning (CLAUDE.md § 61).
//
// Regional behovs- och innovationsdatabas inom energiområdet: aktörer
// registreras EN gång och kan ha flera behov, flera lösningar och testmiljöer.
// Den här filen är källan av sanning för kategorierna, för det ADAPTIVA
// intervjuformuläret (frågorna formas efter vad som anges i början) och för
// hur ett intervjusvar blir poster i registret.
//
// Ren, server-/React-fri logik (enhetstestad i spark.test.ts). Kategorierna
// lagras som text/json i PocketBase (validerade här), så listorna kan utökas
// utan migration. Statusfälten är PB-select och MÅSTE spegla konstanterna
// nedan (migration 1700000221).

import { KOMMUN_OPTIONS } from './compass-contact';

export interface SparkOption {
  id: string;
  label: string;
  hint?: string;
}

const ids = <T extends readonly SparkOption[]>(list: T): string[] => list.map((o) => o.id);
const labels = (list: readonly SparkOption[]): Record<string, string> => Object.fromEntries(list.map((o) => [o.id, o.label]));

// ── Kategorier ──────────────────────────────────────────────────────────────

/** Energiområden — intervjuguidens tolv kategorier (B1). */
export const SPARK_ENERGY_AREAS = [
  { id: 'energieffektivisering', label: 'Energieffektivisering' },
  { id: 'elektrifiering', label: 'Elektrifiering' },
  { id: 'energilagring', label: 'Energilagring' },
  { id: 'effekt_elnat', label: 'Effektbehov och elnätskapacitet' },
  { id: 'energikostnader', label: 'Energikostnader' },
  { id: 'fossilfri_produktion', label: 'Fossilfri produktion' },
  { id: 'spillvarme', label: 'Spillvärme och värmeåtervinning' },
  { id: 'fornybar_produktion', label: 'Förnybar energiproduktion' },
  { id: 'overvakning_digitalisering', label: 'Energiövervakning och digitalisering' },
  { id: 'flexibilitet_effektstyrning', label: 'Flexibilitet och effektstyrning' },
  { id: 'cirkulara_energifloden', label: 'Cirkulära energiflöden' },
  { id: 'annat', label: 'Annat' }
] as const satisfies readonly SparkOption[];
export type SparkEnergyArea = (typeof SPARK_ENERGY_AREAS)[number]['id'];
export const SPARK_ENERGY_AREA_LABELS = labels(SPARK_ENERGY_AREAS);

/** Stödbehov — intervjuguidens sexton kategorier (E). */
export const SPARK_SUPPORT_NEEDS = [
  { id: 'teknisk_verifiering', label: 'Teknisk verifiering' },
  { id: 'testbaddar', label: 'Testbäddar' },
  { id: 'pilotkunder', label: 'Pilotkunder' },
  { id: 'affarsutveckling', label: 'Affärsmodell och affärsutveckling' },
  { id: 'marknadsverifiering', label: 'Marknadsverifiering' },
  { id: 'specialistkompetens', label: 'Specialistkompetens' },
  { id: 'kapital', label: 'Kapital och finansiering' },
  { id: 'kapitalstrategi_pitch', label: 'Kapitalstrategi och pitchträning' },
  { id: 'hallbarhetsanalys', label: 'Hållbarhetsanalys' },
  { id: 'teamutveckling', label: 'Teamutveckling' },
  { id: 'forskningssamverkan', label: 'Forskningssamverkan' },
  { id: 'internationalisering', label: 'Internationalisering' },
  { id: 'ipr', label: 'Immateriella rättigheter' },
  { id: 'regelverk_certifiering', label: 'Regelverk och certifiering' },
  { id: 'natverk_partnerskap', label: 'Nätverk och partnerskap' },
  { id: 'annat', label: 'Annat' }
] as const satisfies readonly SparkOption[];
export const SPARK_SUPPORT_NEED_LABELS = labels(SPARK_SUPPORT_NEEDS);

/** Lösningens utvecklingsstadium — förenklad sexgradig skala (D5). */
export const SPARK_MATURITY = [
  { id: '1', label: 'Idéstadium', hint: 'Koncept eller identifierad möjlighet' },
  { id: '2', label: 'Konceptutveckling', hint: 'Pågående utveckling av lösningen' },
  { id: '3', label: 'Prototyp', hint: 'Lösningen finns i en första testbar version' },
  { id: '4', label: 'Test och verifiering', hint: 'Lösningen testas eller behöver verifieras' },
  { id: '5', label: 'Marknadsintroduktion', hint: 'Redo för eller har fått sina första kunder' },
  { id: '6', label: 'Kommersialisering och skalning', hint: 'Etablerad lösning med tillväxtpotential' }
] as const satisfies readonly SparkOption[];
export const SPARK_MATURITY_LABELS = labels(SPARK_MATURITY);

/**
 * Technology Readiness Level 1–9 — Movexums formuleringar (TRL-bladet).
 * Används för LÖSNINGAR hos innovationsaktörer som kan vara aktuella för
 * acceleratorprogrammet. Behovsägare bedöms inte, och portföljbolag bedöms
 * med KTH IRL på bolagskortet (§ 52.2) — inte här.
 */
export const SPARK_TRL = [
  { id: '1', label: 'TRL 1 — Basforskning', hint: 'Principer finns antagna men experimentella belägg saknas.' },
  { id: '2', label: 'TRL 2 — Teknologikoncept', hint: 'Teknologikoncept finns formulerat. Både koncept och applikationer finns definierade.' },
  { id: '3', label: 'TRL 3 — Experimentella belägg', hint: 'Tillämpad forskning. De första laboratorietesterna är gjorda.' },
  { id: '4', label: 'TRL 4 — Bekräftad i labb', hint: 'Teknologin bekräftad i labb. Småskaliga prototyper finns konstruerade.' },
  { id: '5', label: 'TRL 5 — Validerad i relevant miljö', hint: 'Storskaliga prototyper testade i avsedd miljö.' },
  { id: '6', label: 'TRL 6 — Demonstrerad i relevant miljö', hint: 'Prototypsystem testade i avsedd miljö och med avsedd prestanda.' },
  { id: '7', label: 'TRL 7 — Systemprototyp i operationell miljö', hint: 'Demonstrerad i avsedd operationell miljö i för-kommersiell skala.' },
  { id: '8', label: 'TRL 8 — Systemet komplett och bekräftat', hint: 'Tekniklösning som är den första i sitt slag. Tillverkningsproblem lösta.' },
  { id: '9', label: 'TRL 9 — Beprövat i operationell miljö', hint: 'Fullt kommersiellt gångbar applikation, teknologin tillgänglig för kunden.' }
] as const satisfies readonly SparkOption[];
export const SPARK_TRL_LABELS = labels(SPARK_TRL);
export function isSparkTrl(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 9;
}

/** Movexums kategorisering av en lösning inför acceleratorprogrammet. */
export const SPARK_ACCELERATOR_CATEGORIES = [
  { id: 'candidate', label: 'Kandidat till acceleratorn', hint: 'Redo att testas och verifieras — passar programmet nu' },
  { id: 'early', label: 'Tidig — följ upp', hint: 'Behöver mer teknikutveckling innan programmet ger värde' },
  { id: 'market_ready', label: 'Marknadsredo', hint: 'Passar matchning mot behovsägare snarare än programmet' },
  { id: 'not_relevant', label: 'Inte aktuell', hint: 'Utanför programmets inriktning' }
] as const satisfies readonly SparkOption[];
export type SparkAcceleratorCategory = (typeof SPARK_ACCELERATOR_CATEGORIES)[number]['id'];
export const SPARK_ACCELERATOR_CATEGORY_LABELS = labels(SPARK_ACCELERATOR_CATEGORIES);
export function isSparkAcceleratorCategory(v: unknown): v is SparkAcceleratorCategory {
  return typeof v === 'string' && SPARK_ACCELERATOR_CATEGORIES.some((c) => c.id === v);
}

/**
 * Förslag till kategori utifrån TRL — en startpunkt som en människa på
 * Movexum bekräftar eller ändrar. Gränserna (TRL 4–7 = test och verifiering,
 * det acceleratorn och testbäddarna är till för) är Movexums arbetshypotes
 * och justeras här när programmet har samlat erfarenhet.
 */
export function suggestSparkAcceleratorCategory(trl: number | null | undefined): SparkAcceleratorCategory | null {
  if (!isSparkTrl(trl)) return null;
  if (trl <= 3) return 'early';
  if (trl <= 7) return 'candidate';
  return 'market_ready';
}

/** TRL som gäller: Movexums bedömning när den finns, annars företagets egen uppgift. */
export function effectiveSparkTrl(s: { trl?: number | null; trl_assessed?: number | null }): number | null {
  if (isSparkTrl(s.trl_assessed)) return s.trl_assessed;
  return isSparkTrl(s.trl) ? s.trl : null;
}

/**
 * Ska lösningen bedömas för acceleratorn? Bara innovationsaktörer utanför
 * portföljen — inte behovsägare, och inte bolag som redan har ett bolagskort.
 */
export function sparkAcceleratorEligible(actor: { roles?: readonly string[]; startup?: string | null; status?: string }): boolean {
  return (actor.roles ?? []).includes('innovator') && !actor.startup && actor.status !== 'archived';
}

export const SPARK_ACTOR_TYPES = [
  { id: 'industri', label: 'Industriföretag' },
  { id: 'energibolag', label: 'Energibolag eller elnätsaktör' },
  { id: 'startup_smf', label: 'Startup eller innovativt SMF' },
  { id: 'offentlig', label: 'Offentlig aktör (kommun, region, myndighet)' },
  { id: 'akademi', label: 'Akademi eller forskningsaktör' },
  { id: 'kapital', label: 'Kapitalaktör' },
  { id: 'framjare', label: 'Innovations- eller företagsfrämjare' },
  { id: 'annan', label: 'Annan' }
] as const satisfies readonly SparkOption[];
export type SparkActorType = (typeof SPARK_ACTOR_TYPES)[number]['id'];
export const SPARK_ACTOR_TYPE_LABELS = labels(SPARK_ACTOR_TYPES);

export const SPARK_SECTORS = [
  { id: 'tillverkning', label: 'Tillverkande industri' },
  { id: 'processindustri', label: 'Processindustri (stål, papper, massa, kemi)' },
  { id: 'energi_elnat', label: 'Energi och elnät' },
  { id: 'fastighet_bygg', label: 'Fastigheter och bygg' },
  { id: 'transport_logistik', label: 'Transport och logistik' },
  { id: 'skog_tra', label: 'Skog och trä' },
  { id: 'livsmedel', label: 'Livsmedel och jordbruk' },
  { id: 'offentlig', label: 'Offentlig verksamhet' },
  { id: 'it_tjanster', label: 'IT, teknik och tjänster' },
  { id: 'annat', label: 'Annan bransch' }
] as const satisfies readonly SparkOption[];
export const SPARK_SECTOR_LABELS = labels(SPARK_SECTORS);
/** Kort etikett för anonymiserad presentation ("Processindustri i Sandviken"). */
const SECTOR_SHORT: Record<string, string> = {
  processindustri: 'Processindustri',
  it_tjanster: 'IT- och teknikföretag',
  annat: 'Företag',
  offentlig: 'Offentlig verksamhet',
  energi_elnat: 'Energi- eller elnätsbolag',
  fastighet_bygg: 'Fastighets- eller byggföretag',
  transport_logistik: 'Transport- eller logistikföretag',
  skog_tra: 'Skogs- eller träföretag',
  livsmedel: 'Livsmedelsföretag'
};

export const SPARK_SIZES = [
  { id: 'micro', label: '1–9 anställda' },
  { id: 'small', label: '10–49 anställda' },
  { id: 'medium', label: '50–249 anställda' },
  { id: 'large', label: '250 eller fler' }
] as const satisfies readonly SparkOption[];
export const SPARK_SIZE_LABELS = labels(SPARK_SIZES);

/** Rollerna väljs i början av intervjun och styr vilka avsnitt som visas. */
export const SPARK_ROLES = [
  { id: 'need_owner', label: 'Har energiutmaningar eller behov av nya energilösningar', hint: 'Behovsägare' },
  { id: 'innovator', label: 'Utvecklar eller erbjuder egna lösningar för energiomställningen', hint: 'Innovationsaktör' },
  { id: 'testbed', label: 'Kan erbjuda testmiljö eller vara pilotkund', hint: 'Testmiljö / pilotkund' }
] as const satisfies readonly SparkOption[];
export type SparkRole = (typeof SPARK_ROLES)[number]['id'];
export const SPARK_ROLE_LABELS: Record<SparkRole, string> = {
  need_owner: 'Behovsägare',
  innovator: 'Innovationsaktör',
  testbed: 'Testmiljö / pilotkund'
};
export function isSparkRole(v: unknown): v is SparkRole {
  return v === 'need_owner' || v === 'innovator' || v === 'testbed';
}

export const SPARK_PRIORITIES = [
  { id: 'high', label: 'Hög' },
  { id: 'medium', label: 'Medel' },
  { id: 'low', label: 'Låg' }
] as const satisfies readonly SparkOption[];
export const SPARK_PRIORITY_LABELS = labels(SPARK_PRIORITIES);

export const SPARK_HORIZONS = [
  { id: 'lt1', label: 'Inom ett år' },
  { id: 'y1_3', label: 'Inom 1–3 år' },
  { id: 'y3_5', label: 'Inom 3–5 år' },
  { id: 'gt5', label: 'Längre fram än 5 år' }
] as const satisfies readonly SparkOption[];
export const SPARK_HORIZON_LABELS = labels(SPARK_HORIZONS);

const YES_NO = [
  { id: 'yes', label: 'Ja' },
  { id: 'no', label: 'Nej' }
] as const satisfies readonly SparkOption[];
const YES_MAYBE_NO = [
  { id: 'yes', label: 'Ja' },
  { id: 'maybe', label: 'Kanske' },
  { id: 'no', label: 'Nej' }
] as const satisfies readonly SparkOption[];
const YES_PARTLY_NO = [
  { id: 'yes', label: 'Ja' },
  { id: 'partly', label: 'Delvis' },
  { id: 'no', label: 'Nej' }
] as const satisfies readonly SparkOption[];
const YES_NO_UNKNOWN = [
  { id: 'yes', label: 'Ja' },
  { id: 'no', label: 'Nej' },
  { id: 'unknown', label: 'Vet inte' }
] as const satisfies readonly SparkOption[];
export const SPARK_ANSWER_LABELS: Record<string, string> = { yes: 'Ja', no: 'Nej', maybe: 'Kanske', partly: 'Delvis', unknown: 'Vet inte' };

export const SPARK_ENERGY_IMPORTANCE = [
  { id: 'critical', label: 'Avgörande' },
  { id: 'large', label: 'Stor' },
  { id: 'moderate', label: 'Måttlig' },
  { id: 'small', label: 'Liten' }
] as const satisfies readonly SparkOption[];

export const SPARK_CONSEQUENCES = [
  { id: 'kostnader', label: 'Ökade kostnader' },
  { id: 'kapacitet', label: 'Begränsad produktionskapacitet' },
  { id: 'klimat', label: 'Klimatpåverkan' },
  { id: 'konkurrenskraft', label: 'Försämrad konkurrenskraft' },
  { id: 'annat', label: 'Annat' }
] as const satisfies readonly SparkOption[];
export const SPARK_CONSEQUENCE_LABELS = labels(SPARK_CONSEQUENCES);

export const SPARK_CONTRIBUTIONS = [
  { id: 'energianvandning', label: 'Minskad energianvändning' },
  { id: 'utslapp', label: 'Minskade utsläpp' },
  { id: 'elektrifiering', label: 'Elektrifiering' },
  { id: 'resurseffektivitet', label: 'Effektivare resursanvändning' },
  { id: 'flexibilitet', label: 'Flexibilitet i elsystemet' },
  { id: 'annat', label: 'Annat' }
] as const satisfies readonly SparkOption[];
export const SPARK_CONTRIBUTION_LABELS = labels(SPARK_CONTRIBUTIONS);

/** Vad en lösning behöver för att ta nästa steg (D7). */
export const SPARK_SOLUTION_NEEDS = [
  { id: 'testmiljo', label: 'Testmiljö' },
  { id: 'pilotkund', label: 'Pilotkund' },
  { id: 'samarbetspartner', label: 'Samarbetspartner' },
  { id: 'forskning', label: 'Forskningssamverkan' },
  { id: 'kapital', label: 'Kapital' }
] as const satisfies readonly SparkOption[];
export const SPARK_SOLUTION_NEED_LABELS = labels(SPARK_SOLUTION_NEEDS);

/** Vad som får delas med en möjlig samarbetspartner (F4). */
export const SPARK_SHARING_LEVELS = [
  { id: 'anonymous', label: 'Anonymt', hint: 'Bransch, storlek, kommun och beskrivning — inte företagets namn' },
  { id: 'named', label: 'Med företagets namn', hint: 'Efter att Movexum har frågat inför varje matchning' },
  { id: 'none', label: 'Ingenting får delas', hint: 'Uppgifterna används bara för analys på övergripande nivå' }
] as const satisfies readonly SparkOption[];
export type SparkSharingLevel = (typeof SPARK_SHARING_LEVELS)[number]['id'];
export const SPARK_SHARING_LABELS = labels(SPARK_SHARING_LEVELS);

const KOMMUNER: readonly SparkOption[] = KOMMUN_OPTIONS.map((k) => ({ id: k.value, label: k.label }));
export const SPARK_KOMMUN_LABELS = labels(KOMMUNER);

// ── Statusar (PB-select — MÅSTE speglas i migration 1700000221) ─────────────

export const SPARK_INTERVIEW_STATUSES = ['draft', 'submitted', 'applied'] as const;
export type SparkInterviewStatus = (typeof SPARK_INTERVIEW_STATUSES)[number];
export const SPARK_INTERVIEW_STATUS_LABELS: Record<SparkInterviewStatus, string> = {
  draft: 'Utkast',
  submitted: 'Inskickad',
  applied: 'Införd i registret'
};
export const SPARK_INTERVIEW_SOURCES = ['staff', 'partner', 'import', 'self'] as const;
export type SparkInterviewSource = (typeof SPARK_INTERVIEW_SOURCES)[number];
export const SPARK_INTERVIEW_SOURCE_LABELS: Record<SparkInterviewSource, string> = {
  staff: 'Movexum',
  partner: 'Partner',
  import: 'Import',
  self: 'Egen anmälan'
};

export const SPARK_NEED_STATUSES = ['open', 'matched', 'solved', 'closed'] as const;
export type SparkNeedStatus = (typeof SPARK_NEED_STATUSES)[number];
export const SPARK_NEED_STATUS_LABELS: Record<SparkNeedStatus, string> = { open: 'Öppet', matched: 'I matchning', solved: 'Löst', closed: 'Inte aktuellt' };

export const SPARK_SOLUTION_STATUSES = ['active', 'paused', 'closed'] as const;
export type SparkSolutionStatus = (typeof SPARK_SOLUTION_STATUSES)[number];
export const SPARK_SOLUTION_STATUS_LABELS: Record<SparkSolutionStatus, string> = { active: 'Aktiv', paused: 'Pausad', closed: 'Inte aktuell' };

export const SPARK_TESTBED_KINDS = ['test_environment', 'pilot_customer'] as const;
export type SparkTestbedKind = (typeof SPARK_TESTBED_KINDS)[number];
export const SPARK_TESTBED_KIND_LABELS: Record<SparkTestbedKind, string> = { test_environment: 'Testmiljö', pilot_customer: 'Pilotkund' };
export const SPARK_TESTBED_STATUSES = ['available', 'paused', 'closed'] as const;
export type SparkTestbedStatus = (typeof SPARK_TESTBED_STATUSES)[number];
export const SPARK_TESTBED_STATUS_LABELS: Record<SparkTestbedStatus, string> = { available: 'Tillgänglig', paused: 'Pausad', closed: 'Inte aktuell' };

export const SPARK_ACTOR_STATUSES = ['active', 'archived'] as const;
export type SparkActorStatus = (typeof SPARK_ACTOR_STATUSES)[number];

export const SPARK_MATCH_STATUSES = ['suggested', 'introduced', 'dialogue', 'pilot_planned', 'pilot_running', 'completed', 'declined'] as const;
export type SparkMatchStatus = (typeof SPARK_MATCH_STATUSES)[number];
export const SPARK_MATCH_STATUS_LABELS: Record<SparkMatchStatus, string> = {
  suggested: 'Föreslagen',
  introduced: 'Introducerad',
  dialogue: 'Dialog',
  pilot_planned: 'Pilot planerad',
  pilot_running: 'Pilot pågår',
  completed: 'Genomförd',
  declined: 'Inte aktuell'
};
export function isSparkMatchStatus(v: unknown): v is SparkMatchStatus {
  return typeof v === 'string' && (SPARK_MATCH_STATUSES as readonly string[]).includes(v);
}
/** Statusar där parterna har presenterats för varandra. */
export const SPARK_MATCH_ACTIVE_STATUSES: readonly SparkMatchStatus[] = ['introduced', 'dialogue', 'pilot_planned', 'pilot_running', 'completed'];
export const SPARK_MATCH_PILOT_STATUSES: readonly SparkMatchStatus[] = ['pilot_running', 'completed'];

export const SPARK_CONSENTS = ['pending', 'yes', 'no'] as const;
export type SparkConsent = (typeof SPARK_CONSENTS)[number];
export const SPARK_CONSENT_LABELS: Record<SparkConsent, string> = { pending: 'Inte tillfrågad', yes: 'Har tackat ja', no: 'Har tackat nej' };
export function isSparkConsent(v: unknown): v is SparkConsent {
  return v === 'pending' || v === 'yes' || v === 'no';
}

/** Systeminsats (AP 1, 2, 4 — inget stöd) eller företagsindividuell insats (AP 3, 5 — stöd av mindre betydelse). */
export const SPARK_SUPPORT_KINDS = ['none', 'de_minimis'] as const;
export type SparkSupportKind = (typeof SPARK_SUPPORT_KINDS)[number];
export const SPARK_SUPPORT_KIND_LABELS: Record<SparkSupportKind, string> = {
  none: 'Ingen företagsindividuell insats',
  de_minimis: 'Stödinsats till företaget (stöd av mindre betydelse)'
};
export const SPARK_WORK_PACKAGES = ['AP1', 'AP2', 'AP3', 'AP4', 'AP5'] as const;

/** Projektmål ur ansökan (ERUF, 2026-04-01 – 2029-09-30). */
export const SPARK_PROJECT_TARGETS = {
  need_owners: 10,
  supported_companies: 20,
  structure_users: 30,
  research_collaborations: 5
} as const;

// ── Hjälpare ────────────────────────────────────────────────────────────────

const ID_RE = /^[a-z0-9]{15}$/;
export function isSparkId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v);
}
const ITEM_ID_RE = /^[a-z0-9]{6,16}$/;
const PERSONNUMMER_RE = /\b(?:19|20)?\d{6}[-+]?\d{4}\b/g;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Trimmar, tar bort styrtecken och kapar. Personnummer maskas i fritext. */
export function cleanSparkText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL_RE, '').replace(PERSONNUMMER_RE, '[REDACTED]').trim().slice(0, max);
}
function cleanPlain(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL_RE, '').trim().slice(0, max);
}

/** Organisationsnummer som `NNNNNN-NNNN`, eller tomt när det inte är tio siffror. */
export function normalizeSparkOrgNr(v: unknown): string {
  if (typeof v !== 'string') return '';
  let digits = v.replace(/\D/g, '');
  if (digits.length === 12 && (digits.startsWith('16') || digits.startsWith('19') || digits.startsWith('20'))) digits = digits.slice(2);
  if (digits.length !== 10) return '';
  return `${digits.slice(0, 6)}-${digits.slice(6)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function pickOption(v: unknown, options: readonly SparkOption[]): string {
  return typeof v === 'string' && options.some((o) => o.id === v) ? v : '';
}
function pickOptions(v: unknown, options: readonly SparkOption[]): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const o of options) if (v.includes(o.id)) out.push(o.id);
  return out;
}
/** Rensar en lagrad json-lista mot en kategori (läsvägen). */
export function sanitizeSparkList(v: unknown, options: readonly SparkOption[]): string[] {
  return pickOptions(v, options);
}
export function sanitizeSparkRoles(v: unknown): SparkRole[] {
  return pickOptions(v, SPARK_ROLES) as SparkRole[];
}

// ── Det adaptiva intervjuformuläret ─────────────────────────────────────────

export type SparkFieldType = 'text' | 'longtext' | 'single' | 'multi' | 'email' | 'phone';

export interface SparkField {
  key: string;
  /** Frågans nummer i intervjuguiden (A1, B3 …). */
  code?: string;
  label: string;
  help?: string;
  type: SparkFieldType;
  options?: readonly SparkOption[];
  /** Krävs när intervjun skickas in (aldrig för ett utkast). */
  required?: boolean;
  max?: number;
  /** Visas bara när ett annat fält i samma avsnitt/post har något av värdena. */
  showIf?: { field: string; in: readonly string[] };
}

export interface SparkRepeat {
  key: 'needs' | 'solutions';
  max: number;
  itemLabel: string;
  addLabel: string;
  titleField: string;
  fields: readonly SparkField[];
}

export type SparkSectionId = 'start' | 'a' | 'b' | 'c' | 'd' | 'e' | 'f';

export interface SparkSection {
  id: SparkSectionId;
  title: string;
  intro: string;
  /** Avsnittet visas när företaget har NÅGON av rollerna. Utelämnat ⇒ alltid. */
  roles?: readonly SparkRole[];
  fields: readonly SparkField[];
  repeat?: SparkRepeat;
}

export const SPARK_MAX_ITEMS = 5;
const T = 300;
const L = 3000;

export const SPARK_INTERVIEW_SECTIONS: readonly SparkSection[] = [
  {
    id: 'start',
    title: 'Företaget',
    intro: 'Börja med vilket företag det gäller och vad som stämmer in på det. Resten av frågorna anpassas efter svaren.',
    fields: [
      { key: 'name', label: 'Företagets namn', type: 'text', required: true, max: 200 },
      { key: 'org_nr', label: 'Organisationsnummer', help: 'Tio siffror. Gör att företaget bara registreras en gång.', type: 'text', max: 20 },
      { key: 'actor_type', label: 'Typ av aktör', type: 'single', options: SPARK_ACTOR_TYPES, required: true }
    ]
  },
  {
    id: 'a',
    title: 'Verksamhet och energi',
    intro: 'Grundläggande uppgifter om företaget och vilken roll energi spelar i verksamheten.',
    fields: [
      { key: 'sector', code: 'A1', label: 'Vilken bransch tillhör företaget?', type: 'single', options: SPARK_SECTORS, required: true },
      { key: 'business', code: 'A1', label: 'Vad är företagets huvudsakliga verksamhet?', type: 'text', max: 500 },
      { key: 'kommun', code: 'A2', label: 'Var bedriver företaget sin verksamhet?', type: 'single', options: KOMMUNER, required: true },
      { key: 'size', code: 'A3', label: 'Hur många anställda har företaget?', type: 'single', options: SPARK_SIZES },
      { key: 'energy_importance', code: 'A4', label: 'Vilken betydelse har energi för verksamheten och konkurrenskraften?', type: 'single', options: SPARK_ENERGY_IMPORTANCE },
      { key: 'energy_work', code: 'A5', label: 'Arbetar företaget aktivt med energiomställning, energieffektivisering eller energirelaterade lösningar?', type: 'single', options: YES_PARTLY_NO },
      { key: 'development_areas', code: 'A6', label: 'Vilka är de viktigaste utvecklingsområdena kopplat till energi de kommande tre till fem åren?', type: 'longtext', max: L }
    ]
  },
  {
    id: 'b',
    title: 'Energiutmaningar och behov',
    intro: 'Beskriv varje utmaning för sig, så kan den matchas mot rätt lösning. Lägg till fler om företaget har flera.',
    roles: ['need_owner'],
    repeat: {
      key: 'needs',
      max: SPARK_MAX_ITEMS,
      itemLabel: 'Behov',
      addLabel: 'Lägg till ett behov',
      titleField: 'title',
      fields: [
        { key: 'title', code: 'B1', label: 'Utmaningen i en mening', help: 'Till exempel "Höga effekttoppar i produktionen".', type: 'text', required: true, max: 160 },
        { key: 'description', code: 'B1', label: 'Beskriv utmaningen', type: 'longtext', required: true, max: 4000 },
        { key: 'areas', code: 'B1', label: 'Vilka energiområden gäller det?', type: 'multi', options: SPARK_ENERGY_AREAS, required: true },
        { key: 'where', code: 'B2', label: 'Vilka processer, produkter eller delar av verksamheten berörs?', type: 'text', max: 1000 },
        { key: 'unmet', code: 'B3', label: 'Saknas det tillfredsställande lösningar på marknaden i dag?', type: 'single', options: YES_NO_UNKNOWN },
        { key: 'consequences', code: 'B4', label: 'Vilka konsekvenser får utmaningen?', type: 'multi', options: SPARK_CONSEQUENCES },
        { key: 'priority', code: 'B6', label: 'Hur prioriterad är utmaningen?', type: 'single', options: SPARK_PRIORITIES },
        { key: 'horizon', code: 'B6', label: 'När behöver den vara löst?', type: 'single', options: SPARK_HORIZONS },
        { key: 'tried', code: 'B7', label: 'Har ni sökt efter eller testat lösningar tidigare? Vad fungerade och vad fungerade inte?', type: 'longtext', max: 2000 }
      ]
    },
    fields: [
      { key: 'need_barriers', code: 'B5', label: 'Vilka är de största hindren för att genomföra en energiomställning i företaget?', type: 'longtext', max: L },
      { key: 'need_matching', code: 'B8', label: 'Vill företaget få sina utmaningar matchade mot lösningar från startups, andra företag eller forskningsaktörer?', type: 'single', options: YES_NO, required: true }
    ]
  },
  {
    id: 'c',
    title: 'Testmiljöer, pilotkund och samverkan',
    intro: 'Vilka möjligheter finns att testa nya lösningar hos företaget, och vad krävs för att det ska fungera?',
    roles: ['need_owner', 'testbed'],
    fields: [
      { key: 'collab_before', code: 'C1', label: 'Har företaget tidigare samarbetat med startups eller andra innovativa företag för att utveckla eller testa lösningar?', type: 'single', options: YES_NO },
      { key: 'collab_before_note', label: 'Vad gällde samarbetet och hur gick det?', type: 'longtext', max: 2000, showIf: { field: 'collab_before', in: ['yes'] } },
      { key: 'pilot_interest', code: 'C2', label: 'Är företaget intresserat av att vara pilotkund för nya energirelaterade innovationer?', type: 'single', options: YES_MAYBE_NO, required: true },
      { key: 'has_testbed', code: 'C3', label: 'Finns anläggningar, produktionsmiljöer, utrustning eller infrastruktur som kan användas för test och demonstration?', type: 'single', options: YES_NO, required: true },
      { key: 'testbed_description', label: 'Beskriv miljön eller utrustningen', type: 'longtext', required: true, max: L, showIf: { field: 'has_testbed', in: ['yes'] } },
      { key: 'testbed_areas', label: 'Vilka energiområden passar miljön för?', type: 'multi', options: SPARK_ENERGY_AREAS, showIf: { field: 'has_testbed', in: ['yes'] } },
      { key: 'test_conditions', code: 'C4', label: 'Vilka förutsättningar behöver vara uppfyllda för att testa en extern innovation i verksamheten?', type: 'longtext', max: 2000 },
      { key: 'collab_barriers', code: 'C5', label: 'Vilka hinder finns för samverkan med startups och mindre innovativa företag?', type: 'longtext', max: 2000 },
      { key: 'collab_support', code: 'C6', label: 'Vilket stöd skulle göra det lättare att hitta, utvärdera och testa nya innovationer?', type: 'longtext', max: 2000 },
      { key: 'academia_interest', code: 'C7', label: 'Finns intresse av samverkan med akademi och forskningsaktörer inom energiområdet?', type: 'single', options: YES_MAYBE_NO }
    ]
  },
  {
    id: 'd',
    title: 'Innovationer och lösningar',
    intro: 'Beskriv varje lösning för sig. Lägg till fler om företaget har flera produkter, tjänster eller metoder.',
    roles: ['innovator'],
    repeat: {
      key: 'solutions',
      max: SPARK_MAX_ITEMS,
      itemLabel: 'Lösning',
      addLabel: 'Lägg till en lösning',
      titleField: 'name',
      fields: [
        { key: 'name', code: 'D1', label: 'Lösningens namn eller en kort rubrik', type: 'text', required: true, max: 160 },
        { key: 'description', code: 'D1', label: 'Beskriv produkten, tjänsten, tekniken eller metoden', type: 'longtext', required: true, max: 4000 },
        { key: 'problem', code: 'D2', label: 'Vilket problem eller behov löser den?', type: 'longtext', max: 2000 },
        { key: 'areas', label: 'Vilka energiområden gäller lösningen?', type: 'multi', options: SPARK_ENERGY_AREAS, required: true },
        { key: 'target_sectors', code: 'D3', label: 'Vilka branscher eller verksamheter kan ha nytta av lösningen?', type: 'multi', options: SPARK_SECTORS },
        { key: 'contributions', code: 'D4', label: 'Hur bidrar lösningen till energiomställningen?', type: 'multi', options: SPARK_CONTRIBUTIONS },
        { key: 'maturity', code: 'D5', label: 'Hur långt har lösningen kommit?', type: 'single', options: SPARK_MATURITY, required: true },
        { key: 'trl', label: 'Teknikens mognad (TRL)', help: 'Välj den nivå som bäst beskriver var tekniken är i dag.', type: 'single', options: SPARK_TRL },
        { key: 'verified', code: 'D6', label: 'Är lösningen testad eller verifierad i en verklig användarmiljö?', type: 'single', options: YES_PARTLY_NO },
        { key: 'needs', code: 'D7', label: 'Vad behövs för att ta nästa steg?', type: 'multi', options: SPARK_SOLUTION_NEEDS },
        { key: 'barriers', code: 'D8', label: 'Vilka är de största hindren för att kommersialisera eller skala upp?', type: 'longtext', max: 2000 },
        { key: 'expansion', code: 'D9', label: 'Kan lösningen användas i andra branscher eller på nya marknader?', type: 'text', max: 1000 }
      ]
    },
    fields: [
      { key: 'solution_matching', code: 'D10', label: 'Vill företaget matchas mot behov hos industri, energibolag eller offentliga aktörer?', type: 'single', options: YES_NO, required: true }
    ]
  },
  {
    id: 'e',
    title: 'Stödbehov',
    intro: 'Vad behöver företaget för att utveckla sina energirelaterade innovationer vidare? Svaren formar acceleratorprogrammet.',
    roles: ['innovator'],
    fields: [
      { key: 'support_needs', code: 'E2', label: 'Vilka typer av stöd skulle vara mest värdefulla?', type: 'multi', options: SPARK_SUPPORT_NEEDS },
      { key: 'missing_competence', code: 'E1', label: 'Vilka kompetenser eller resurser saknas?', type: 'longtext', max: 2000 },
      { key: 'funding_difficulty', code: 'E3', label: 'Är det svårt att hitta finansiering för utveckling, verifiering och kommersialisering?', type: 'single', options: YES_PARTLY_NO },
      { key: 'sustainability_support', code: 'E4', label: 'Behövs stöd för att visa lösningens miljömässiga, ekonomiska och sociala effekter?', type: 'single', options: YES_NO },
      { key: 'team_needs', code: 'E5', label: 'Behövs nya kompetenser, teamutveckling eller strategiska samarbetspartners?', type: 'text', max: 1000 },
      { key: 'international', code: 'E6', label: 'Finns ambitioner att nå en nationell eller internationell marknad, och vilka hinder finns?', type: 'text', max: 1000 },
      { key: 'support_access', code: 'E7', label: 'Hur upplevs tillgången till innovations- och företagsstöd inom energi i dag? Saknas något?', type: 'longtext', max: 2000 },
      { key: 'program_interest', code: 'E8', label: 'Är ett riktat utvecklingsprogram inom energiinnovation intressant?', type: 'single', options: YES_MAYBE_NO },
      { key: 'program_content', label: 'Vad behöver ett sådant program innehålla för att skapa värde?', type: 'longtext', max: 2000, showIf: { field: 'program_interest', in: ['yes', 'maybe'] } }
    ]
  },
  {
    id: 'f',
    title: 'Fortsatt kontakt',
    intro: 'Hur vill företaget vara med framåt, och vad får delas med en möjlig samarbetspartner? Movexum frågar alltid innan två parter presenteras för varandra.',
    fields: [
      { key: 'contact_ok', code: 'F3', label: 'Får Movexum kontakta företaget för en fördjupad dialog?', type: 'single', options: YES_NO, required: true },
      { key: 'contact_name', code: 'F5', label: 'Kontaktperson', type: 'text', max: 120, showIf: { field: 'contact_ok', in: ['yes'] } },
      { key: 'contact_role', label: 'Roll i företaget', type: 'text', max: 120, showIf: { field: 'contact_ok', in: ['yes'] } },
      { key: 'contact_email', label: 'E-post', type: 'email', max: 200, showIf: { field: 'contact_ok', in: ['yes'] } },
      { key: 'contact_phone', label: 'Telefon', type: 'phone', max: 40, showIf: { field: 'contact_ok', in: ['yes'] } },
      { key: 'sharing', code: 'F4', label: 'Vad får delas om företagets behov eller lösningar inför en matchning?', type: 'single', options: SPARK_SHARING_LEVELS, required: true },
      { key: 'info_ok', code: 'F1', label: 'Vill företaget få information om kommande aktiviteter inom SPARK?', type: 'single', options: YES_NO },
      { key: 'events_ok', code: 'F2', label: 'Vill företaget delta i nätverksträffar, workshops eller matchningsaktiviteter?', type: 'single', options: YES_NO },
      { key: 'other', label: 'Något mer som är bra att veta?', type: 'longtext', max: 2000 }
    ]
  }
];

export type SparkValue = string | string[];
export type SparkRecord = Record<string, SparkValue>;

export interface SparkInterviewAnswers {
  roles: SparkRole[];
  company: SparkRecord;
  needs: SparkRecord[];
  solutions: SparkRecord[];
}

export function emptySparkAnswers(): SparkInterviewAnswers {
  return { roles: [], company: {}, needs: [], solutions: [] };
}

/** Avsnitten som gäller för de valda rollerna — i intervjuns ordning. */
export function visibleSparkSections(roles: readonly SparkRole[]): SparkSection[] {
  return SPARK_INTERVIEW_SECTIONS.filter((s) => !s.roles || s.roles.some((r) => roles.includes(r)));
}

export function sparkFieldVisible(field: SparkField, scope: SparkRecord): boolean {
  if (!field.showIf) return true;
  const v = scope[field.showIf.field];
  return typeof v === 'string' && field.showIf.in.includes(v);
}

function hasValue(v: SparkValue | undefined): boolean {
  return Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim() !== '';
}

function cleanField(field: SparkField, raw: unknown): SparkValue | undefined {
  switch (field.type) {
    case 'single': {
      const v = pickOption(raw, field.options ?? []);
      return v || undefined;
    }
    case 'multi': {
      const v = pickOptions(raw, field.options ?? []);
      return v.length ? v : undefined;
    }
    case 'email': {
      const v = cleanPlain(raw, field.max ?? 200).toLowerCase();
      return v || undefined;
    }
    case 'phone': {
      const v = cleanPlain(raw, field.max ?? 40).replace(/[^\d+\-() ]/g, '');
      return v || undefined;
    }
    default: {
      // Namnfält får inte maskas som personnummer; fritext maskas.
      const v = field.key === 'org_nr' ? cleanPlain(raw, 20) : cleanSparkText(raw, field.max ?? T);
      return v || undefined;
    }
  }
}

function cleanScope(fields: readonly SparkField[], raw: unknown): SparkRecord {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: SparkRecord = {};
  // Två varv: villkorade fält prövas mot de redan rensade värdena.
  for (const f of fields) {
    if (f.showIf) continue;
    const v = cleanField(f, src[f.key]);
    if (v !== undefined) out[f.key] = v;
  }
  for (const f of fields) {
    if (!f.showIf || !sparkFieldVisible(f, out)) continue;
    const v = cleanField(f, src[f.key]);
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

function itemId(raw: unknown, used: Set<string>, index: number): string {
  const candidate = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)._id : undefined;
  let id = typeof candidate === 'string' && ITEM_ID_RE.test(candidate) ? candidate : '';
  if (!id || used.has(id)) {
    let n = index + 1;
    do {
      id = `item${String(n).padStart(3, '0')}`;
      n += 1;
    } while (used.has(id));
  }
  used.add(id);
  return id;
}

export interface SparkInterviewIssue {
  section: SparkSectionId;
  field: string;
  /** Index i behov/lösningar när felet gäller en upprepad post. */
  item?: number;
  message: string;
}

export type SparkInterviewResult =
  | { ok: true; value: SparkInterviewAnswers }
  | { ok: false; value: SparkInterviewAnswers; issue: SparkInterviewIssue };

/**
 * Tvingar in ett svar i formulärets form: bara avsnitt som gäller för de
 * valda rollerna behålls, okända fält och värden kastas, text kapas och
 * personnummer maskas. `submit` kräver dessutom de obligatoriska fälten —
 * ett utkast får vara ofullständigt.
 */
export function normalizeSparkInterview(raw: unknown, opts: { submit?: boolean } = {}): SparkInterviewResult {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const roles = sanitizeSparkRoles(src.roles);
  const sections = visibleSparkSections(roles);
  const company: SparkRecord = {};
  const needs: SparkRecord[] = [];
  const solutions: SparkRecord[] = [];
  for (const s of sections) {
    Object.assign(company, cleanScope(s.fields, src.company));
    if (s.repeat) {
      const list = Array.isArray(src[s.repeat.key]) ? (src[s.repeat.key] as unknown[]).slice(0, s.repeat.max) : [];
      const used = new Set<string>();
      const target = s.repeat.key === 'needs' ? needs : solutions;
      list.forEach((item, i) => {
        const cleaned = cleanScope(s.repeat!.fields, item);
        if (Object.keys(cleaned).length === 0) return;
        cleaned._id = itemId(item, used, i);
        target.push(cleaned);
      });
    }
  }
  if (typeof company.org_nr === 'string') {
    const org = normalizeSparkOrgNr(company.org_nr);
    if (org) company.org_nr = org;
  }
  const value: SparkInterviewAnswers = { roles, company, needs, solutions };
  const bad = (issue: SparkInterviewIssue): SparkInterviewResult => ({ ok: false, value, issue });

  if (!hasValue(company.name) || String(company.name).length < 2) {
    return bad({ section: 'start', field: 'name', message: 'Ange företagets namn.' });
  }
  if (typeof company.org_nr === 'string' && company.org_nr && !normalizeSparkOrgNr(company.org_nr)) {
    return bad({ section: 'start', field: 'org_nr', message: 'Organisationsnumret ska ha tio siffror.' });
  }
  if (typeof company.contact_email === 'string' && company.contact_email && !EMAIL_RE.test(company.contact_email)) {
    return bad({ section: 'f', field: 'contact_email', message: 'E-postadressen ser inte rätt ut.' });
  }
  if (!opts.submit) return { ok: true, value };

  for (const s of sections) {
    for (const f of s.fields) {
      if (f.required && sparkFieldVisible(f, company) && !hasValue(company[f.key])) {
        return bad({ section: s.id, field: f.key, message: `Svara på frågan "${f.label}".` });
      }
    }
    if (s.repeat) {
      const list = s.repeat.key === 'needs' ? needs : solutions;
      if (list.length === 0) {
        return bad({ section: s.id, field: s.repeat.key, message: `Lägg till minst ett ${s.repeat.key === 'needs' ? 'behov' : 'exempel på en lösning'}.` });
      }
      for (let i = 0; i < list.length; i += 1) {
        for (const f of s.repeat.fields) {
          if (f.required && sparkFieldVisible(f, list[i]) && !hasValue(list[i][f.key])) {
            return bad({ section: s.id, field: f.key, item: i, message: `${s.repeat.itemLabel} ${i + 1}: svara på "${f.label}".` });
          }
        }
      }
    }
  }
  return { ok: true, value };
}

/** Hur stor del av de synliga frågorna som har svar (0–100). */
export function sparkInterviewProgress(answers: SparkInterviewAnswers): number {
  let total = 0;
  let done = 0;
  for (const s of visibleSparkSections(answers.roles)) {
    for (const f of s.fields) {
      if (!sparkFieldVisible(f, answers.company)) continue;
      total += 1;
      if (hasValue(answers.company[f.key])) done += 1;
    }
    if (s.repeat) {
      total += 1;
      if ((s.repeat.key === 'needs' ? answers.needs : answers.solutions).length > 0) done += 1;
    }
  }
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

// ── Från intervjusvar till poster i registret ───────────────────────────────

const str = (v: SparkValue | undefined): string => (typeof v === 'string' ? v : '');
const list = (v: SparkValue | undefined): string[] => (Array.isArray(v) ? v : []);

export interface SparkActorDraft {
  name: string;
  org_nr: string;
  actor_type: string;
  sector: string;
  business: string;
  kommun: string;
  size: string;
  roles: SparkRole[];
  energy_importance: string;
  energy_work: string;
  development_areas: string;
  pilot_interest: string;
  academia_interest: string;
  need_matching: string;
  solution_matching: string;
  support_needs: string[];
  program_interest: string;
  info_ok: boolean;
  events_ok: boolean;
  contact_ok: boolean;
  sharing: string;
  contact_name: string;
  contact_role: string;
  contact_email: string;
  contact_phone: string;
}

export interface SparkNeedDraft {
  source_key: string;
  title: string;
  description: string;
  areas: string[];
  process_note: string;
  unmet: string;
  consequences: string[];
  priority: string;
  horizon: string;
  tried: string;
}

export interface SparkSolutionDraft {
  source_key: string;
  name: string;
  description: string;
  problem: string;
  areas: string[];
  target_sectors: string[];
  contributions: string[];
  maturity: number;
  trl: number;
  verified: string;
  needs: string[];
  barriers: string;
  expansion: string;
}

export interface SparkTestbedDraft {
  source_key: string;
  kind: SparkTestbedKind;
  description: string;
  areas: string[];
  conditions: string;
}

export interface SparkDerivedRecords {
  actor: SparkActorDraft;
  needs: SparkNeedDraft[];
  solutions: SparkSolutionDraft[];
  testbeds: SparkTestbedDraft[];
}

/** Delar upp ett (normaliserat) intervjusvar i aktör, behov, lösningar och testmiljöer. */
export function deriveSparkRecords(answers: SparkInterviewAnswers): SparkDerivedRecords {
  const c = answers.company;
  const contactOk = str(c.contact_ok) === 'yes';
  const actor: SparkActorDraft = {
    name: str(c.name),
    org_nr: normalizeSparkOrgNr(str(c.org_nr)),
    actor_type: str(c.actor_type),
    sector: str(c.sector),
    business: str(c.business),
    kommun: str(c.kommun),
    size: str(c.size),
    roles: answers.roles,
    energy_importance: str(c.energy_importance),
    energy_work: str(c.energy_work),
    development_areas: str(c.development_areas),
    pilot_interest: str(c.pilot_interest),
    academia_interest: str(c.academia_interest),
    need_matching: str(c.need_matching),
    solution_matching: str(c.solution_matching),
    support_needs: list(c.support_needs),
    program_interest: str(c.program_interest),
    info_ok: str(c.info_ok) === 'yes',
    events_ok: str(c.events_ok) === 'yes',
    contact_ok: contactOk,
    sharing: str(c.sharing),
    // Kontaktuppgifter följer bara med när företaget sagt ja till kontakt.
    contact_name: contactOk ? str(c.contact_name) : '',
    contact_role: contactOk ? str(c.contact_role) : '',
    contact_email: contactOk ? str(c.contact_email) : '',
    contact_phone: contactOk ? str(c.contact_phone) : ''
  };
  const needs = answers.needs.map<SparkNeedDraft>((n) => ({
    source_key: `need:${str(n._id)}`,
    title: str(n.title),
    description: str(n.description),
    areas: list(n.areas),
    process_note: str(n.where),
    unmet: str(n.unmet),
    consequences: list(n.consequences),
    priority: str(n.priority),
    horizon: str(n.horizon),
    tried: str(n.tried)
  }));
  const solutions = answers.solutions.map<SparkSolutionDraft>((s) => ({
    source_key: `solution:${str(s._id)}`,
    name: str(s.name),
    description: str(s.description),
    problem: str(s.problem),
    areas: list(s.areas),
    target_sectors: list(s.target_sectors),
    contributions: list(s.contributions),
    maturity: Number(str(s.maturity)) || 0,
    trl: Number(str(s.trl)) || 0,
    verified: str(s.verified),
    needs: list(s.needs),
    barriers: str(s.barriers),
    expansion: str(s.expansion)
  }));
  const testbeds: SparkTestbedDraft[] = [];
  if (str(c.has_testbed) === 'yes') {
    testbeds.push({
      source_key: 'testbed:env',
      kind: 'test_environment',
      description: str(c.testbed_description),
      areas: list(c.testbed_areas),
      conditions: str(c.test_conditions)
    });
  }
  if (str(c.pilot_interest) === 'yes' || str(c.pilot_interest) === 'maybe') {
    const needAreas = [...new Set(needs.flatMap((n) => n.areas))];
    testbeds.push({
      source_key: 'testbed:pilot',
      kind: 'pilot_customer',
      description: str(c.pilot_interest) === 'maybe' ? 'Kan tänka sig att vara pilotkund.' : 'Intresserad av att vara pilotkund.',
      areas: needAreas,
      conditions: str(c.test_conditions)
    });
  }
  return { actor, needs, solutions, testbeds };
}

// ── Presentation ────────────────────────────────────────────────────────────

/** Anonym beskrivning av en aktör: "Processindustri i Sandviken (50–249 anställda)". */
export function sparkAnonymousActorLabel(a: { sector?: string; kommun?: string; size?: string; actor_type?: string }): string {
  const sector =
    SECTOR_SHORT[a.sector ?? ''] ??
    (a.sector && SPARK_SECTOR_LABELS[a.sector]) ??
    (a.actor_type && SPARK_ACTOR_TYPE_LABELS[a.actor_type]) ??
    'Företag';
  const kommunLabel = a.kommun && a.kommun !== 'annan_sverige' && a.kommun !== 'utanfor_sverige' ? SPARK_KOMMUN_LABELS[a.kommun] : '';
  const size = a.size && SPARK_SIZE_LABELS[a.size] ? ` (${SPARK_SIZE_LABELS[a.size]})` : '';
  return `${sector}${kommunLabel ? ` i ${kommunLabel}` : ''}${size}`;
}

/** Namnet som får visas för motparten, utifrån aktörens delningsnivå. */
export function sparkShareableName(a: { name: string; sharing?: string; sector?: string; kommun?: string; size?: string; actor_type?: string }): string {
  return a.sharing === 'named' ? a.name : sparkAnonymousActorLabel(a);
}

export function sparkLabels(values: readonly string[], map: Record<string, string>): string[] {
  return values.map((v) => map[v] ?? v);
}

// ── Projektindikatorer ──────────────────────────────────────────────────────

export interface SparkIndicatorInput {
  needs: readonly { id: string; actor: string }[];
  solutions: readonly { id: string; actor: string }[];
  testbeds: readonly { id: string; actor: string }[];
  matches: readonly { status: SparkMatchStatus; need?: string | null; solution?: string | null; testbed?: string | null; support_kind?: string; support_confirmed?: boolean }[];
  actors: readonly { id: string; actor_type?: string; academia_interest?: string }[];
}

export interface SparkIndicators {
  /** Behovsägare (aktörer med behov eller testmiljö) som är med i en aktiv matchning. */
  needOwnersInvolved: number;
  /** Företag med lösning som fått en bekräftad stödinsats. */
  supportedCompanies: number;
  /** Aktörer som är med i minst en aktiv matchning. */
  structureUsers: number;
  /** Aktiva matchningar där en akademisk aktör deltar. */
  researchCollaborations: number;
  pilots: number;
}

/** Räknar projektets indikatorer ur registret — distinkta aktörer, aldrig rader. */
export function computeSparkIndicators(input: SparkIndicatorInput): SparkIndicators {
  const needActor = new Map(input.needs.map((n) => [n.id, n.actor]));
  const solutionActor = new Map(input.solutions.map((s) => [s.id, s.actor]));
  const testbedActor = new Map(input.testbeds.map((t) => [t.id, t.actor]));
  const academia = new Set(input.actors.filter((a) => a.actor_type === 'akademi').map((a) => a.id));
  const needOwners = new Set<string>();
  const supported = new Set<string>();
  const users = new Set<string>();
  let research = 0;
  let pilots = 0;
  for (const m of input.matches) {
    if (!SPARK_MATCH_ACTIVE_STATUSES.includes(m.status)) continue;
    const na = m.need ? needActor.get(m.need) : undefined;
    const sa = m.solution ? solutionActor.get(m.solution) : undefined;
    const ta = m.testbed ? testbedActor.get(m.testbed) : undefined;
    const parties = [na, sa, ta].filter((x): x is string => Boolean(x));
    for (const p of parties) users.add(p);
    if (na) needOwners.add(na);
    if (ta) needOwners.add(ta);
    if (sa && m.support_kind === 'de_minimis' && m.support_confirmed) supported.add(sa);
    if (parties.some((p) => academia.has(p))) research += 1;
    if (SPARK_MATCH_PILOT_STATUSES.includes(m.status)) pilots += 1;
  }
  return {
    needOwnersInvolved: needOwners.size,
    supportedCompanies: supported.size,
    structureUsers: users.size,
    researchCollaborations: research,
    pilots
  };
}

/** Listor för val i gränssnittet — samlade så komponenterna inte importerar var och en. */
export const SPARK_OPTION_IDS = {
  areas: ids(SPARK_ENERGY_AREAS),
  sectors: ids(SPARK_SECTORS),
  actorTypes: ids(SPARK_ACTOR_TYPES)
};
