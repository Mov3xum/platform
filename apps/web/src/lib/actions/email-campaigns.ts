'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { requestOrigin } from '@/lib/request-origin';
import { readTableFile } from '@/lib/import/table-file';
import {
  addManualSuppression,
  cancelEmailCampaignSchedule,
  createEmailCampaign,
  deleteEmailCampaign,
  deleteSuppression,
  importSuppressions,
  previewCampaignRecipients,
  saveCampaignAsTemplate,
  scheduleEmailCampaign,
  sendEmailCampaignNow,
  sendEmailCampaignTest,
  setNewsletterConsent,
  updateEmailCampaign,
  type Actor
} from '@/lib/core/write';
import { listInviteOptionsAction, type InviteOptionsResult } from '@/lib/actions/invitations';
import { isEmailSuppressionReason, parseDateTimeInput, type Role } from '@platform/shared';

/**
 * Server actions för e-postkampanjer (CLAUDE.md § 54). Tunna skal: RBAC här,
 * validering + tenant + audit i `lib/core/write/email-campaigns.ts`. Alla
 * utskick är mänskliga klick; klienten är aldrig säkerhetsgränsen.
 */

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;

export interface CampaignActionState {
  ok?: boolean;
  error?: string;
  notice?: string;
  warning?: string;
  id?: string;
  path?: string;
}

async function manager(): Promise<{ actor: Actor; email: string } | { error: string }> {
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES]) || !user.tenant) return { error: 'Bara admin, inkubatorledning och coacher kan hantera kampanjer.' };
  return { actor: { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] }, email: user.email };
}

function revalidate(id?: string) {
  revalidatePath('/inflode/kampanjer');
  if (id) revalidatePath(`/inflode/kampanjer/${id}`);
  revalidatePath('/installningar/e-post');
}

export async function createCampaignAction(input: {
  templateKey?: string;
  fromId?: string;
  eventId?: string;
  /** Eventets deltagarlista som mottagargrupp (§ 54.3). */
  eventGroup?: string;
  surveyId?: string;
  title?: string;
  isTemplate?: boolean;
}): Promise<CampaignActionState> {
  const m = await manager();
  if ('error' in m) return { error: m.error };
  const res = await createEmailCampaign(await getServerPb(), m.actor, input);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.id);
  return { ok: true, id: res.value.id, path: res.value.path, warning: res.value.warning };
}

/** Formulärvariant: skapar och går direkt till redigeringen. */
export async function createCampaignAndRedirect(formData: FormData): Promise<void> {
  const res = await createCampaignAction({
    templateKey: String(formData.get('template') || ''),
    fromId: String(formData.get('from') || ''),
    eventId: String(formData.get('event') || ''),
    eventGroup: String(formData.get('event_group') || ''),
    surveyId: String(formData.get('survey') || ''),
    title: String(formData.get('title') || ''),
    isTemplate: formData.get('is_template') === '1'
  });
  if (!res.ok || !res.path) redirect(`/inflode/kampanjer?fel=${encodeURIComponent(res.error ?? 'skapa')}`);
  redirect(res.path);
}

export async function saveCampaignAction(input: {
  id: string;
  title?: string;
  subject?: string;
  preheader?: string;
  category?: string;
  consent_mode?: string;
  blocks?: unknown;
  design?: unknown;
  sender_name?: string;
  senderUserId?: string;
  eventId?: string;
  surveyId?: string;
  audience?: unknown;
}): Promise<CampaignActionState> {
  const m = await manager();
  if ('error' in m) return { error: m.error };
  const res = await updateEmailCampaign(await getServerPb(), m.actor, String(input.id || ''), input);
  if (!res.ok) return { error: res.error };
  revalidate(res.value.id);
  return { ok: true, id: res.value.id, notice: 'Sparat.', warning: res.value.warning };
}

export async function deleteCampaignAction(id: string): Promise<CampaignActionState> {
  const m = await manager();
  if ('error' in m) return { error: m.error };
  const res = await deleteEmailCampaign(await getServerPb(), m.actor, String(id || ''));
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, notice: `"${res.value.title}" togs bort.` };
}

export async function deleteCampaignFormAction(formData: FormData): Promise<void> {
  const res = await deleteCampaignAction(String(formData.get('id') || ''));
  redirect(res.ok ? '/inflode/kampanjer' : `/inflode/kampanjer?fel=${encodeURIComponent(res.error ?? 'radera')}`);
}

export async function saveCampaignAsTemplateAction(input: { id: string; title?: string }): Promise<CampaignActionState> {
  const m = await manager();
  if ('error' in m) return { error: m.error };
  const res = await saveCampaignAsTemplate(await getServerPb(), m.actor, String(input.id || ''), input.title);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, id: res.value.id, path: res.value.path, notice: `Mallen "${res.value.title}" sparades.` };
}

export async function previewRecipientsAction(id: string): Promise<CampaignActionState & { total?: number; sendable?: number; blocked?: Array<{ name: string; organization: string; why: string }> }> {
  const m = await manager();
  if ('error' in m) return { error: m.error };
  const res = await previewCampaignRecipients(await getServerPb(), m.actor, String(id || ''));
  if (!res.ok) return { error: res.error };
  return { ok: true, ...res.value };
}

export async function scheduleCampaignAction(input: { id: string; sendAt: string }): Promise<CampaignActionState> {
  const m = await manager();
  if ('error' in m) return { error: m.error };
  const when = parseDateTimeInput(String(input.sendAt || '').trim());
  if (!when) return { error: 'Ogiltig tidpunkt.' };
  const origin = await requestOrigin();
  const res = await scheduleEmailCampaign(await getServerPb(), m.actor, String(input.id || ''), when, origin);
  if (!res.ok) return { error: res.error };
  revalidate(input.id);
  return { ok: true, notice: 'Utskicket är schemalagt.' };
}

export async function cancelScheduleAction(id: string): Promise<CampaignActionState> {
  const m = await manager();
  if ('error' in m) return { error: m.error };
  const res = await cancelEmailCampaignSchedule(await getServerPb(), m.actor, String(id || ''));
  if (!res.ok) return { error: res.error };
  revalidate(id);
  return { ok: true, notice: 'Schemaläggningen är avbruten — utskicket är ett utkast igen.' };
}

export async function sendCampaignNowAction(id: string): Promise<CampaignActionState> {
  const m = await manager();
  if ('error' in m) return { error: m.error };
  let res: Awaited<ReturnType<typeof sendEmailCampaignNow>>;
  try {
    res = await sendEmailCampaignNow(await getServerPb(), m.actor, String(id || ''), await requestOrigin());
  } catch (err) {
    console.error('[campaigns] send action failed', err instanceof Error ? err.message : 'unknown');
    return { error: 'Utskicket kunde inte genomföras. Ladda om sidan och försök igen.' };
  }
  revalidate(id);
  if (!res.ok) return { error: res.error };
  const v = res.value;
  const parts = [`${v.sent} mejl skickade`, v.suppressed ? `${v.suppressed} hoppades över (spärrade/avregistrerade)` : '', v.failed ? `${v.failed} misslyckades${v.failReason ? ` (${v.failReason.replace(/\.$/, '')})` : ''}` : ''].filter(Boolean);
  return { ok: true, notice: `${parts.join(' · ')}.` };
}

export async function sendTestAction(id: string): Promise<CampaignActionState> {
  const m = await manager();
  if ('error' in m) return { error: m.error };
  const res = await sendEmailCampaignTest(await getServerPb(), m.actor, String(id || ''), m.email, await requestOrigin());
  if (!res.ok) return { error: res.error };
  revalidate(id);
  return { ok: true, notice: `Testmejl skickat till din adress (${m.email}).` };
}

/** Mottagarlistan i kampanjeditorn — samma listning som inbjudningspanelen, utan event. */
export async function listCampaignRecipientOptionsAction(input: { list?: string; q?: string; withMeta?: boolean }): Promise<InviteOptionsResult> {
  return listInviteOptionsAction({ eventId: '', list: input.list, q: input.q, withMeta: input.withMeta });
}

// ── Spärrlista & samtycke ───────────────────────────────────────────────────

export async function addSuppressionAction(_prev: CampaignActionState, fd: FormData): Promise<CampaignActionState> {
  const m = await manager();
  if ('error' in m) return { error: m.error };
  const res = await addManualSuppression(await getServerPb(), m.actor, {
    email: String(fd.get('email') || ''),
    reason: String(fd.get('reason') || 'manual'),
    note: String(fd.get('note') || '')
  });
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, notice: res.value.created ? 'Adressen är spärrad.' : 'Adressen var redan spärrad.' };
}

export async function deleteSuppressionAction(id: string): Promise<CampaignActionState> {
  const m = await manager();
  if ('error' in m) return { error: m.error };
  const res = await deleteSuppression(await getServerPb(), m.actor, String(id || ''));
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, notice: 'Spärren är borttagen.' };
}

export interface SuppressionImportState {
  status: 'idle' | 'error' | 'done';
  message?: string;
  result?: { added: number; existing: number; contactsUpdated: number; warnings: string[] };
}

export async function importSuppressionsAction(_prev: SuppressionImportState, fd: FormData): Promise<SuppressionImportState> {
  const m = await manager();
  if ('error' in m) return { status: 'error', message: m.error };
  const file = fd.get('file');
  if (!(file instanceof File)) return { status: 'error', message: 'Ingen fil bifogad.' };
  const read = await readTableFile(file, { maxRows: 20000, rowNoun: 'rad' });
  if ('error' in read) return { status: 'error', message: read.error };
  const reasonRaw = String(fd.get('reason') || 'import');
  const res = await importSuppressions(await getServerPb(), m.actor, read.headers, read.rows, isEmailSuppressionReason(reasonRaw) ? reasonRaw : 'import');
  if (!res.ok) return { status: 'error', message: res.error };
  revalidate();
  return { status: 'done', result: res.value };
}

export async function setNewsletterConsentAction(input: { contactId: string; consent: boolean }): Promise<CampaignActionState> {
  const m = await manager();
  if ('error' in m) return { error: m.error };
  const res = await setNewsletterConsent(await getServerPb(), m.actor, String(input.contactId || ''), Boolean(input.consent));
  if (!res.ok) return { error: res.error };
  revalidatePath(`/kontakter/${input.contactId}`);
  return { ok: true, notice: input.consent ? 'Samtycke till nyhetsbrev registrerat.' : 'Samtycket är borttaget.' };
}
