// ── Studenter & talang — matchning mellan studenter och bolag ──────────────
// CLAUDE.md § 54. Ren, enhetstestad domänlogik (ingen IO, ingen React).
//
// Bolagen i inkubatorn publicerar BEHOV (exjobb, praktik, deltid, anställning,
// projekt) och studenter registrerar en PROFIL med kompetens-hashtags (samma
// vokabulär som § 29.7), vad de söker och när de är tillgängliga. Matchningen
// är DETERMINISTISK: hashtag-träff viktad med nivå, typ av uppdrag, period,
// plats/distans — med läsbara skäl per rad. Ingen AI rankar, filtrerar eller
// bedömer studenter (EU AI Act bilaga III p. 4 — rekrytering är högrisk om
// ett AI-system utvärderar kandidater; det byggs medvetet inte).
//
// GDPR § 5: studenten är en privatperson utanför organisationen — rättslig
// grund SAMTYCKE, gallring efter `STUDENT_PROFILE_RETENTION_DAYS`, inga betyg,
// inga art. 9-fält. Bolag ser en ANONYMISERAD profil tills studenten själv
// sökt eller tackat ja till ett förslag.

import {
  COMPETENCE_LEVEL_WEIGHT,
  isCompetenceLevel,
  normalizeCompetenceTagSlug,
  type CompetenceLevel
} from './competence-tags';

// ── Vokabulär ───────────────────────────────────────────────────────────────

export const TALENT_NEED_KINDS = ['exjobb', 'praktik', 'deltid', 'anstallning', 'projekt'] as const;
export type TalentNeedKind = (typeof TALENT_NEED_KINDS)[number];
export const TALENT_NEED_KIND_LABELS: Record<TalentNeedKind, string> = {
  exjobb: 'Examensarbete',
  praktik: 'Praktik',
  deltid: 'Deltidsjobb vid sidan av studierna',
  anstallning: 'Anställning',
  projekt: 'Projekt eller kursarbete'
};
export function isTalentNeedKind(v: unknown): v is TalentNeedKind {
  return typeof v === 'string' && (TALENT_NEED_KINDS as readonly string[]).includes(v);
}

export const TALENT_NEED_STATUSES = ['draft', 'pending_review', 'published', 'paused', 'closed'] as const;
export type TalentNeedStatus = (typeof TALENT_NEED_STATUSES)[number];
export const TALENT_NEED_STATUS_LABELS: Record<TalentNeedStatus, string> = {
  draft: 'Utkast',
  pending_review: 'Väntar på Movexum',
  published: 'Publicerat',
  paused: 'Pausat',
  closed: 'Avslutat'
};
export function isTalentNeedStatus(v: unknown): v is TalentNeedStatus {
  return typeof v === 'string' && (TALENT_NEED_STATUSES as readonly string[]).includes(v);
}

export const TALENT_COMPENSATIONS = ['unpaid', 'paid', 'negotiable'] as const;
export type TalentCompensation = (typeof TALENT_COMPENSATIONS)[number];
export const TALENT_COMPENSATION_LABELS: Record<TalentCompensation, string> = {
  unpaid: 'Oavlönat',
  paid: 'Avlönat',
  negotiable: 'Enligt överenskommelse'
};

export const TALENT_WORK_MODES = ['onsite', 'hybrid', 'remote'] as const;
export type TalentWorkMode = (typeof TALENT_WORK_MODES)[number];
export const TALENT_WORK_MODE_LABELS: Record<TalentWorkMode, string> = {
  onsite: 'På plats',
  hybrid: 'Hybrid',
  remote: 'På distans'
};

export const STUDENT_LEVELS = ['kandidat', 'master', 'yrkeshogskola', 'doktorand', 'annan'] as const;
export type StudentLevel = (typeof STUDENT_LEVELS)[number];
export const STUDENT_LEVEL_LABELS: Record<StudentLevel, string> = {
  kandidat: 'Kandidat / grundnivå',
  master: 'Master / avancerad nivå',
  yrkeshogskola: 'Yrkeshögskola',
  doktorand: 'Doktorand',
  annan: 'Annan utbildning'
};
export function isStudentLevel(v: unknown): v is StudentLevel {
  return typeof v === 'string' && (STUDENT_LEVELS as readonly string[]).includes(v);
}

export const STUDENT_PROFILE_STATUSES = ['pending', 'active', 'paused', 'withdrawn'] as const;
export type StudentProfileStatus = (typeof STUDENT_PROFILE_STATUSES)[number];
export const STUDENT_PROFILE_STATUS_LABELS: Record<StudentProfileStatus, string> = {
  pending: 'Ej bekräftad e-post',
  active: 'Aktiv',
  paused: 'Pausad',
  withdrawn: 'Avregistrerad'
};
export function isStudentProfileStatus(v: unknown): v is StudentProfileStatus {
  return typeof v === 'string' && (STUDENT_PROFILE_STATUSES as readonly string[]).includes(v);
}

/**
 * Intresse/matchning mellan ett behov och en student.
 *  proposed  — bolaget eller Movexum har föreslagit studenten; väntar på studentens svar
 *  new       — studenten har sökt (eller tackat ja) — bolaget ser profil + kontakt
 *  dialogue  — bolaget har tagit kontakt / intervju pågår
 *  matched   — parterna är överens (exjobb/praktik/anställning)
 *  declined  — nej från student eller bolag
 *  withdrawn — studenten drog tillbaka sitt intresse
 */
export const TALENT_INTEREST_STATUSES = ['proposed', 'new', 'dialogue', 'matched', 'declined', 'withdrawn'] as const;
export type TalentInterestStatus = (typeof TALENT_INTEREST_STATUSES)[number];
export const TALENT_INTEREST_STATUS_LABELS: Record<TalentInterestStatus, string> = {
  proposed: 'Föreslagen — väntar på studenten',
  new: 'Ny intresseanmälan',
  dialogue: 'Dialog pågår',
  matched: 'Matchad',
  declined: 'Avböjd',
  withdrawn: 'Tillbakadragen'
};
export function isTalentInterestStatus(v: unknown): v is TalentInterestStatus {
  return typeof v === 'string' && (TALENT_INTEREST_STATUSES as readonly string[]).includes(v);
}

export const TALENT_INTEREST_INITIATORS = ['student', 'company', 'staff'] as const;
export type TalentInterestInitiator = (typeof TALENT_INTEREST_INITIATORS)[number];

export const TALENT_OUTCOMES = ['thesis_completed', 'internship_completed', 'hired', 'not_completed'] as const;
export type TalentOutcome = (typeof TALENT_OUTCOMES)[number];
export const TALENT_OUTCOME_LABELS: Record<TalentOutcome, string> = {
  thesis_completed: 'Examensarbete genomfört',
  internship_completed: 'Praktik genomförd',
  hired: 'Anställd',
  not_completed: 'Blev inte av'
};
export function isTalentOutcome(v: unknown): v is TalentOutcome {
  return typeof v === 'string' && (TALENT_OUTCOMES as readonly string[]).includes(v);
}

/** Kolumner i matchningstavlan. */
export const TALENT_BOARD_COLUMNS: ReadonlyArray<{ id: string; label: string; statuses: readonly TalentInterestStatus[] }> = [
  { id: 'proposed', label: 'Föreslagna', statuses: ['proposed'] },
  { id: 'new', label: 'Nya', statuses: ['new'] },
  { id: 'dialogue', label: 'Dialog', statuses: ['dialogue'] },
  { id: 'matched', label: 'Matchade', statuses: ['matched'] },
  { id: 'closed', label: 'Avslutade', statuses: ['declined', 'withdrawn'] }
];

// ── Gränser ─────────────────────────────────────────────────────────────────

export const TALENT_NEED_TITLE_MAX = 120;
export const TALENT_NEED_DESCRIPTION_MAX = 5000;
export const TALENT_NEED_TAGS_MAX = 12;
export const TALENT_NEED_SCOPE_MAX = 160;
export const TALENT_NEED_LOCATION_MAX = 120;
export const TALENT_NEED_NOTE_MAX = 200;
export const TALENT_REVIEW_NOTE_MAX = 1000;
export const STUDENT_NAME_MAX = 80;
export const STUDENT_UNIVERSITY_MAX = 120;
export const STUDENT_PROGRAM_MAX = 160;
export const STUDENT_SUMMARY_MAX = 1500;
export const STUDENT_TAGS_MAX = 20;
export const STUDENT_LINKEDIN_MAX = 300;
export const TALENT_MESSAGE_MAX = 1000;
export const TALENT_OUTCOME_NOTE_MAX = 500;
/** Samtycket gäller ett år; därefter påminns studenten och profilen gallras. */
export const STUDENT_PROFILE_RETENTION_DAYS = 365;
/** Magisk länk giltig 30 min; webbläsarsession 30 dagar. */
export const STUDENT_LINK_TTL_MS = 30 * 60 * 1000;
export const STUDENT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const TALENT_SHORTLIST_SIZE = 15;

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;
export function isTalentId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v);
}

const PERSONNUMMER_RE = /\d{6,8}[-+]?\d{4}/g;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export function cleanTalentText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL_RE, '').replace(PERSONNUMMER_RE, '[REDACTED]').trim().slice(0, max);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function cleanDateOnly(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, 10);
  if (!DATE_RE.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return s.length <= 254 && EMAIL_RE.test(s) ? s : null;
}

export function cleanHttpsUrl(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (s.length > max || !/^https:\/\/[^\s]+$/i.test(s)) return 'invalid';
  return s;
}

// ── Taggar ──────────────────────────────────────────────────────────────────

export interface StudentTag {
  tag: string;
  level: CompetenceLevel;
}

/** Normaliserar studentens taggar: slug + nivå, dedupe, tak. Okända nivåer ⇒ "kan bidra". */
export function sanitizeStudentTags(values: unknown, max = STUDENT_TAGS_MAX): StudentTag[] {
  if (!Array.isArray(values)) return [];
  const out: StudentTag[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const rec = (typeof raw === 'string' ? { tag: raw } : raw) as { tag?: unknown; level?: unknown } | null;
    const tag = normalizeCompetenceTagSlug(rec?.tag);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push({ tag, level: isCompetenceLevel(rec?.level) ? rec.level : 'contribute' });
    if (out.length >= max) break;
  }
  return out;
}

/** Normaliserar behovets taggar: slugs, dedupe, tak. */
export function sanitizeNeedTags(values: unknown, max = TALENT_NEED_TAGS_MAX): string[] {
  const list = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? values.split(/[,\n;]+/)
      : [];
  const out: string[] = [];
  for (const raw of list) {
    const tag = normalizeCompetenceTagSlug(raw);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

export function sanitizeKinds(values: unknown, max = TALENT_NEED_KINDS.length): TalentNeedKind[] {
  const list = Array.isArray(values) ? values : typeof values === 'string' ? [values] : [];
  const out: TalentNeedKind[] = [];
  for (const v of list) if (isTalentNeedKind(v) && !out.includes(v)) out.push(v);
  return out.slice(0, max);
}

// ── Validering ──────────────────────────────────────────────────────────────

export interface TalentNeedInput {
  title: string;
  kind: TalentNeedKind;
  description: string;
  tags: string[];
  scope: string;
  starts_at: string | null;
  ends_at: string | null;
  compensation: TalentCompensation;
  compensation_note: string;
  location: string;
  work_mode: TalentWorkMode;
  supervisor: boolean;
  deadline: string | null;
  anonymous: boolean;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 'on' || v === '1' || v === 1;
}

/** Validerar ett behov (bolagets annons). Hela objektet valideras — även vid redigering. */
export function validateTalentNeedInput(raw: Record<string, unknown>): Validation<TalentNeedInput> {
  const title = cleanTalentText(raw.title, TALENT_NEED_TITLE_MAX);
  if (title.length < 3) return { ok: false, error: 'Ange en rubrik (minst 3 tecken).' };
  if (!isTalentNeedKind(raw.kind)) return { ok: false, error: 'Välj vilken typ av uppdrag det gäller.' };
  const description = cleanTalentText(raw.description, TALENT_NEED_DESCRIPTION_MAX);
  if (description.length < 20) return { ok: false, error: 'Beskriv uppdraget (minst 20 tecken) — vad studenten ska göra och vad ni erbjuder.' };
  const tags = sanitizeNeedTags(raw.tags);
  if (tags.length === 0) return { ok: false, error: 'Ange minst en kompetens-hashtag så att studenter kan matchas.' };
  const starts_at = cleanDateOnly(raw.starts_at);
  const ends_at = cleanDateOnly(raw.ends_at);
  if (starts_at && ends_at && ends_at < starts_at) return { ok: false, error: 'Slutet måste ligga efter starten.' };
  const deadline = cleanDateOnly(raw.deadline);
  const compensation = (TALENT_COMPENSATIONS as readonly string[]).includes(String(raw.compensation))
    ? (raw.compensation as TalentCompensation)
    : 'negotiable';
  const work_mode = (TALENT_WORK_MODES as readonly string[]).includes(String(raw.work_mode))
    ? (raw.work_mode as TalentWorkMode)
    : 'hybrid';
  return {
    ok: true,
    value: {
      title,
      kind: raw.kind,
      description,
      tags,
      scope: cleanTalentText(raw.scope, TALENT_NEED_SCOPE_MAX),
      starts_at,
      ends_at,
      compensation,
      compensation_note: cleanTalentText(raw.compensation_note, TALENT_NEED_NOTE_MAX),
      location: cleanTalentText(raw.location, TALENT_NEED_LOCATION_MAX),
      work_mode,
      supervisor: bool(raw.supervisor),
      deadline,
      anonymous: bool(raw.anonymous)
    }
  };
}

export interface StudentProfileInput {
  first_name: string;
  last_name: string;
  email: string;
  university: string;
  program: string;
  level: StudentLevel;
  graduation_year: number | null;
  tags: StudentTag[];
  seeking: TalentNeedKind[];
  available_from: string | null;
  location: string;
  remote_ok: boolean;
  summary: string;
  linkedin_url: string;
  searchable: boolean;
}

/** Validerar studentens egen profil (registrering + redigering). */
export function validateStudentProfileInput(raw: Record<string, unknown>): Validation<StudentProfileInput> {
  const first_name = cleanTalentText(raw.first_name, STUDENT_NAME_MAX);
  const last_name = cleanTalentText(raw.last_name, STUDENT_NAME_MAX);
  if (!first_name) return { ok: false, error: 'Ange ditt förnamn.' };
  const email = cleanEmail(raw.email);
  if (!email) return { ok: false, error: 'Ange en giltig e-postadress.' };
  const university = cleanTalentText(raw.university, STUDENT_UNIVERSITY_MAX);
  if (!university) return { ok: false, error: 'Ange ditt lärosäte.' };
  const program = cleanTalentText(raw.program, STUDENT_PROGRAM_MAX);
  if (!isStudentLevel(raw.level)) return { ok: false, error: 'Välj utbildningsnivå.' };
  const year = Number(raw.graduation_year);
  const graduation_year = Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
  const tags = sanitizeStudentTags(raw.tags);
  if (tags.length === 0) return { ok: false, error: 'Lägg till minst en kompetens-hashtag så att bolag kan hitta dig.' };
  const seeking = sanitizeKinds(raw.seeking);
  if (seeking.length === 0) return { ok: false, error: 'Välj vad du söker (t.ex. examensarbete eller praktik).' };
  const linkedin = cleanHttpsUrl(raw.linkedin_url, STUDENT_LINKEDIN_MAX);
  if (linkedin === 'invalid') return { ok: false, error: 'LinkedIn-länken måste vara en https-adress.' };
  return {
    ok: true,
    value: {
      first_name,
      last_name,
      email,
      university,
      program,
      level: raw.level,
      graduation_year,
      tags,
      seeking,
      available_from: cleanDateOnly(raw.available_from),
      location: cleanTalentText(raw.location, TALENT_NEED_LOCATION_MAX),
      remote_ok: bool(raw.remote_ok),
      summary: cleanTalentText(raw.summary, STUDENT_SUMMARY_MAX),
      linkedin_url: linkedin ?? '',
      searchable: bool(raw.searchable)
    }
  };
}

// ── Statusövergångar ────────────────────────────────────────────────────────

export type TalentParty = 'student' | 'company' | 'staff';

/** Vilka statusbyten var och en får göra på ett intresse. */
export function canTransitionInterest(from: TalentInterestStatus, to: TalentInterestStatus, by: TalentParty): boolean {
  if (from === to) return false;
  const closed = from === 'declined' || from === 'withdrawn';
  switch (by) {
    case 'student':
      if (from === 'proposed') return to === 'new' || to === 'declined';
      if (from === 'new' || from === 'dialogue') return to === 'withdrawn';
      return false;
    case 'company':
      if (from === 'proposed') return to === 'declined';
      if (from === 'new') return to === 'dialogue' || to === 'matched' || to === 'declined';
      if (from === 'dialogue') return to === 'matched' || to === 'declined' || to === 'new';
      if (from === 'matched') return to === 'dialogue' || to === 'declined';
      return false;
    case 'staff':
      if (closed) return to === 'new';
      return to !== 'withdrawn';
  }
}

/** Vilka statusbyten bolaget får göra på sitt behov (Movexum publicerar). */
export function canTransitionNeed(from: TalentNeedStatus, to: TalentNeedStatus, by: 'company' | 'staff'): boolean {
  if (from === to) return false;
  if (by === 'staff') return true;
  switch (from) {
    case 'draft':
      return to === 'pending_review' || to === 'closed';
    case 'pending_review':
      return to === 'draft' || to === 'closed';
    case 'published':
      return to === 'paused' || to === 'closed';
    case 'paused':
      return to === 'published' || to === 'closed';
    case 'closed':
      return to === 'draft';
  }
}

/** Visar bolaget studentens namn och kontaktuppgifter i detta läge? */
export function interestRevealsContact(status: TalentInterestStatus): boolean {
  return status === 'new' || status === 'dialogue' || status === 'matched';
}

/** Kan studenten redigera sin annons-text? (Publicerade behov går tillbaka till granskning.) */
export function needEditableByCompany(status: TalentNeedStatus): boolean {
  return status === 'draft' || status === 'pending_review' || status === 'paused' || status === 'published';
}

// ── Gallring & samtycke ─────────────────────────────────────────────────────

export function studentProfileExpiresAt(consentAt: Date, days = STUDENT_PROFILE_RETENTION_DAYS): Date {
  return new Date(consentAt.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isStudentProfileExpired(expiresAt: string | Date | null | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  const t = typeof expiresAt === 'string' ? Date.parse(expiresAt) : expiresAt.getTime();
  return Number.isFinite(t) && t <= now.getTime();
}

// ── Rankning ────────────────────────────────────────────────────────────────

export interface RankableNeed {
  id: string;
  kind: TalentNeedKind;
  tags: readonly string[];
  starts_at?: string | null;
  ends_at?: string | null;
  location?: string | null;
  work_mode?: TalentWorkMode | null;
  status?: TalentNeedStatus;
}

export interface RankableStudent {
  id: string;
  tags: readonly StudentTag[];
  seeking: readonly TalentNeedKind[];
  available_from?: string | null;
  location?: string | null;
  remote_ok?: boolean;
  searchable?: boolean;
  status?: StudentProfileStatus;
}

export interface TalentMatch<T> {
  item: T;
  score: number;
  /** Läsbara, PII-fria skäl ("3 av 4 hashtags", "söker exjobb", "tillgänglig från start"). */
  reasons: string[];
  matchedTags: string[];
  missingTags: string[];
}

const KIND_WEIGHT = 4;
const TAG_WEIGHT = 3;
const PERIOD_WEIGHT = 1.5;
const PLACE_WEIGHT = 1;

function normLoc(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/** Poäng + skäl för ETT par behov/student. Ren och symmetrisk. */
export function scoreTalentPair(need: RankableNeed, student: RankableStudent): Omit<TalentMatch<never>, 'item'> {
  const reasons: string[] = [];
  let score = 0;
  const studentTags = new Map(student.tags.map((t) => [t.tag, t.level]));
  const matchedTags: string[] = [];
  const missingTags: string[] = [];
  for (const tag of need.tags) {
    const level = studentTags.get(tag);
    if (level) {
      matchedTags.push(tag);
      score += TAG_WEIGHT * COMPETENCE_LEVEL_WEIGHT[level];
    } else missingTags.push(tag);
  }
  if (need.tags.length > 0) {
    reasons.push(`${matchedTags.length} av ${need.tags.length} hashtags`);
  }
  if (student.seeking.includes(need.kind)) {
    score += KIND_WEIGHT;
    reasons.push(`söker ${TALENT_NEED_KIND_LABELS[need.kind].toLowerCase()}`);
  } else {
    reasons.push(`söker inte ${TALENT_NEED_KIND_LABELS[need.kind].toLowerCase()}`);
  }
  if (student.available_from) {
    if (!need.starts_at || student.available_from <= need.starts_at) {
      score += PERIOD_WEIGHT;
      reasons.push('tillgänglig från start');
    } else if (need.ends_at && student.available_from > need.ends_at) {
      score -= PERIOD_WEIGHT;
      reasons.push('tillgänglig först efter periodens slut');
    } else {
      reasons.push(`tillgänglig från ${student.available_from}`);
    }
  }
  const remoteNeed = need.work_mode === 'remote';
  const sameLoc = normLoc(need.location) && normLoc(need.location) === normLoc(student.location);
  if (remoteNeed || student.remote_ok || sameLoc) {
    score += PLACE_WEIGHT;
    reasons.push(remoteNeed ? 'på distans' : sameLoc ? 'samma ort' : 'kan arbeta på distans');
  }
  return { score, reasons, matchedTags, missingTags };
}

function eligibleStudent(s: RankableStudent): boolean {
  return (s.status ?? 'active') === 'active' && s.searchable !== false;
}

/** Rankar sökbara, aktiva studenter för ett behov. Minst en hashtag eller rätt typ krävs för att listas. */
export function rankStudentsForNeed(
  need: RankableNeed,
  students: readonly RankableStudent[],
  opts: { limit?: number; exclude?: ReadonlySet<string> } = {}
): TalentMatch<RankableStudent>[] {
  const limit = opts.limit ?? TALENT_SHORTLIST_SIZE;
  const out: TalentMatch<RankableStudent>[] = [];
  for (const s of students) {
    if (!eligibleStudent(s) || opts.exclude?.has(s.id)) continue;
    const r = scoreTalentPair(need, s);
    if (r.matchedTags.length === 0 && !s.seeking.includes(need.kind)) continue;
    out.push({ item: s, ...r });
  }
  out.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  return out.slice(0, limit);
}

/** Rankar publicerade behov för en student (den publika tavlan + förslag). */
export function rankNeedsForStudent(
  student: RankableStudent,
  needs: readonly RankableNeed[],
  opts: { limit?: number } = {}
): TalentMatch<RankableNeed>[] {
  const limit = opts.limit ?? TALENT_SHORTLIST_SIZE;
  const out: TalentMatch<RankableNeed>[] = [];
  for (const n of needs) {
    if ((n.status ?? 'published') !== 'published') continue;
    const r = scoreTalentPair(n, student);
    out.push({ item: n, ...r });
  }
  out.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  return out.slice(0, limit);
}

/** Hashtags ett behov efterfrågar som INGEN sökbar student har. */
export function uncoveredNeedTags(need: RankableNeed, students: readonly RankableStudent[]): string[] {
  const have = new Set<string>();
  for (const s of students) if (eligibleStudent(s)) for (const t of s.tags) have.add(t.tag);
  return need.tags.filter((t) => !have.has(t));
}

// ── Projektioner mot skärmen ────────────────────────────────────────────────

/** Den anonymiserade profilen ett bolag ser innan studenten själv tagit kontakt. */
export interface AnonymizedStudent {
  id: string;
  headline: string;
  level: StudentLevel;
  university: string;
  program: string;
  graduation_year: number | null;
  tags: StudentTag[];
  seeking: TalentNeedKind[];
  available_from: string | null;
  location: string;
  remote_ok: boolean;
  summary: string;
}

export function anonymizeStudent(p: {
  id: string;
  level: StudentLevel;
  university: string;
  program: string;
  graduation_year: number | null;
  tags: readonly StudentTag[];
  seeking: readonly TalentNeedKind[];
  available_from: string | null;
  location: string;
  remote_ok: boolean;
  summary: string;
}): AnonymizedStudent {
  const levelWord = STUDENT_LEVEL_LABELS[p.level].split(' /')[0];
  return {
    id: p.id,
    headline: [p.program || levelWord, p.university].filter(Boolean).join(' · '),
    level: p.level,
    university: p.university,
    program: p.program,
    graduation_year: p.graduation_year,
    tags: [...p.tags],
    seeking: [...p.seeking],
    available_from: p.available_from,
    location: p.location,
    remote_ok: p.remote_ok,
    summary: p.summary
  };
}

/** Så bolaget presenteras på den publika tavlan (anonymt behov ⇒ "Startup i inkubatorn"). */
export function publicCompanyLabel(need: { anonymous?: boolean }, startupName: string | null | undefined, tenantName?: string | null): string {
  if (need.anonymous || !startupName) return tenantName ? `Startup i ${tenantName}s inkubator` : 'Startup i inkubatorn';
  return startupName;
}

/** Kort, PII-fri sammanfattning av perioden ("jan 2027 – jun 2027", "från 2027-01-15"). */
export function needPeriodLabel(need: { starts_at?: string | null; ends_at?: string | null }): string {
  if (need.starts_at && need.ends_at) return `${need.starts_at} – ${need.ends_at}`;
  if (need.starts_at) return `från ${need.starts_at}`;
  if (need.ends_at) return `till ${need.ends_at}`;
  return 'Period enligt överenskommelse';
}

export function countInterestsByStatus(items: readonly { status: TalentInterestStatus }[]): Record<TalentInterestStatus, number> {
  const out = Object.fromEntries(TALENT_INTEREST_STATUSES.map((s) => [s, 0])) as Record<TalentInterestStatus, number>;
  for (const i of items) out[i.status]++;
  return out;
}

/** Hela adressen till en tenants publika studentsida. */
export function talentPublicPath(tenantSlug: string, sub = ''): string {
  return `/s/${encodeURIComponent(tenantSlug)}${sub}`;
}
