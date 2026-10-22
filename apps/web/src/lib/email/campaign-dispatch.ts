import 'server-only';
import { randomBytes } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  EMAIL_SAMPLE_MERGE,
  blocksNeedSignup,
  eventGroupMatches,
  blocksNeedEvent,
  emailBlockedReason,
  emailReasonText,
  formatStockholmDateTime,
  normalizeEmailAddress,
  renderCampaignEmail,
  renderMergeFields,
  rsvpOpen,
  type EmailMergeData,
  type EmailRecipientStatus,
  type InviteReason
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { listUnsubscribeHeaders, resolveReplyTo, resolveSender, senderAddress } from '@/lib/mail-sender';
import { EMAIL_NOT_CONFIGURED_MESSAGE, isEmailConfigured } from '@/lib/email';
import { loadInviteUsers, loadStartupReach, type InviteUser, type StartupReach } from '@/lib/events/invite-candidates';
import { recomputeEventCounters } from '@/lib/events/counters';
import { hashRsvpToken } from '@/lib/core/write/event-invitations';
import { logAgentAction } from '@/lib/core/write/audit';
import { signUnsubscribeSubject, unsubscribeSecret, type UnsubscribeSubject } from '@/lib/unsubscribe-key';
import { LockTimeoutError, withDistributedLock } from '@/lib/distributed-lock';
import { CAMPAIGNS, CAMPAIGN_RECIPIENTS, getCampaign, normalizeCampaign, type CampaignRow } from './campaign-data';
import { sendEmailBatch, sendOne, type OutgoingEmail } from './send-batch';
import { emailLinkSecret, hashEmail, signCalendarKey, signClickToken } from './signed-tokens';
import { loadSuppressedHashes } from './suppression';

/**
 * Utskickskärnan för kampanjer (CLAUDE.md § 55.4) — delad av "Skicka nu"
 * och cron-vägen (`/api/internal/send-campaign`). Körs med superusern (cron
 * saknar session), så tenant-likhet mellan kampanj, event och mottagare
 * verifieras uttryckligen.
 *
 * Ordning: lås per kampanj → mottagare ur urvalet (kontakter, användare,
 * bolag) → spärrlista + mottagarens val + samtycke → mottagarrader
 * (pending/suppressed) → ev. inbjudningsrader i eventets deltagarlista med
 * svarstoken → rendering per mottagare (platshållare, spårade länkar,
 * avregistrering) → Resend i batchar → rader + räknare + audit.
 *
 * Adresser lagras aldrig på kampanjen eller mottagarraden (bara SHA-256) och
 * loggas aldrig. Ett misslyckat mejl rullar inget tillbaka: raden får
 * `failed` + orsak och kan skickas igen.
 */

export type DispatchResult =
  | { ok: true; recipients: number; sent: number; failed: number; suppressed: number; failReason?: string }
  | { ok: false; error: string };

interface Candidate {
  key: string;
  /** `signup` = en rad i eventets deltagarlista som bara har e-post (manuellt tillagd gäst). */
  kind: 'contact' | 'user' | 'startup' | 'signup';
  email: string | null;
  name: string;
  firstName: string;
  organization: string;
  contact?: string;
  user?: string;
  startup?: string;
  /** Befintlig rad i eventets deltagarlista (när mottagaren kom ur eventgruppen). */
  signupId?: string;
  reason: InviteReason;
  blocked?: EmailRecipientStatus;
  blockedWhy?: string;
}

interface SignupRowX {
  id: string;
  stage?: string;
  invite_sent_at?: string;
  contact?: string;
  user?: string;
  startup?: string;
  email?: string;
  name?: string;
  organization?: string;
}

interface ContactRowX {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  organization?: string;
  invite_opt_out?: boolean;
  email_opt_out?: unknown;
  email_status?: string;
  newsletter_consent?: boolean;
}

const CHUNK = 40;
const CAMPAIGN_ROWS_HINT = 'Kör migration 1700000203 (eller workflowen "Sync PocketBase") om kampanjkollektionerna saknas eller har gammalt schema.';

function anyOf(pb: PocketBase, field: string, values: readonly string[]): string {
  const params: Record<string, string> = {};
  const parts = values.map((v, i) => {
    params[`v${i}`] = v;
    return `${field} = {:v${i}}`;
  });
  return pb.filter(`(${parts.join(' || ')})`, params);
}

async function loadContacts(pb: PocketBase, tenant: string, ids: readonly string[]): Promise<ContactRowX[]> {
  const out: ContactRowX[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    out.push(
      ...(await pb.collection('contacts').getFullList<ContactRowX>({
        filter: `${pb.filter('tenant = {:t}', { t: tenant })} && ${anyOf(pb, 'id', ids.slice(i, i + CHUNK))}`,
        fields: 'id,first_name,last_name,email,organization,invite_opt_out,email_opt_out,email_status,newsletter_consent'
      }))
    );
  }
  return out;
}

export const UNSUBSCRIBE_SECRET_MISSING =
  'Avregistreringslänkar kan inte skapas: sätt MOVEXUM_UNSUBSCRIBE_SECRET (eller MOVEXUM_INTEGRATION_KEY) på web-appen i Coolify. Inget skickades.';

/** Posten avregistreringslänken ska peka på — den adressen hämtades ur. */
function unsubscribeSubjectFor(c: Candidate): UnsubscribeSubject | null {
  if (c.contact) return { kind: 'contact', id: c.contact };
  if (c.user) return { kind: 'user', id: c.user };
  if (c.kind === 'startup' && c.startup) return { kind: 'startup', id: c.startup };
  if (c.kind === 'signup' && c.signupId) return { kind: 'signup', id: c.signupId };
  return null;
}

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** Mottagarna ur kampanjens urval — med skäl när någon inte får mejlet. */
export async function resolveCampaignCandidates(pb: PocketBase, campaign: CampaignRow): Promise<Candidate[]> {
  const contactIds: string[] = [];
  const userIds: string[] = [];
  const startupIds: string[] = [];
  for (const key of campaign.audience.keys) {
    const id = key.slice(2);
    if (key.startsWith('c:')) contactIds.push(id);
    else if (key.startsWith('u:')) userIds.push(id);
    else if (key.startsWith('s:')) startupIds.push(id);
  }
  const out: Candidate[] = [];
  const consentOnly = campaign.consent_mode === 'consent_only';

  const contactCandidate = (c: ContactRowX, startup?: string, org?: string): Candidate => {
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Kontakt';
    const email = normalizeEmailAddress(c.email);
    const why = emailBlockedReason(c, campaign.category, campaign.consent_mode);
    return {
      key: `c:${c.id}`,
      kind: 'contact',
      email,
      name,
      firstName: c.first_name?.trim() || firstNameOf(name),
      organization: org || c.organization || '',
      contact: c.id,
      ...(startup ? { startup } : {}),
      reason: 'contact',
      ...(why
        ? {
            blocked: why === 'status' ? 'suppressed' : why === 'opt_out' ? 'unsubscribed' : 'suppressed',
            blockedWhy: why === 'opt_out' ? 'Har avregistrerat sig från kategorin' : why === 'status' ? 'E-posten studsar eller är avregistrerad' : 'Saknar samtycke till nyhetsbrev'
          }
        : {})
    };
  };
  const userCandidate = (u: InviteUser, startup?: string, org?: string): Candidate => ({
    key: `u:${u.id}`,
    kind: 'user',
    email: normalizeEmailAddress(u.email),
    name: u.name,
    firstName: firstNameOf(u.name),
    organization: org || (u.kind === 'staff' ? 'Movexum' : u.startupName),
    user: u.id,
    ...(startup || u.startup ? { startup: startup || u.startup } : {}),
    reason: u.kind === 'staff' && !startup ? 'team' : 'program',
    ...(consentOnly ? { blocked: 'suppressed', blockedWhy: 'Utskicket kräver nyhetsbrevssamtycke — gäller bara kontakter' } : {})
  });

  if (contactIds.length > 0) for (const c of await loadContacts(pb, campaign.tenant, contactIds)) out.push(contactCandidate(c));
  if (userIds.length > 0) for (const u of await loadInviteUsers(pb, campaign.tenant, { ids: userIds })) out.push(userCandidate(u));
  if (startupIds.length > 0) {
    const reach: StartupReach[] = await loadStartupReach(pb, campaign.tenant, startupIds);
    for (const r of reach) {
      if (r.members.length > 0) {
        for (const m of r.members) {
          out.push({
            key: `u:${m.id}`,
            kind: 'user',
            email: normalizeEmailAddress(m.email),
            name: m.name,
            firstName: firstNameOf(m.name),
            organization: r.name,
            user: m.id,
            startup: r.id,
            reason: 'program',
            ...(consentOnly ? { blocked: 'suppressed', blockedWhy: 'Utskicket kräver nyhetsbrevssamtycke — gäller bara kontakter' } : {})
          });
        }
      } else if (r.primaryContacts.length > 0) {
        const full = await loadContacts(pb, campaign.tenant, r.primaryContacts.map((c) => c.id));
        for (const c of full) out.push(contactCandidate(c, r.id, r.name));
      } else if (r.companyEmail) {
        out.push({
          key: `s:${r.id}`,
          kind: 'startup',
          email: normalizeEmailAddress(r.companyEmail),
          name: r.name,
          firstName: '',
          organization: r.name,
          startup: r.id,
          reason: 'program',
          ...(consentOnly ? { blocked: 'suppressed', blockedWhy: 'Utskicket kräver nyhetsbrevssamtycke — gäller bara kontakter' } : {})
        });
      }
    }
  }

  // Eventets deltagarlista som grupp (§ 55.3): samma rader som svaren, närvaron
  // och målen bygger på. Kontakter/användare berikas ur sina poster (status,
  // samtycke, avregistrering gäller); en rad med bara e-post blir mottagare
  // ändå (`e:<signup>`), så en manuellt tillagd gäst aldrig faller bort.
  if (campaign.audience.event_group && campaign.event) {
    const rows = await pb.collection('event_signups').getFullList<SignupRowX>({
      filter: pb.filter('tenant = {:t} && event = {:e}', { t: campaign.tenant, e: campaign.event }),
      fields: 'id,stage,invite_sent_at,contact,user,startup,email,name,organization'
    });
    const group = campaign.audience.event_group;
    const inGroup = rows.filter((r) => eventGroupMatches(group, r));
    const byContact = new Map<string, SignupRowX>();
    const byUser = new Map<string, SignupRowX>();
    const emailOnly: SignupRowX[] = [];
    for (const r of inGroup) {
      if (r.contact) byContact.set(r.contact, r);
      else if (r.user) byUser.set(r.user, r);
      else if (r.email) emailOnly.push(r);
    }
    if (byContact.size > 0) {
      for (const c of await loadContacts(pb, campaign.tenant, [...byContact.keys()])) {
        const row = byContact.get(c.id)!;
        out.push({ ...contactCandidate(c, row.startup, row.organization), signupId: row.id });
      }
    }
    if (byUser.size > 0) {
      for (const u of await loadInviteUsers(pb, campaign.tenant, { ids: [...byUser.keys()] })) {
        const row = byUser.get(u.id)!;
        out.push({ ...userCandidate(u, row.startup, row.organization), signupId: row.id });
      }
    }
    for (const r of emailOnly) {
      const name = (r.name || '').trim() || 'Gäst';
      out.push({
        key: `e:${r.id}`,
        kind: 'signup',
        email: normalizeEmailAddress(r.email),
        name,
        firstName: firstNameOf(name),
        organization: r.organization || '',
        ...(r.startup ? { startup: r.startup } : {}),
        signupId: r.id,
        reason: r.startup ? 'program' : 'contact',
        ...(consentOnly ? { blocked: 'suppressed', blockedWhy: 'Utskicket kräver nyhetsbrevssamtycke — gäller bara kontakter' } : {})
      });
    }
  }

  // Dubbletter på adress eller samma person via olika vägar: första vinner.
  const seenEmail = new Set<string>();
  const seenKey = new Set<string>();
  const unique: Candidate[] = [];
  for (const c of out) {
    if (seenKey.has(c.key)) continue;
    seenKey.add(c.key);
    if (!c.email) {
      unique.push({ ...c, blocked: 'failed', blockedWhy: 'Saknar giltig e-postadress' });
      continue;
    }
    if (seenEmail.has(c.email)) continue;
    seenEmail.add(c.email);
    unique.push(c);
  }
  return unique;
}

export interface EventInfo {
  id: string;
  tenant: string;
  name: string;
  starts_at?: string;
  ends_at?: string;
  location?: string;
  description?: string;
}

async function loadEvent(pb: PocketBase, campaign: CampaignRow): Promise<EventInfo | null> {
  if (!campaign.event) return null;
  try {
    const ev = await pb.collection('incubator_events').getOne<EventInfo>(campaign.event, {
      fields: 'id,tenant,name,starts_at,ends_at,location,description'
    });
    return ev.tenant === campaign.tenant ? ev : null;
  } catch {
    return null;
  }
}

/** Publik länk till kampanjens kopplade utvärdering (§ 47) — tenant-verifierad. */
async function surveyUrlFor(pb: PocketBase, campaign: CampaignRow, baseUrl: string): Promise<string> {
  if (!campaign.survey) return '';
  try {
    const sv = await pb.collection('surveys').getOne<{ tenant?: string; public_slug?: string }>(campaign.survey, { fields: 'id,tenant,public_slug' });
    if (sv.tenant !== campaign.tenant || !sv.public_slug) return '';
    return `${baseUrl}/u/${encodeURIComponent(sv.public_slug)}?utm_source=event`;
  } catch {
    return '';
  }
}

export function eventMerge(ev: EventInfo | null): Pick<EmailMergeData, 'event_name' | 'event_when' | 'event_location'> {
  if (!ev) return {};
  return {
    event_name: ev.name || '',
    event_when: ev.starts_at ? formatStockholmDateTime(ev.starts_at) : '',
    event_location: ev.location || ''
  };
}

async function tenantName(pb: PocketBase, tenant: string): Promise<string> {
  try {
    const t = await pb.collection('tenants').getOne<{ name?: string }>(tenant, { fields: 'id,name' });
    return t.name || 'Movexum';
  } catch {
    return 'Movexum';
  }
}

async function senderFor(pb: PocketBase, campaign: CampaignRow, orgName: string): Promise<{ from: string; replyTo: string | null; name: string }> {
  const address = senderAddress(resolveSender(process.env, 'invite'));
  let replyTo = resolveReplyTo(process.env);
  let name = campaign.sender_name || orgName;
  if (campaign.sender_user) {
    try {
      const u = await pb.collection('users').getOne<{ tenant?: string; email?: string; display_name?: string }>(campaign.sender_user, {
        fields: 'id,tenant,email,display_name'
      });
      if (u.tenant === campaign.tenant) {
        if (u.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email)) replyTo = u.email.trim();
        if (!campaign.sender_name && u.display_name) name = `${u.display_name} på ${orgName}`;
      }
    } catch {
      /* standardavsändare */
    }
  }
  const safeName = name.replace(/[<>"\r\n]/g, '').trim().slice(0, 80) || orgName;
  return { from: `${safeName} <${address}>`, replyTo, name: safeName };
}

const baseUrlOf = (campaign: CampaignRow, explicit?: string): string => {
  const configured = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim();
  return (configured || explicit || campaign.send_base_url || '').replace(/\/+$/, '');
};

/** Kampanjens upplösta länklista (för klickspårningen) — renderas med kampanjnivå-data. */
function campaignLinks(campaign: CampaignRow, ev: EventInfo | null, senderName: string, orgName: string, surveyUrl: string): string[] {
  // Samma event-/enkätdata som de riktiga mejlen, så länkindexen stämmer
  // (en saknad utvärderingslänk tar bort knappen i båda).
  return renderCampaignEmail({
    subject: campaign.subject,
    preheader: campaign.preheader,
    blocks: campaign.blocks,
    design: campaign.design,
    merge: { ...EMAIL_SAMPLE_MERGE, sender_name: senderName, ...eventMerge(ev), survey_url: surveyUrl },
    links: {},
    reasonText: '',
    orgName
  }).links;
}

export async function dispatchCampaign(campaignId: string, opts: { baseUrl?: string; actorId?: string } = {}): Promise<DispatchResult> {
  try {
    return await withDistributedLock(`email-campaign:${campaignId}`, () => dispatchLocked(campaignId, opts), {
      ttlMs: 15 * 60 * 1000,
      waitMs: 1500
    });
  } catch (err) {
    if (err instanceof LockTimeoutError) return { ok: false, error: 'Utskicket pågår redan.' };
    console.error('[campaigns] dispatch failed', err instanceof Error ? err.message : 'unknown');
    return { ok: false, error: 'Utskicket kunde inte genomföras.' };
  }
}

async function dispatchLocked(campaignId: string, opts: { baseUrl?: string; actorId?: string }): Promise<DispatchResult> {
  const su = await getSuperuserPb();
  if (!su.ok) return { ok: false, error: 'Superuser saknas — utskicket kan inte göras.' };
  const pb = su.pb;

  let campaign: CampaignRow;
  try {
    campaign = normalizeCampaign(await pb.collection(CAMPAIGNS).getOne<Record<string, unknown>>(campaignId));
  } catch {
    return { ok: false, error: 'Kampanjen hittades inte.' };
  }
  if (campaign.is_template) return { ok: false, error: 'En mall kan inte skickas — skapa ett utskick från den.' };
  if (campaign.status === 'sent') return { ok: false, error: 'Kampanjen är redan skickad.' };
  if (campaign.status === 'cancelled') return { ok: false, error: 'Kampanjen är avbruten.' };
  if (!isEmailConfigured()) return { ok: false, error: EMAIL_NOT_CONFIGURED_MESSAGE };
  const baseUrl = baseUrlOf(campaign, opts.baseUrl);
  if (!/^https?:\/\/[^\s/]+$/.test(baseUrl)) return { ok: false, error: 'Ingen giltig adress för länkarna i mejlet (APP_URL saknas).' };

  const ev = await loadEvent(pb, campaign);
  const needsEvent = blocksNeedEvent(campaign.blocks) || Boolean(campaign.audience.event_group);
  if (needsEvent && !ev) return { ok: false, error: 'Eventet kampanjen gäller finns inte längre.' };
  const wantsRsvp = Boolean(ev) && campaign.blocks.some((b) => b.type === 'rsvp');
  // Biljett/svarsknappar är personliga: varje mottagare behöver en rad i deltagarlistan.
  const wantsSignup = Boolean(ev) && blocksNeedSignup(campaign.blocks);
  if (wantsRsvp && ev && !rsvpOpen(ev, new Date(), 'yes')) return { ok: false, error: 'Eventet har redan ägt rum — inbjudningar kan inte skickas.' };
  const surveyUrl = await surveyUrlFor(pb, campaign, baseUrl);

  const orgName = await tenantName(pb, campaign.tenant);
  const sender = await senderFor(pb, campaign, orgName);
  const secret = emailLinkSecret();
  const unsubSecret = unsubscribeSecret();
  // Inget kampanjmejl utan fungerande avregistrering (GDPR art. 21, § 55.6):
  // saknas hemligheten kan ingen länk signeras — säg det i stället för att
  // skicka mejl vars "Avregistrera dig" saknas.
  if (!unsubSecret) return { ok: false, error: UNSUBSCRIBE_SECRET_MISSING };

  // Markera som pågående innan något skickas (cron kör inte om den).
  await pb.collection(CAMPAIGNS).update(campaign.id, { status: 'sending', send_at: '', last_error: '' }).catch(() => undefined);
  const fail = async (error: string): Promise<DispatchResult> => {
    // Orsaken i serverloggen också (PII-fri: räknare och konfigurationsfel,
    // aldrig adresser) — så den syns i Coolify även om ingen tittar i UI:t.
    console.error('[campaigns] dispatch aborted', { campaign: campaign.id, reason: error.slice(0, 300) });
    await pb.collection(CAMPAIGNS).update(campaign.id, { status: 'draft', last_error: error.slice(0, 300) }).catch(() => undefined);
    return { ok: false, error };
  };

  // Mottagare.
  let candidates: Candidate[];
  try {
    candidates = await resolveCampaignCandidates(pb, campaign);
  } catch (err) {
    return fail(err instanceof Error && err.message.includes('superuser') ? err.message : 'Kunde inte läsa mottagarna.');
  }
  if (candidates.length === 0) return fail('Utskicket har inga mottagare.');
  let suppressedHashes: Set<string>;
  try {
    suppressedHashes = await loadSuppressedHashes(pb, campaign.tenant, candidates.map((c) => (c.email ? hashEmail(c.email) : '')));
  } catch (err) {
    return fail((err as { status?: number })?.status === 404 ? 'Spärrlistan saknas — kör migration 1700000203.' : 'Kunde inte läsa spärrlistan — inget skickades.');
  }

  // Redan skapade rader (avbrutet försök): återanvänd, skapa inte dubbletter.
  const existing = new Map<string, { id: string; status: string; signup?: string }>();
  try {
    const rows = await pb.collection(CAMPAIGN_RECIPIENTS).getFullList<{ id: string; status: string; contact?: string; user?: string; startup?: string; signup?: string }>({
      filter: pb.filter('campaign = {:c}', { c: campaign.id }),
      fields: 'id,status,contact,user,startup,signup'
    });
    for (const r of rows) {
      const key = r.contact ? `c:${r.contact}` : r.user ? `u:${r.user}` : r.startup ? `s:${r.startup}` : r.signup ? `e:${r.signup}` : '';
      if (key) existing.set(key, { id: r.id, status: r.status, signup: r.signup });
    }
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return fail('Kampanjkollektionerna saknas — kör migration 1700000203.');
  }

  type Pending = { candidate: Candidate; rowId: string; hash: string; signupId?: string; token?: string };
  const pending: Pending[] = [];
  let suppressed = 0;
  let alreadySent = 0;
  let rowErrors = 0;
  let rowErrorStatus: number | undefined;
  // Varför en mottagare inte får mejlet — summeras i felet när INGEN kan nås,
  // så "0 skickade" aldrig blir ett tyst "Skickat".
  const skipReasons = new Map<string, number>();
  const noteSkip = (why: string) => skipReasons.set(why, (skipReasons.get(why) ?? 0) + 1);
  for (const c of candidates) {
    const hash = c.email ? hashEmail(c.email) : '';
    let status: EmailRecipientStatus = 'pending';
    let why = '';
    if (c.blocked) {
      status = c.blocked;
      why = c.blockedWhy ?? '';
    } else if (suppressedHashes.has(hash)) {
      status = 'suppressed';
      why = 'Adressen är spärrad (studs, klagomål eller avregistrering)';
    }
    const prior = existing.get(c.key);
    // Bara ett mejl som faktiskt lämnade oss är slutgiltigt ("sent", eller
    // studsat/klagat EFTER ett utskick). Allt annat från ett tidigare försök
    // prövas om mot DAGENS läge: en rad som föll ("failed", Resend avvisade)
    // skickas igen, och en som hoppades över (saknat samtycke, spärrad,
    // avregistrerad) får mejlet när orsaken är åtgärdad — tidigare låstes
    // den som "hoppades över redan i ett tidigare försök" för alltid, så ett
    // nyhetsbrev som skickades om efter att samtycket registrerats nådde
    // fortfarande ingen (incident 2026-10-22).
    if (prior && (prior.status === 'sent' || prior.status === 'bounced' || prior.status === 'complained')) {
      alreadySent++;
      continue;
    }
    let rowId = prior?.id;
    try {
      if (!rowId) {
        const row = await pb.collection(CAMPAIGN_RECIPIENTS).create<{ id: string }>({
          tenant: campaign.tenant,
          campaign: campaign.id,
          ...(c.contact ? { contact: c.contact } : {}),
          ...(c.user ? { user: c.user } : {}),
          ...(c.startup ? { startup: c.startup } : {}),
          ...(c.signupId ? { signup: c.signupId } : {}),
          name: c.name.slice(0, 200),
          organization: c.organization.slice(0, 200),
          email_hash: hash,
          status,
          ...(why ? { fail_reason: why } : {})
        });
        rowId = row.id;
      } else if (status !== 'pending') {
        if (prior?.status !== status || why) await pb.collection(CAMPAIGN_RECIPIENTS).update(rowId, { status, fail_reason: why }).catch(() => undefined);
      } else if (prior?.status !== 'pending') {
        await pb.collection(CAMPAIGN_RECIPIENTS).update(rowId, { status: 'pending', fail_reason: '' }).catch(() => undefined);
      }
    } catch (err) {
      // En mottagarrad som inte kan skrivas får ALDRIG tyst falla bort ur
      // utskicket — räknas och redovisas (PII-fritt: bara PB-status).
      rowErrors++;
      rowErrorStatus ??= (err as { status?: number })?.status;
      console.error('[campaigns] recipient row failed', { status: (err as { status?: number })?.status });
      continue;
    }
    if (status === 'pending' && c.email) pending.push({ candidate: c, rowId, hash, signupId: c.signupId ?? prior?.signup });
    else {
      suppressed++;
      noteSkip(why || 'Hoppades över');
    }
  }

  if (rowErrors > 0 && pending.length === 0) {
    return fail(
      `Mottagarraderna kunde inte sparas i PocketBase${rowErrorStatus ? ` (HTTP ${rowErrorStatus})` : ''} — inget skickades. ${CAMPAIGN_ROWS_HINT}`
    );
  }
  if (pending.length === 0 && alreadySent === 0) {
    const detail = [...skipReasons.entries()].map(([why, n]) => `${n} × ${why.toLowerCase()}`).join(', ');
    return fail(`Ingen av de ${candidates.length} mottagarna kan nås${detail ? ` (${detail})` : ''}. Kontrollera mottagarna under "Kontrollera mottagarna" och rätta adresser eller samtycke innan du skickar igen.`);
  }

  // Rader i eventets deltagarlista: svarsknappar skapar inbjudna rader för nya
  // mottagare; biljettblocket länkar BARA till befintliga rader (en biljett
  // till någon som inte är anmäld vore fel) — utan rad utelämnas knappen.
  if (wantsSignup && ev) {
    let signups: Array<{ id: string; contact?: string; user?: string; email?: string }> = [];
    try {
      signups = await pb.collection('event_signups').getFullList({
        filter: pb.filter('tenant = {:t} && event = {:e}', { t: campaign.tenant, e: ev.id }),
        fields: 'id,contact,user,email'
      });
    } catch {
      return fail('Kunde inte läsa eventets deltagarlista.');
    }
    const now = new Date().toISOString();
    for (const p of pending) {
      const c = p.candidate;
      let signupId = p.signupId;
      if (!signupId) {
        const match = signups.find(
          (s) => (c.contact && s.contact === c.contact) || (c.user && s.user === c.user) || (s.email && normalizeEmailAddress(s.email) === c.email)
        );
        if (match) signupId = match.id;
      }
      try {
        if (!signupId && !wantsRsvp) continue;
        if (!signupId) {
          const row = await pb.collection('event_signups').create<{ id: string }>({
            tenant: campaign.tenant,
            event: ev.id,
            name: c.name.slice(0, 200),
            email: c.email,
            organization: c.organization.slice(0, 200),
            stage: 'invited',
            invited_at: now,
            campaign: campaign.id,
            ...(c.contact ? { contact: c.contact } : {}),
            ...(c.user ? { user: c.user } : {}),
            ...(c.startup ? { startup: c.startup } : {})
          });
          signupId = row.id;
        }
        const token = randomBytes(32).toString('base64url');
        await pb.collection('event_signups').update(signupId, { rsvp_token_hash: hashRsvpToken(token) });
        await pb.collection(CAMPAIGN_RECIPIENTS).update(p.rowId, { signup: signupId });
        p.signupId = signupId;
        p.token = token;
      } catch (err) {
        console.error('[campaigns] signup row failed', { status: (err as { status?: number })?.status });
      }
    }
  }

  // Rendering + utskick.
  const links = campaignLinks(campaign, ev, sender.name, orgName, surveyUrl);
  const calendarKey = ev && ev.starts_at ? signCalendarKey(ev.id, secret) : null;
  const messages: OutgoingEmail[] = [];
  const byKey = new Map<string, Pending>();
  for (const p of pending) {
    const c = p.candidate;
    // Avregistreringen följer med i VARJE mejl — kontakt, användare, bolag
    // eller gäst i deltagarlistan (§ 55.6); nyckeln pekar på posten adressen
    // hämtades ur, så den fungerar från alla mallar och utan ny token.
    const subject = unsubscribeSubjectFor(c);
    const key = subject ? signUnsubscribeSubject(subject, unsubSecret) : null;
    const unsubscribe = key ? `${baseUrl}/e/avregistrera?k=${key}&alla=1` : null;
    const oneClick = key ? `${baseUrl}/api/public/e/unsubscribe?k=${key}&alla=1` : null;
    const rendered = renderCampaignEmail({
      subject: campaign.subject,
      preheader: campaign.preheader,
      blocks: campaign.blocks,
      design: campaign.design,
      merge: { first_name: c.firstName, name: c.name, organization: c.organization, sender_name: sender.name, ...eventMerge(ev), survey_url: surveyUrl },
      links: {
        unsubscribe,
        preferences: key ? `${baseUrl}/e/installningar?k=${key}` : null,
        rsvpYes: p.token ? `${baseUrl}/e/svar?t=${p.token}&svar=yes` : null,
        rsvpNo: p.token ? `${baseUrl}/e/svar?t=${p.token}&svar=no` : null,
        ticket: p.token ? `${baseUrl}/e/svar?t=${p.token}&klart=yes` : null,
        calendar: calendarKey ? `${baseUrl}/api/public/e/kalender?e=${calendarKey}` : null
      },
      reasonText: emailReasonText(c.reason, campaign.category, campaign.consent_mode),
      orgName,
      // Uppladdade bilder (app-relativa sökvägar) blir absoluta mot utskickets bas (§ 55.9).
      assetBase: baseUrl,
      trackLink: (url, index) => {
        const t = secret ? signClickToken({ recipientId: p.rowId, campaignId: campaign.id, index }, secret) : null;
        return t ? `${baseUrl}/api/public/e/klick?c=${t}` : url;
      }
    });
    messages.push({
      key: p.rowId,
      from: sender.from,
      to: c.email!,
      subject: renderSubject(campaign.subject, c, sender.name, ev),
      html: rendered.html,
      text: rendered.text,
      reply_to: sender.replyTo,
      headers: listUnsubscribeHeaders(oneClick),
      tags: [
        { name: 'category', value: `campaign_${campaign.category}` },
        { name: 'campaign', value: campaign.id },
        { name: 'tenant', value: campaign.tenant }
      ]
    });
    byKey.set(p.rowId, p);
  }

  let sent = 0;
  let failed = rowErrors;
  let failReason: string | undefined = rowErrors > 0 ? `${rowErrors} mottagarrader kunde inte sparas i PocketBase` : undefined;
  if (messages.length > 0) {
    const outcomes = await sendEmailBatch(messages);
    const sentAt = new Date().toISOString();
    for (const o of outcomes) {
      const p = byKey.get(o.key);
      if (!p) continue;
      if (o.error) {
        failed++;
        failReason ??= o.error;
        await pb.collection(CAMPAIGN_RECIPIENTS).update(p.rowId, { status: 'failed', fail_reason: o.error.slice(0, 300) }).catch(() => undefined);
      } else {
        sent++;
        await pb
          .collection(CAMPAIGN_RECIPIENTS)
          .update(p.rowId, { status: 'sent', sent_at: sentAt, provider_message_id: (o.id ?? '').slice(0, 100), fail_reason: '' })
          .catch(() => undefined);
        if (p.signupId && wantsRsvp) await pb.collection('event_signups').update(p.signupId, { invite_sent_at: sentAt }).catch(() => undefined);
      }
    }
  }

  const everythingFailed = messages.length > 0 && sent === 0;
  if (everythingFailed) console.error('[campaigns] dispatch sent nothing', { campaign: campaign.id, attempted: messages.length, reason: (failReason ?? '').slice(0, 300) });
  await pb
    .collection(CAMPAIGNS)
    .update(campaign.id, {
      status: everythingFailed ? 'draft' : 'sent',
      ...(everythingFailed ? {} : { sent_at: new Date().toISOString() }),
      send_at: '',
      recipients_count: candidates.length,
      sent_count: alreadySent + sent,
      failed_count: failed,
      suppressed_count: suppressed,
      link_clicks: { urls: links, counts: campaign.link_clicks.urls.length === links.length ? campaign.link_clicks.counts : links.map(() => 0) },
      last_error: everythingFailed ? (failReason ?? 'Inget mejl gick fram.').slice(0, 300) : ''
    })
    .catch((err) => console.error('[campaigns] could not record dispatch', (err as { status?: number })?.status));
  if (ev) await recomputeEventCounters(pb, campaign.tenant, ev.id);

  const actorId = opts.actorId || campaign.created_by;
  if (actorId) {
    await logAgentAction(pb, {
      actor: { kind: 'user', id: actorId, tenant: campaign.tenant, roles: [] },
      action_type: 'update',
      collection: CAMPAIGNS,
      record_id: campaign.id,
      field: 'sent',
      after_value: { title: campaign.title, recipients: candidates.length, sent, failed, suppressed }
    });
  }
  if (everythingFailed) return { ok: false, error: `Inga mejl skickades. ${failReason ?? 'Resend avvisade utskicket.'}` };
  return { ok: true, recipients: candidates.length, sent, failed, suppressed, ...(failReason ? { failReason } : {}) };
}

function renderSubject(subject: string, c: Candidate, senderName: string, ev: EventInfo | null): string {
  // Platshållare i ämnesraden fylls i per mottagare (samma data som brödtexten).
  return renderMergeFields(subject, { first_name: c.firstName, name: c.name, organization: c.organization, sender_name: senderName, ...eventMerge(ev) }).slice(0, 150) || subject;
}

/**
 * Testmejl till en adress (den inloggades egen): exempeldata i platshållarna,
 * `[TEST]` i ämnesraden, inga mottagarrader, ingen statistik. Länkarna pekar
 * på riktiga sidor i testläge.
 */
export async function sendCampaignTest(pb: PocketBase, tenant: string, campaignId: string, to: string, baseUrl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normalizeEmailAddress(to);
  if (!email) return { ok: false, error: 'Ogiltig adress.' };
  if (!isEmailConfigured()) return { ok: false, error: EMAIL_NOT_CONFIGURED_MESSAGE };
  const campaign = await getCampaign(pb, tenant, campaignId);
  if (!campaign) return { ok: false, error: 'Kampanjen hittades inte.' };
  const su = await getSuperuserPb();
  const client = su.ok ? su.pb : pb;
  const ev = await loadEvent(client, campaign);
  const orgName = await tenantName(client, tenant);
  const sender = await senderFor(client, campaign, orgName);
  const base = baseUrlOf(campaign, baseUrl);
  const realSurvey = await surveyUrlFor(client, campaign, base);
  const merge: EmailMergeData = {
    ...EMAIL_SAMPLE_MERGE,
    sender_name: sender.name,
    ...eventMerge(ev),
    // Riktig enkätlänk när kampanjen har en; annars exempel så knappen syns i testet.
    survey_url: realSurvey || (campaign.survey ? '' : EMAIL_SAMPLE_MERGE.survey_url)
  };
  const rendered = renderCampaignEmail({
    subject: campaign.subject || campaign.title,
    preheader: campaign.preheader,
    blocks: campaign.blocks,
    design: campaign.design,
    merge,
    links: {
      unsubscribe: `${base}/e/avregistrera?test=1`,
      preferences: `${base}/e/installningar?test=1`,
      rsvpYes: ev ? `${base}/e/svar?test=1&svar=yes` : null,
      rsvpNo: ev ? `${base}/e/svar?test=1&svar=no` : null,
      ticket: ev ? `${base}/e/svar?test=1&klart=yes` : null,
      calendar: ev?.starts_at ? `${base}/api/public/e/kalender?e=${signCalendarKey(ev.id, emailLinkSecret()) ?? ''}` : null
    },
    reasonText: emailReasonText('contact', campaign.category, campaign.consent_mode),
    orgName,
    assetBase: base
  });
  const res = await sendOne({
    key: 'test',
    from: sender.from,
    to: email,
    subject: `[TEST] ${renderMergeFields(campaign.subject || campaign.title, merge)}`.slice(0, 150),
    html: rendered.html,
    text: rendered.text,
    reply_to: sender.replyTo,
    tags: [{ name: 'category', value: 'campaign_test' }, { name: 'tenant', value: tenant }]
  });
  if (res.error) return { ok: false, error: res.error };
  await client.collection(CAMPAIGNS).update(campaign.id, { last_test_at: new Date().toISOString() }).catch(() => undefined);
  return { ok: true };
}
