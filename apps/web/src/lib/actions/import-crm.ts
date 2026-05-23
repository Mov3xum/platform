'use server';

import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { parseXlsx } from '@/lib/import/xlsx';
import { parseCrmExport, type CrmParseResult } from '@/lib/import/crm-excel';
import { recordActivity } from './record-activity';
import { escFilter as esc } from '@/lib/pb-filter';
import type PocketBase from 'pocketbase';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream'
]);

function isZipMagic(buf: Buffer): boolean {
  return (
    buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)
  );
}

export interface CrmImportSummary {
  companies: number;
  contacts: number;
  startupContacts: number;
  events: number;
  signups: number;
  capital: number;
  ipr: number;
  agreements: number;
  tasks: number;
  kpis: number;
  phaseEntries: number;
  warnings: string[]; // PII-fria
}

export interface CrmImportResult {
  created: Record<string, number>;
  updated: Record<string, number>;
  skipped: number;
}

export type PreviewState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'ok'; summary: CrmImportSummary };

export type CommitState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'ok'; summary: CrmImportSummary; result: CrmImportResult };

function summarize(parse: CrmParseResult): CrmImportSummary {
  const phaseEntries = parse.companies.reduce((acc, c) => acc + c.phaseEntries.length, 0);
  return {
    companies: parse.companies.length,
    contacts: parse.contacts.length,
    startupContacts: parse.startupContacts.length,
    events: parse.events.length,
    signups: parse.signups.length,
    capital: parse.capital.length,
    ipr: parse.ipr.length,
    agreements: parse.agreements.length,
    tasks: parse.tasks.length,
    kpis: parse.kpis.length,
    phaseEntries,
    warnings: parse.warnings
  };
}

async function readUploadedFile(
  formData: FormData
): Promise<{ ok: true; buf: Buffer } | { ok: false; message: string }> {
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, message: 'Ingen fil bifogad.' };
  if (file.size === 0) return { ok: false, message: 'Filen är tom.' };
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: `Filen är större än ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
  }
  if (file.type && !ALLOWED_MIMES.has(file.type)) {
    return { ok: false, message: `Filtyp "${file.type}" stöds inte. Förväntar .xlsx (OOXML).` };
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (!isZipMagic(buf)) {
    return { ok: false, message: 'Filen ser inte ut som en .xlsx (ZIP-magic saknas).' };
  }
  return { ok: true, buf };
}

function parseUpload(
  buf: Buffer
): { parse: CrmParseResult; error?: string } {
  let xlsx;
  try {
    xlsx = parseXlsx(buf);
  } catch (err) {
    return {
      parse: emptyParse(),
      error: err instanceof Error ? err.message : 'Kunde inte läsa XLSX-filen.'
    };
  }
  const parse = parseCrmExport(xlsx.sheets);
  return { parse };
}

function emptyParse(): CrmParseResult {
  return {
    companies: [],
    contacts: [],
    startupContacts: [],
    events: [],
    signups: [],
    capital: [],
    ipr: [],
    agreements: [],
    tasks: [],
    kpis: [],
    warnings: []
  };
}

export async function previewImportCrmAction(
  _prev: PreviewState,
  formData: FormData
): Promise<PreviewState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { status: 'error', message: 'Endast inkubatorledning får köra importer.' };
  }
  const upload = await readUploadedFile(formData);
  if (!upload.ok) return { status: 'error', message: upload.message };
  const { parse, error } = parseUpload(upload.buf);
  if (error) return { status: 'error', message: error };
  return { status: 'ok', summary: summarize(parse) };
}

// Generisk upsert-helper. Söker första raden som matchar `filter` i
// tenanten; uppdaterar den, annars skapar ny. Returnerar id + om den
// skapades. Fel sväljs av anroparen.
async function upsert(
  pb: PocketBase,
  collection: string,
  filter: string,
  payload: Record<string, unknown>
): Promise<{ id: string; created: boolean }> {
  let existing: { id: string } | null = null;
  try {
    existing = await pb.collection(collection).getFirstListItem<{ id: string }>(filter);
  } catch {
    existing = null;
  }
  if (existing) {
    await pb.collection(collection).update(existing.id, payload);
    return { id: existing.id, created: false };
  }
  const rec = await pb.collection(collection).create(payload);
  return { id: rec.id as string, created: true };
}

export async function commitImportCrmAction(
  _prev: CommitState,
  formData: FormData
): Promise<CommitState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { status: 'error', message: 'Endast inkubatorledning får köra importer.' };
  }

  const upload = await readUploadedFile(formData);
  if (!upload.ok) return { status: 'error', message: upload.message };
  const { parse, error } = parseUpload(upload.buf);
  if (error) return { status: 'error', message: error };

  const summary = summarize(parse);

  const adminResult = await getSuperuserPb();
  if (!adminResult.ok) {
    return {
      status: 'error',
      message:
        adminResult.reason === 'missing_credentials'
          ? 'Superuser-credentials saknas på servern.'
          : 'Superuser-autentisering misslyckades.'
    };
  }
  const pb = adminResult.pb;
  const tenant = user.tenant;
  const syncedAt = new Date().toISOString();

  const created: Record<string, number> = {};
  const updated: Record<string, number> = {};
  let skipped = 0;
  const bump = (m: Record<string, number>, k: string) => {
    m[k] = (m[k] ?? 0) + 1;
  };

  // Korsreferens-mappar Excel-ID → PB-record-ID.
  const companyMap = new Map<string, string>();
  const contactMap = new Map<string, string>();
  const eventMap = new Map<string, string>();

  // 1. Företag → startups (upsert på org_nr, annars namn)
  for (const c of parse.companies) {
    const filter = c.org_nr
      ? `tenant = "${tenant}" && org_nr = "${esc(c.org_nr)}"`
      : `tenant = "${tenant}" && name = "${esc(c.name)}"`;
    const payload: Record<string, unknown> = {
      tenant,
      name: c.name,
      status: c.status
    };
    const set = (k: string, v: unknown) => {
      if (v !== null && v !== undefined) payload[k] = v;
    };
    set('org_nr', c.org_nr);
    set('idea_name', c.idea_name);
    set('case_type', c.case_type);
    set('status_completion_pct', c.status_completion_pct);
    set('preliminary_exit', c.preliminary_exit);
    set('company_registered_at', c.company_registered_at);
    set('email', c.email);
    set('website', c.website);
    set('city', c.city);
    set('street_address', c.street_address);
    set('postal_code', c.postal_code);
    set('description', c.description);
    set('contacted_at', c.contacted_at);
    set('phone', c.phone);
    set('founder_gender', c.founder_gender);
    set('potential_bc_case', c.potential_bc_case);
    set('signed_incubator_agreement', c.signed_incubator_agreement);
    set('signed_nda', c.signed_nda);
    set('founder_identifies_as', c.founder_identifies_as);
    set('signed_bc_agreement', c.signed_bc_agreement);
    set('is_deeptech', c.is_deeptech);
    set('inflow_source', c.inflow_source);
    set('meets_excellence_criteria', c.meets_excellence_criteria);
    set('approved_state_aid_art22', c.approved_state_aid_art22);
    set('area', c.area);
    set('signed_vinnova_incubation_approval', c.signed_vinnova_incubation_approval);
    set('approved_de_minimis', c.approved_de_minimis);
    set('sent_to', c.sent_to);
    set('register_notes', c.register_notes);
    set('is_regional', c.is_regional);
    set('signed_partner_agreement', c.signed_partner_agreement);

    let startupId: string;
    try {
      // För nya bolag: sätt default phase. För befintliga: rör inte phase
      // (staff kan ha satt den manuellt).
      let existing: { id: string } | null = null;
      try {
        existing = await pb.collection('startups').getFirstListItem<{ id: string }>(filter);
      } catch {
        existing = null;
      }
      if (existing) {
        await pb.collection('startups').update(existing.id, payload);
        startupId = existing.id;
        bump(updated, 'startups');
      } else {
        const createPayload = { ...payload, phase: 'idea' };
        const rec = await pb.collection('startups').create(createPayload);
        startupId = rec.id as string;
        bump(created, 'startups');
      }
    } catch (err) {
      console.error('[crm:import] startup upsert failed', {
        excelId: c.excelId,
        error: err instanceof Error ? err.message : 'unknown'
      });
      skipped++;
      continue;
    }

    if (c.excelId) companyMap.set(c.excelId, startupId);

    // Fashistorik — en rad per inträdesdatum (dedupe på startup+phase+datum)
    for (const pe of c.phaseEntries) {
      const phFilter = `tenant = "${tenant}" && startup = "${startupId}" && phase = "${esc(pe.phase)}" && entered_at >= "${pe.entered_at} 00:00:00" && entered_at <= "${pe.entered_at} 23:59:59"`;
      try {
        const res = await upsert(pb, 'startup_phase_history', phFilter, {
          tenant,
          startup: startupId,
          phase: pe.phase,
          entered_at: pe.entered_at,
          created_by: user.id
        });
        bump(res.created ? created : updated, 'startup_phase_history');
      } catch (err) {
        console.error('[crm:import] phase_history upsert failed', {
          startupId,
          phase: pe.phase,
          error: err instanceof Error ? err.message : 'unknown'
        });
      }
    }
  }

  // 2. Personer → contacts (upsert på email, annars namn)
  for (const ct of parse.contacts) {
    const filter = ct.email
      ? `tenant = "${tenant}" && email = "${esc(ct.email)}"`
      : `tenant = "${tenant}" && first_name = "${esc(ct.first_name)}" && last_name = "${esc(ct.last_name)}"`;
    const payload: Record<string, unknown> = {
      tenant,
      first_name: ct.first_name,
      last_name: ct.last_name,
      gdpr_consent: true,
      gdpr_consent_at: syncedAt
    };
    const set = (k: string, v: unknown) => {
      if (v !== null && v !== undefined) payload[k] = v;
    };
    set('email', ct.email);
    set('phone', ct.phone);
    set('primary_role', ct.primary_role);
    set('gender', ct.gender);
    set('skills', ct.skills);
    set('kommun', ct.kommun);
    set('info', ct.info);
    try {
      const res = await upsert(pb, 'contacts', filter, payload);
      if (ct.excelId) contactMap.set(ct.excelId, res.id);
      bump(res.created ? created : updated, 'contacts');
    } catch (err) {
      console.error('[crm:import] contact upsert failed', {
        excelId: ct.excelId,
        error: err instanceof Error ? err.message : 'unknown'
      });
      skipped++;
    }
  }

  // 3. Företag-Person → startup_contacts (kräver båda mappade)
  for (const sc of parse.startupContacts) {
    const startupId = companyMap.get(sc.companyExcelId);
    const contactId = contactMap.get(sc.personExcelId);
    if (!startupId || !contactId) {
      // Personen kan ha skippats pga GDPR-samtycke — inte ett fel.
      skipped++;
      continue;
    }
    const filter = `startup = "${startupId}" && contact = "${contactId}"`;
    const payload: Record<string, unknown> = { startup: startupId, contact: contactId };
    if (sc.role !== null) payload.role = sc.role;
    if (sc.is_primary !== null) payload.is_primary = sc.is_primary;
    try {
      const res = await upsert(pb, 'startup_contacts', filter, payload);
      bump(res.created ? created : updated, 'startup_contacts');
    } catch (err) {
      console.error('[crm:import] startup_contact upsert failed', {
        error: err instanceof Error ? err.message : 'unknown'
      });
      skipped++;
    }
  }

  // 4. Aktiviteter → incubator_events (upsert på namn + startdatum)
  for (const ev of parse.events) {
    const startsAt = ev.starts_at ?? syncedAt.slice(0, 10);
    const filter = `tenant = "${tenant}" && name = "${esc(ev.name)}" && starts_at >= "${startsAt} 00:00:00" && starts_at <= "${startsAt} 23:59:59"`;
    const payload: Record<string, unknown> = {
      tenant,
      name: ev.name,
      type: ev.type,
      status: ev.status,
      starts_at: startsAt
    };
    const set = (k: string, v: unknown) => {
      if (v !== null && v !== undefined) payload[k] = v;
    };
    set('ends_at', ev.ends_at);
    set('location', ev.location);
    set('description', ev.description);
    set('organizer', ev.organizer);
    set('target_audience', ev.target_audience);
    set('event_url', ev.event_url);
    set('internal_comment', ev.internal_comment);
    set('outcome', ev.outcome);
    set('participant_count', ev.participant_count);
    try {
      const res = await upsert(pb, 'incubator_events', filter, payload);
      if (ev.excelId) eventMap.set(ev.excelId, res.id);
      bump(res.created ? created : updated, 'incubator_events');
    } catch (err) {
      console.error('[crm:import] event upsert failed', {
        excelId: ev.excelId,
        error: err instanceof Error ? err.message : 'unknown'
      });
      skipped++;
    }
  }

  // 5. Deltagare → event_signups (kräver event mappat)
  for (const su of parse.signups) {
    const eventId = eventMap.get(su.eventExcelId);
    if (!eventId) {
      skipped++;
      continue;
    }
    const filter = `tenant = "${tenant}" && event = "${eventId}" && name = "${esc(su.name)}"`;
    const payload: Record<string, unknown> = {
      tenant,
      event: eventId,
      name: su.name,
      stage: su.stage
    };
    if (su.participant_kind) payload.participant_kind = su.participant_kind;
    if (su.note !== null) payload.note = su.note;
    // Koppla deltagaren till contact eller startup om vi kan resolva.
    if (su.participantExcelId) {
      if (su.participant_kind === 'person') {
        const cid = contactMap.get(su.participantExcelId);
        if (cid) payload.contact = cid;
      } else if (su.participant_kind === 'company') {
        const sid = companyMap.get(su.participantExcelId);
        if (sid) payload.startup = sid;
      }
    }
    try {
      const res = await upsert(pb, 'event_signups', filter, payload);
      bump(res.created ? created : updated, 'event_signups');
    } catch (err) {
      console.error('[crm:import] signup upsert failed', {
        error: err instanceof Error ? err.message : 'unknown'
      });
      skipped++;
    }
  }

  // 6. Kapital → capital_rounds (kräver bolag mappat)
  for (const cap of parse.capital) {
    const startupId = companyMap.get(cap.companyExcelId);
    if (!startupId || cap.amount_sek === null || !cap.received_at) {
      skipped++;
      continue;
    }
    const filter = `startup = "${startupId}" && source = "${esc(cap.source)}" && amount_sek = ${cap.amount_sek} && received_at >= "${cap.received_at} 00:00:00" && received_at <= "${cap.received_at} 23:59:59"`;
    const payload: Record<string, unknown> = {
      tenant,
      startup: startupId,
      type: cap.type,
      source: cap.source,
      amount_sek: cap.amount_sek,
      received_at: cap.received_at
    };
    if (cap.notes !== null) payload.notes = cap.notes;
    try {
      const res = await upsert(pb, 'capital_rounds', filter, payload);
      bump(res.created ? created : updated, 'capital_rounds');
    } catch (err) {
      console.error('[crm:import] capital upsert failed', {
        error: err instanceof Error ? err.message : 'unknown'
      });
      skipped++;
    }
  }

  // 7. IPR → intellectual_property (kräver bolag mappat)
  for (const ip of parse.ipr) {
    const startupId = companyMap.get(ip.companyExcelId);
    if (!startupId) {
      skipped++;
      continue;
    }
    const filter = ip.external_reference
      ? `startup = "${startupId}" && type = "${esc(ip.type)}" && external_reference = "${esc(ip.external_reference)}"`
      : `startup = "${startupId}" && type = "${esc(ip.type)}" && filed_at ${ip.filed_at ? `>= "${ip.filed_at} 00:00:00" && filed_at <= "${ip.filed_at} 23:59:59"` : '= ""'}`;
    const payload: Record<string, unknown> = {
      tenant,
      startup: startupId,
      type: ip.type,
      status: ip.status
    };
    const set = (k: string, v: unknown) => {
      if (v !== null && v !== undefined) payload[k] = v;
    };
    set('external_reference', ip.external_reference);
    set('filed_at', ip.filed_at);
    set('response_at', ip.response_at);
    set('notes', ip.notes);
    try {
      const res = await upsert(pb, 'intellectual_property', filter, payload);
      bump(res.created ? created : updated, 'intellectual_property');
    } catch (err) {
      console.error('[crm:import] ipr upsert failed', {
        error: err instanceof Error ? err.message : 'unknown'
      });
      skipped++;
    }
  }

  // 8. Avtal → agreements (kräver bolag mappat)
  for (const ag of parse.agreements) {
    const startupId = companyMap.get(ag.companyExcelId);
    if (!startupId) {
      skipped++;
      continue;
    }
    const title = ag.kind_label || ag.partner || 'Avtal';
    const dateClause = ag.agreement_date
      ? `agreement_date >= "${ag.agreement_date} 00:00:00" && agreement_date <= "${ag.agreement_date} 23:59:59"`
      : 'agreement_date = ""';
    const filter = `startup = "${startupId}" && title = "${esc(title)}" && ${dateClause}`;
    const payload: Record<string, unknown> = {
      startup: startupId,
      title,
      kind: ag.kind,
      status: 'signed'
    };
    const set = (k: string, v: unknown) => {
      if (v !== null && v !== undefined) payload[k] = v;
    };
    set('kind_label', ag.kind_label);
    set('partner', ag.partner);
    set('country', ag.country);
    set('agreement_date', ag.agreement_date);
    set('signed_at', ag.agreement_date);
    set('notes', ag.notes);
    try {
      const res = await upsert(pb, 'agreements', filter, payload);
      bump(res.created ? created : updated, 'agreements');
    } catch (err) {
      console.error('[crm:import] agreement upsert failed', {
        error: err instanceof Error ? err.message : 'unknown'
      });
      skipped++;
    }
  }

  // 9. ToDo → tasks (polymorf koppling)
  for (const t of parse.tasks) {
    const payload: Record<string, unknown> = {
      tenant,
      kind: t.kind,
      description: t.description,
      status: t.status,
      link_kind: t.link_kind
    };
    const set = (k: string, v: unknown) => {
      if (v !== null && v !== undefined) payload[k] = v;
    };
    set('details', t.details);
    set('starts_at', t.starts_at);
    set('due_at', t.due_at);
    set('completed_at', t.completed_at);

    // Resolva polymorf länk. Om länken ej kan resolvas → fristående task
    // (link_kind=none) istället för att tappa raden.
    let resolvedLink = false;
    if (t.link_kind === 'startup' && t.linkExcelId) {
      const sid = companyMap.get(t.linkExcelId);
      if (sid) {
        payload.startup = sid;
        resolvedLink = true;
      }
    } else if (t.link_kind === 'contact' && t.linkExcelId) {
      const cid = contactMap.get(t.linkExcelId);
      if (cid) {
        payload.contact = cid;
        resolvedLink = true;
      }
    } else if (t.link_kind === 'event' && t.linkExcelId) {
      const eid = eventMap.get(t.linkExcelId);
      if (eid) {
        payload.event = eid;
        resolvedLink = true;
      }
    }
    if (t.link_kind !== 'none' && !resolvedLink) {
      payload.link_kind = 'none';
    }

    // Dedupe på (tenant + description + due_at-dag). Saknar due_at → matcha
    // bara på description (svagare men acceptabelt för engångsmigration).
    const dueClause = t.due_at
      ? `due_at >= "${t.due_at} 00:00:00" && due_at <= "${t.due_at} 23:59:59"`
      : 'due_at = ""';
    const filter = `tenant = "${tenant}" && description = "${esc(t.description)}" && ${dueClause}`;
    try {
      const res = await upsert(pb, 'tasks', filter, payload);
      bump(res.created ? created : updated, 'tasks');
    } catch (err) {
      console.error('[crm:import] task upsert failed', {
        error: err instanceof Error ? err.message : 'unknown'
      });
      skipped++;
    }
  }

  // 10. Mätetal → startup_kpis (kräver bolag mappat)
  for (const k of parse.kpis) {
    const startupId = companyMap.get(k.companyExcelId);
    if (!startupId || !k.measured_at) {
      skipped++;
      continue;
    }
    const filter = `startup = "${startupId}" && kpi_name = "${esc(k.kpi_name)}" && measured_at >= "${k.measured_at} 00:00:00" && measured_at <= "${k.measured_at} 23:59:59"`;
    const payload: Record<string, unknown> = {
      tenant,
      startup: startupId,
      kpi_name: k.kpi_name,
      value_text: k.value_text,
      measured_at: k.measured_at
    };
    const set = (kk: string, v: unknown) => {
      if (v !== null && v !== undefined) payload[kk] = v;
    };
    set('value_numeric', k.value_numeric);
    set('is_current', k.is_current);
    try {
      const res = await upsert(pb, 'startup_kpis', filter, payload);
      bump(res.created ? created : updated, 'startup_kpis');
    } catch (err) {
      console.error('[crm:import] kpi upsert failed', {
        error: err instanceof Error ? err.message : 'unknown'
      });
      skipped++;
    }
  }

  // Audit-logg (PII-fri): bara aggregerade siffror, inget filnamn/e-post.
  const totalCreated = Object.values(created).reduce((a, b) => a + b, 0);
  const totalUpdated = Object.values(updated).reduce((a, b) => a + b, 0);
  await recordActivity(pb, {
    tenant,
    kind: 'integration_sync',
    actor: user.id,
    title: 'CRM-export (Excel) — manuell import',
    meta: `${totalCreated} rader skapade, ${totalUpdated} uppdaterade över ${Object.keys({ ...created, ...updated }).length} kollektioner${skipped > 0 ? ` · ${skipped} hoppade över` : ''}`
  });

  revalidatePath('/admin/import-crm');
  revalidatePath('/startups');
  revalidatePath('/aktivitet');

  return {
    status: 'ok',
    summary,
    result: { created, updated, skipped }
  };
}
