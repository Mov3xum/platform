import 'server-only';
import type PocketBase from 'pocketbase';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { escFilter } from '@/lib/pb-filter';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { validateDateOnly, validateOptionalText } from './validators';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Tilldelningar via chatten (§ 33): workshop → bolag och utbildningsdokument
 * → bolag. Speglar UI-flödena (`assignWorkshopToStartupAction`,
 * `assignDocumentToStartupAction`) men utan samarbets-/mötesdelen —
 * medarbetare bjuds in och möten bokas av en människa i UI:t (§ 18.4).
 * Tenant för workshop/dokument/bolag verifieras alltid mot actorn;
 * varje tilldelning loggas i `agent_actions`.
 */

export interface AssignWorkshopParams {
  workshopId: string;
  startupId: string;
  dueDate?: string | null;
  instructions?: string | null;
}

export interface AssignedWorkshopResult {
  assignmentId: string;
  workshopTitle: string;
  startupName: string;
  startupPath: string;
}

export async function assignWorkshop(
  pb: PocketBase,
  actor: Actor,
  params: AssignWorkshopParams
): Promise<WriteResult<AssignedWorkshopResult>> {
  const policy = canCreateRecord(actor, 'workshop_assignments');
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Tilldelning nekad.'
    );
  }

  const dueDate = validateDateOnly(params.dueDate, 'due_date');
  if (!dueDate.ok) return fail('INVALID_VALUE', dueDate.error);
  const instructions = validateOptionalText(params.instructions, 'instructions', 2000);
  if (!instructions.ok) return fail('INVALID_VALUE', instructions.error);

  const workshop = await getRecordInTenant<{ id: string; tenant?: string; title?: string }>(
    pb,
    actor,
    PB_COLLECTIONS.workshops,
    params.workshopId.trim(),
    'id,tenant,title'
  );
  if (!workshop) return fail('NOT_FOUND', 'Workshopen hittades inte i din organisation.');

  const startup = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(
    pb,
    actor,
    'startups',
    params.startupId.trim(),
    'id,tenant,name'
  );
  if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');

  const workshopTitle = workshop.title || 'Workshop';
  const startupName = startup.name || 'bolaget';

  // Dubbelvakt: samma workshop ska inte tilldelas samma bolag två gånger av
  // misstag från chatten. Finns en tilldelning redan berättar vi det i stället
  // (en medveten om-tilldelning görs i UI:t).
  try {
    const existing = await pb
      .collection(PB_COLLECTIONS.workshopAssignments)
      .getFirstListItem(
        `tenant = "${escFilter(actor.tenant)}" && workshop = "${escFilter(workshop.id)}" && startup = "${escFilter(startup.id)}"`,
        { fields: 'id,status' }
      )
      .catch(() => null);
    if (existing) {
      return fail(
        'INVALID_VALUE',
        `"${workshopTitle}" är redan tilldelad ${startupName} (status: ${String(
          (existing as { status?: string }).status ?? 'okänd'
        )}). Vill personalen tilldela om görs det i /education.`
      );
    }
  } catch {
    /* kunde inte läsa — låt skapandet avgöra */
  }

  let assignment: { id: string };
  let writeClient: PocketBase = pb;
  try {
    assignment = await writeWithFallback(pb, (client) => {
      writeClient = client;
      return client.collection(PB_COLLECTIONS.workshopAssignments).create<{ id: string }>({
        tenant: actor.tenant,
        workshop: workshop.id,
        startup: startup.id,
        assigned_by: actor.id,
        owner: actor.id,
        status: 'planned',
        due_date: dueDate.value || null,
        // Person nr lagras aldrig (§ 9.4) — sanera fritexten på skrivvägen.
        instructions: instructions.value ? sanitizePersonnummer(instructions.value) : '',
        progress_json: {},
        answers_json: {},
        takeaway_json: {},
        artifacts_json: {},
        ai_thread_json: []
      });
    });
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte tilldela workshopen.');
  }

  // Aktivitetsfeed-rad (samma som UI-flödet). Fail-soft — tilldelningen är
  // redan gjord; ett logg-fel får inte se ut som ett misslyckande.
  try {
    const activity = await writeClient.collection('activities').create<{ id: string }>({
      startup: startup.id,
      type: 'workshop',
      title: `${workshopTitle} – tilldelad workshop`,
      status: 'planned',
      kind: 'workshop_assignment',
      workshop: workshop.id,
      workshop_assignment: assignment.id,
      owner: actor.id,
      due_date: dueDate.value || new Date().toISOString().slice(0, 10)
    });
    await writeClient
      .collection(PB_COLLECTIONS.workshopAssignments)
      .update(assignment.id, { activity: activity.id });
  } catch {
    /* fail-soft */
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: 'workshop_assignments',
    record_id: assignment.id,
    after_value: {
      workshop: workshop.id,
      workshop_title: workshopTitle,
      startup: startup.id,
      startup_name: startupName,
      due_date: dueDate.value ?? undefined
    }
  });

  return ok({
    assignmentId: assignment.id,
    workshopTitle,
    startupName,
    startupPath: `/startups/${startup.id}`
  });
}

export interface AssignEducationDocumentParams {
  documentId: string;
  startupId: string;
  instructions?: string | null;
  dueDate?: string | null;
}

export interface AssignedEducationDocumentResult {
  assignmentId: string;
  documentTitle: string;
  startupName: string;
  startupPath: string;
  /** true när en befintlig tilldelning uppdaterades i stället för att skapas. */
  updatedExisting: boolean;
}

export async function assignEducationDocument(
  pb: PocketBase,
  actor: Actor,
  params: AssignEducationDocumentParams
): Promise<WriteResult<AssignedEducationDocumentResult>> {
  const policy = canCreateRecord(actor, 'education_document_assignments');
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Tilldelning nekad.'
    );
  }

  const dueDate = validateDateOnly(params.dueDate, 'due_date');
  if (!dueDate.ok) return fail('INVALID_VALUE', dueDate.error);
  const instructions = validateOptionalText(params.instructions, 'instructions', 2000);
  if (!instructions.ok) return fail('INVALID_VALUE', instructions.error);

  const doc = await getRecordInTenant<{ id: string; tenant?: string; title?: string }>(
    pb,
    actor,
    PB_COLLECTIONS.educationDocuments,
    params.documentId.trim(),
    'id,tenant,title'
  );
  if (!doc) return fail('NOT_FOUND', 'Utbildningsdokumentet hittades inte i din organisation.');

  const startup = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(
    pb,
    actor,
    'startups',
    params.startupId.trim(),
    'id,tenant,name'
  );
  if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');

  const documentTitle = doc.title || 'Dokument';
  const startupName = startup.name || 'bolaget';

  const payload: Record<string, unknown> = {
    tenant: actor.tenant,
    document: doc.id,
    startup: startup.id,
    // Person nr lagras aldrig (§ 9.4) — sanera fritexten på skrivvägen.
    instructions: instructions.value ? sanitizePersonnummer(instructions.value) : '',
    due_date: dueDate.value || '',
    assigned_by: actor.id
  };

  // Idempotent upsert på (tenant, document, startup) — samma som UI:t.
  let existingId: string | null = null;
  try {
    const existing = await pb
      .collection(PB_COLLECTIONS.educationDocumentAssignments)
      .getFirstListItem(
        `tenant = "${escFilter(actor.tenant)}" && document = "${escFilter(doc.id)}" && startup = "${escFilter(startup.id)}"`,
        { fields: 'id' }
      )
      .catch(() => null);
    existingId = existing ? String((existing as { id: string }).id) : null;
  } catch {
    /* skapa nytt */
  }

  let assignmentId = existingId ?? '';
  try {
    if (existingId) {
      const idToUpdate = existingId;
      await writeWithFallback(pb, (client) =>
        client.collection(PB_COLLECTIONS.educationDocumentAssignments).update(idToUpdate, payload)
      );
    } else {
      const created = await writeWithFallback(pb, (client) =>
        client
          .collection(PB_COLLECTIONS.educationDocumentAssignments)
          .create<{ id: string }>({ ...payload, status: 'assigned' })
      );
      assignmentId = created.id;
    }
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Tilldelningen misslyckades.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: existingId ? 'update' : 'create',
    collection: 'education_document_assignments',
    record_id: assignmentId,
    after_value: {
      document: doc.id,
      document_title: documentTitle,
      startup: startup.id,
      startup_name: startupName,
      due_date: dueDate.value ?? undefined
    }
  });

  return ok({
    assignmentId,
    documentTitle,
    startupName,
    startupPath: `/startups/${startup.id}`,
    updatedExisting: Boolean(existingId)
  });
}
