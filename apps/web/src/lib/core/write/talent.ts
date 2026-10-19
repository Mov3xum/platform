import 'server-only';
import type PocketBase from 'pocketbase';
import {
  TALENT_INTEREST_STATUS_LABELS,
  TALENT_MESSAGE_MAX,
  TALENT_NEED_KIND_LABELS,
  TALENT_NEED_STATUS_LABELS,
  TALENT_OUTCOME_LABELS,
  TALENT_OUTCOME_NOTE_MAX,
  TALENT_REVIEW_NOTE_MAX,
  canTransitionInterest,
  canTransitionNeed,
  cleanTalentText,
  isStudentProfileStatus,
  isTalentId,
  isTalentInterestStatus,
  isTalentOutcome,
  needEditableByCompany,
  validateTalentNeedInput,
  type StudentProfileStatus,
  type TalentInterestStatus,
  type TalentNeedStatus,
  type TalentParty
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { notify, notifyStartupMembers } from '@/lib/notifications-server';
import { recordActivity } from '@/lib/actions/record-activity';
import { sendStudentEmail, isEmailConfigured } from '@/lib/email';
import {
  STUDENT_PROFILES,
  TALENT_INTERESTS,
  TALENT_MIGRATION_HINT,
  TALENT_NEEDS,
  getInterest,
  getNeedWithFallback,
  getStudent,
  normalizeNeed,
  type StudentProfileRow,
  type TalentInterestRow,
  type TalentNeedRow
} from '@/lib/talent/data';
import { canCreateRecord, canWriteField } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Studenter & talang (CLAUDE.md § 54) — det delade skrivlagret för BOLAG och
 * MOVEXUM. (Studentens egna skrivningar — registrering, intresse, svar — går
 * via `lib/talent/students.server.ts` och den publika routen; de har ingen
 * Actor.)
 *
 * - Bolaget (länkad `startup_member`, `access.linkedStartups`) skapar och
 *   redigerar sina behov, skickar dem till granskning, pausar/avslutar och
 *   hanterar sina intressen. Det kan ALDRIG publicera — Movexum granskar
 *   (`reviewTalentNeed`), och en textändring på ett publicerat behov går
 *   tillbaka till granskning.
 * - Movexum-personal gör allt ovan för alla bolag i tenanten, föreslår
 *   studenter för behov och hanterar studentprofiler (pausa, ta bort).
 * - Tenant + bolagstillhörighet verifieras i koden på varje post; superuser
 *   bara som reserv vid PB v0.23.4:s tysta regel-nekande (§ 21.3) och för
 *   intressen (createRule null — bara servern skapar dem).
 * - Audit i `agent_actions` är PII-fri: behovets rubrik/typ/status, antal —
 *   aldrig studentens namn, e-post eller meddelande.
 * - Ingen AI: förslag till en student görs av en människa som läst den
 *   deterministiska rankningen (EU AI Act bilaga III p. 4).
 */

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;
const LEAD_ROLES = ['admin', 'incubator_lead'] as const;

export interface TalentAccess {
  /** Bolagsmedlemmens länkade bolag (ur sessionen). */
  linkedStartups?: readonly string[];
}

function isStaff(actor: Actor): boolean {
  return actor.roles.some((r) => (STAFF_ROLES as readonly string[]).includes(r));
}
function isLead(actor: Actor): boolean {
  return actor.roles.some((r) => (LEAD_ROLES as readonly string[]).includes(r));
}
type ActorParty = Exclude<TalentParty, 'student'>;
function partyFor(actor: Actor, startupId: string, access: TalentAccess): ActorParty | null {
  if (isStaff(actor)) return 'staff';
  if (actor.roles.includes('startup_member') && (access.linkedStartups ?? []).includes(startupId)) return 'company';
  return null;
}
function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}
function dbFail<T>(err: unknown, what: string): WriteResult<T> {
  if (statusOf(err) === 404) return fail('DB_ERROR', TALENT_MIGRATION_HINT);
  console.error('[talent] write failed', { what, status: statusOf(err) });
  return fail('DB_ERROR', `Kunde inte ${what}.`);
}

export function talentNeedPath(need: { id: string }, party: 'company' | 'staff'): string {
  return party === 'staff' ? `/talang/behov/${need.id}` : `/min-oversikt/talang/${need.id}`;
}

async function loadStartup(pb: PocketBase, actor: Actor, startupId: string) {
  if (!isTalentId(startupId)) return null;
  return getRecordInTenant<{ id: string; tenant: string; name?: string; coaches?: string[] }>(
    pb,
    actor,
    'startups',
    startupId,
    'id,tenant,name,coaches'
  );
}

/** Movexums ledning + bolagets coacher — mottagare för granskningsnotiser. */
async function reviewerIds(tenant: string, coaches: readonly string[]): Promise<string[]> {
  const ids = new Set<string>(coaches.filter(isTalentId));
  const su = await getSuperuserPb();
  if (su.ok) {
    try {
      const res = await su.pb.collection('users').getList<{ id: string; tenant?: string; roles?: string[] }>(1, 100, {
        filter: su.pb.filter('tenant = {:t} && (roles ~ "admin" || roles ~ "incubator_lead")', { t: tenant }),
        fields: 'id,tenant,roles'
      });
      for (const u of res.items) {
        if (String(u.tenant) === tenant && (u.roles ?? []).some((r) => r === 'admin' || r === 'incubator_lead')) ids.add(u.id);
      }
    } catch {
      /* fail-soft */
    }
  }
  return [...ids];
}

function auditNeed(n: TalentNeedRow, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: n.title, kind: n.kind, status: n.status, startup_name: n.startupName ?? undefined, ...extra };
}

// ── Behov ───────────────────────────────────────────────────────────────────

export interface TalentNeedResult {
  needId: string;
  status: TalentNeedStatus;
  path: string;
  warning?: string;
}

export async function createTalentNeed(
  pb: PocketBase,
  actor: Actor,
  access: TalentAccess,
  startupId: string,
  input: Record<string, unknown>,
  opts: { submit?: boolean } = {}
): Promise<WriteResult<TalentNeedResult>> {
  const policy = canCreateRecord(actor, TALENT_NEEDS);
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Nekat.');
  const startup = await loadStartup(pb, actor, startupId);
  if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');
  const party = partyFor(actor, startup.id, access);
  if (!party) return fail('FORBIDDEN', 'Du kan bara lägga upp behov för ditt eget bolag.');
  const v = validateTalentNeedInput(input);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const status: TalentNeedStatus = opts.submit ? 'pending_review' : 'draft';
  let created: Record<string, unknown>;
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(TALENT_NEEDS).create<Record<string, unknown>>({
        tenant: actor.tenant,
        startup: startup.id,
        ...v.value,
        contact_user: actor.id,
        status,
        created_by: actor.id
      })
    );
  } catch (err) {
    return dbFail(err, 'skapa behovet');
  }
  const need = normalizeNeed({ ...created, expand: { startup: { name: startup.name } } });
  await logAgentAction(pb, { actor, action_type: 'create', collection: TALENT_NEEDS, record_id: need.id, after_value: auditNeed(need) });
  if (opts.submit) await notifyReviewers(pb, actor, need, startup.coaches ?? []);
  return ok({ needId: need.id, status, path: talentNeedPath(need, party) });
}

async function notifyReviewers(pb: PocketBase, actor: Actor, need: TalentNeedRow, coaches: readonly string[]) {
  const recipients = await reviewerIds(actor.tenant, coaches);
  await notify(pb, {
    tenant: actor.tenant,
    recipients,
    kind: 'talent_need_review',
    actorId: actor.id,
    entity: { type: 'talent_need', id: need.id },
    dedupeKey: `talent_need_review:${need.id}:${need.updated}`,
    payload: {
      title: `Behov att granska: ${need.title}`,
      snippet: `${need.startupName ?? 'Ett bolag'} · ${TALENT_NEED_KIND_LABELS[need.kind]}`,
      href: `/talang/behov/${need.id}`
    }
  }).catch(() => undefined);
}

async function loadNeedForActor(
  pb: PocketBase,
  actor: Actor,
  access: TalentAccess,
  needId: string
): Promise<{ need: TalentNeedRow; party: ActorParty } | WriteResult<never>> {
  if (!isTalentId(needId)) return fail('NOT_FOUND', 'Ogiltigt behov.');
  const need = await getNeedWithFallback(pb, actor.tenant, needId);
  if (!need) return fail('NOT_FOUND', 'Behovet hittades inte i din organisation.');
  const party = partyFor(actor, need.startup, access);
  if (!party) return fail('FORBIDDEN', 'Du har inte tillgång till det här behovet.');
  return { need, party };
}

function isFail<T>(v: WriteResult<T> | { need: TalentNeedRow }): v is WriteResult<never> {
  return 'ok' in v;
}

/** Redigerar annonsens innehåll. Bolagets ändring på ett publicerat behov går tillbaka till granskning. */
export async function updateTalentNeed(
  pb: PocketBase,
  actor: Actor,
  access: TalentAccess,
  needId: string,
  input: Record<string, unknown>
): Promise<WriteResult<TalentNeedResult>> {
  const loaded = await loadNeedForActor(pb, actor, access, needId);
  if (isFail(loaded)) return loaded;
  const { need, party } = loaded;
  for (const f of ['title', 'kind', 'description', 'tags']) {
    const p = canWriteField(actor, TALENT_NEEDS, f);
    if (!p.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', p.reason ?? 'Nekat.');
  }
  if (party === 'company' && !needEditableByCompany(need.status)) {
    return fail('STATE_TRANSITION', 'Ett avslutat behov kan inte redigeras — öppna det igen först.');
  }
  const v = validateTalentNeedInput(input);
  if (!v.ok) return fail('INVALID_VALUE', v.error);
  const nextStatus: TalentNeedStatus = party === 'company' && need.status === 'published' ? 'pending_review' : need.status;
  try {
    await writeWithFallback(
      pb,
      (client) => client.collection(TALENT_NEEDS).update(need.id, { ...v.value, status: nextStatus }),
      { fallbackOn404: true }
    );
  } catch (err) {
    return dbFail(err, 'spara behovet');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: TALENT_NEEDS,
    record_id: need.id,
    field: 'content',
    after_value: auditNeed({ ...need, ...v.value, status: nextStatus })
  });
  if (nextStatus === 'pending_review' && need.status === 'published') {
    const startup = await loadStartup(pb, actor, need.startup);
    await notifyReviewers(pb, actor, { ...need, ...v.value, status: nextStatus }, startup?.coaches ?? []);
  }
  return ok({
    needId: need.id,
    status: nextStatus,
    path: talentNeedPath(need, party),
    warning: nextStatus !== need.status ? 'Behovet är ändrat och granskas av Movexum igen innan det syns för studenter.' : undefined
  });
}

/** Statusbyte: bolaget skickar till granskning/pausar/avslutar; Movexum publicerar, pausar, skickar tillbaka. */
export async function setTalentNeedStatus(
  pb: PocketBase,
  actor: Actor,
  access: TalentAccess,
  needId: string,
  to: TalentNeedStatus,
  opts: { note?: string } = {}
): Promise<WriteResult<TalentNeedResult>> {
  const loaded = await loadNeedForActor(pb, actor, access, needId);
  if (isFail(loaded)) return loaded;
  const { need, party } = loaded;
  const p = canWriteField(actor, TALENT_NEEDS, 'status');
  if (!p.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', p.reason ?? 'Nekat.');
  const by = party === 'staff' ? 'staff' : 'company';
  if (!canTransitionNeed(need.status, to, by)) {
    return fail('STATE_TRANSITION', `Kan inte gå från "${TALENT_NEED_STATUS_LABELS[need.status]}" till "${TALENT_NEED_STATUS_LABELS[to]}".`);
  }
  const note = cleanTalentText(opts.note, TALENT_REVIEW_NOTE_MAX);
  const patch: Record<string, unknown> = { status: to };
  if (party === 'staff') {
    patch.reviewed_by = actor.id;
    if (note || to === 'draft') patch.review_note = note;
    if (to === 'published') patch.published_at = new Date().toISOString();
  }
  try {
    await writeWithFallback(pb, (client) => client.collection(TALENT_NEEDS).update(need.id, patch), { fallbackOn404: true });
  } catch (err) {
    return dbFail(err, 'ändra status på behovet');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: TALENT_NEEDS,
    record_id: need.id,
    field: 'status',
    before_value: need.status,
    after_value: auditNeed({ ...need, status: to })
  });
  const startup = await loadStartup(pb, actor, need.startup);
  if (to === 'pending_review') {
    await notifyReviewers(pb, actor, { ...need, status: to }, startup?.coaches ?? []);
  } else if (party === 'staff' && (to === 'published' || to === 'draft' || to === 'paused' || to === 'closed')) {
    const label =
      to === 'published'
        ? 'publicerat för studenter'
        : to === 'draft'
          ? 'skickat tillbaka av Movexum'
          : to === 'paused'
            ? 'pausat av Movexum'
            : 'avslutat av Movexum';
    await notifyStartupMembers(pb, {
      tenant: actor.tenant,
      startupId: need.startup,
      kind: 'talent_need_published',
      actorId: actor.id,
      entity: { type: 'talent_need', id: need.id },
      payload: {
        title: `Ert behov "${need.title}" är ${label}`,
        snippet: note || undefined,
        href: `/min-oversikt/talang/${need.id}`
      }
    }).catch(() => undefined);
  }
  return ok({ needId: need.id, status: to, path: talentNeedPath(need, party) });
}

export async function deleteTalentNeed(
  pb: PocketBase,
  actor: Actor,
  access: TalentAccess,
  needId: string
): Promise<WriteResult<{ title: string }>> {
  const loaded = await loadNeedForActor(pb, actor, access, needId);
  if (isFail(loaded)) return loaded;
  const { need, party } = loaded;
  if (party === 'company' && need.status !== 'draft') {
    return fail('STATE_TRANSITION', 'Bara utkast kan tas bort — avsluta behovet i stället.');
  }
  try {
    await writeWithFallback(pb, (client) => client.collection(TALENT_NEEDS).delete(need.id), { fallbackOn404: true });
  } catch (err) {
    return dbFail(err, 'ta bort behovet');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: TALENT_NEEDS,
    record_id: need.id,
    after_value: auditNeed(need, { deleted: true })
  });
  return ok({ title: need.title });
}

// ── Intressen (bolag/Movexum) ───────────────────────────────────────────────

export interface InterestResult {
  interestId: string;
  status: TalentInterestStatus;
  needId: string;
  path: string;
}

async function loadActiveStudent(tenant: string, studentId: string): Promise<StudentProfileRow | null> {
  if (!isTalentId(studentId)) return null;
  const su = await getSuperuserPb();
  if (!su.ok) return null;
  const s = await getStudent(su.pb, tenant, studentId);
  return s && s.status === 'active' ? s : null;
}

/**
 * Föreslår en SÖKBAR student för ett publicerat behov (bolaget eller Movexum).
 * Studenten får ett mejl och avgör själv; bolaget ser namn/kontakt först
 * efter ett ja (människa-i-loopen, GDPR § 5).
 */
export async function proposeStudentForNeed(
  pb: PocketBase,
  actor: Actor,
  access: TalentAccess,
  needId: string,
  studentId: string,
  opts: { message?: string; origin: string; tenantSlug: string }
): Promise<WriteResult<InterestResult>> {
  const policy = canCreateRecord(actor, TALENT_INTERESTS);
  if (!policy.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', policy.reason ?? 'Nekat.');
  const loaded = await loadNeedForActor(pb, actor, access, needId);
  if (isFail(loaded)) return loaded;
  const { need, party } = loaded;
  if (need.status !== 'published') return fail('STATE_TRANSITION', 'Bara publicerade behov kan föreslås för studenter.');
  const student = await loadActiveStudent(actor.tenant, studentId);
  if (!student || !student.searchable) return fail('NOT_FOUND', 'Studenten är inte sökbar längre.');
  if (!isEmailConfigured()) return fail('DB_ERROR', 'E-posttjänsten är inte konfigurerad — förslaget kan inte skickas till studenten.');
  const su = await getSuperuserPb();
  if (!su.ok) return fail('DB_ERROR', 'Kunde inte skapa förslaget (superuser saknas).');
  const message = cleanTalentText(opts.message, TALENT_MESSAGE_MAX);
  const now = new Date().toISOString();
  let created: { id: string };
  try {
    created = await su.pb.collection(TALENT_INTERESTS).create<{ id: string }>({
      tenant: actor.tenant,
      need: need.id,
      student: student.id,
      startup: need.startup,
      status: 'proposed',
      initiated_by: party === 'staff' ? 'staff' : 'company',
      message,
      status_changed_at: now,
      changed_by: actor.id,
      created_by: actor.id
    });
  } catch (err) {
    if (statusOf(err) === 400) return fail('INVALID_VALUE', 'Studenten har redan ett intresse på det här behovet.');
    return dbFail(err, 'skapa förslaget');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: TALENT_INTERESTS,
    record_id: created.id,
    after_value: { need_title: need.title, status: 'proposed', initiated_by: party, startup_name: need.startupName ?? undefined }
  });
  const url = `${opts.origin}/s/${encodeURIComponent(opts.tenantSlug)}/jag`;
  const company = need.anonymous ? 'Ett bolag i inkubatorn' : need.startupName ?? 'Ett bolag i inkubatorn';
  try {
    await sendStudentEmail(student.email, {
      subject: `Ett bolag vill gärna höra av sig: ${need.title}`,
      eyebrow: 'Förslag',
      heading: `${company} tror att du passar för "${need.title}"`,
      intro: `${TALENT_NEED_KIND_LABELS[need.kind]} · ${need.scope || 'omfattning enligt överenskommelse'}. Bolaget ser inte ditt namn eller dina kontaktuppgifter förrän du tackar ja.`,
      lines: message ? [`Hälsning från bolaget: ${message}`] : [],
      cta: { label: 'Se förslaget och svara', url }
    });
  } catch {
    // Förslaget finns kvar — studenten ser det på sin sida vid nästa inloggning.
  }
  return ok({ interestId: created.id, status: 'proposed', needId: need.id, path: talentNeedPath(need, party) });
}

async function loadInterestForActor(
  pb: PocketBase,
  actor: Actor,
  access: TalentAccess,
  interestId: string
): Promise<{ interest: TalentInterestRow; need: TalentNeedRow; party: ActorParty } | WriteResult<never>> {
  if (!isTalentId(interestId)) return fail('NOT_FOUND', 'Ogiltigt intresse.');
  let interest = await getInterest(pb, actor.tenant, interestId);
  if (!interest) {
    const su = await getSuperuserPb();
    if (su.ok) interest = await getInterest(su.pb, actor.tenant, interestId);
  }
  if (!interest) return fail('NOT_FOUND', 'Intresset hittades inte i din organisation.');
  const need = await getNeedWithFallback(pb, actor.tenant, interest.need);
  if (!need || need.startup !== interest.startup) return fail('NOT_FOUND', 'Behovet hittades inte.');
  const party = partyFor(actor, interest.startup, access);
  if (!party) return fail('FORBIDDEN', 'Du har inte tillgång till det här intresset.');
  return { interest, need, party };
}

function isFailI<T>(v: WriteResult<T> | { interest: TalentInterestRow }): v is WriteResult<never> {
  return 'ok' in v;
}

/** Bolaget/Movexum flyttar ett intresse (dialog, matchad, avböjd …) och sätter ev. utfall. */
export async function setInterestStatus(
  pb: PocketBase,
  actor: Actor,
  access: TalentAccess,
  interestId: string,
  to: unknown,
  opts: { outcome?: unknown; outcomeNote?: unknown; companyNote?: unknown } = {}
): Promise<WriteResult<InterestResult>> {
  if (!isTalentInterestStatus(to)) return fail('INVALID_VALUE', 'Okänd status.');
  const loaded = await loadInterestForActor(pb, actor, access, interestId);
  if (isFailI(loaded)) return loaded;
  const { interest, need, party } = loaded;
  const p = canWriteField(actor, TALENT_INTERESTS, 'status');
  if (!p.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', p.reason ?? 'Nekat.');
  const by: TalentParty = party === 'staff' ? 'staff' : 'company';
  if (!canTransitionInterest(interest.status, to, by)) {
    return fail('STATE_TRANSITION', `Kan inte gå från "${TALENT_INTEREST_STATUS_LABELS[interest.status]}" till "${TALENT_INTEREST_STATUS_LABELS[to]}".`);
  }
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: to, status_changed_at: now, changed_by: actor.id };
  if (opts.companyNote !== undefined) patch.company_note = cleanTalentText(opts.companyNote, TALENT_MESSAGE_MAX);
  if (isTalentOutcome(opts.outcome)) {
    patch.outcome = opts.outcome;
    patch.outcome_note = cleanTalentText(opts.outcomeNote, TALENT_OUTCOME_NOTE_MAX);
    patch.outcome_at = now;
  }
  try {
    await writeWithFallback(pb, (client) => client.collection(TALENT_INTERESTS).update(interest.id, patch), { fallbackOn404: true });
  } catch (err) {
    return dbFail(err, 'ändra status på intresset');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: TALENT_INTERESTS,
    record_id: interest.id,
    field: 'status',
    before_value: interest.status,
    after_value: {
      need_title: need.title,
      status: to,
      startup_name: need.startupName ?? undefined,
      outcome: isTalentOutcome(opts.outcome) ? opts.outcome : undefined
    }
  });
  if (to === 'matched' && interest.status !== 'matched') {
    // Syns på bolagskortet och i Bolagsnytt — utan studentens namn (PII).
    await recordActivity(pb, {
      tenant: actor.tenant,
      startup: need.startup,
      kind: 'manual',
      actor: actor.id,
      title: `Matchad med student: ${need.title}`,
      meta: TALENT_NEED_KIND_LABELS[need.kind]
    });
  }
  // Studenten får besked om beslut (match/avböjt) — aldrig om interna statusbyten.
  if (to === 'matched' || to === 'declined') {
    const student = await loadActiveStudent(actor.tenant, interest.student);
    if (student && isEmailConfigured()) {
      const company = need.anonymous ? 'Bolaget' : need.startupName ?? 'Bolaget';
      await sendStudentEmail(student.email, {
        subject: to === 'matched' ? `Ni är matchade: ${need.title}` : `Besked om "${need.title}"`,
        eyebrow: 'Besked',
        heading:
          to === 'matched'
            ? `${company} har markerat er som matchade`
            : `${company} går vidare utan dig den här gången`,
        intro:
          to === 'matched'
            ? 'Grattis! Bolaget räknar med att ni går vidare tillsammans. Hör av dig till bolaget om ni inte redan har kontakt.'
            : 'Tack för ditt intresse. Din profil finns kvar och kan matchas mot andra behov.',
        cta: { label: 'Till min sida', url: `${(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '')}/s/${encodeURIComponent(await tenantSlug(actor.tenant))}/jag` }
      }).catch(() => undefined);
    }
  }
  return ok({ interestId: interest.id, status: to, needId: need.id, path: talentNeedPath(need, party) });
}

async function tenantSlug(tenantId: string): Promise<string> {
  const su = await getSuperuserPb();
  if (!su.ok) return '';
  try {
    const t = await su.pb.collection('tenants').getOne<{ slug?: string }>(tenantId, { fields: 'slug' });
    return t.slug ?? '';
  } catch {
    return '';
  }
}

// ── Studentprofiler (Movexum) ───────────────────────────────────────────────

/** Movexum pausar/aktiverar/avregistrerar en profil (t.ex. på studentens begäran per mejl). */
export async function setStudentProfileStatus(
  pb: PocketBase,
  actor: Actor,
  studentId: string,
  to: unknown
): Promise<WriteResult<{ status: StudentProfileStatus }>> {
  if (!isStudentProfileStatus(to) || to === 'pending') return fail('INVALID_VALUE', 'Okänd status.');
  const p = canWriteField(actor, STUDENT_PROFILES, 'status');
  if (!p.ok) return fail(actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN', p.reason ?? 'Nekat.');
  const student = isTalentId(studentId) ? await getStudent(pb, actor.tenant, studentId) : null;
  if (!student) return fail('NOT_FOUND', 'Studenten hittades inte.');
  try {
    await writeWithFallback(pb, (client) => client.collection(STUDENT_PROFILES).update(student.id, { status: to, searchable: to === 'active' ? student.searchable : false }), {
      fallbackOn404: true
    });
  } catch (err) {
    return dbFail(err, 'ändra studentens status');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: STUDENT_PROFILES,
    record_id: student.id,
    field: 'status',
    before_value: student.status,
    after_value: { status: to }
  });
  return ok({ status: to });
}

/** Ledningen raderar en profil helt (GDPR art. 17) — intressen kaskadraderas. */
export async function deleteStudentProfile(pb: PocketBase, actor: Actor, studentId: string): Promise<WriteResult<void>> {
  if (!isLead(actor)) return fail('FORBIDDEN', 'Bara ledningen kan ta bort en studentprofil.');
  const student = isTalentId(studentId) ? await getStudent(pb, actor.tenant, studentId) : null;
  if (!student) return fail('NOT_FOUND', 'Studenten hittades inte.');
  try {
    await writeWithFallback(pb, (client) => client.collection(STUDENT_PROFILES).delete(student.id), { fallbackOn404: true });
  } catch (err) {
    return dbFail(err, 'ta bort profilen');
  }
  await logAgentAction(pb, {
    actor,
    action_type: 'update',
    collection: STUDENT_PROFILES,
    record_id: student.id,
    after_value: { deleted: true }
  });
  return ok(undefined);
}

export { TALENT_OUTCOME_LABELS };
