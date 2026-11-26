/**
 * Diarium, informationshanteringsplan och arkivförteckning (CLAUDE.md § 60).
 *
 * REN modul (ingen IO, ingen React) — delas av skrivlagret, läsvägen, UI:t
 * och enhetstesterna. Tre lager:
 *
 *   1. PLANEN (`record_types`): en rad per handlingstyp — vilken händelse som
 *      gör handlingen allmän, om den registreras/hålls ordnad, om sekretess kan
 *      förekomma, om den bevaras eller gallras och med vilken frist.
 *   2. DIARIET (`register_cases` + `register_entries`): ärenden med löpnummer
 *      per år och handlingar i nummerordning, med de uppgifter OSL 5 kap. 2 §
 *      kräver (datum, beteckning, från/till, vad handlingen rör).
 *   3. FÖRTECKNINGEN: arkivförteckning (per process → handlingstyp: antal,
 *      tidsspann, förvaring, bevara/gallra) som räknas ur plan + diarium, och
 *      en arkivbeskrivning som personalen håller aktuell. Båda fastställs som
 *      daterade versioner.
 *
 * Standardvärdena nedan är FÖRSLAG. Lagrum för sekretess och gallringsfrister
 * ska bekräftas av jurist/arkivmyndighet — därför bär varje planrad
 * `confirmed`, och granskningsvyn varnar för obekräftade rader.
 */

// ─── Vokabulär ────────────────────────────────────────────────────────────

export const RECORD_DIRECTIONS = ['incoming', 'outgoing', 'created'] as const;
export type RecordDirection = (typeof RECORD_DIRECTIONS)[number];
export const RECORD_DIRECTION_LABELS: Record<RecordDirection, string> = {
  incoming: 'Inkommen',
  outgoing: 'Expedierad',
  created: 'Upprättad'
};

/** Hur handlingstypen hanteras (OSL 5 kap. 1 §). */
export const RECORD_HANDLINGS = ['register', 'ordered', 'minor'] as const;
export type RecordHandling = (typeof RECORD_HANDLINGS)[number];
export const RECORD_HANDLING_LABELS: Record<RecordHandling, string> = {
  register: 'Registreras i diariet',
  ordered: 'Hålls ordnad i systemet',
  minor: 'Ringa betydelse'
};

export const RECORD_RETENTIONS = ['preserve', 'dispose'] as const;
export type RecordRetention = (typeof RECORD_RETENTIONS)[number];
export const RECORD_RETENTION_LABELS: Record<RecordRetention, string> = {
  preserve: 'Bevaras',
  dispose: 'Gallras'
};

export const REGISTER_VIAS = ['auto', 'manual', 'backfill'] as const;
export type RegisterVia = (typeof REGISTER_VIAS)[number];
export const REGISTER_VIA_LABELS: Record<RegisterVia, string> = {
  auto: 'Automatiskt',
  manual: 'Manuellt',
  backfill: 'Efterregistrerad'
};

export const REGISTER_CASE_STATUSES = ['open', 'closed'] as const;
export type RegisterCaseStatus = (typeof REGISTER_CASE_STATUSES)[number];

export const DISCLOSURE_OUTCOMES = ['released', 'partial', 'denied'] as const;
export type DisclosureOutcome = (typeof DISCLOSURE_OUTCOMES)[number];
export const DISCLOSURE_OUTCOME_LABELS: Record<DisclosureOutcome, string> = {
  released: 'Utlämnad',
  partial: 'Utlämnad med maskning',
  denied: 'Inte utlämnad'
};

/** Roller: läsa = modulen (staff/observer); registrera manuellt; förvalta. */
export const REGISTER_MANUAL_ROLES = ['admin', 'incubator_lead', 'coach'] as const;
export const REGISTRAR_ROLES = ['admin', 'incubator_lead'] as const;

export function canManageRegister(roles: readonly string[]): boolean {
  return roles.some((r) => (REGISTRAR_ROLES as readonly string[]).includes(r));
}
export function canRegisterManually(roles: readonly string[]): boolean {
  return roles.some((r) => (REGISTER_MANUAL_ROLES as readonly string[]).includes(r));
}

// ─── Källor (vilka poster i plattformen som ger ärenden) ──────────────────

export const REGISTER_SOURCES = [
  'support_check_applications',
  'agreements',
  'procurements',
  'compass_leads',
  'screening_cases'
] as const;
export type RegisterSource = (typeof REGISTER_SOURCES)[number];

export const REGISTER_SOURCE_LABELS: Record<RegisterSource, string> = {
  support_check_applications: 'Stödcheckar',
  agreements: 'Avtal',
  procurements: 'Upphandlingar',
  compass_leads: 'Inflöde (leads)',
  screening_cases: 'Bedömning excellens'
};

export function isRegisterSource(v: unknown): v is RegisterSource {
  return typeof v === 'string' && (REGISTER_SOURCES as readonly string[]).includes(v);
}

/** Intern länk till källposten (visas i ärendet). */
export function registerSourceHref(source: string, id: string, startupId?: string | null): string | null {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) return null;
  switch (source) {
    case 'support_check_applications':
      return `/checkar/${id}`;
    case 'agreements':
      return startupId ? `/startups/${startupId}/dokument#agreements` : null;
    case 'procurements':
      return `/upphandlingar/${id}`;
    case 'compass_leads':
      return `/inflode/leads/${id}`;
    case 'screening_cases':
      return `/bedomning-excellens?arende=${id}`;
    default:
      return null;
  }
}

// ─── Planen ───────────────────────────────────────────────────────────────

export interface RecordTypePlan {
  key: string;
  label: string;
  /** Verksamhetsprocess (klassificeringsstrukturens nivå). */
  process: string;
  direction: RecordDirection;
  /** Händelsen som gör handlingen allmän. */
  trigger: string;
  handling: RecordHandling;
  secrecy_possible: boolean;
  /** Lagrum/grund — förslag tills planraden bekräftats. */
  secrecy_basis: string;
  retention: RecordRetention;
  /** Gallringsfrist i månader efter att ärendet avslutats (bara `dispose`). */
  retention_months: number | null;
  /** Rättslig grund/kommentar till bevarande eller gallring. */
  legal_basis: string;
  /** Var handlingen förvaras. */
  storage: string;
  source_collection: string;
  sort_order: number;
}

export const RECORD_STORAGE_DEFAULT = 'Movexum-plattformen (PocketBase, UpCloud EU)';

const SECRECY_HINT_BUSINESS =
  'Förslag: uppgift om enskilds affärs- eller driftförhållanden — lagrum bekräftas av jurist';

function plan(p: Omit<RecordTypePlan, 'storage'> & { storage?: string }): RecordTypePlan {
  return { storage: RECORD_STORAGE_DEFAULT, ...p };
}

/**
 * Movexums förslag till informationshanteringsplan. Materialiseras per tenant
 * första gången diariet används och redigeras sedan i /diarium?vy=plan.
 * Nycklarna är stabila — skrivlagrets inkopplingar refererar dem.
 */
export const DEFAULT_RECORD_TYPES: readonly RecordTypePlan[] = [
  plan({
    key: 'lead_incoming',
    label: 'Inkommen idébeskrivning / intresseanmälan',
    process: 'Inflöde och antagning',
    direction: 'incoming',
    trigger: 'Besökaren slutför en publik modul (formulär, quiz eller chatt)',
    handling: 'register',
    secrecy_possible: true,
    secrecy_basis: SECRECY_HINT_BUSINESS,
    retention: 'dispose',
    retention_months: 24,
    legal_basis: 'Förslag: gallras 2 år efter avslutat ärende om bolaget inte antas. Bekräftas i gallringsbeslut.',
    source_collection: 'compass_leads',
    sort_order: 10
  }),
  plan({
    key: 'agreement_signed',
    label: 'Signerat avtal',
    process: 'Inkubatorprogram',
    direction: 'created',
    trigger: 'Alla parter har signerat avtalet',
    handling: 'register',
    secrecy_possible: true,
    secrecy_basis: SECRECY_HINT_BUSINESS,
    retention: 'preserve',
    retention_months: null,
    legal_basis: 'Förslag: bevaras (avtal och signeringsbevis).',
    source_collection: 'agreements',
    sort_order: 20
  }),
  plan({
    key: 'support_check_application',
    label: 'Ansökan om stödcheck',
    process: 'Stöd och statsstöd',
    direction: 'incoming',
    trigger: 'Ansökan skickas in och signeras',
    handling: 'register',
    secrecy_possible: true,
    secrecy_basis: SECRECY_HINT_BUSINESS,
    retention: 'preserve',
    retention_months: null,
    legal_basis: 'Förslag: bevaras. Statsstödsunderlag ska kunna visas upp i minst 10 år (GBER art. 12, de minimis-förordningen).',
    source_collection: 'support_check_applications',
    sort_order: 30
  }),
  plan({
    key: 'support_check_completion',
    label: 'Komplettering av ansökan om stödcheck',
    process: 'Stöd och statsstöd',
    direction: 'incoming',
    trigger: 'Bolaget skickar in en kompletterad ansökan (ny revision)',
    handling: 'register',
    secrecy_possible: true,
    secrecy_basis: SECRECY_HINT_BUSINESS,
    retention: 'preserve',
    retention_months: null,
    legal_basis: 'Förslag: bevaras tillsammans med ansökan.',
    source_collection: 'support_check_applications',
    sort_order: 31
  }),
  plan({
    key: 'support_check_decision',
    label: 'Beslut om stödcheck',
    process: 'Stöd och statsstöd',
    direction: 'outgoing',
    trigger: 'Beslutet fattas och meddelas bolaget',
    handling: 'register',
    secrecy_possible: false,
    secrecy_basis: '',
    retention: 'preserve',
    retention_months: null,
    legal_basis: 'Förslag: bevaras (beslut om stöd).',
    source_collection: 'support_check_applications',
    sort_order: 32
  }),
  plan({
    key: 'screening_final',
    label: 'Slutbedömning statsstöd och Vinnova',
    process: 'Stöd och statsstöd',
    direction: 'created',
    trigger: 'Ärendet i Bedömning excellens klarmarkeras',
    handling: 'register',
    secrecy_possible: true,
    secrecy_basis: SECRECY_HINT_BUSINESS,
    retention: 'preserve',
    retention_months: null,
    legal_basis: 'Förslag: bevaras som underlag för statsstödsbeslut.',
    source_collection: 'screening_cases',
    sort_order: 40
  }),
  plan({
    key: 'procurement_opened',
    label: 'Upphandling — ärende och underlag',
    process: 'Upphandling',
    direction: 'created',
    trigger: 'Upphandlingen läggs upp',
    handling: 'register',
    secrecy_possible: true,
    secrecy_basis: 'Förslag: upphandlingssekretess till dess tilldelning skett (OSL 19 kap. 3 §) — bekräftas av jurist',
    retention: 'preserve',
    retention_months: null,
    legal_basis: 'Förslag: bevaras (förfrågningsunderlag, tilldelning, avtal).',
    source_collection: 'procurements',
    sort_order: 50
  }),
  plan({
    key: 'incoming_other',
    label: 'Övrig inkommen handling',
    process: 'Ledning och styrning',
    direction: 'incoming',
    trigger: 'Handlingen kommer in (brev, e-post, uppladdning)',
    handling: 'register',
    secrecy_possible: false,
    secrecy_basis: '',
    retention: 'preserve',
    retention_months: null,
    legal_basis: 'Förslag: bevaras tills typen fått en egen rad i planen.',
    source_collection: '',
    sort_order: 90
  }),
  plan({
    key: 'outgoing_other',
    label: 'Övrig expedierad handling',
    process: 'Ledning och styrning',
    direction: 'outgoing',
    trigger: 'Handlingen skickas ut',
    handling: 'register',
    secrecy_possible: false,
    secrecy_basis: '',
    retention: 'preserve',
    retention_months: null,
    legal_basis: 'Förslag: bevaras tills typen fått en egen rad i planen.',
    source_collection: '',
    sort_order: 91
  }),
  plan({
    key: 'created_other',
    label: 'Övrig upprättad handling',
    process: 'Ledning och styrning',
    direction: 'created',
    trigger: 'Handlingen justeras eller färdigställs (protokoll, beslut, rapport)',
    handling: 'register',
    secrecy_possible: false,
    secrecy_basis: '',
    retention: 'preserve',
    retention_months: null,
    legal_basis: 'Förslag: bevaras tills typen fått en egen rad i planen.',
    source_collection: '',
    sort_order: 92
  })
];

export const RECORD_TYPE_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
const PNR_RE = /\b(\d{6}|\d{8})[-+]?\d{4}\b/g;

/** Plattar, kapar och personnummer-tvättar fritext. */
export function cleanRegisterText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(PNR_RE, '[REDACTED]').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Som ovan men behåller radbrytningar (arkivbeskrivningens avsnitt). */
export function cleanRegisterLongText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(PNR_RE, '[REDACTED]')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export interface RecordTypeInput {
  key?: unknown;
  label?: unknown;
  process?: unknown;
  direction?: unknown;
  trigger?: unknown;
  handling?: unknown;
  secrecy_possible?: unknown;
  secrecy_basis?: unknown;
  retention?: unknown;
  retention_months?: unknown;
  legal_basis?: unknown;
  storage?: unknown;
}

export type RecordTypeValues = Omit<RecordTypePlan, 'source_collection' | 'sort_order'>;

export function validateRecordTypeInput(input: RecordTypeInput): Validated<RecordTypeValues> {
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (!RECORD_TYPE_KEY_RE.test(key)) return { ok: false, error: 'Nyckeln ska vara gemener, siffror och understreck (2–40 tecken).' };
  const label = cleanRegisterText(input.label, 120);
  if (label.length < 2) return { ok: false, error: 'Ange ett namn på handlingstypen.' };
  const process = cleanRegisterText(input.process, 80);
  if (!process) return { ok: false, error: 'Ange vilken process handlingstypen hör till.' };
  if (!(RECORD_DIRECTIONS as readonly unknown[]).includes(input.direction)) return { ok: false, error: 'Välj inkommen, expedierad eller upprättad.' };
  if (!(RECORD_HANDLINGS as readonly unknown[]).includes(input.handling)) return { ok: false, error: 'Välj hur handlingstypen hanteras.' };
  if (!(RECORD_RETENTIONS as readonly unknown[]).includes(input.retention)) return { ok: false, error: 'Välj bevaras eller gallras.' };
  const retention = input.retention as RecordRetention;
  let months: number | null = null;
  if (retention === 'dispose') {
    const n = typeof input.retention_months === 'number' ? input.retention_months : Number(String(input.retention_months ?? '').trim());
    if (!Number.isInteger(n) || n < 1 || n > 1200) return { ok: false, error: 'Ange gallringsfrist i hela månader (1–1200).' };
    months = n;
  }
  const secrecy = input.secrecy_possible === true || input.secrecy_possible === 'true' || input.secrecy_possible === 'on';
  const handling = input.handling as RecordHandling;
  if (secrecy && handling !== 'register') {
    return { ok: false, error: 'En handlingstyp som kan innehålla sekretess ska registreras i diariet (OSL 5 kap. 1 §).' };
  }
  return {
    ok: true,
    value: {
      key,
      label,
      process,
      direction: input.direction as RecordDirection,
      trigger: cleanRegisterText(input.trigger, 300),
      handling,
      secrecy_possible: secrecy,
      secrecy_basis: secrecy ? cleanRegisterText(input.secrecy_basis, 300) : '',
      retention,
      retention_months: months,
      legal_basis: cleanRegisterText(input.legal_basis, 400),
      storage: cleanRegisterText(input.storage, 200) || RECORD_STORAGE_DEFAULT
    }
  };
}

// ─── Diarienummer ─────────────────────────────────────────────────────────

/** Ärendets beteckning: `2026/0042`. */
export function formatCaseNumber(year: number, seq: number): string {
  return `${year}/${String(seq).padStart(4, '0')}`;
}

/** Handlingens beteckning: `2026/0042-3`. */
export function formatEntryDesignation(caseNumber: string, seqInCase: number): string {
  return `${caseNumber}-${seqInCase}`;
}

export function nextSequence(existing: readonly number[]): number {
  let max = 0;
  for (const n of existing) if (Number.isInteger(n) && n > max) max = n;
  return max + 1;
}

/** Luckor i en nummerserie (1..max). En obruten serie är ett granskningskrav. */
export function findSequenceGaps(seqs: readonly number[]): number[] {
  const set = new Set(seqs.filter((n) => Number.isInteger(n) && n > 0));
  if (set.size === 0) return [];
  const max = Math.max(...set);
  const gaps: number[] = [];
  for (let i = 1; i <= max && gaps.length < 50; i++) if (!set.has(i)) gaps.push(i);
  return gaps;
}

// ─── Registrering ─────────────────────────────────────────────────────────

export interface RegisterEntryHashInput {
  type_key: string;
  title: string;
  direction: RecordDirection;
  document_date: string;
  source_collection: string;
  source_id: string;
  source_event: string;
  /** Kontrollsumma för själva handlingen (t.ex. avtalets PDF) när den finns. */
  document_hash: string;
  snapshot: unknown;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        if (o[k] !== undefined) acc[k] = canonical(o[k]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Den kanoniska strängen som registreringens kontrollsumma (SHA-256) räknas
 * på. Samma indata ger alltid samma sträng — granskningen räknar om summan
 * ur den lagrade posten och jämför.
 */
export function registerEntryHashPayload(input: RegisterEntryHashInput): string {
  return JSON.stringify(
    canonical({
      type_key: input.type_key,
      title: input.title,
      direction: input.direction,
      document_date: (input.document_date || '').slice(0, 10),
      source_collection: input.source_collection,
      source_id: input.source_id,
      source_event: input.source_event,
      document_hash: input.document_hash,
      snapshot: input.snapshot ?? null
    })
  );
}

export interface ManualEntryInput {
  type_key?: unknown;
  title?: unknown;
  case_title?: unknown;
  counterpart?: unknown;
  document_date?: unknown;
  secrecy?: unknown;
  secrecy_basis?: unknown;
  note?: unknown;
}

export interface ManualEntryValues {
  type_key: string;
  title: string;
  case_title: string;
  counterpart: string;
  document_date: string;
  secrecy: boolean;
  secrecy_basis: string;
  note: string;
}

export function validateManualEntryInput(input: ManualEntryInput, todayIso: string): Validated<ManualEntryValues> {
  const type = typeof input.type_key === 'string' ? input.type_key.trim() : '';
  if (!RECORD_TYPE_KEY_RE.test(type)) return { ok: false, error: 'Välj handlingstyp.' };
  const title = cleanRegisterText(input.title, 200);
  if (title.length < 3) return { ok: false, error: 'Beskriv kort vad handlingen rör.' };
  const date = typeof input.document_date === 'string' && input.document_date.trim() ? input.document_date.trim().slice(0, 10) : todayIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { ok: false, error: 'Ogiltigt datum.' };
  if (date > todayIso.slice(0, 10)) return { ok: false, error: 'Handlingens datum kan inte ligga i framtiden.' };
  const secrecy = input.secrecy === true || input.secrecy === 'true' || input.secrecy === 'on';
  return {
    ok: true,
    value: {
      type_key: type,
      title,
      case_title: cleanRegisterText(input.case_title, 200) || title,
      counterpart: cleanRegisterText(input.counterpart, 160),
      document_date: date,
      secrecy,
      secrecy_basis: secrecy ? cleanRegisterText(input.secrecy_basis, 300) : '',
      note: cleanRegisterText(input.note, 500)
    }
  };
}

export interface DisclosureInput {
  request_summary?: unknown;
  outcome?: unknown;
  secrecy_basis?: unknown;
  note?: unknown;
  requested_at?: unknown;
}

export interface DisclosureValues {
  request_summary: string;
  outcome: DisclosureOutcome;
  secrecy_basis: string;
  note: string;
  requested_at: string;
}

export function validateDisclosureInput(input: DisclosureInput, todayIso: string): Validated<DisclosureValues> {
  const summary = cleanRegisterText(input.request_summary, 400);
  if (summary.length < 3) return { ok: false, error: 'Beskriv vad som begärdes ut.' };
  if (!(DISCLOSURE_OUTCOMES as readonly unknown[]).includes(input.outcome)) return { ok: false, error: 'Välj utfall.' };
  const outcome = input.outcome as DisclosureOutcome;
  const basis = cleanRegisterText(input.secrecy_basis, 300);
  if (outcome !== 'released' && !basis) return { ok: false, error: 'Ange lagrum för sekretessen när något inte lämnas ut.' };
  const date = typeof input.requested_at === 'string' && input.requested_at.trim() ? input.requested_at.trim().slice(0, 10) : todayIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { ok: false, error: 'Ogiltigt datum.' };
  return { ok: true, value: { request_summary: summary, outcome, secrecy_basis: basis, note: cleanRegisterText(input.note, 600), requested_at: date } };
}

// ─── Gallring ─────────────────────────────────────────────────────────────

/**
 * När en handling får gallras: fristen räknas från att ÄRENDET avslutats.
 * `null` = bevaras, eller ärendet är inte avslutat (fristen har inte börjat).
 */
export function disposalDueDate(
  entry: { retention: RecordRetention | ''; retention_months: number | null },
  caseClosedAt: string | null | undefined
): string | null {
  if (entry.retention !== 'dispose' || !entry.retention_months || !caseClosedAt) return null;
  const d = new Date(caseClosedAt);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + entry.retention_months);
  return d.toISOString().slice(0, 10);
}

// ─── Arkivförteckning ─────────────────────────────────────────────────────

export interface InventoryEntryFact {
  type_key: string;
  registered_at: string;
  secrecy: boolean;
  voided: boolean;
}

export interface InventoryRow {
  key: string;
  label: string;
  direction: RecordDirection;
  handling: RecordHandling;
  retention: RecordRetention;
  retention_months: number | null;
  secrecy_possible: boolean;
  storage: string;
  count: number;
  secrecy_count: number;
  first: string | null;
  last: string | null;
}

export interface InventoryProcess {
  process: string;
  rows: InventoryRow[];
  count: number;
}

/**
 * Arkivförteckningen: per process → handlingstyp med antal registrerade
 * handlingar, tidsspann och förvaring. Makulerade handlingar räknas inte.
 * Typer utan registreringar finns med (förteckningen visar även det som ska
 * finnas). Handlingar vars typ saknas i planen samlas under "Saknas i planen".
 */
export function buildArchiveInventory(types: readonly RecordTypePlan[], entries: readonly InventoryEntryFact[]): InventoryProcess[] {
  const stats = new Map<string, { count: number; secrecy: number; first: string | null; last: string | null }>();
  for (const e of entries) {
    if (e.voided) continue;
    const s = stats.get(e.type_key) ?? { count: 0, secrecy: 0, first: null, last: null };
    s.count += 1;
    if (e.secrecy) s.secrecy += 1;
    const d = (e.registered_at || '').slice(0, 10);
    if (d) {
      if (!s.first || d < s.first) s.first = d;
      if (!s.last || d > s.last) s.last = d;
    }
    stats.set(e.type_key, s);
  }
  const byProcess = new Map<string, InventoryRow[]>();
  const known = new Set<string>();
  for (const t of [...types].sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, 'sv'))) {
    known.add(t.key);
    const s = stats.get(t.key);
    const row: InventoryRow = {
      key: t.key,
      label: t.label,
      direction: t.direction,
      handling: t.handling,
      retention: t.retention,
      retention_months: t.retention_months,
      secrecy_possible: t.secrecy_possible,
      storage: t.storage,
      count: s?.count ?? 0,
      secrecy_count: s?.secrecy ?? 0,
      first: s?.first ?? null,
      last: s?.last ?? null
    };
    byProcess.set(t.process, [...(byProcess.get(t.process) ?? []), row]);
  }
  const orphans: InventoryRow[] = [];
  for (const [key, s] of stats) {
    if (known.has(key)) continue;
    orphans.push({
      key,
      label: key,
      direction: 'created',
      handling: 'register',
      retention: 'preserve',
      retention_months: null,
      secrecy_possible: false,
      storage: RECORD_STORAGE_DEFAULT,
      count: s.count,
      secrecy_count: s.secrecy,
      first: s.first,
      last: s.last
    });
  }
  const out: InventoryProcess[] = [...byProcess].map(([process, rows]) => ({ process, rows, count: rows.reduce((n, r) => n + r.count, 0) }));
  if (orphans.length) out.push({ process: 'Saknas i planen', rows: orphans, count: orphans.reduce((n, r) => n + r.count, 0) });
  return out;
}

// ─── Arkivbeskrivning ─────────────────────────────────────────────────────

export const ARCHIVE_DESCRIPTION_SECTIONS = [
  { key: 'organisation', label: 'Verksamhet och organisation', hint: 'Vad Movexum gör, ägare, hur verksamheten är organiserad.' },
  { key: 'history', label: 'Historik', hint: 'När verksamheten startade och viktiga förändringar (namnbyten, omorganisationer, systembyten).' },
  { key: 'records', label: 'Viktiga handlingsslag', hint: 'De handlingar som är mest betydelsefulla och var de finns.' },
  { key: 'search', label: 'Sökingångar', hint: 'Hur man hittar handlingar: diariet, bolagskort, register och äldre system.' },
  { key: 'secrecy', label: 'Sekretess', hint: 'Vilka sekretessbestämmelser som vanligen tillämpas och vem som prövar utlämnande.' },
  { key: 'disposal', label: 'Gallring', hint: 'Vilka gallringsbeslut som gäller och hur gallring går till.' },
  { key: 'responsible', label: 'Ansvar', hint: 'Arkivansvarig, arkivredogörare och arkivmyndighet (roller, inte personuppgifter utöver namn i tjänsten).' }
] as const;
export type ArchiveSectionKey = (typeof ARCHIVE_DESCRIPTION_SECTIONS)[number]['key'];
export type ArchiveDescription = Record<ArchiveSectionKey, string>;
export const ARCHIVE_SECTION_MAX = 4000;

export function normalizeArchiveDescription(raw: unknown): ArchiveDescription {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = {} as ArchiveDescription;
  for (const s of ARCHIVE_DESCRIPTION_SECTIONS) out[s.key] = cleanRegisterLongText(o[s.key], ARCHIVE_SECTION_MAX);
  return out;
}

export function archiveDescriptionMissing(desc: ArchiveDescription): string[] {
  return ARCHIVE_DESCRIPTION_SECTIONS.filter((s) => !desc[s.key]).map((s) => s.label);
}

// ─── Granskning ───────────────────────────────────────────────────────────

export type AuditStatus = 'ok' | 'warn' | 'fail' | 'info';

export interface AuditCheck {
  key: string;
  label: string;
  status: AuditStatus;
  detail: string;
  /** Vad man gör åt det — tom när allt är i ordning. */
  action: string;
}

export interface SourceCoverage {
  source: RegisterSource;
  /** Poster i källan som ska ha ett ärende. `null` = kunde inte räknas. */
  expected: number | null;
  registered: number | null;
}

export interface AuditInput {
  types: readonly (RecordTypePlan & { confirmed: boolean; active: boolean })[];
  coverage: readonly SourceCoverage[];
  /** Löpnummer per år för ärendena. */
  caseSeqsByYear: Readonly<Record<string, readonly number[]>>;
  entries: { total: number; withoutHash: number; secrecyWithoutBasis: number; disposalDue: number; complete: boolean };
  disclosures: number;
  description: ArchiveDescription;
  /** Senast fastställda version av plan + förteckning. */
  lastVersionAt: string | null;
  /** Planen eller beskrivningen ändrad efter senaste fastställda version. */
  changedSinceVersion: boolean;
  /** Servern kan skriva i diariet (superuser konfigurerad, schemat finns). */
  writable: boolean;
  today: string;
}

/** Hur gammal en fastställd version får bli innan granskningen varnar. */
export const ARCHIVE_VERSION_MAX_AGE_DAYS = 365;

export function runRegisterAudit(input: AuditInput): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const active = input.types.filter((t) => t.active);

  checks.push(
    input.writable
      ? { key: 'writable', label: 'Diariet tar emot registreringar', status: 'ok', detail: 'Servern kan skriva i diariet.', action: '' }
      : {
          key: 'writable',
          label: 'Diariet tar emot registreringar',
          status: 'fail',
          detail: 'Servern kan inte skriva i diariet — inga handlingar registreras.',
          action: 'Sätt POCKETBASE_SUPERUSER_EMAIL/PASSWORD på web-appen och kör migration 1700000219.'
        }
  );

  const unconfirmed = active.filter((t) => !t.confirmed);
  checks.push(
    active.length === 0
      ? { key: 'plan', label: 'Informationshanteringsplanen är beslutad', status: 'fail', detail: 'Planen saknar handlingstyper.', action: 'Öppna fliken Plan.' }
      : unconfirmed.length === 0
        ? { key: 'plan', label: 'Informationshanteringsplanen är beslutad', status: 'ok', detail: `Alla ${active.length} handlingstyper är bekräftade.`, action: '' }
        : {
            key: 'plan',
            label: 'Informationshanteringsplanen är beslutad',
            status: 'warn',
            detail: `${unconfirmed.length} av ${active.length} handlingstyper bär fortfarande förslagsvärden.`,
            action: 'Gå igenom raderna i Plan med jurist/arkivmyndighet och bekräfta dem.'
          }
  );

  const secrecyNoBasis = active.filter((t) => t.secrecy_possible && !t.secrecy_basis);
  const disposeNoBasis = active.filter((t) => t.retention === 'dispose' && !t.legal_basis);
  checks.push(
    secrecyNoBasis.length + disposeNoBasis.length === 0
      ? { key: 'plan_basis', label: 'Sekretess och gallring har angiven grund', status: 'ok', detail: 'Varje rad som kan innehålla sekretess eller gallras har en grund.', action: '' }
      : {
          key: 'plan_basis',
          label: 'Sekretess och gallring har angiven grund',
          status: 'warn',
          detail: `${secrecyNoBasis.length} rader saknar lagrum för sekretess, ${disposeNoBasis.length} saknar grund för gallring.`,
          action: 'Fyll i grunden på raderna i Plan.'
        }
  );

  const uncounted = input.coverage.filter((c) => c.expected === null || c.registered === null);
  const missing = input.coverage.reduce((n, c) => (c.expected !== null && c.registered !== null ? n + Math.max(0, c.expected - c.registered) : n), 0);
  checks.push(
    uncounted.length > 0
      ? {
          key: 'coverage',
          label: 'Alla handlingar som ska registreras är registrerade',
          status: 'warn',
          detail: `Kunde inte räkna: ${uncounted.map((c) => REGISTER_SOURCE_LABELS[c.source]).join(', ')}.${missing ? ` ${missing} ärenden saknar registrering i övriga källor.` : ''}`,
          action: 'Kontrollera behörigheten till källorna och ladda om.'
        }
      : missing === 0
        ? { key: 'coverage', label: 'Alla handlingar som ska registreras är registrerade', status: 'ok', detail: 'Varje källpost har ett ärende i diariet.', action: '' }
        : {
            key: 'coverage',
            label: 'Alla handlingar som ska registreras är registrerade',
            status: 'fail',
            detail: `${missing} ärenden i källorna saknar registrering.`,
            action: 'Kör Efterregistrera saknade.'
          }
  );

  const gapYears = Object.entries(input.caseSeqsByYear)
    .map(([year, seqs]) => ({ year, gaps: findSequenceGaps(seqs) }))
    .filter((g) => g.gaps.length > 0);
  checks.push(
    gapYears.length === 0
      ? { key: 'sequence', label: 'Diarienummerserien är obruten', status: 'ok', detail: 'Inga luckor i löpnumren.', action: '' }
      : {
          key: 'sequence',
          label: 'Diarienummerserien är obruten',
          status: 'fail',
          detail: gapYears.map((g) => `${g.year}: nr ${g.gaps.slice(0, 8).join(', ')}${g.gaps.length > 8 ? ' …' : ''}`).join(' · '),
          action: 'Ett ärende har tagits bort utanför systemet. Utred och dokumentera.'
        }
  );

  checks.push(
    input.entries.withoutHash === 0
      ? { key: 'hash', label: 'Varje handling har kontrollsumma', status: 'ok', detail: `${input.entries.total} handlingar${input.entries.complete ? '' : ' (minst)'} har kontrollsumma.`, action: '' }
      : { key: 'hash', label: 'Varje handling har kontrollsumma', status: 'fail', detail: `${input.entries.withoutHash} handlingar saknar kontrollsumma.`, action: 'Utred raderna — de är inte skapade av skrivlagret.' }
  );

  checks.push(
    input.entries.secrecyWithoutBasis === 0
      ? { key: 'secrecy', label: 'Sekretessmarkerade handlingar har lagrum', status: 'ok', detail: 'Inga sekretessmarkeringar utan angiven grund.', action: '' }
      : {
          key: 'secrecy',
          label: 'Sekretessmarkerade handlingar har lagrum',
          status: 'warn',
          detail: `${input.entries.secrecyWithoutBasis} sekretessmarkerade handlingar saknar lagrum.`,
          action: 'Filtrera diariet på Sekretess och fyll i grunden.'
        }
  );

  checks.push(
    input.entries.disposalDue === 0
      ? { key: 'disposal', label: 'Gallring sker enligt planen', status: 'ok', detail: 'Inga handlingar har passerat sin gallringsfrist.', action: '' }
      : {
          key: 'disposal',
          label: 'Gallring sker enligt planen',
          status: 'warn',
          detail: `${input.entries.disposalDue} handlingar har passerat gallringsfristen.`,
          action: 'Gallra enligt beslutet och notera det i ärendet.'
        }
  );

  const missingSections = archiveDescriptionMissing(input.description);
  checks.push(
    missingSections.length === 0
      ? { key: 'description', label: 'Arkivbeskrivningen är komplett', status: 'ok', detail: 'Alla avsnitt är ifyllda.', action: '' }
      : {
          key: 'description',
          label: 'Arkivbeskrivningen är komplett',
          status: 'warn',
          detail: `Saknas: ${missingSections.join(', ')}.`,
          action: 'Fyll i avsnitten under Förteckning.'
        }
  );

  const ageDays = input.lastVersionAt ? Math.floor((Date.parse(input.today) - Date.parse(input.lastVersionAt)) / 86_400_000) : null;
  checks.push(
    ageDays === null
      ? {
          key: 'version',
          label: 'Plan och förteckning är fastställda',
          status: 'fail',
          detail: 'Ingen version har fastställts.',
          action: 'Fastställ en version under Förteckning när planen är genomgången.'
        }
      : input.changedSinceVersion
        ? {
            key: 'version',
            label: 'Plan och förteckning är fastställda',
            status: 'warn',
            detail: `Planen eller beskrivningen har ändrats sedan versionen ${input.lastVersionAt!.slice(0, 10)}.`,
            action: 'Fastställ en ny version.'
          }
        : ageDays > ARCHIVE_VERSION_MAX_AGE_DAYS
          ? {
              key: 'version',
              label: 'Plan och förteckning är fastställda',
              status: 'warn',
              detail: `Senaste versionen är ${ageDays} dagar gammal.`,
              action: 'Se över planen och fastställ en ny version (minst årligen).'
            }
          : { key: 'version', label: 'Plan och förteckning är fastställda', status: 'ok', detail: `Fastställd ${input.lastVersionAt!.slice(0, 10)}.`, action: '' }
  );

  checks.push({
    key: 'disclosures',
    label: 'Utlämnanden loggas',
    status: 'info',
    detail: input.disclosures === 0 ? 'Inga utlämnanden är loggade än.' : `${input.disclosures} utlämnanden är loggade.`,
    action: input.disclosures === 0 ? 'Logga varje begäran om allmän handling under Utlämnanden.' : ''
  });

  return checks;
}

export function summarizeAudit(checks: readonly AuditCheck[]): { ok: number; warn: number; fail: number } {
  return {
    ok: checks.filter((c) => c.status === 'ok').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length
  };
}

// ─── Export ───────────────────────────────────────────────────────────────

/** Neutraliserar formel-injektion och citat i en CSV-cell (semikolonseparerad). */
export function registerCsvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
