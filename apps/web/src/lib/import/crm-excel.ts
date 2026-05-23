import 'server-only';
import { excelSerialToIso, type Row } from './xlsx';

// Header-driven mappning av Movexums CRM-export (Excel, 12 ark) →
// plattformens kollektioner. Speglar mappningstabellen i CLAUDE.md § 15.2.
//
// Varje ark parsas separat. Vi matchar headers på rad 1 (case-insensitivt,
// trim) mot kända kolumnnamn så att kolumnordning kan variera. Okända
// kolumner ignoreras. Tomma rader hoppas över.
//
// GDPR (CLAUDE.md § 15.4, § 15.6):
//   • "Person nr"-kolumnen på Företag läses ALDRIG in.
//   • Info-fält saneras: personnummer (\d{6,8}-\d{4}) → [REDACTED].
//   • Personer utan GDPR-samtycke skippas (loggas som PII-fri varning).

// ── Personnummer-sanering ──────────────────────────────────────────
const PERSONNUMMER_RE = /\b\d{6,8}[-+]?\d{4}\b/g;

export function sanitizePersonnummer(text: string): string {
  return text.replace(PERSONNUMMER_RE, '[REDACTED]');
}

// ── Header-matchning ───────────────────────────────────────────────
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Bygger en map från normaliserat header-namn → kolumnbokstav, från
// första raden i ett ark.
function headerMap(rows: Row[]): { cols: Map<string, string>; headerRowIndex: number } {
  if (rows.length === 0) return { cols: new Map(), headerRowIndex: -1 };
  const header = rows[0];
  const cols = new Map<string, string>();
  for (const [col, val] of Object.entries(header)) {
    if (val && val.trim()) cols.set(norm(val), col);
  }
  return { cols, headerRowIndex: 0 };
}

// Hämtar cellvärde via headernamn (eller alias). Returnerar trimmad
// sträng eller '' om kolumnen/cellen saknas.
function cell(row: Row, cols: Map<string, string>, ...names: string[]): string {
  for (const n of names) {
    const col = cols.get(norm(n));
    if (col && row[col] !== undefined) {
      return row[col].trim();
    }
  }
  return '';
}

// ── Värde-konvertering ─────────────────────────────────────────────
function toDate(raw: string): string | null {
  if (!raw) return null;
  // Excel-serial (rent numeriskt)?
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = parseFloat(raw);
    // Serials < 1000 är troligen riktiga tal, inte datum. CRM-datum
    // ligger > 36000 (efter år 1998).
    if (serial > 20000 && serial < 80000) {
      return excelSerialToIso(serial);
    }
  }
  // ISO eller svensk datumsträng (yyyy-mm-dd eller yyyy/mm/dd).
  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(raw);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function toBool(raw: string): boolean | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (['ja', 'yes', 'true', '1', 'x', 'sant'].includes(v)) return true;
  if (['nej', 'no', 'false', '0', 'falskt'].includes(v)) return false;
  return null;
}

function toNumber(raw: string): number | null {
  if (!raw) return null;
  // Svenska tal: "1 234,56" → 1234.56. Ta bort mellanslag (inkl NBSP),
  // byt komma mot punkt.
  const cleaned = raw.replace(/[\s ]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function optStr(raw: string): string | null {
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

// ── Enum-mappning ──────────────────────────────────────────────────
const BOLAGSFAS_MAP: Record<string, string> = {
  paus: 'paus',
  pausad: 'paus',
  inflöde: 'inflode',
  inflode: 'inflode',
  lead: 'lead',
  'boost chamber': 'boost_chamber',
  boostchamber: 'boost_chamber',
  bc: 'boost_chamber',
  incubation: 'incubation',
  inkubation: 'incubation',
  prescale: 'prescale',
  'pre scale': 'prescale',
  acceleration: 'acceleration',
  alumni: 'alumni'
};

function mapBolagsfas(raw: string): string | null {
  if (!raw) return null;
  return BOLAGSFAS_MAP[norm(raw)] ?? null;
}

// Startups.phase använder ett annat enum (idea/pre_revenue/...). CRM:t
// har bara Bolagsfas (inkubatorfas) → vi lämnar phase till default 'idea'
// vid skapande och skriver Bolagsfas till phase_history.

const STARTUP_STATUS_MAP: Record<string, string> = {
  aktiv: 'active',
  active: 'active',
  alumn: 'alumni',
  alumni: 'alumni',
  paus: 'paused',
  pausad: 'paused',
  paused: 'paused',
  avslutad: 'alumni',
  nekad: 'rejected',
  rejected: 'rejected',
  avregistrerad: 'rejected'
};

function mapStartupStatus(raw: string): string {
  return STARTUP_STATUS_MAP[norm(raw)] ?? 'active';
}

const GENDER_MAP: Record<string, string> = {
  kvinna: 'kvinna',
  woman: 'kvinna',
  k: 'kvinna',
  man: 'man',
  m: 'man',
  'icke binär': 'icke_binar',
  'icke-binär': 'icke_binar',
  icke_binar: 'icke_binar',
  annat: 'uppger_ej',
  'uppger ej': 'uppger_ej',
  'vill ej uppge': 'uppger_ej'
};

function mapGender(raw: string): string | null {
  if (!raw) return null;
  return GENDER_MAP[norm(raw)] ?? null;
}

const CAPITAL_TYPE_MAP: Record<string, string> = {
  bidrag: 'grant',
  grant: 'grant',
  equity: 'equity',
  ägarkapital: 'equity',
  aktiekapital: 'equity',
  lån: 'loan',
  loan: 'loan',
  'mjukt kapital': 'soft_funding',
  soft_funding: 'soft_funding',
  innovationscheck: 'soft_funding',
  konvertibel: 'convertible',
  convertible: 'convertible',
  konvertibelt: 'convertible'
};

function mapCapitalType(raw: string): string {
  return CAPITAL_TYPE_MAP[norm(raw)] ?? 'other';
}

const IPR_TYPE_MAP: Record<string, string> = {
  patent: 'patent',
  bruksmodell: 'utility_model',
  utility_model: 'utility_model',
  varumärke: 'trademark',
  trademark: 'trademark',
  design: 'design',
  mönster: 'design',
  upphovsrätt: 'copyright',
  copyright: 'copyright',
  'företagshemlighet': 'trade_secret',
  trade_secret: 'trade_secret',
  domän: 'domain',
  domain: 'domain'
};

function mapIprType(raw: string): string {
  return IPR_TYPE_MAP[norm(raw)] ?? 'other';
}

const IPR_STATUS_MAP: Record<string, string> = {
  idé: 'idea',
  ide: 'idea',
  idea: 'idea',
  inlämnad: 'filed',
  filed: 'filed',
  ansökt: 'filed',
  pågående: 'pending',
  pending: 'pending',
  väntar: 'pending',
  beviljad: 'granted',
  granted: 'granted',
  godkänd: 'granted',
  avslagen: 'rejected',
  rejected: 'rejected',
  nekad: 'rejected',
  övergiven: 'abandoned',
  abandoned: 'abandoned',
  utgången: 'expired',
  expired: 'expired'
};

function mapIprStatus(raw: string): string {
  return IPR_STATUS_MAP[norm(raw)] ?? 'idea';
}

const AGREEMENT_KIND_MAP: Record<string, string> = {
  nda: 'nda',
  sekretessavtal: 'nda',
  inkubatoravtal: 'incubator_agreement',
  incubator_agreement: 'incubator_agreement',
  'ip-överlåtelse': 'ip_assignment',
  ip_assignment: 'ip_assignment',
  tillägg: 'addendum',
  addendum: 'addendum'
};

function mapAgreementKind(raw: string): string {
  return AGREEMENT_KIND_MAP[norm(raw)] ?? 'other';
}

const TASK_KIND_MAP: Record<string, string> = {
  samtal: 'call',
  call: 'call',
  ring: 'call',
  möte: 'meeting',
  meeting: 'meeting',
  'e-post': 'email',
  epost: 'email',
  email: 'email',
  mejl: 'email',
  förberedelse: 'prep',
  prep: 'prep',
  uppföljning: 'followup',
  followup: 'followup',
  administration: 'admin',
  admin: 'admin'
};

function mapTaskKind(raw: string): string {
  return TASK_KIND_MAP[norm(raw)] ?? 'other';
}

const TASK_STATUS_MAP: Record<string, string> = {
  öppen: 'open',
  open: 'open',
  'ej påbörjad': 'open',
  pågående: 'in_progress',
  in_progress: 'in_progress',
  påbörjad: 'in_progress',
  blockerad: 'blocked',
  blocked: 'blocked',
  klar: 'done',
  done: 'done',
  färdig: 'done',
  avbruten: 'cancelled',
  cancelled: 'cancelled'
};

function mapTaskStatus(raw: string, completedAt: string | null): string {
  const mapped = TASK_STATUS_MAP[norm(raw)];
  if (mapped) return mapped;
  return completedAt ? 'done' : 'open';
}

const EVENT_TYPE_MAP: Record<string, string> = {
  pitch: 'pitch',
  konferens: 'conference',
  conference: 'conference',
  matchning: 'matching',
  matching: 'matching',
  hack: 'hack',
  hackathon: 'hack',
  mingel: 'mingle',
  mingle: 'mingle',
  workshop: 'workshop',
  utbildning: 'workshop'
};

function mapEventType(raw: string): string {
  return EVENT_TYPE_MAP[norm(raw)] ?? 'other';
}

const EVENT_STATUS_MAP: Record<string, string> = {
  planerad: 'planned',
  planned: 'planned',
  pågående: 'live',
  live: 'live',
  genomförd: 'completed',
  completed: 'completed',
  klar: 'completed',
  inställd: 'cancelled',
  cancelled: 'cancelled'
};

function mapEventStatus(raw: string): string {
  return EVENT_STATUS_MAP[norm(raw)] ?? 'planned';
}

const SIGNUP_STAGE_MAP: Record<string, string> = {
  anmäld: 'signup',
  signup: 'signup',
  deltog: 'attended',
  attended: 'attended',
  närvarade: 'attended',
  möte: 'meeting',
  meeting: 'meeting',
  ansökan: 'application',
  application: 'application',
  antagen: 'admitted',
  admitted: 'admitted'
};

function mapSignupStage(raw: string): string {
  return SIGNUP_STAGE_MAP[norm(raw)] ?? 'signup';
}

// ── Parsade typer ──────────────────────────────────────────────────
export interface CrmCompany {
  excelId: string; // FöretagsID (för korsreferens från andra ark)
  name: string;
  idea_name: string | null;
  org_nr: string | null;
  case_type: string | null; // Typ
  status: string; // startup-status (inkubatorrelation)
  status_completion_pct: number | null;
  bolagsfas: string | null; // mappad till phase_history-fas
  preliminary_exit: string | null;
  company_registered_at: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  street_address: string | null;
  postal_code: string | null;
  description: string | null;
  contacted_at: string | null;
  phone: string | null;
  founder_gender: string | null;
  potential_bc_case: boolean | null;
  signed_incubator_agreement: boolean | null;
  signed_nda: boolean | null;
  founder_identifies_as: string | null;
  signed_bc_agreement: boolean | null;
  is_deeptech: boolean | null;
  inflow_source: string | null;
  meets_excellence_criteria: boolean | null;
  approved_state_aid_art22: boolean | null;
  area: string | null;
  signed_vinnova_incubation_approval: boolean | null;
  approved_de_minimis: boolean | null;
  sent_to: string | null;
  register_notes: string | null;
  is_regional: boolean | null;
  signed_partner_agreement: boolean | null;
  // Inträde-datum per fas → phase_history-rader
  phaseEntries: { phase: string; entered_at: string }[];
}

export interface CrmContact {
  excelId: string; // person_id
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  primary_role: string | null;
  gender: string | null;
  skills: string | null;
  gdpr_consent: boolean;
  kommun: string | null;
  info: string | null;
}

export interface CrmStartupContact {
  companyExcelId: string;
  personExcelId: string;
  role: string | null;
  is_primary: boolean | null;
}

export interface CrmEvent {
  excelId: string; // activity_id
  name: string;
  location: string | null;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  type: string;
  status: string;
  organizer: string | null;
  target_audience: string | null;
  event_url: string | null;
  internal_comment: string | null;
  outcome: string | null;
  participant_count: number | null;
}

export interface CrmSignup {
  eventExcelId: string;
  participant_kind: 'person' | 'company' | null;
  participantExcelId: string | null;
  name: string;
  stage: string;
  note: string | null;
}

export interface CrmCapital {
  companyExcelId: string;
  type: string;
  source: string;
  amount_sek: number | null;
  received_at: string | null;
  notes: string | null;
}

export interface CrmIpr {
  companyExcelId: string;
  type: string;
  status: string;
  external_reference: string | null;
  filed_at: string | null;
  response_at: string | null;
  notes: string | null;
}

export interface CrmAgreement {
  companyExcelId: string;
  kind: string;
  kind_label: string | null;
  partner: string | null;
  country: string | null;
  agreement_date: string | null;
  notes: string | null;
}

export interface CrmTask {
  link_kind: 'none' | 'startup' | 'contact' | 'event';
  linkExcelId: string | null;
  kind: string;
  description: string;
  details: string | null;
  starts_at: string | null;
  due_at: string | null;
  completed_at: string | null;
  status: string;
}

export interface CrmKpi {
  companyExcelId: string;
  kpi_name: string;
  value_text: string;
  value_numeric: number | null;
  measured_at: string | null;
  is_current: boolean | null;
}

export interface CrmParseResult {
  companies: CrmCompany[];
  contacts: CrmContact[];
  startupContacts: CrmStartupContact[];
  events: CrmEvent[];
  signups: CrmSignup[];
  capital: CrmCapital[];
  ipr: CrmIpr[];
  agreements: CrmAgreement[];
  tasks: CrmTask[];
  kpis: CrmKpi[];
  warnings: string[]; // PII-fria
}

// ── Datarader (hoppar över header + tomma) ─────────────────────────
function dataRows(rows: Row[], headerRowIndex: number): Row[] {
  const out: Row[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const hasValue = Object.values(r).some((v) => v && v.trim());
    if (hasValue) out.push(r);
  }
  return out;
}

// ── Per-ark-parsers ────────────────────────────────────────────────
function parseCompanies(rows: Row[], warnings: string[]): CrmCompany[] {
  const { cols, headerRowIndex } = headerMap(rows);
  if (headerRowIndex < 0) return [];
  const out: CrmCompany[] = [];

  const phaseColumns: { header: string; phase: string }[] = [
    { header: 'inträde paus', phase: 'paus' },
    { header: 'inträde inflöde', phase: 'inflode' },
    { header: 'inträde lead', phase: 'lead' },
    { header: 'inträde boost chamber', phase: 'boost_chamber' },
    { header: 'inträde incubation', phase: 'incubation' },
    { header: 'inträde acceleration', phase: 'acceleration' },
    { header: 'inträde alumni', phase: 'alumni' },
    { header: 'inträde prescale', phase: 'prescale' }
  ];

  for (const row of dataRows(rows, headerRowIndex)) {
    const name = cell(row, cols, 'Företagsnamn', 'Bolag', 'Namn');
    const excelId = cell(row, cols, 'FöretagsID', 'FöretagsId');
    if (!name) {
      if (excelId) warnings.push(`Företag rad (ID ${excelId}) saknar namn — hoppas över.`);
      continue;
    }

    // "Person nr"-kolumnen läses ALDRIG in (GDPR § 15.4).
    const phaseEntries: { phase: string; entered_at: string }[] = [];
    for (const pc of phaseColumns) {
      const d = toDate(cell(row, cols, pc.header));
      if (d) phaseEntries.push({ phase: pc.phase, entered_at: d });
    }

    const rawNotes = cell(row, cols, 'Noteringar', 'Anteckningar');
    const company: CrmCompany = {
      excelId,
      name,
      idea_name: optStr(cell(row, cols, 'Idénamn')),
      org_nr: normalizeOrgNr(cell(row, cols, 'Org.nr', 'Orgnr', 'Organisationsnummer')),
      case_type: optStr(cell(row, cols, 'Typ')),
      status: mapStartupStatus(cell(row, cols, 'Status')),
      status_completion_pct: toNumber(cell(row, cols, 'Process %', 'Process')),
      bolagsfas: mapBolagsfas(cell(row, cols, 'Bolagsfas')),
      preliminary_exit: optStr(cell(row, cols, 'Prel exit', 'Exit')),
      company_registered_at: toDate(cell(row, cols, 'Registreringsdatum')),
      email: optStr(cell(row, cols, 'E-post', 'Epost')),
      website: normalizeUrl(cell(row, cols, 'Webbplats', 'Webb')),
      city: optStr(cell(row, cols, 'Stad')),
      street_address: optStr(cell(row, cols, 'Adress')),
      postal_code: optStr(cell(row, cols, 'Postnummer')),
      description: optStr(cell(row, cols, 'Beskrivning')),
      contacted_at: toDate(cell(row, cols, 'Kontaktad')),
      phone: optStr(cell(row, cols, 'Telefonnummer', 'Telefon')),
      founder_gender: mapGender(cell(row, cols, 'Kön på grundare')),
      potential_bc_case: toBool(cell(row, cols, 'Potentiellt BC case')),
      signed_incubator_agreement: toBool(cell(row, cols, 'Signerat inkubatoravtal')),
      signed_nda: toBool(cell(row, cols, 'Signerat sekretessavtal')),
      founder_identifies_as: optStr(cell(row, cols, 'Grundaren identifierar sig som')),
      signed_bc_agreement: toBool(cell(row, cols, 'Signerat BC avtal')),
      is_deeptech: toBool(cell(row, cols, 'Deeptech')),
      inflow_source: optStr(cell(row, cols, 'Inflöde från')),
      meets_excellence_criteria: toBool(cell(row, cols, 'Uppfyller krav Excellens')),
      approved_state_aid_art22: toBool(cell(row, cols, 'Godkänd för statsstöd artikel 22')),
      area: optStr(cell(row, cols, 'Område')),
      signed_vinnova_incubation_approval: toBool(
        cell(row, cols, 'Signerat Dokument Godkännande av inkubationsstöd från Vinnova')
      ),
      approved_de_minimis: toBool(cell(row, cols, 'Godkänd för de minimis')),
      sent_to: optStr(cell(row, cols, 'Skickad till')),
      register_notes: rawNotes ? sanitizePersonnummer(rawNotes) : null,
      is_regional: toBool(cell(row, cols, 'Regionalt bolag')),
      signed_partner_agreement: toBool(cell(row, cols, 'Signerat partneravtal')),
      phaseEntries
    };
    out.push(company);
  }
  return out;
}

function normalizeOrgNr(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  // Endast XXXXXX-XXXX accepteras (matchar startups-fältets pattern).
  const m = /(\d{6})-?(\d{4})/.exec(t);
  if (m) return `${m[1]}-${m[2]}`;
  return null;
}

function normalizeUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function parseContacts(rows: Row[], warnings: string[]): CrmContact[] {
  const { cols, headerRowIndex } = headerMap(rows);
  if (headerRowIndex < 0) return [];
  const out: CrmContact[] = [];

  for (const row of dataRows(rows, headerRowIndex)) {
    const excelId = cell(row, cols, 'person_id', 'PersonID', 'PersonId');
    const first = cell(row, cols, 'Förnamn');
    const last = cell(row, cols, 'Efternamn');
    if (!first && !last) {
      if (excelId) warnings.push(`Person (ID ${excelId}) saknar namn — hoppas över.`);
      continue;
    }

    const consent = toBool(
      cell(
        row,
        cols,
        'Personen har godkänt lagring av information enligt GDPR',
        'GDPR',
        'Samtycke'
      )
    );
    // Saknat consent behandlas som false → raden importeras inte.
    if (consent !== true) {
      warnings.push(
        `Kontakt ${excelId || `${first} ${last}`.trim()} saknar GDPR-samtycke — hoppas över (§ 15.6).`
      );
      continue;
    }

    const rawInfo = cell(row, cols, 'Info');
    out.push({
      excelId,
      first_name: first || '(okänt)',
      last_name: last || '(okänt)',
      email: optStr(cell(row, cols, 'E-post', 'Epost')),
      phone: optStr(cell(row, cols, 'Telefon')),
      primary_role: optStr(cell(row, cols, 'Ordinarie roll', 'Roll')),
      gender: mapGender(cell(row, cols, 'Gender', 'Kön')),
      skills: optStr(cell(row, cols, 'Kompetenser')),
      gdpr_consent: true,
      kommun: optStr(cell(row, cols, 'Kommuntillhörighet', 'Kommun')),
      info: rawInfo ? sanitizePersonnummer(rawInfo) : null
    });
  }
  return out;
}

function parseStartupContacts(rows: Row[]): CrmStartupContact[] {
  const { cols, headerRowIndex } = headerMap(rows);
  if (headerRowIndex < 0) return [];
  const out: CrmStartupContact[] = [];
  for (const row of dataRows(rows, headerRowIndex)) {
    const companyExcelId = cell(row, cols, 'FöretagsID', 'FöretagsId');
    const personExcelId = cell(row, cols, 'PersonID', 'PersonId', 'person_id');
    if (!companyExcelId || !personExcelId) continue;
    out.push({
      companyExcelId,
      personExcelId,
      role: optStr(cell(row, cols, 'Roll')),
      is_primary: toBool(cell(row, cols, 'Primärkontakt'))
    });
  }
  return out;
}

function parseEvents(rows: Row[]): CrmEvent[] {
  const { cols, headerRowIndex } = headerMap(rows);
  if (headerRowIndex < 0) return [];
  const out: CrmEvent[] = [];
  for (const row of dataRows(rows, headerRowIndex)) {
    const name = cell(row, cols, 'Rubrik', 'Namn', 'Aktivitet');
    const excelId = cell(row, cols, 'activity_id', 'AktivitetsID', 'AktivitetsId');
    if (!name) continue;
    out.push({
      excelId,
      name,
      location: optStr(cell(row, cols, 'Plats')),
      description: optStr(cell(row, cols, 'Beskrivning')),
      starts_at: toDate(cell(row, cols, 'Startdatum')),
      ends_at: toDate(cell(row, cols, 'Slutdatum')),
      type: mapEventType(cell(row, cols, 'Typ')),
      status: mapEventStatus(cell(row, cols, 'Status')),
      organizer: optStr(cell(row, cols, 'Arrangör')),
      target_audience: optStr(cell(row, cols, 'Målgrupp för aktiviteten', 'Målgrupp')),
      event_url: normalizeUrl(cell(row, cols, 'Länk till event', 'Länk')),
      internal_comment: optStr(cell(row, cols, 'Kommentar')),
      outcome: optStr(cell(row, cols, 'Resultat')),
      participant_count: toNumber(cell(row, cols, 'Antal deltagare'))
    });
  }
  return out;
}

function parseSignups(rows: Row[]): CrmSignup[] {
  const { cols, headerRowIndex } = headerMap(rows);
  if (headerRowIndex < 0) return [];
  const out: CrmSignup[] = [];
  for (const row of dataRows(rows, headerRowIndex)) {
    const eventExcelId = cell(row, cols, 'AktivitetsID', 'AktivitetsId', 'activity_id');
    const name = cell(row, cols, 'Deltagarnamn', 'Namn');
    if (!eventExcelId && !name) continue;
    const kindRaw = norm(cell(row, cols, 'Deltagartyp'));
    let participant_kind: 'person' | 'company' | null = null;
    if (['person', 'individ', 'människa'].includes(kindRaw)) participant_kind = 'person';
    else if (['företag', 'bolag', 'company'].includes(kindRaw)) participant_kind = 'company';
    out.push({
      eventExcelId,
      participant_kind,
      participantExcelId: optStr(cell(row, cols, 'DeltagarID', 'DeltagarId')),
      name: name || '(okänd)',
      stage: mapSignupStage(cell(row, cols, 'Status')),
      note: optStr(cell(row, cols, 'Anteckning'))
    });
  }
  return out;
}

function parseCapital(rows: Row[]): CrmCapital[] {
  const { cols, headerRowIndex } = headerMap(rows);
  if (headerRowIndex < 0) return [];
  const out: CrmCapital[] = [];
  for (const row of dataRows(rows, headerRowIndex)) {
    const companyExcelId = cell(row, cols, 'FöretagsID', 'FöretagsId');
    const source = cell(row, cols, 'Finansiär', 'Källa');
    if (!companyExcelId && !source) continue;
    const rawNotes = cell(row, cols, 'Anteckning');
    out.push({
      companyExcelId,
      type: mapCapitalType(cell(row, cols, 'Typ')),
      source: source || '(okänd finansiär)',
      amount_sek: toNumber(cell(row, cols, 'Belopp')),
      received_at: toDate(cell(row, cols, 'Mottaget datum', 'Datum')),
      notes: rawNotes ? sanitizePersonnummer(rawNotes) : null
    });
  }
  return out;
}

function parseIpr(rows: Row[]): CrmIpr[] {
  const { cols, headerRowIndex } = headerMap(rows);
  if (headerRowIndex < 0) return [];
  const out: CrmIpr[] = [];
  for (const row of dataRows(rows, headerRowIndex)) {
    const companyExcelId = cell(row, cols, 'FöretagsID', 'FöretagsId');
    if (!companyExcelId) continue;
    const rawNotes = cell(row, cols, 'Anteckning');
    out.push({
      companyExcelId,
      type: mapIprType(cell(row, cols, 'Typ')),
      status: mapIprStatus(cell(row, cols, 'Status')),
      external_reference: optStr(cell(row, cols, 'Ext. referens', 'Ext referens', 'Referens')),
      filed_at: toDate(cell(row, cols, 'Ansökningsdatum')),
      response_at: toDate(cell(row, cols, 'Svarsdatum')),
      notes: rawNotes ? sanitizePersonnummer(rawNotes) : null
    });
  }
  return out;
}

function parseAgreements(rows: Row[]): CrmAgreement[] {
  const { cols, headerRowIndex } = headerMap(rows);
  if (headerRowIndex < 0) return [];
  const out: CrmAgreement[] = [];
  for (const row of dataRows(rows, headerRowIndex)) {
    const companyExcelId = cell(row, cols, 'FöretagsID', 'FöretagsId');
    if (!companyExcelId) continue;
    const typeRaw = cell(row, cols, 'Typ');
    const rawNotes = cell(row, cols, 'Anteckning');
    out.push({
      companyExcelId,
      kind: mapAgreementKind(typeRaw),
      kind_label: optStr(typeRaw),
      partner: optStr(cell(row, cols, 'Partner')),
      country: optStr(cell(row, cols, 'Land')),
      agreement_date: toDate(cell(row, cols, 'Avtalsdatum', 'Datum')),
      notes: rawNotes ? sanitizePersonnummer(rawNotes) : null
    });
  }
  return out;
}

function parseTasks(rows: Row[]): CrmTask[] {
  const { cols, headerRowIndex } = headerMap(rows);
  if (headerRowIndex < 0) return [];
  const out: CrmTask[] = [];
  for (const row of dataRows(rows, headerRowIndex)) {
    const description = cell(row, cols, 'Beskrivning');
    if (!description) continue;
    const linkKindRaw = norm(cell(row, cols, 'Kopplad Typ', 'Kopplad typ'));
    let link_kind: CrmTask['link_kind'] = 'none';
    if (['företag', 'bolag', 'startup'].includes(linkKindRaw)) link_kind = 'startup';
    else if (['person', 'kontakt', 'contact'].includes(linkKindRaw)) link_kind = 'contact';
    else if (['aktivitet', 'event'].includes(linkKindRaw)) link_kind = 'event';
    const completed_at = toDate(cell(row, cols, 'Klardatum'));
    // tasks.description har max 500 tecken — lägg lång text i details
    // (obegränsad editor) och en trunkerad sammanfattning i description.
    let shortDesc = description;
    let details: string | null = null;
    if (description.length > 500) {
      shortDesc = description.slice(0, 497) + '…';
      details = description;
    }
    out.push({
      link_kind,
      linkExcelId: optStr(cell(row, cols, 'Koppling till ID', 'Koppling')),
      kind: mapTaskKind(cell(row, cols, 'Typ')),
      description: shortDesc,
      details,
      starts_at: toDate(cell(row, cols, 'Startdatum')),
      due_at: toDate(cell(row, cols, 'Slutdatum')),
      completed_at,
      status: mapTaskStatus(cell(row, cols, 'Status'), completed_at)
    });
  }
  return out;
}

function parseKpis(rows: Row[]): CrmKpi[] {
  const { cols, headerRowIndex } = headerMap(rows);
  if (headerRowIndex < 0) return [];
  const out: CrmKpi[] = [];
  for (const row of dataRows(rows, headerRowIndex)) {
    const companyExcelId = cell(row, cols, 'FöretagsID', 'FöretagsId');
    const kpi_name = cell(row, cols, 'Nyckeltal', 'KPI');
    if (!companyExcelId || !kpi_name) continue;
    const valueRaw = cell(row, cols, 'Värde');
    out.push({
      companyExcelId,
      kpi_name,
      value_text: valueRaw || '',
      value_numeric: toNumber(valueRaw),
      measured_at: toDate(cell(row, cols, 'Mätdatum', 'Datum')),
      is_current: toBool(cell(row, cols, 'Aktuell'))
    });
  }
  return out;
}

// ── Orkestrering ───────────────────────────────────────────────────
// Hittar ett ark via namn-alias (case-insensitivt).
function findSheet(sheets: Map<string, Row[]>, ...names: string[]): Row[] | null {
  for (const [sheetName, rows] of sheets) {
    const n = norm(sheetName);
    if (names.some((target) => n === norm(target))) return rows;
  }
  return null;
}

export function parseCrmExport(sheets: Map<string, Row[]>): CrmParseResult {
  const warnings: string[] = [];

  const companies = parseCompanies(findSheet(sheets, 'Företag') ?? [], warnings);
  const contacts = parseContacts(findSheet(sheets, 'Personer') ?? [], warnings);
  const startupContacts = parseStartupContacts(findSheet(sheets, 'Företag-Person') ?? []);
  const events = parseEvents(findSheet(sheets, 'Aktiviteter') ?? []);
  const signups = parseSignups(findSheet(sheets, 'Deltagare') ?? []);
  const capital = parseCapital(findSheet(sheets, 'Kapital') ?? []);
  const ipr = parseIpr(findSheet(sheets, 'IPR') ?? []);
  const agreements = parseAgreements(findSheet(sheets, 'Avtal') ?? []);
  const tasks = parseTasks(findSheet(sheets, 'ToDo') ?? []);
  const kpis = parseKpis(findSheet(sheets, 'Mätetal') ?? []);

  if (
    companies.length === 0 &&
    contacts.length === 0 &&
    events.length === 0 &&
    capital.length === 0 &&
    ipr.length === 0 &&
    agreements.length === 0 &&
    tasks.length === 0 &&
    kpis.length === 0
  ) {
    warnings.push(
      'Inga rader hittades i något känt ark (Företag/Personer/Aktiviteter m.fl.). Kontrollera att filen är en CRM-export.'
    );
  }

  return {
    companies,
    contacts,
    startupContacts,
    events,
    signups,
    capital,
    ipr,
    agreements,
    tasks,
    kpis,
    warnings
  };
}
