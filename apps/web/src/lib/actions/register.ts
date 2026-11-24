'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { canManageRegister } from '@platform/shared';
import {
  establishArchiveVersion,
  logDisclosure,
  registerManualEntry,
  saveArchiveDescription,
  saveRecordType,
  setEntrySecrecy,
  setRegisterCaseStatus,
  verifyRegisterIntegrity,
  voidEntry
} from '@/lib/core/write/register';
import { backfillRegister } from '@/lib/register/sources';
import type { Actor } from '@/lib/core/write';

/**
 * Server actions för diariet (CLAUDE.md § 60). Tunna skal: modulgrind här,
 * roll + validering + audit i `lib/core/write/register.ts`.
 */

export interface RegisterActionState {
  ok?: boolean;
  error?: string;
  notice?: string;
  caseId?: string;
}

async function actor(): Promise<Actor | { error: string }> {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'diarium', user.enabledModules)) return { error: 'Du har inte tillgång till diariet.' };
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

function revalidate(caseId?: string | null) {
  revalidatePath('/diarium');
  if (caseId) revalidatePath(`/diarium/${caseId}`);
}

export async function registerManualEntryAction(_prev: RegisterActionState, fd: FormData): Promise<RegisterActionState> {
  const a = await actor();
  if ('error' in a) return a;
  const res = await registerManualEntry(a, {
    type_key: str(fd, 'type_key'),
    title: str(fd, 'title'),
    case_title: str(fd, 'case_title'),
    counterpart: str(fd, 'counterpart'),
    document_date: str(fd, 'document_date'),
    secrecy: str(fd, 'secrecy'),
    secrecy_basis: str(fd, 'secrecy_basis'),
    note: str(fd, 'note'),
    case_id: str(fd, 'case_id') || null
  });
  if (!res.ok) return { error: res.error };
  revalidate(res.value.caseId);
  return { ok: true, caseId: res.value.caseId, notice: `Registrerad som ${res.value.designation}.` };
}

export async function setEntrySecrecyAction(_prev: RegisterActionState, fd: FormData): Promise<RegisterActionState> {
  const a = await actor();
  if ('error' in a) return a;
  const res = await setEntrySecrecy(a, str(fd, 'entry_id'), { secrecy: str(fd, 'secrecy') === 'on', basis: str(fd, 'secrecy_basis') });
  if (!res.ok) return { error: res.error };
  revalidate(res.value.caseId);
  return { ok: true, notice: 'Sekretessmarkeringen sparades.' };
}

export async function voidEntryAction(_prev: RegisterActionState, fd: FormData): Promise<RegisterActionState> {
  const a = await actor();
  if ('error' in a) return a;
  const res = await voidEntry(a, str(fd, 'entry_id'), str(fd, 'reason'));
  if (!res.ok) return { error: res.error };
  revalidate(res.value.caseId);
  return { ok: true, notice: 'Handlingen är makulerad. Posten och numret finns kvar.' };
}

export async function setCaseStatusAction(caseId: string, status: 'open' | 'closed'): Promise<RegisterActionState> {
  const a = await actor();
  if ('error' in a) return a;
  const res = await setRegisterCaseStatus(a, caseId, status === 'closed' ? 'closed' : 'open');
  if (!res.ok) return { error: res.error };
  revalidate(caseId);
  return { ok: true, notice: status === 'closed' ? 'Ärendet är avslutat.' : 'Ärendet är öppnat igen.' };
}

export async function logDisclosureAction(_prev: RegisterActionState, fd: FormData): Promise<RegisterActionState> {
  const a = await actor();
  if ('error' in a) return a;
  const res = await logDisclosure(a, {
    request_summary: str(fd, 'request_summary'),
    outcome: str(fd, 'outcome'),
    secrecy_basis: str(fd, 'secrecy_basis'),
    note: str(fd, 'note'),
    requested_at: str(fd, 'requested_at'),
    case_id: str(fd, 'case_id') || null,
    entry_id: str(fd, 'entry_id') || null
  });
  if (!res.ok) return { error: res.error };
  revalidate(res.value.caseId);
  return { ok: true, notice: 'Utlämnandet är loggat.' };
}

export async function saveRecordTypeAction(_prev: RegisterActionState, fd: FormData): Promise<RegisterActionState> {
  const a = await actor();
  if ('error' in a) return a;
  const res = await saveRecordType(a, {
    key: str(fd, 'key'),
    label: str(fd, 'label'),
    process: str(fd, 'process'),
    direction: str(fd, 'direction'),
    trigger: str(fd, 'trigger'),
    handling: str(fd, 'handling'),
    secrecy_possible: str(fd, 'secrecy_possible'),
    secrecy_basis: str(fd, 'secrecy_basis'),
    retention: str(fd, 'retention'),
    retention_months: str(fd, 'retention_months'),
    legal_basis: str(fd, 'legal_basis'),
    storage: str(fd, 'storage'),
    confirmed: str(fd, 'confirmed'),
    active: str(fd, 'active') !== 'off'
  });
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, notice: res.value.created ? 'Handlingstypen lades till.' : 'Handlingstypen sparades.' };
}

export async function saveArchiveDescriptionAction(_prev: RegisterActionState, fd: FormData): Promise<RegisterActionState> {
  const a = await actor();
  if ('error' in a) return a;
  const sections: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith('section_') && typeof v === 'string') sections[k.slice(8)] = v;
  const res = await saveArchiveDescription(a, sections);
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, notice: 'Arkivbeskrivningen sparades.' };
}

export async function establishArchiveVersionAction(_prev: RegisterActionState, fd: FormData): Promise<RegisterActionState> {
  const a = await actor();
  if ('error' in a) return a;
  const res = await establishArchiveVersion(a, str(fd, 'note'));
  if (!res.ok) return { error: res.error };
  revalidate();
  return { ok: true, notice: `Version ${res.value.version} är fastställd.` };
}

export async function backfillRegisterAction(): Promise<RegisterActionState> {
  const a = await actor();
  if ('error' in a) return a;
  if (!canManageRegister(a.roles)) return { error: 'Bara admin och inkubatorledning efterregistrerar.' };
  const res = await backfillRegister(a.tenant, a.id);
  revalidate();
  if (res.error) return { error: res.error };
  const parts = [`${res.registered} handlingar efterregistrerade`];
  if (res.remaining) parts.push(`${res.remaining} ärenden återstår — kör igen`);
  if (res.errors) parts.push(`${res.errors} kunde inte registreras`);
  return res.errors ? { error: `${parts.join(' · ')}.` } : { ok: true, notice: `${parts.join(' · ')}.` };
}

export async function verifyRegisterIntegrityAction(): Promise<RegisterActionState> {
  const a = await actor();
  if ('error' in a) return a;
  if (!canManageRegister(a.roles)) return { error: 'Bara admin och inkubatorledning kör kontrollen.' };
  const res = await verifyRegisterIntegrity(a.tenant);
  if (res.error) return { error: res.error };
  if (!res.ok) return { error: `${res.mismatched.length} av ${res.checked} handlingar avviker från sin kontrollsumma: ${res.mismatched.slice(0, 10).join(', ')}.` };
  return { ok: true, notice: `${res.checked} handlingar kontrollerade — alla stämmer med sin kontrollsumma.` };
}
