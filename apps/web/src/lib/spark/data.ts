import 'server-only';
import type PocketBase from 'pocketbase';
import {
  SPARK_ACCELERATOR_CATEGORIES,
  SPARK_CONSEQUENCES,
  SPARK_CONTRIBUTIONS,
  SPARK_ENERGY_AREAS,
  SPARK_INTERVIEW_SOURCES,
  SPARK_INTERVIEW_STATUSES,
  SPARK_MATCH_STATUSES,
  SPARK_NEED_STATUSES,
  SPARK_SECTORS,
  SPARK_SOLUTION_NEEDS,
  SPARK_SOLUTION_STATUSES,
  SPARK_SUPPORT_NEEDS,
  SPARK_TESTBED_STATUSES,
  emptySparkAnswers,
  isSparkConsent,
  isSparkId,
  normalizeSparkInterview,
  sanitizeSparkList,
  sanitizeSparkRoles,
  type SparkActorStatus,
  type SparkConsent,
  type SparkInterviewAnswers,
  type SparkInterviewSource,
  type SparkInterviewStatus,
  type SparkMatchStatus,
  type SparkNeedStatus,
  type SparkRole,
  type SparkSolutionStatus,
  type SparkSupportKind,
  type SparkTestbedKind,
  type SparkTestbedStatus
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';

/**
 * Enda läsvägen för SPARK – energimatchning (CLAUDE.md § 61). Reads går via
 * den inkommande klienten (användarens token → RLS): registret och
 * matchningarna är staff/observer-only, intervjuer läses dessutom av den som
 * skapade dem (partnern). Kollektionerna adresseras på NAMN (§ 30.4 p. 1).
 * Fail-soft mot ett schema utan migrationen (`missing`) — aldrig krasch, och
 * ett läsfel visas som fel, aldrig som en tom lista.
 */

export const SPARK_ACTORS = 'spark_actors';
export const SPARK_INTERVIEWS = 'spark_interviews';
export const SPARK_NEEDS = 'spark_needs';
export const SPARK_SOLUTIONS = 'spark_solutions';
export const SPARK_TESTBEDS = 'spark_testbeds';
export const SPARK_MATCHES = 'spark_matches';

export const SPARK_MIGRATION_HINT = 'SPARK saknas i databasen — kör migration 1700000221 (eller workflowen "Sync PocketBase").';

const MAX_ROWS = 5000;

export interface SparkActorRow {
  id: string;
  tenant: string;
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
  website: string;
  notes: string;
  startup: string | null;
  status: SparkActorStatus;
  created: string;
  updated: string;
}

export interface SparkNeedRow {
  id: string;
  tenant: string;
  actor: string;
  interview: string | null;
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
  status: SparkNeedStatus;
  created: string;
}

export interface SparkSolutionRow {
  id: string;
  tenant: string;
  actor: string;
  interview: string | null;
  source_key: string;
  name: string;
  description: string;
  problem: string;
  areas: string[];
  target_sectors: string[];
  contributions: string[];
  maturity: number;
  trl: number | null;
  trl_assessed: number | null;
  accelerator_category: string;
  accelerator_note: string;
  assessed_at: string | null;
  verified: string;
  needs: string[];
  barriers: string;
  expansion: string;
  status: SparkSolutionStatus;
  created: string;
}

export interface SparkTestbedRow {
  id: string;
  tenant: string;
  actor: string;
  interview: string | null;
  source_key: string;
  kind: SparkTestbedKind;
  description: string;
  areas: string[];
  conditions: string;
  status: SparkTestbedStatus;
  created: string;
}

export interface SparkMatchRow {
  id: string;
  tenant: string;
  need: string | null;
  solution: string | null;
  testbed: string | null;
  status: SparkMatchStatus;
  need_consent: SparkConsent;
  solution_consent: SparkConsent;
  owner: string | null;
  next_step: string;
  next_step_due: string | null;
  notes: string;
  outcome: string;
  score: number;
  reasons: string[];
  support_kind: SparkSupportKind;
  support_confirmed: boolean;
  support_note: string;
  work_package: string;
  status_changed_at: string | null;
  created: string;
  updated: string;
}

export interface SparkInterviewRow {
  id: string;
  tenant: string;
  company_name: string;
  org_nr: string;
  roles: SparkRole[];
  answers: SparkInterviewAnswers;
  status: SparkInterviewStatus;
  source: SparkInterviewSource;
  interviewer_org: string;
  interviewed_at: string | null;
  actor: string | null;
  referred_by: string | null;
  submitted_at: string | null;
  applied_at: string | null;
  created_by: string | null;
  created: string;
  updated: string;
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const idOrNull = (v: unknown): string | null => (isSparkId(v) ? v : null);
const dateOnly = (v: unknown): string | null => {
  const s = str(v).trim();
  return s ? s.slice(0, 10) : null;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const level = (v: unknown, max: number): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
};
const textList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20) : []);

export function normalizeSparkActor(r: Raw): SparkActorRow {
  return {
    id: str(r.id),
    tenant: str(r.tenant),
    name: str(r.name),
    org_nr: str(r.org_nr),
    actor_type: str(r.actor_type),
    sector: str(r.sector),
    business: str(r.business),
    kommun: str(r.kommun),
    size: str(r.size),
    roles: sanitizeSparkRoles(r.roles),
    energy_importance: str(r.energy_importance),
    energy_work: str(r.energy_work),
    development_areas: str(r.development_areas),
    pilot_interest: str(r.pilot_interest),
    academia_interest: str(r.academia_interest),
    need_matching: str(r.need_matching),
    solution_matching: str(r.solution_matching),
    support_needs: sanitizeSparkList(r.support_needs, SPARK_SUPPORT_NEEDS),
    program_interest: str(r.program_interest),
    info_ok: r.info_ok === true,
    events_ok: r.events_ok === true,
    contact_ok: r.contact_ok === true,
    sharing: str(r.sharing),
    contact_name: str(r.contact_name),
    contact_role: str(r.contact_role),
    contact_email: str(r.contact_email),
    contact_phone: str(r.contact_phone),
    website: str(r.website),
    notes: str(r.notes),
    startup: idOrNull(r.startup),
    status: oneOf(r.status, ['active', 'archived'] as const, 'active'),
    created: str(r.created),
    updated: str(r.updated)
  };
}

export function normalizeSparkNeed(r: Raw): SparkNeedRow {
  return {
    id: str(r.id),
    tenant: str(r.tenant),
    actor: str(r.actor),
    interview: idOrNull(r.interview),
    source_key: str(r.source_key),
    title: str(r.title),
    description: str(r.description),
    areas: sanitizeSparkList(r.areas, SPARK_ENERGY_AREAS),
    process_note: str(r.process_note),
    unmet: str(r.unmet),
    consequences: sanitizeSparkList(r.consequences, SPARK_CONSEQUENCES),
    priority: str(r.priority),
    horizon: str(r.horizon),
    tried: str(r.tried),
    status: oneOf(r.status, SPARK_NEED_STATUSES, 'open'),
    created: str(r.created)
  };
}

export function normalizeSparkSolution(r: Raw): SparkSolutionRow {
  const category = str(r.accelerator_category);
  return {
    id: str(r.id),
    tenant: str(r.tenant),
    actor: str(r.actor),
    interview: idOrNull(r.interview),
    source_key: str(r.source_key),
    name: str(r.name),
    description: str(r.description),
    problem: str(r.problem),
    areas: sanitizeSparkList(r.areas, SPARK_ENERGY_AREAS),
    target_sectors: sanitizeSparkList(r.target_sectors, SPARK_SECTORS),
    contributions: sanitizeSparkList(r.contributions, SPARK_CONTRIBUTIONS),
    maturity: level(r.maturity, 6) ?? 0,
    trl: level(r.trl, 9),
    trl_assessed: level(r.trl_assessed, 9),
    accelerator_category: SPARK_ACCELERATOR_CATEGORIES.some((c) => c.id === category) ? category : '',
    accelerator_note: str(r.accelerator_note),
    assessed_at: dateOnly(r.assessed_at),
    verified: str(r.verified),
    needs: sanitizeSparkList(r.needs, SPARK_SOLUTION_NEEDS),
    barriers: str(r.barriers),
    expansion: str(r.expansion),
    status: oneOf(r.status, SPARK_SOLUTION_STATUSES, 'active'),
    created: str(r.created)
  };
}

export function normalizeSparkTestbed(r: Raw): SparkTestbedRow {
  return {
    id: str(r.id),
    tenant: str(r.tenant),
    actor: str(r.actor),
    interview: idOrNull(r.interview),
    source_key: str(r.source_key),
    kind: oneOf(r.kind, ['test_environment', 'pilot_customer'] as const, 'test_environment'),
    description: str(r.description),
    areas: sanitizeSparkList(r.areas, SPARK_ENERGY_AREAS),
    conditions: str(r.conditions),
    status: oneOf(r.status, SPARK_TESTBED_STATUSES, 'available'),
    created: str(r.created)
  };
}

export function normalizeSparkMatch(r: Raw): SparkMatchRow {
  return {
    id: str(r.id),
    tenant: str(r.tenant),
    need: idOrNull(r.need),
    solution: idOrNull(r.solution),
    testbed: idOrNull(r.testbed),
    status: oneOf(r.status, SPARK_MATCH_STATUSES, 'suggested'),
    need_consent: isSparkConsent(r.need_consent) ? r.need_consent : 'pending',
    solution_consent: isSparkConsent(r.solution_consent) ? r.solution_consent : 'pending',
    owner: idOrNull(r.owner),
    next_step: str(r.next_step),
    next_step_due: dateOnly(r.next_step_due),
    notes: str(r.notes),
    outcome: str(r.outcome),
    score: typeof r.score === 'number' ? r.score : 0,
    reasons: textList(r.reasons),
    support_kind: oneOf(r.support_kind, ['none', 'de_minimis'] as const, 'none'),
    support_confirmed: r.support_confirmed === true,
    support_note: str(r.support_note),
    work_package: str(r.work_package),
    status_changed_at: dateOnly(r.status_changed_at),
    created: str(r.created),
    updated: str(r.updated)
  };
}

export function normalizeSparkInterviewRow(r: Raw): SparkInterviewRow {
  const answers = r.answers && typeof r.answers === 'object' ? normalizeSparkInterview(r.answers).value : emptySparkAnswers();
  return {
    id: str(r.id),
    tenant: str(r.tenant),
    company_name: str(r.company_name),
    org_nr: str(r.org_nr),
    roles: sanitizeSparkRoles(r.roles),
    answers,
    status: oneOf(r.status, SPARK_INTERVIEW_STATUSES, 'draft'),
    source: oneOf(r.source, SPARK_INTERVIEW_SOURCES, 'staff'),
    interviewer_org: str(r.interviewer_org),
    interviewed_at: dateOnly(r.interviewed_at),
    actor: idOrNull(r.actor),
    referred_by: idOrNull(r.referred_by),
    submitted_at: dateOnly(r.submitted_at),
    applied_at: dateOnly(r.applied_at),
    created_by: idOrNull(r.created_by),
    created: str(r.created),
    updated: str(r.updated)
  };
}

export interface SparkList<T> {
  items: T[];
  /** Kollektionen saknas (migrationen inte körd). */
  missing?: boolean;
  /** Läsfel — visas, aldrig som tom lista. */
  error?: string;
  /** Fler rader finns än som lästes. */
  truncated?: boolean;
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

async function fetchAll<T>(
  pb: PocketBase,
  collection: string,
  filter: string,
  normalize: (r: Raw) => T,
  opts: { sort?: string; fields?: string } = {}
): Promise<SparkList<T>> {
  const items: T[] = [];
  try {
    for (let page = 1; items.length < MAX_ROWS; page += 1) {
      const res = await pb.collection(collection).getList<Raw>(page, 500, { filter, sort: opts.sort ?? '-created', fields: opts.fields, skipTotal: false });
      for (const r of res.items) items.push(normalize(r));
      if (page >= res.totalPages) return { items };
    }
    return { items, truncated: true };
  } catch (err) {
    if (statusOf(err) === 404) return { items: [], missing: true };
    console.error('[spark] read failed', { collection, status: statusOf(err) });
    return { items, error: 'Kunde inte läsa uppgifterna just nu. Ladda om sidan.' };
  }
}

export interface SparkRegistry {
  actors: SparkActorRow[];
  needs: SparkNeedRow[];
  solutions: SparkSolutionRow[];
  testbeds: SparkTestbedRow[];
  matches: SparkMatchRow[];
  actorById: Map<string, SparkActorRow>;
  missing: boolean;
  error?: string;
  truncated: boolean;
}

/** Hela registret för tenanten — underlag för översikt, matchning och acceleratorvyn. */
export async function loadSparkRegistry(pb: PocketBase, tenant: string): Promise<SparkRegistry> {
  const filter = pb.filter('tenant = {:t}', { t: tenant });
  const [actors, needs, solutions, testbeds, matches] = await Promise.all([
    fetchAll(pb, SPARK_ACTORS, filter, normalizeSparkActor, { sort: 'name' }),
    fetchAll(pb, SPARK_NEEDS, filter, normalizeSparkNeed),
    fetchAll(pb, SPARK_SOLUTIONS, filter, normalizeSparkSolution),
    fetchAll(pb, SPARK_TESTBEDS, filter, normalizeSparkTestbed),
    fetchAll(pb, SPARK_MATCHES, filter, normalizeSparkMatch, { sort: '-updated' })
  ]);
  const all = [actors, needs, solutions, testbeds, matches];
  return {
    actors: actors.items,
    needs: needs.items,
    solutions: solutions.items,
    testbeds: testbeds.items,
    matches: matches.items,
    actorById: new Map(actors.items.map((a) => [a.id, a])),
    missing: all.some((l) => l.missing),
    error: all.find((l) => l.error)?.error,
    truncated: all.some((l) => l.truncated)
  };
}

const INTERVIEW_LIST_FIELDS = 'id,tenant,company_name,org_nr,roles,status,source,interviewer_org,interviewed_at,actor,referred_by,submitted_at,applied_at,created_by,created,updated';

/** Intervjuer — RLS ger Movexum alla och en partner bara sina egna. Svaren läses inte i listan. */
export async function listSparkInterviews(pb: PocketBase, tenant: string): Promise<SparkList<SparkInterviewRow>> {
  return fetchAll(pb, SPARK_INTERVIEWS, pb.filter('tenant = {:t}', { t: tenant }), normalizeSparkInterviewRow, {
    sort: '-updated',
    fields: INTERVIEW_LIST_FIELDS
  });
}

export async function getSparkInterview(pb: PocketBase, tenant: string, id: string): Promise<SparkInterviewRow | null> {
  if (!isSparkId(id)) return null;
  try {
    const row = normalizeSparkInterviewRow(await pb.collection(SPARK_INTERVIEWS).getOne<Raw>(id));
    return row.tenant === tenant ? row : null;
  } catch {
    return null;
  }
}

export interface SparkReferralRow {
  company_name: string;
  created: string;
  status: SparkInterviewStatus;
}

/**
 * Anmälningar som kommit in via en partners delningslänk — KURERAD vy:
 * bara företagets namn, datum och status (aldrig svaren). Läses med
 * superusern efter att anroparen verifierat att `userId` är den inloggade;
 * utan superuser visas ingenting (`null`).
 */
export async function listSparkReferrals(tenant: string, userId: string): Promise<SparkReferralRow[] | null> {
  if (!isSparkId(userId)) return null;
  const su = await getSuperuserPb();
  if (!su.ok) return null;
  try {
    const res = await su.pb.collection(SPARK_INTERVIEWS).getList<Raw>(1, 200, {
      filter: su.pb.filter('tenant = {:t} && referred_by = {:u}', { t: tenant, u: userId }),
      sort: '-created',
      fields: 'company_name,created,status,tenant,referred_by'
    });
    return res.items
      .filter((r) => str(r.tenant) === tenant && str(r.referred_by) === userId)
      .map((r) => ({ company_name: str(r.company_name), created: str(r.created), status: oneOf(r.status, SPARK_INTERVIEW_STATUSES, 'submitted') }));
  } catch {
    return null;
  }
}

/** Visningsnamn för interna användare (id → namn) — aldrig e-post. */
export async function sparkUserNames(pb: PocketBase, tenant: string, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(isSparkId))].slice(0, 80);
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  try {
    const res = await pb.collection('users').getList<Raw>(1, 200, {
      filter: pb.filter('tenant = {:t}', { t: tenant }),
      fields: 'id,display_name,name'
    });
    for (const u of res.items) {
      if (wanted.includes(str(u.id))) out.set(str(u.id), str(u.display_name) || str(u.name) || 'Kollega');
    }
  } catch {
    /* fail-soft: visas som okänd */
  }
  return out;
}
