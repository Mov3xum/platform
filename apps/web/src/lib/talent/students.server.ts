import 'server-only';
import type PocketBase from 'pocketbase';
import {
  TALENT_MESSAGE_MAX,
  TALENT_NEED_KIND_LABELS,
  canTransitionInterest,
  cleanEmail,
  cleanTalentText,
  isTalentId,
  studentProfileExpiresAt,
  validateStudentProfileInput,
  type StudentProfileInput,
  type TalentInterestStatus
} from '@platform/shared';
import { isEmailConfigured, sendStudentEmail } from '@/lib/email';
import { notify, notifyStartupMembers } from '@/lib/notifications-server';
import { STUDENT_PROFILES, TALENT_INTERESTS, getInterest, getNeed, listInterests, normalizeStudent, type StudentProfileRow, type TalentInterestRow } from './data';
import { hashStudentToken, newStudentToken, studentLinkExpiry } from './student-session';
import type { ResolvedTalentTenant } from './public';

/**
 * Studentens EGNA skrivningar (CLAUDE.md § 54) — anropade från de publika
 * routerna under /api/public/s/<tenant>/… med superuser-klienten ur
 * `resolveTalentTenant`. Ingen Actor: studenten är en privatperson utan
 * konto. Varje funktion tar profilen som redan verifierats ur sessionen
 * (`loadStudentSession`) och skriver BARA på den profilen och dess egna
 * intressen, alltid inom tenanten.
 *
 * - Registrering/inloggning svarar alltid likadant ("kolla din e-post") så
 *   att adresser inte kan räknas upp. Bara hashen av engångstoken lagras.
 * - Samtycket stämplas (`consent_at`) och sätter gallringen (`expires_at`).
 * - Audit: `agent_actions` kräver en inloggad aktör — studentens handlingar
 *   syns i stället som notiser till bolaget/Movexum och i intressets fält.
 */

type Result<T = void> = { ok: true; value: T } | { ok: false; error: string; status?: number };

function okr<T>(value: T): Result<T> {
  return { ok: true, value };
}
function err<T>(error: string, status = 400): Result<T> {
  return { ok: false, error, status };
}

const GENERIC_LINK_NOTICE = 'Om adressen finns registrerad har vi skickat en inloggningslänk till den. Länken gäller i 30 minuter.';

function jagUrl(origin: string, slug: string, token?: string): string {
  const base = `${origin}/s/${encodeURIComponent(slug)}/jag`;
  return token ? `${base}?t=${encodeURIComponent(token)}` : base;
}

async function findByEmail(pb: PocketBase, tenant: string, email: string): Promise<StudentProfileRow | null> {
  try {
    const raw = await pb
      .collection(STUDENT_PROFILES)
      .getFirstListItem<Record<string, unknown>>(pb.filter('tenant = {:tenant} && email = {:email}', { tenant, email }));
    return normalizeStudent(raw);
  } catch {
    return null;
  }
}

async function issueLink(pb: PocketBase, profileId: string): Promise<string> {
  const token = newStudentToken();
  await pb.collection(STUDENT_PROFILES).update(profileId, {
    access_token_hash: hashStudentToken(token),
    token_expires_at: studentLinkExpiry().toISOString()
  });
  return token;
}

async function sendLink(profile: StudentProfileRow, token: string, origin: string, slug: string, firstTime: boolean): Promise<void> {
  await sendStudentEmail(profile.email, {
    subject: firstTime ? 'Bekräfta din studentprofil hos Movexum' : 'Din inloggningslänk till Movexum',
    eyebrow: 'Studenter & talang',
    heading: firstTime ? `Hej ${profile.first_name} — bekräfta din e-post` : `Hej ${profile.first_name}`,
    intro: firstTime
      ? 'Tryck på knappen för att bekräfta din adress och aktivera din profil. Först då kan bolag i inkubatorn se den (anonymt, tills du själv tar kontakt).'
      : 'Här är din inloggningslänk. Den gäller i 30 minuter och kan bara användas från den här webbläsaren.',
    cta: { label: firstTime ? 'Bekräfta och öppna min sida' : 'Öppna min sida', url: jagUrl(origin, slug, token) },
    footer: 'Om du inte registrerat dig hos Movexum kan du ignorera det här mejlet — ingen profil aktiveras utan den här bekräftelsen.'
  });
}

/**
 * Registrerar en profil (status `pending` tills e-posten bekräftats). Finns
 * adressen redan skickas en inloggningslänk i stället — svaret är detsamma.
 */
export async function registerStudent(
  resolved: ResolvedTalentTenant,
  input: Record<string, unknown>,
  opts: { origin: string; consent: boolean }
): Promise<Result<{ notice: string }>> {
  if (!opts.consent) return err('Du behöver godkänna hur dina uppgifter används för att registrera dig.');
  const v = validateStudentProfileInput(input);
  if (!v.ok) return err(v.error);
  if (!isEmailConfigured()) return err('Registreringen är inte öppen just nu (e-posttjänsten saknas). Försök igen senare.', 503);
  const { pb, tenant } = resolved;
  const existing = await findByEmail(pb, tenant.id, v.value.email);
  try {
    if (existing) {
      if (existing.status === 'withdrawn') {
        // Återregistrering efter avregistrering: ny profil med nytt samtycke.
        const consentAt = new Date();
        await pb.collection(STUDENT_PROFILES).update(existing.id, {
          ...profilePayload(v.value),
          status: 'pending',
          consent_at: consentAt.toISOString(),
          expires_at: studentProfileExpiresAt(consentAt).toISOString(),
          verified_at: null
        });
        const token = await issueLink(pb, existing.id);
        await sendLink({ ...existing, ...v.value }, token, opts.origin, tenant.slug, true);
      } else {
        const token = await issueLink(pb, existing.id);
        await sendLink(existing, token, opts.origin, tenant.slug, existing.status === 'pending');
      }
      return okr({ notice: GENERIC_LINK_NOTICE });
    }
    const consentAt = new Date();
    const created = await pb.collection(STUDENT_PROFILES).create<Record<string, unknown>>({
      tenant: tenant.id,
      ...profilePayload(v.value),
      status: 'pending',
      consent_at: consentAt.toISOString(),
      expires_at: studentProfileExpiresAt(consentAt).toISOString()
    });
    const profile = normalizeStudent(created);
    const token = await issueLink(pb, profile.id);
    await sendLink(profile, token, opts.origin, tenant.slug, true);
    return okr({ notice: GENERIC_LINK_NOTICE });
  } catch (e) {
    const status = (e as { status?: number })?.status;
    console.error('[talent] register failed', { status });
    if (status === 404) return err('Studentsidan är inte aktiverad än — kontakta Movexum.', 503);
    return err('Registreringen kunde inte slutföras just nu. Försök igen om en stund.', 500);
  }
}

function profilePayload(v: StudentProfileInput): Record<string, unknown> {
  return {
    first_name: v.first_name,
    last_name: v.last_name,
    email: v.email,
    university: v.university,
    program: v.program,
    level: v.level,
    graduation_year: v.graduation_year,
    tags: v.tags,
    seeking: v.seeking,
    available_from: v.available_from,
    location: v.location,
    remote_ok: v.remote_ok,
    summary: v.summary,
    linkedin_url: v.linkedin_url,
    searchable: v.searchable
  };
}

/** Skickar en ny inloggningslänk. Svaret avslöjar aldrig om adressen finns. */
export async function requestStudentLink(resolved: ResolvedTalentTenant, emailRaw: unknown, origin: string): Promise<Result<{ notice: string }>> {
  const email = cleanEmail(emailRaw);
  if (!email) return err('Ange en giltig e-postadress.');
  if (!isEmailConfigured()) return err('Inloggning är inte möjlig just nu (e-posttjänsten saknas).', 503);
  const profile = await findByEmail(resolved.pb, resolved.tenant.id, email);
  if (profile && profile.status !== 'withdrawn') {
    try {
      const token = await issueLink(resolved.pb, profile.id);
      await sendLink(profile, token, origin, resolved.tenant.slug, profile.status === 'pending');
    } catch {
      /* samma svar oavsett */
    }
  }
  return okr({ notice: GENERIC_LINK_NOTICE });
}

/** Växlar en engångstoken mot profilen: bekräftar e-posten, aktiverar och förbrukar tokenen. */
export async function exchangeStudentToken(resolved: ResolvedTalentTenant, token: string): Promise<StudentProfileRow | null> {
  const { pb, tenant } = resolved;
  let raw: Record<string, unknown>;
  try {
    raw = await pb
      .collection(STUDENT_PROFILES)
      .getFirstListItem<Record<string, unknown>>(pb.filter('tenant = {:tenant} && access_token_hash = {:h}', { tenant: tenant.id, h: hashStudentToken(token) }));
  } catch {
    return null;
  }
  const profile = normalizeStudent(raw);
  const exp = typeof raw.token_expires_at === 'string' ? Date.parse(raw.token_expires_at) : NaN;
  if (!Number.isFinite(exp) || exp < Date.now() || profile.status === 'withdrawn') return null;
  const now = new Date().toISOString();
  try {
    const updated = await pb.collection(STUDENT_PROFILES).update<Record<string, unknown>>(profile.id, {
      access_token_hash: '',
      token_expires_at: null,
      verified_at: profile.verified_at ?? now,
      last_active_at: now,
      ...(profile.status === 'pending' ? { status: 'active' } : {})
    });
    return normalizeStudent(updated);
  } catch {
    return null;
  }
}

/** Studenten uppdaterar sin profil. E-posten är låst (den är identiteten). */
export async function updateStudentProfile(
  resolved: ResolvedTalentTenant,
  profile: StudentProfileRow,
  input: Record<string, unknown>
): Promise<Result<StudentProfileRow>> {
  const v = validateStudentProfileInput({ ...input, email: profile.email });
  if (!v.ok) return err(v.error);
  try {
    const updated = await resolved.pb
      .collection(STUDENT_PROFILES)
      .update<Record<string, unknown>>(profile.id, { ...profilePayload(v.value), last_active_at: new Date().toISOString() });
    return okr(normalizeStudent(updated));
  } catch {
    return err('Profilen kunde inte sparas just nu.', 500);
  }
}

/** Pausa (osynlig för bolag, intressen kvar) eller aktivera igen; förläng samtycket ett år. */
export async function setStudentSelfStatus(
  resolved: ResolvedTalentTenant,
  profile: StudentProfileRow,
  action: 'pause' | 'resume' | 'extend'
): Promise<Result<void>> {
  const patch: Record<string, unknown> =
    action === 'pause'
      ? { status: 'paused', searchable: false }
      : action === 'resume'
        ? { status: 'active' }
        : { consent_at: new Date().toISOString(), expires_at: studentProfileExpiresAt(new Date()).toISOString() };
  try {
    await resolved.pb.collection(STUDENT_PROFILES).update(profile.id, patch);
    return okr(undefined);
  } catch {
    return err('Ändringen kunde inte sparas just nu.', 500);
  }
}

/** Tar bort profilen helt (GDPR art. 17). Intressen kaskadraderas. */
export async function deleteOwnStudentProfile(resolved: ResolvedTalentTenant, profile: StudentProfileRow): Promise<Result<void>> {
  try {
    await resolved.pb.collection(STUDENT_PROFILES).delete(profile.id);
    return okr(undefined);
  } catch {
    return err('Profilen kunde inte tas bort just nu.', 500);
  }
}

async function notifyCompanyAboutInterest(
  resolved: ResolvedTalentTenant,
  interest: TalentInterestRow,
  needTitle: string,
  kindLabel: string,
  kind: 'talent_interest' | 'talent_student_response',
  title: string
): Promise<void> {
  const { pb, tenant } = resolved;
  const href = `/min-oversikt/talang/${interest.need}`;
  await notifyStartupMembers(pb, {
    tenant: tenant.id,
    startupId: interest.startup,
    kind,
    entity: { type: 'talent_need', id: interest.need },
    payload: { title, snippet: `${needTitle} · ${kindLabel}`, href }
  }).catch(() => undefined);
  // Den som skickade förslaget (coach/bolag) får svaret — även när det inte är en bolagsmedlem.
  if (interest.created_by && kind === 'talent_student_response') {
    await notify(pb, {
      tenant: tenant.id,
      recipients: [interest.created_by],
      kind,
      entity: { type: 'talent_need', id: interest.need },
      payload: { title, snippet: `${needTitle} · ${kindLabel}`, href: `/talang/behov/${interest.need}` }
    }).catch(() => undefined);
  }
}

/** Studenten söker ett publicerat behov (eller tackar ja till ett förslag på samma behov). */
export async function applyToNeed(
  resolved: ResolvedTalentTenant,
  profile: StudentProfileRow,
  needId: string,
  messageRaw: unknown
): Promise<Result<{ status: TalentInterestStatus }>> {
  if (profile.status !== 'active') return err('Bekräfta din e-post och aktivera profilen innan du söker.');
  if (!isTalentId(needId)) return err('Ogiltigt behov.');
  const { pb, tenant } = resolved;
  const need = await getNeed(pb, tenant.id, needId);
  if (!need || need.status !== 'published') return err('Behovet är inte öppet för ansökningar längre.', 404);
  const message = cleanTalentText(messageRaw, TALENT_MESSAGE_MAX);
  const now = new Date().toISOString();
  const existing = await listInterests(pb, tenant.id, { need: need.id, student: profile.id });
  const current = existing.items[0];
  try {
    if (current) {
      if (current.status === 'proposed') {
        await pb.collection(TALENT_INTERESTS).update(current.id, { status: 'new', responded_at: now, status_changed_at: now, ...(message ? { message } : {}) });
        await notifyCompanyAboutInterest(resolved, { ...current, status: 'new' }, need.title, TALENT_NEED_KIND_LABELS[need.kind], 'talent_student_response', 'En student tackade ja till ert förslag');
        return okr({ status: 'new' });
      }
      if (current.status === 'withdrawn' || current.status === 'declined') {
        await pb.collection(TALENT_INTERESTS).update(current.id, { status: 'new', initiated_by: 'student', message, status_changed_at: now, responded_at: now });
        await notifyCompanyAboutInterest(resolved, { ...current, status: 'new' }, need.title, TALENT_NEED_KIND_LABELS[need.kind], 'talent_interest', 'Ny intresseanmälan från en student');
        return okr({ status: 'new' });
      }
      return okr({ status: current.status });
    }
    const created = await pb.collection(TALENT_INTERESTS).create<Record<string, unknown>>({
      tenant: tenant.id,
      need: need.id,
      student: profile.id,
      startup: need.startup,
      status: 'new',
      initiated_by: 'student',
      message,
      status_changed_at: now,
      responded_at: now
    });
    const interest: TalentInterestRow = {
      id: String(created.id),
      tenant: tenant.id,
      need: need.id,
      student: profile.id,
      startup: need.startup,
      status: 'new',
      initiated_by: 'student',
      message,
      company_note: '',
      outcome: null,
      outcome_note: '',
      outcome_at: null,
      responded_at: now,
      status_changed_at: now,
      changed_by: null,
      created_by: null,
      created: now,
      updated: now
    };
    await notifyCompanyAboutInterest(resolved, interest, need.title, TALENT_NEED_KIND_LABELS[need.kind], 'talent_interest', 'Ny intresseanmälan från en student');
    await pb.collection(STUDENT_PROFILES).update(profile.id, { last_active_at: now }).catch(() => undefined);
    return okr({ status: 'new' });
  } catch (e) {
    console.error('[talent] apply failed', { status: (e as { status?: number })?.status });
    return err('Intresseanmälan kunde inte sparas just nu.', 500);
  }
}

/** Studenten svarar på ett förslag (ja ⇒ `new`, nej ⇒ `declined`) eller drar tillbaka sitt intresse. */
export async function respondToInterest(
  resolved: ResolvedTalentTenant,
  profile: StudentProfileRow,
  interestId: string,
  answer: 'accept' | 'decline' | 'withdraw'
): Promise<Result<{ status: TalentInterestStatus }>> {
  if (!isTalentId(interestId)) return err('Ogiltigt intresse.');
  const { pb, tenant } = resolved;
  const interest = await getInterest(pb, tenant.id, interestId);
  if (!interest || interest.student !== profile.id) return err('Intresset hittades inte.', 404);
  const to: TalentInterestStatus = answer === 'accept' ? 'new' : answer === 'decline' ? 'declined' : 'withdrawn';
  if (!canTransitionInterest(interest.status, to, 'student')) return err('Det går inte att ändra det här svaret längre.');
  const now = new Date().toISOString();
  try {
    await pb.collection(TALENT_INTERESTS).update(interest.id, { status: to, responded_at: now, status_changed_at: now });
  } catch {
    return err('Svaret kunde inte sparas just nu.', 500);
  }
  const need = await getNeed(pb, tenant.id, interest.need);
  const kindLabel = need ? TALENT_NEED_KIND_LABELS[need.kind] : '';
  await notifyCompanyAboutInterest(
    resolved,
    { ...interest, status: to },
    need?.title ?? 'Behov',
    kindLabel,
    'talent_student_response',
    to === 'new' ? 'En student tackade ja till ert förslag' : to === 'declined' ? 'En student tackade nej till ert förslag' : 'En student drog tillbaka sitt intresse'
  );
  return okr({ status: to });
}
