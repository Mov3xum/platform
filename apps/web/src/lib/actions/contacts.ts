'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  createContact,
  decideContactRequest,
  deleteContact,
  importContacts,
  requestContactUse,
  updateContactFields,
  withdrawContactRequest,
  type Actor,
  type ContactChanges,
  type ImportContactsResult
} from '@/lib/core/write';
import { parseXlsx } from '@/lib/import/xlsx';
import {
  CONTACT_BOOK_ROLES,
  dedupeContactImportRows,
  parseContactImportRows,
  parseDelimitedText,
  type ContactImportRow,
  type ContactRequestDecision,
  type Role
} from '@platform/shared';

/**
 * Server actions för kontaktboken (CLAUDE.md § 45). Tunna skal: RBAC här,
 * validering + whitelist + audit + notiser i det delade skrivlagret
 * (`lib/core/write/contacts.ts`). Klienten är aldrig säkerhetsgränsen.
 */

export interface ContactActionState {
  ok?: boolean;
  error?: string;
  warning?: string;
  notice?: string;
  id?: string;
  path?: string;
}

function actorOf(user: { id: string; tenant: string; roles: Role[] }): Actor {
  return { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles };
}

function revalidate(contactId?: string, startupId?: string | null) {
  revalidatePath('/kontakter');
  revalidatePath('/kontakter/forfragningar');
  if (contactId) revalidatePath(`/kontakter/${contactId}`);
  if (startupId) revalidatePath(`/startups/${startupId}`);
  revalidatePath('/min-oversikt');
  revalidatePath('/inkorg');
}

async function staff(): Promise<{ user: Awaited<ReturnType<typeof requireUser>>; actor: Actor } | { error: string }> {
  const user = await requireUser();
  if (!hasRole(user.roles, [...CONTACT_BOOK_ROLES])) {
    return { error: 'Endast Movexum-personal kan ändra i kontaktboken.' };
  }
  return { user, actor: actorOf(user) };
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

function list(fd: FormData, key: string): string[] {
  return fd
    .getAll(key)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim());
}

export async function createContactAction(_prev: ContactActionState, fd: FormData): Promise<ContactActionState> {
  const s = await staff();
  if ('error' in s) return { error: s.error };
  const pb = await getServerPb();
  const result = await createContact(pb, s.actor, {
    firstName: str(fd, 'first_name'),
    lastName: str(fd, 'last_name'),
    email: str(fd, 'email'),
    phone: str(fd, 'phone'),
    organization: str(fd, 'organization'),
    primaryRole: str(fd, 'primary_role'),
    category: str(fd, 'category'),
    kommun: str(fd, 'kommun'),
    skills: str(fd, 'skills'),
    info: str(fd, 'info'),
    ownerIds: list(fd, 'owners'),
    gender: str(fd, 'gender') || null,
    gdprConsent: fd.get('gdpr_consent') === 'on' || fd.get('gdpr_consent') === 'true'
  });
  if (!result.ok) return { error: result.error };
  revalidate(result.value.contactId);
  return { ok: true, id: result.value.contactId, path: result.value.path };
}

export async function updateContactAction(_prev: ContactActionState, fd: FormData): Promise<ContactActionState> {
  const s = await staff();
  if ('error' in s) return { error: s.error };
  const id = str(fd, 'id');
  if (!id) return { error: 'Kontakt-id saknas.' };
  const changes: ContactChanges = {
    first_name: str(fd, 'first_name'),
    last_name: str(fd, 'last_name'),
    email: str(fd, 'email'),
    phone: str(fd, 'phone'),
    organization: str(fd, 'organization'),
    primary_role: str(fd, 'primary_role'),
    category: str(fd, 'category'),
    kommun: str(fd, 'kommun'),
    skills: str(fd, 'skills'),
    info: str(fd, 'info'),
    owners: list(fd, 'owners')
  };
  if (fd.has('gender')) changes.gender = str(fd, 'gender');
  const pb = await getServerPb();
  const result = await updateContactFields(pb, s.actor, id, changes);
  if (!result.ok) return { error: result.error };
  revalidate(id);
  return { ok: true, id, path: result.value.path, notice: 'Kontakten sparades.' };
}

export async function deleteContactAction(_prev: ContactActionState, fd: FormData): Promise<ContactActionState> {
  const user = await requireUser();
  const id = str(fd, 'id');
  if (!id) return { error: 'Kontakt-id saknas.' };
  const pb = await getServerPb();
  const result = await deleteContact(pb, actorOf(user), id);
  if (!result.ok) return { error: result.error };
  revalidate(id);
  return { ok: true, path: '/kontakter', notice: `${result.value.name} raderades.` };
}

export async function requestContactUseAction(_prev: ContactActionState, fd: FormData): Promise<ContactActionState> {
  const s = await staff();
  if ('error' in s) return { error: s.error };
  const contactId = str(fd, 'contact_id');
  if (!contactId) return { error: 'Kontakt-id saknas.' };
  const pb = await getServerPb();
  const result = await requestContactUse(pb, s.actor, {
    contactId,
    purpose: str(fd, 'purpose'),
    startupId: str(fd, 'startup_id') || null,
    startupRole: str(fd, 'startup_role') || null
  });
  if (!result.ok) return { error: result.error };
  revalidate(contactId, result.value.startupId);
  return {
    ok: true,
    id: result.value.requestId,
    path: result.value.path,
    warning: result.value.warning,
    notice: result.value.selfApproved
      ? result.value.startupName
        ? `Du äger kontakten — den är nu kopplad till ${result.value.startupName}.`
        : 'Du äger kontakten — användningen är registrerad.'
      : 'Förfrågan är skickad till kontaktens ägare.'
  };
}

export async function decideContactRequestAction(_prev: ContactActionState, fd: FormData): Promise<ContactActionState> {
  const s = await staff();
  if ('error' in s) return { error: s.error };
  const requestId = str(fd, 'request_id');
  const decision = str(fd, 'decision') as ContactRequestDecision;
  if (!requestId) return { error: 'Förfrågans id saknas.' };
  const pb = await getServerPb();
  const result = await decideContactRequest(pb, s.actor, { requestId, decision, note: str(fd, 'note') || null });
  if (!result.ok) return { error: result.error };
  revalidate(result.value.contactId, result.value.startupId);
  return {
    ok: true,
    id: requestId,
    path: result.value.path,
    warning: result.value.warning,
    notice:
      decision === 'approved'
        ? result.value.linked && result.value.startupName
          ? `Godkänd — ${result.value.contactName} är nu kopplad till ${result.value.startupName}.`
          : 'Förfrågan godkändes.'
        : 'Förfrågan avböjdes.'
  };
}

export async function withdrawContactRequestAction(_prev: ContactActionState, fd: FormData): Promise<ContactActionState> {
  const user = await requireUser();
  const requestId = str(fd, 'request_id');
  if (!requestId) return { error: 'Förfrågans id saknas.' };
  const pb = await getServerPb();
  const result = await withdrawContactRequest(pb, actorOf(user), requestId);
  if (!result.ok) return { error: result.error };
  revalidate(result.value.contactId);
  return { ok: true, id: requestId, path: result.value.path, notice: 'Förfrågan återkallades.' };
}

// ── Import ──────────────────────────────────────────────────────────────────

const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const IMPORT_MAX_ROWS = 5000;

export type ContactImportPreview = {
  rows: ContactImportRow[];
  mappedFields: string[];
  unmappedHeaders: string[];
  warnings: string[];
  merged: number;
  sheet?: string;
};

export type ContactImportState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'preview'; preview: ContactImportPreview }
  | { status: 'done'; result: ImportContactsResult };

function isZip(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

async function readRows(file: File): Promise<{ headers: string[]; rows: string[][]; sheet?: string } | { error: string }> {
  if (file.size === 0) return { error: 'Filen är tom.' };
  if (file.size > IMPORT_MAX_BYTES) return { error: 'Filen är större än 10 MB.' };
  const buf = Buffer.from(await file.arrayBuffer());
  let table: string[][];
  let sheet: string | undefined;
  if (isZip(buf) || /\.xlsx$/i.test(file.name)) {
    let parsed;
    try {
      parsed = parseXlsx(buf);
    } catch {
      return { error: 'Kunde inte läsa Excel-filen. Spara som .xlsx eller .csv och försök igen.' };
    }
    // Första arket med innehåll (Outlook/Google-exporter har ett ark).
    let best: { name: string; rows: Record<string, string>[] } | null = null;
    for (const [name, rows] of parsed.sheets) {
      if (rows.length > 1 && (!best || rows.length > best.rows.length)) best = { name, rows };
    }
    if (!best) return { error: 'Excel-filen innehåller inga rader.' };
    sheet = best.name;
    // Kolumnbokstäver → positionsordnade celler (A, B, …, Z, AA …).
    const cols = new Set<string>();
    for (const r of best.rows) for (const k of Object.keys(r)) cols.add(k);
    const order = [...cols].sort((a, b) => a.length - b.length || a.localeCompare(b));
    table = best.rows.map((r) => order.map((c) => r[c] ?? ''));
  } else {
    table = parseDelimitedText(buf.toString('utf8'));
  }
  if (table.length < 2) return { error: 'Filen måste ha en rubrikrad och minst en kontaktrad.' };
  const [headers, ...rows] = table;
  if (rows.length > IMPORT_MAX_ROWS) return { error: `Max ${IMPORT_MAX_ROWS} kontakter per import.` };
  return { headers, rows, sheet };
}

export async function previewContactImportAction(_prev: ContactImportState, fd: FormData): Promise<ContactImportState> {
  const s = await staff();
  if ('error' in s) return { status: 'error', message: s.error };
  const file = fd.get('file');
  if (!(file instanceof File)) return { status: 'error', message: 'Ingen fil bifogad.' };
  const read = await readRows(file);
  if ('error' in read) return { status: 'error', message: read.error };
  const parsed = parseContactImportRows(read.headers, read.rows);
  const { rows, merged } = dedupeContactImportRows(parsed.rows);
  return {
    status: 'preview',
    preview: {
      rows,
      mappedFields: parsed.mappedFields,
      unmappedHeaders: parsed.unmappedHeaders,
      warnings: parsed.warnings,
      merged,
      sheet: read.sheet
    }
  };
}

export async function commitContactImportAction(_prev: ContactImportState, fd: FormData): Promise<ContactImportState> {
  const s = await staff();
  if ('error' in s) return { status: 'error', message: s.error };
  const raw = fd.get('rows');
  if (typeof raw !== 'string') return { status: 'error', message: 'Förhandsgranskningen saknas — ladda upp filen igen.' };
  let rows: ContactImportRow[];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length > IMPORT_MAX_ROWS) throw new Error('bad');
    // Rader från klienten är DATA — de kör genom samma validering som allt annat i skrivlagret.
    rows = parsed as ContactImportRow[];
  } catch {
    return { status: 'error', message: 'Förhandsgranskningen kunde inte tolkas — ladda upp filen igen.' };
  }
  const pb = await getServerPb();
  const result = await importContacts(pb, s.actor, rows, {
    consentConfirmed: fd.get('consent_confirmed') === 'on' || fd.get('consent_confirmed') === 'true',
    defaultOwnerIds: list(fd, 'owners'),
    dryRun: false
  });
  if (!result.ok) return { status: 'error', message: result.error };
  revalidate();
  return { status: 'done', result: result.value };
}
