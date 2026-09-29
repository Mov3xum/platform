// Kontaktboken — Movexums gemensamma kontaktbok (CLAUDE.md § 41).
//
// Ren, testbar domänlogik för kontakter med interna ägare och förfrågningar
// om att använda en kontakt för ett specifikt syfte (ev. dela med ett bolag).
// Delas av server-actions, sidorna, importen och chatt-verktygen så att
// reglerna aldrig divergerar. Inga beroenden, ingen IO.

import type { Role } from './index';

// ── Kategorier (fast vokabulär, samma mönster som file-topics/competences) ──

export const CONTACT_CATEGORIES = [
  'investerare',
  'radgivare',
  'myndighet',
  'partner',
  'akademi',
  'media',
  'leverantor',
  'alumn',
  'annan'
] as const;
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number];

export const CONTACT_CATEGORY_LABELS: Record<ContactCategory, string> = {
  investerare: 'Investerare',
  radgivare: 'Rådgivare / expert',
  myndighet: 'Myndighet / offentlig aktör',
  partner: 'Partner / näringsliv',
  akademi: 'Akademi / forskning',
  media: 'Media',
  leverantor: 'Leverantör',
  alumn: 'Alumn',
  annan: 'Annan'
};

export function isContactCategory(v: unknown): v is ContactCategory {
  return typeof v === 'string' && (CONTACT_CATEGORIES as readonly string[]).includes(v);
}

/** Tolkar fritext ("Investerare", "VC", "Rådgivare") till en kategori. */
export function normalizeContactCategory(v: unknown): ContactCategory | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (isContactCategory(s)) return s;
  const table: Array<[RegExp, ContactCategory]> = [
    [/invest|vc|ängel|angel|riskkapital|fond/, 'investerare'],
    [/rådgiv|radgiv|expert|jurist|revisor|coach|mentor|konsult/, 'radgivare'],
    [/myndighet|kommun|region|vinnova|almi|tillväxtverk|tillvaxtverk|offentlig|stat/, 'myndighet'],
    [/partner|näringsliv|naringsliv|bolag|företag|foretag|kund/, 'partner'],
    [/akademi|universitet|högskola|hogskola|forsk|professor/, 'akademi'],
    [/media|press|journalist|redakt/, 'media'],
    [/leverant|supplier|byrå|byra/, 'leverantor'],
    [/alumn/, 'alumn']
  ];
  for (const [re, cat] of table) if (re.test(s)) return cat;
  return 'annan';
}

// ── Roller ──────────────────────────────────────────────────────────────────

/** Roller som får skapa/ändra kontakter och skicka förfrågningar. */
export const CONTACT_BOOK_ROLES: readonly Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
/** Roller som får radera kontakter och avgöra förfrågningar över ägarens huvud. */
export const CONTACT_BOOK_ADMIN_ROLES: readonly Role[] = ['admin', 'incubator_lead'];

export function canManageContactBook(roles: readonly Role[] | undefined): boolean {
  return Boolean(roles?.some((r) => CONTACT_BOOK_ROLES.includes(r)));
}

export function isContactBookAdmin(roles: readonly Role[] | undefined): boolean {
  return Boolean(roles?.some((r) => CONTACT_BOOK_ADMIN_ROLES.includes(r)));
}

// ── Kontakt ─────────────────────────────────────────────────────────────────

export interface ContactLike {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  organization?: string | null;
  primary_role?: string | null;
  owners?: readonly string[] | null;
}

export function contactDisplayName(c: Pick<ContactLike, 'first_name' | 'last_name'>): string {
  const name = [c.first_name, c.last_name]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return name || 'Namnlös kontakt';
}

/** "Titel, Organisation" — det som står under namnet i listor. */
export function contactSubtitle(c: Pick<ContactLike, 'organization' | 'primary_role'>): string {
  return [c.primary_role, c.organization]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join(', ');
}

export function isContactOwner(c: Pick<ContactLike, 'owners'>, userId: string): boolean {
  return Array.isArray(c.owners) && c.owners.includes(userId);
}

/** Enkel e-postnormalisering för dedupe vid import/upsert. */
export function normalizeContactEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  return isValidEmail(s) ? s : null;
}

export function isValidEmail(v: string): boolean {
  // Medvetet enkel — PB validerar strikt på servern.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/**
 * Normaliserar ett telefonnummer till en jämförbar nyckel (bara siffror,
 * ledande 00 → +). Returnerar null när det inte ser ut som ett nummer.
 */
export function normalizePhone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/[^\d+]/g, '');
  if (digits.replace(/\D/g, '').length < 6) return null;
  return digits.startsWith('00') ? `+${digits.slice(2)}` : digits;
}

/** Dedupe-nyckel för en kontakt: e-post vinner, annars namn + organisation. */
export function contactDedupeKey(c: {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  organization?: string | null;
}): string {
  const email = normalizeContactEmail(c.email);
  if (email) return `email:${email}`;
  const name = contactDisplayName(c).toLowerCase().replace(/\s+/g, ' ');
  const org = (c.organization ?? '').trim().toLowerCase();
  return `name:${name}|${org}`;
}

// ── Förfrågningar ───────────────────────────────────────────────────────────

export const CONTACT_REQUEST_STATUSES = ['pending', 'approved', 'declined', 'withdrawn'] as const;
export type ContactRequestStatus = (typeof CONTACT_REQUEST_STATUSES)[number];

export const CONTACT_REQUEST_STATUS_LABELS: Record<ContactRequestStatus, string> = {
  pending: 'Väntar på svar',
  approved: 'Godkänd',
  declined: 'Avböjd',
  withdrawn: 'Återkallad'
};

export function isContactRequestStatus(v: unknown): v is ContactRequestStatus {
  return typeof v === 'string' && (CONTACT_REQUEST_STATUSES as readonly string[]).includes(v);
}

export type ContactRequestDecision = 'approved' | 'declined';

export interface ContactRequestLike {
  id: string;
  contact: string;
  requester: string;
  status: ContactRequestStatus;
  startup?: string | null;
  purpose?: string | null;
}

/**
 * Tillåtna statusövergångar. En avgjord förfrågan är slutgiltig — vill man
 * använda kontakten igen skapas en ny förfrågan (ren audit-kedja).
 */
export function contactRequestTransition(
  from: ContactRequestStatus,
  to: ContactRequestStatus
): { ok: true } | { ok: false; error: string } {
  if (from !== 'pending') {
    return { ok: false, error: `Förfrågan är redan ${CONTACT_REQUEST_STATUS_LABELS[from].toLowerCase()}.` };
  }
  if (to === 'pending') return { ok: false, error: 'En förfrågan kan inte återställas till väntande.' };
  return { ok: true };
}

/**
 * Vem får avgöra en förfrågan? Kontaktens ägare — eller admin/incubator_lead
 * som eskaleringsväg när en ägare är borta. Aldrig den som frågar (om hen
 * inte själv är ägare).
 */
export function canDecideContactRequest(params: {
  userId: string;
  roles: readonly Role[] | undefined;
  ownerIds: readonly string[];
}): boolean {
  if (params.ownerIds.includes(params.userId)) return true;
  return isContactBookAdmin(params.roles);
}

/** Bara den som frågade kan återkalla — eller admin/incubator_lead. */
export function canWithdrawContactRequest(params: {
  userId: string;
  roles: readonly Role[] | undefined;
  requesterId: string;
}): boolean {
  return params.userId === params.requesterId || isContactBookAdmin(params.roles);
}

/**
 * En ägare som själv vill använda/dela sin kontakt behöver inte fråga någon:
 * förfrågan skapas ändå (audit-spår för vad kontakten använts till) men blir
 * godkänd direkt.
 */
export function isSelfApprovedRequest(params: { requesterId: string; ownerIds: readonly string[] }): boolean {
  return params.ownerIds.includes(params.requesterId);
}

/** Cap + trim för fritextfält som visas i notiser och feed. */
export function clipText(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ── Import (CSV/Excel) ──────────────────────────────────────────────────────

/**
 * Enkel, robust parser för avgränsad text (CSV). Stödjer `;`, `,` och tabb
 * (auto-detekterat på första raden), citattecken med dubblerade `""` och
 * radbrytningar inuti citat. Returnerar rader som strängarrayer.
 */
export function parseDelimitedText(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  if (!src.trim()) return [];
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const counts: Array<[string, number]> = [';', ',', '\t'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  const delimiter = counts[0][1] > 0 ? counts[0][0] : ';';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Fält en importrad kan innehålla (kolumnrubriker matchas mot alias). */
export const CONTACT_IMPORT_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'organization',
  'primary_role',
  'category',
  'kommun',
  'skills',
  'info',
  'owner_email',
  'gdpr_consent'
] as const;
export type ContactImportField = (typeof CONTACT_IMPORT_FIELDS)[number];

export const CONTACT_IMPORT_FIELD_LABELS: Record<ContactImportField, string> = {
  first_name: 'Förnamn',
  last_name: 'Efternamn',
  email: 'E-post',
  phone: 'Telefon',
  organization: 'Organisation',
  primary_role: 'Titel / roll',
  category: 'Kategori',
  kommun: 'Kommun',
  skills: 'Kompetenser',
  info: 'Info',
  owner_email: 'Ägare (e-post till Movexum-kollega)',
  gdpr_consent: 'GDPR-samtycke'
};

/** Kolumnrubriker (normaliserade) → fält. Svenska + engelska + Outlook/Google-export. */
const HEADER_ALIASES: Record<string, ContactImportField> = {
  förnamn: 'first_name',
  fornamn: 'first_name',
  'first name': 'first_name',
  firstname: 'first_name',
  'given name': 'first_name',
  efternamn: 'last_name',
  'last name': 'last_name',
  lastname: 'last_name',
  surname: 'last_name',
  'family name': 'last_name',
  'e-post': 'email',
  epost: 'email',
  email: 'email',
  'e-mail': 'email',
  mail: 'email',
  'e-mail address': 'email',
  'e-mail 1 - value': 'email',
  telefon: 'phone',
  tel: 'phone',
  mobil: 'phone',
  mobile: 'phone',
  phone: 'phone',
  'mobile phone': 'phone',
  'phone 1 - value': 'phone',
  organisation: 'organization',
  organization: 'organization',
  företag: 'organization',
  foretag: 'organization',
  bolag: 'organization',
  company: 'organization',
  arbetsgivare: 'organization',
  titel: 'primary_role',
  title: 'primary_role',
  'job title': 'primary_role',
  roll: 'primary_role',
  'ordinarie roll': 'primary_role',
  befattning: 'primary_role',
  kategori: 'category',
  category: 'category',
  typ: 'category',
  kommun: 'kommun',
  kommuntillhörighet: 'kommun',
  ort: 'kommun',
  stad: 'kommun',
  city: 'kommun',
  kompetenser: 'skills',
  kompetens: 'skills',
  skills: 'skills',
  info: 'info',
  anteckningar: 'info',
  anteckning: 'info',
  notes: 'info',
  kommentar: 'info',
  ägare: 'owner_email',
  agare: 'owner_email',
  owner: 'owner_email',
  kontaktägare: 'owner_email',
  kontaktagare: 'owner_email',
  ansvarig: 'owner_email',
  gdpr: 'gdpr_consent',
  samtycke: 'gdpr_consent',
  'gdpr-samtycke': 'gdpr_consent',
  consent: 'gdpr_consent',
  'personen har godkänt lagring av information enligt gdpr': 'gdpr_consent'
};

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Mappar en rubrikrad till fält (null = okänd kolumn, ignoreras). */
export function mapContactImportHeaders(headers: readonly string[]): Array<ContactImportField | null> {
  return headers.map((h) => HEADER_ALIASES[normHeader(h)] ?? null);
}

export function parseImportBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (['ja', 'yes', 'true', '1', 'x', 'sant', 'y', 'j'].includes(v)) return true;
  if (['nej', 'no', 'false', '0', 'falskt', 'n'].includes(v)) return false;
  return null;
}

export interface ContactImportRow {
  /** 1-baserat radnummer i källan (rubrikraden är 1). */
  line: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  organization: string | null;
  primary_role: string | null;
  category: ContactCategory | null;
  kommun: string | null;
  skills: string | null;
  info: string | null;
  owner_email: string | null;
  /** true/false när kolumnen fanns och kunde tolkas, annars null. */
  gdpr_consent: boolean | null;
}

export interface ContactImportParseResult {
  rows: ContactImportRow[];
  /** Fält som hittades i rubrikraden. */
  mappedFields: ContactImportField[];
  /** Rubriker som inte kändes igen (importeras inte). */
  unmappedHeaders: string[];
  /** PII-fria varningar (radnummer, inte värden). */
  warnings: string[];
}

const IMPORT_MAX_TEXT = 1000;

function clean(v: string | undefined, max = 200): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Tolkar rubrikrad + datarader (från CSV eller Excel) till typade importrader.
 * Rader utan namn OCH utan e-post hoppas över med varning. Ett fullständigt
 * namn i en enda kolumn ("Anna Andersson" i Förnamn) delas inte — det görs av
 * `splitFullName` när efternamn saknas.
 */
export function parseContactImportRows(
  headers: readonly string[],
  dataRows: readonly (readonly string[])[]
): ContactImportParseResult {
  const map = mapContactImportHeaders(headers);
  const mapped = new Set<ContactImportField>();
  const unmapped: string[] = [];
  map.forEach((f, i) => {
    if (f) mapped.add(f);
    else if ((headers[i] ?? '').trim()) unmapped.push(headers[i].trim());
  });
  const warnings: string[] = [];
  const rows: ContactImportRow[] = [];
  if (!mapped.has('first_name') && !mapped.has('last_name') && !mapped.has('email')) {
    warnings.push('Hittade ingen kolumn för namn eller e-post — kontrollera rubrikraden.');
    return { rows, mappedFields: [...mapped], unmappedHeaders: unmapped, warnings };
  }

  dataRows.forEach((cells, idx) => {
    const line = idx + 2;
    const get = (f: ContactImportField): string => {
      const i = map.indexOf(f);
      return i >= 0 ? (cells[i] ?? '').trim() : '';
    };
    let first = get('first_name');
    let last = get('last_name');
    if (first && !last) {
      const split = splitFullName(first);
      first = split.first;
      last = split.last;
    }
    const email = normalizeContactEmail(get('email'));
    const rawEmail = get('email');
    if (rawEmail && !email) warnings.push(`Rad ${line}: ogiltig e-postadress — fältet lämnas tomt.`);
    if (!first && !last && !email) {
      warnings.push(`Rad ${line}: saknar namn och e-post — hoppas över.`);
      return;
    }
    if (!first && !last && email) {
      // Namn ur e-postens lokaldel ("anna.andersson@…" → Anna Andersson).
      const local = email.split('@')[0];
      const split = splitFullName(local.replace(/[._-]+/g, ' '));
      first = split.first || local;
      last = split.last;
      warnings.push(`Rad ${line}: saknar namn — namn härlett ur e-postadressen, kontrollera.`);
    }
    const categoryRaw = get('category');
    const category = categoryRaw ? normalizeContactCategory(categoryRaw) : null;
    const consentRaw = get('gdpr_consent');
    const gdpr = mapped.has('gdpr_consent') ? parseImportBool(consentRaw) : null;
    rows.push({
      line,
      first_name: capitalizeName(first) || '(okänt)',
      last_name: capitalizeName(last) || '',
      email,
      phone: clean(get('phone'), 30),
      organization: clean(get('organization'), 200),
      primary_role: clean(get('primary_role'), 100),
      category,
      kommun: clean(get('kommun'), 100),
      skills: clean(get('skills'), IMPORT_MAX_TEXT),
      info: clean(get('info'), 4000),
      owner_email: normalizeContactEmail(get('owner_email')),
      gdpr_consent: gdpr
    });
  });

  return { rows, mappedFields: [...mapped], unmappedHeaders: unmapped, warnings };
}

/** "Anna Karin Andersson" → { first: "Anna Karin", last: "Andersson" }. */
export function splitFullName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? '', last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

function capitalizeName(s: string): string {
  const t = s.trim();
  if (!t) return '';
  // Bara helt gemena/versala namn normaliseras — "McDonald"/"de la Cruz" lämnas.
  if (t !== t.toLowerCase() && t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((p) => (p.trim() && p !== '-' ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join('');
}

/**
 * Dedupe:ar importrader mot varandra (första vinner; senare rader med samma
 * nyckel slås ihop så tomma fält fylls). Returnerar även antal sammanslagna.
 */
export function dedupeContactImportRows(rows: readonly ContactImportRow[]): {
  rows: ContactImportRow[];
  merged: number;
} {
  const byKey = new Map<string, ContactImportRow>();
  let merged = 0;
  for (const r of rows) {
    const key = contactDedupeKey(r);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...r });
      continue;
    }
    merged++;
    for (const f of CONTACT_IMPORT_FIELDS) {
      const cur = existing[f];
      const next = r[f];
      if ((cur === null || cur === '' || cur === undefined) && next !== null && next !== '') {
        (existing as unknown as Record<string, unknown>)[f] = next;
      }
    }
  }
  return { rows: [...byKey.values()], merged };
}
