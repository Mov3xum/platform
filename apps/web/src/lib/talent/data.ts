import 'server-only';
import type PocketBase from 'pocketbase';
import {
  anonymizeStudent,
  interestRevealsContact,
  isStudentLevel,
  isStudentProfileStatus,
  isTalentInterestStatus,
  isTalentNeedKind,
  isTalentNeedStatus,
  isTalentOutcome,
  sanitizeKinds,
  sanitizeNeedTags,
  sanitizeStudentTags,
  type AnonymizedStudent,
  type StudentLevel,
  type StudentProfileStatus,
  type StudentTag,
  type TalentCompensation,
  type TalentInterestInitiator,
  type TalentInterestStatus,
  type TalentNeedKind,
  type TalentNeedStatus,
  type TalentOutcome,
  type TalentWorkMode
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';

/**
 * Enda läsvägen för Studenter & talang (CLAUDE.md § 54). Reads går via den
 * inkommande klienten (användarens token → RLS § 21): behov och intressen
 * är medlem-scopade på `startup`, studentprofiler staff/observer-only.
 * Kollektionerna adresseras på NAMN (§ 30.4 p. 1). Fail-soft mot ett ännu
 * inte migrerat schema (`missing`), aldrig krasch.
 *
 * Undantag — KURERADE superuser-vyer för bolaget (samma mönster som
 * `listSharedContactsForStartup`, § 45.4), anropade EFTER att anroparen
 * verifierat medlemskap i bolaget:
 *   - `listSearchableStudentsForStartup`: ANONYMISERADE profiler (ingen e-post,
 *     inget namn) av studenter som valt att vara sökbara.
 *   - `listInterestsForStartup`: bolagets intressen med studentens namn och
 *     kontakt BARA när studenten själv sökt/tackat ja (`interestRevealsContact`).
 */

export const TALENT_NEEDS = 'talent_needs';
export const STUDENT_PROFILES = 'student_profiles';
export const TALENT_INTERESTS = 'talent_interests';

export const TALENT_MIGRATION_HINT =
  'Studenter & talang saknas i databasen — kör migration 1700000201 (eller workflowen "Sync PocketBase").';

export interface TalentNeedRow {
  id: string;
  tenant: string;
  startup: string;
  startupName: string | null;
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
  status: TalentNeedStatus;
  anonymous: boolean;
  review_note: string;
  published_at: string | null;
  reviewed_by: string | null;
  created_by: string | null;
  created: string;
  updated: string;
}

export interface StudentProfileRow {
  id: string;
  tenant: string;
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
  status: StudentProfileStatus;
  consent_at: string | null;
  verified_at: string | null;
  last_active_at: string | null;
  expires_at: string | null;
  created: string;
}

export interface TalentInterestRow {
  id: string;
  tenant: string;
  need: string;
  student: string;
  startup: string;
  status: TalentInterestStatus;
  initiated_by: TalentInterestInitiator;
  message: string;
  company_note: string;
  outcome: TalentOutcome | null;
  outcome_note: string;
  outcome_at: string | null;
  responded_at: string | null;
  status_changed_at: string | null;
  changed_by: string | null;
  created_by: string | null;
  created: string;
  updated: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function dateOnly(v: unknown): string | null {
  const s = str(v).trim();
  return s ? s.slice(0, 10) : null;
}
function iso(v: unknown): string | null {
  const s = str(v).trim();
  return s || null;
}

export function normalizeNeed(raw: Record<string, unknown>): TalentNeedRow {
  const exp = (raw.expand as { startup?: { name?: string } } | undefined)?.startup;
  return {
    id: String(raw.id),
    tenant: str(raw.tenant),
    startup: str(raw.startup),
    startupName: exp?.name ? String(exp.name) : null,
    title: str(raw.title),
    kind: isTalentNeedKind(raw.kind) ? raw.kind : 'projekt',
    description: str(raw.description),
    tags: sanitizeNeedTags(raw.tags),
    scope: str(raw.scope),
    starts_at: dateOnly(raw.starts_at),
    ends_at: dateOnly(raw.ends_at),
    compensation: (['unpaid', 'paid', 'negotiable'] as const).includes(raw.compensation as TalentCompensation)
      ? (raw.compensation as TalentCompensation)
      : 'negotiable',
    compensation_note: str(raw.compensation_note),
    location: str(raw.location),
    work_mode: (['onsite', 'hybrid', 'remote'] as const).includes(raw.work_mode as TalentWorkMode)
      ? (raw.work_mode as TalentWorkMode)
      : 'hybrid',
    supervisor: raw.supervisor === true,
    deadline: dateOnly(raw.deadline),
    status: isTalentNeedStatus(raw.status) ? raw.status : 'draft',
    anonymous: raw.anonymous === true,
    review_note: str(raw.review_note),
    published_at: iso(raw.published_at),
    reviewed_by: iso(raw.reviewed_by),
    created_by: iso(raw.created_by),
    created: str(raw.created),
    updated: str(raw.updated)
  };
}

export function normalizeStudent(raw: Record<string, unknown>): StudentProfileRow {
  const year = Number(raw.graduation_year);
  return {
    id: String(raw.id),
    tenant: str(raw.tenant),
    first_name: str(raw.first_name),
    last_name: str(raw.last_name),
    email: str(raw.email),
    university: str(raw.university),
    program: str(raw.program),
    level: isStudentLevel(raw.level) ? raw.level : 'annan',
    graduation_year: Number.isInteger(year) && year > 0 ? year : null,
    tags: sanitizeStudentTags(raw.tags),
    seeking: sanitizeKinds(raw.seeking),
    available_from: dateOnly(raw.available_from),
    location: str(raw.location),
    remote_ok: raw.remote_ok === true,
    summary: str(raw.summary),
    linkedin_url: str(raw.linkedin_url),
    searchable: raw.searchable === true,
    status: isStudentProfileStatus(raw.status) ? raw.status : 'pending',
    consent_at: iso(raw.consent_at),
    verified_at: iso(raw.verified_at),
    last_active_at: iso(raw.last_active_at),
    expires_at: iso(raw.expires_at),
    created: str(raw.created)
  };
}

export function normalizeInterest(raw: Record<string, unknown>): TalentInterestRow {
  return {
    id: String(raw.id),
    tenant: str(raw.tenant),
    need: str(raw.need),
    student: str(raw.student),
    startup: str(raw.startup),
    status: isTalentInterestStatus(raw.status) ? raw.status : 'new',
    initiated_by: (['student', 'company', 'staff'] as const).includes(raw.initiated_by as TalentInterestInitiator)
      ? (raw.initiated_by as TalentInterestInitiator)
      : 'student',
    message: str(raw.message),
    company_note: str(raw.company_note),
    outcome: isTalentOutcome(raw.outcome) ? raw.outcome : null,
    outcome_note: str(raw.outcome_note),
    outcome_at: iso(raw.outcome_at),
    responded_at: iso(raw.responded_at),
    status_changed_at: iso(raw.status_changed_at),
    changed_by: iso(raw.changed_by),
    created_by: iso(raw.created_by),
    created: str(raw.created),
    updated: str(raw.updated)
  };
}

export interface ListResult<T> {
  items: T[];
  missing?: boolean;
  error?: string;
  truncated?: boolean;
}

const MAX = 500;

function failure<T>(err: unknown, what: string): ListResult<T> {
  const status = (err as { status?: number })?.status;
  if (status === 404) return { items: [], missing: true };
  console.error(`[talent] ${what} failed`, { status });
  return { items: [], error: `Kunde inte läsa ${what}.` };
}

export async function listNeeds(
  pb: PocketBase,
  tenant: string,
  opts: { startup?: string; statuses?: readonly TalentNeedStatus[] } = {}
): Promise<ListResult<TalentNeedRow>> {
  const params: Record<string, string> = { tenant };
  let filter = 'tenant = {:tenant}';
  if (opts.startup) {
    params.startup = opts.startup;
    filter += ' && startup = {:startup}';
  }
  if (opts.statuses && opts.statuses.length > 0) {
    filter += ` && (${opts.statuses.map((s, i) => {
      params[`s${i}`] = s;
      return `status = {:s${i}}`;
    }).join(' || ')})`;
  }
  try {
    const res = await pb.collection(TALENT_NEEDS).getList<Record<string, unknown>>(1, MAX, {
      filter: pb.filter(filter, params),
      sort: '-updated',
      expand: 'startup'
    });
    return { items: res.items.map(normalizeNeed), truncated: res.totalItems > res.items.length };
  } catch (err) {
    return failure(err, 'behoven');
  }
}

export async function getNeed(pb: PocketBase, tenant: string, id: string): Promise<TalentNeedRow | null> {
  try {
    const raw = await pb.collection(TALENT_NEEDS).getOne<Record<string, unknown>>(id, { expand: 'startup' });
    const row = normalizeNeed(raw);
    return row.tenant === tenant ? row : null;
  } catch {
    return null;
  }
}

/** Som `getNeed` men med superuser-reserv vid PB v0.23.4:s tysta regel-nekande (§ 21.3); tenant-kontrollen är gränsen. */
export async function getNeedWithFallback(pb: PocketBase, tenant: string, id: string): Promise<TalentNeedRow | null> {
  const own = await getNeed(pb, tenant, id);
  if (own) return own;
  const su = await getSuperuserPb();
  return su.ok ? getNeed(su.pb, tenant, id) : null;
}

export async function listStudents(
  pb: PocketBase,
  tenant: string,
  opts: { statuses?: readonly StudentProfileStatus[] } = {}
): Promise<ListResult<StudentProfileRow>> {
  const params: Record<string, string> = { tenant };
  let filter = 'tenant = {:tenant}';
  if (opts.statuses && opts.statuses.length > 0) {
    filter += ` && (${opts.statuses.map((s, i) => {
      params[`s${i}`] = s;
      return `status = {:s${i}}`;
    }).join(' || ')})`;
  }
  try {
    const res = await pb.collection(STUDENT_PROFILES).getList<Record<string, unknown>>(1, MAX, {
      filter: pb.filter(filter, params),
      sort: '-created'
    });
    return { items: res.items.map(normalizeStudent), truncated: res.totalItems > res.items.length };
  } catch (err) {
    return failure(err, 'studenterna');
  }
}

export async function getStudent(pb: PocketBase, tenant: string, id: string): Promise<StudentProfileRow | null> {
  try {
    const raw = await pb.collection(STUDENT_PROFILES).getOne<Record<string, unknown>>(id);
    const row = normalizeStudent(raw);
    return row.tenant === tenant ? row : null;
  } catch {
    return null;
  }
}

export async function listInterests(
  pb: PocketBase,
  tenant: string,
  opts: { need?: string; startup?: string; student?: string; statuses?: readonly TalentInterestStatus[] } = {}
): Promise<ListResult<TalentInterestRow>> {
  const params: Record<string, string> = { tenant };
  let filter = 'tenant = {:tenant}';
  for (const key of ['need', 'startup', 'student'] as const) {
    if (opts[key]) {
      params[key] = opts[key]!;
      filter += ` && ${key} = {:${key}}`;
    }
  }
  if (opts.statuses && opts.statuses.length > 0) {
    filter += ` && (${opts.statuses.map((s, i) => {
      params[`s${i}`] = s;
      return `status = {:s${i}}`;
    }).join(' || ')})`;
  }
  try {
    const res = await pb.collection(TALENT_INTERESTS).getList<Record<string, unknown>>(1, MAX, {
      filter: pb.filter(filter, params),
      sort: '-updated'
    });
    return { items: res.items.map(normalizeInterest), truncated: res.totalItems > res.items.length };
  } catch (err) {
    return failure(err, 'intresseanmälningarna');
  }
}

export async function getInterest(pb: PocketBase, tenant: string, id: string): Promise<TalentInterestRow | null> {
  try {
    const raw = await pb.collection(TALENT_INTERESTS).getOne<Record<string, unknown>>(id);
    const row = normalizeInterest(raw);
    return row.tenant === tenant ? row : null;
  } catch {
    return null;
  }
}

// ── Kurerade vyer för bolaget (superuser EFTER verifierat medlemskap) ────────

/** Studenten som bolaget får se på ett intresse: anonym tills kontakt avslöjas. */
export interface InterestStudentView extends AnonymizedStudent {
  revealed: boolean;
  /** Bara när `revealed` (studenten sökte själv eller tackade ja). */
  name: string | null;
  email: string | null;
  linkedin_url: string | null;
}

export function toInterestStudentView(student: StudentProfileRow, status: TalentInterestStatus): InterestStudentView {
  const revealed = interestRevealsContact(status);
  return {
    ...anonymizeStudent(student),
    revealed,
    name: revealed ? [student.first_name, student.last_name].filter(Boolean).join(' ') : null,
    email: revealed ? student.email : null,
    linkedin_url: revealed ? student.linkedin_url || null : null
  };
}

export interface StartupInterestView {
  interest: TalentInterestRow;
  student: InterestStudentView | null;
  needTitle: string;
}

/** Bolagets intressen (alla behov eller ett). Kräver att anroparen verifierat medlemskap/staff. */
export async function listInterestsForStartup(
  tenant: string,
  startupId: string,
  opts: { need?: string } = {}
): Promise<ListResult<StartupInterestView>> {
  const su = await getSuperuserPb();
  if (!su.ok) return { items: [], error: 'Kunde inte läsa intresseanmälningarna (superuser saknas).' };
  const interests = await listInterests(su.pb, tenant, { startup: startupId, need: opts.need });
  if (interests.missing || interests.error) return { items: [], missing: interests.missing, error: interests.error };
  const studentIds = [...new Set(interests.items.map((i) => i.student))];
  const needIds = [...new Set(interests.items.map((i) => i.need))];
  const [students, needs] = await Promise.all([
    Promise.all(studentIds.map((id) => getStudent(su.pb, tenant, id))),
    Promise.all(needIds.map((id) => getNeed(su.pb, tenant, id)))
  ]);
  const studentById = new Map(students.filter((s): s is StudentProfileRow => Boolean(s)).map((s) => [s.id, s]));
  const needById = new Map(needs.filter((n): n is TalentNeedRow => Boolean(n)).map((n) => [n.id, n]));
  return {
    items: interests.items.map((interest) => {
      const s = studentById.get(interest.student);
      return {
        interest,
        student: s ? toInterestStudentView(s, interest.status) : null,
        needTitle: needById.get(interest.need)?.title ?? 'Behov'
      };
    }),
    truncated: interests.truncated
  };
}

/** Sökbara, aktiva studenter — ANONYMISERADE — för ett bolag som verifierats av anroparen. */
export async function listSearchableStudentsForStartup(tenant: string): Promise<ListResult<AnonymizedStudent>> {
  const su = await getSuperuserPb();
  if (!su.ok) return { items: [], error: 'Kunde inte läsa studenterna (superuser saknas).' };
  const res = await listStudents(su.pb, tenant, { statuses: ['active'] });
  if (res.missing || res.error) return { items: [], missing: res.missing, error: res.error };
  const now = Date.now();
  return {
    items: res.items
      .filter((s) => s.searchable && (!s.expires_at || Date.parse(s.expires_at) > now))
      .map(anonymizeStudent),
    truncated: res.truncated
  };
}

/** Rader i `startups` som behövs för att visa namn på behov (superuser EJ — användarens token). */
export async function startupNamesById(pb: PocketBase, tenant: string, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)].slice(0, 200);
  await Promise.all(
    unique.map(async (id) => {
      try {
        const s = await pb.collection('startups').getOne<{ id: string; tenant?: string; name?: string }>(id, { fields: 'id,tenant,name' });
        if (String(s.tenant ?? '') === tenant && s.name) out.set(id, s.name);
      } catch {
        /* ingen behörighet eller borttaget bolag */
      }
    })
  );
  return out;
}
