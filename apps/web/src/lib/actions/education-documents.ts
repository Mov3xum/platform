'use server';

import { revalidatePath } from 'next/cache';
import PocketBase from 'pocketbase';
import { getServerPb, getCurrentUser } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { escFilter } from '@/lib/pb-filter';
import type {
  EducationDocument,
  EducationDocumentAssignment,
  Role
} from '@platform/shared';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const PB_URL = getServerPbUrl();

export interface DocumentActionState {
  ok?: boolean;
  error?: string;
}

type PbErrorLike = { status?: number };

function statusOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    return (err as PbErrorLike).status;
  }
  return undefined;
}

// Superuser-fallback (samma mönster som lib/actions/workshops.ts) — PB v0.23:s
// rule-eval kan fela för annars behöriga skrivningar, och bolagsmedlemmens
// "slutför"-skrivning sker bara efter att vi verifierat behörigheten i koden.
async function getSuperuserPb(): Promise<PocketBase | null> {
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
  if (!email || !password) {
    console.error('[education-documents] superuser credentials missing');
    return null;
  }
  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);
  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    return pb;
  } catch {
    console.error('[education-documents] superuser auth failed');
    return null;
  }
}

/**
 * Tilldela ett utbildningsdokument till ett bolag (staff-only). Idempotent
 * upsert på (tenant, document, startup) — en befintlig tilldelning uppdateras
 * med nya instruktioner/deadline i stället för att skapa en dubblett.
 */
export async function assignDocumentToStartupAction(
  documentId: string,
  startupId: string,
  instructions?: string,
  dueDate?: string
): Promise<DocumentActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };
  if (!documentId || !startupId) return { error: 'Dokument och bolag krävs.' };

  const pb = await getServerPb();

  // Verifiera att dokument + bolag tillhör tenanten.
  let doc: EducationDocument;
  try {
    doc = await pb.collection(PB_COLLECTIONS.educationDocuments).getOne<EducationDocument>(documentId);
  } catch {
    return { error: 'Dokumentet hittades inte.' };
  }
  if (String(doc.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    const startup = await pb.collection('startups').getOne<{ tenant: string }>(startupId);
    if (String(startup.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };
  } catch {
    return { error: 'Bolaget hittades inte.' };
  }

  const payload: Record<string, unknown> = {
    tenant: user.tenant,
    document: documentId,
    startup: startupId,
    instructions: instructions?.slice(0, 2000) || '',
    due_date: dueDate || '',
    assigned_by: user.id
  };

  try {
    // Finns redan en tilldelning? Uppdatera den (idempotent).
    const existing = await pb
      .collection(PB_COLLECTIONS.educationDocumentAssignments)
      .getFirstListItem<EducationDocumentAssignment>(
        `tenant = "${escFilter(user.tenant)}" && document = "${escFilter(documentId)}" && startup = "${escFilter(startupId)}"`
      )
      .catch(() => null);

    const write = async (client: PocketBase) => {
      if (existing) {
        await client
          .collection(PB_COLLECTIONS.educationDocumentAssignments)
          .update(existing.id, payload);
      } else {
        await client
          .collection(PB_COLLECTIONS.educationDocumentAssignments)
          .create({ ...payload, status: 'assigned' });
      }
    };

    try {
      await write(pb);
    } catch (err) {
      const status = statusOf(err);
      if (status === 400 || status === 403) {
        const su = await getSuperuserPb();
        if (!su) throw err;
        await write(su);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('[education-documents] assign failed', {
      tenant: user.tenant,
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Tilldelningen misslyckades.' };
  }

  revalidatePath('/education/documents');
  revalidatePath(`/startups/${startupId}`);
  return { ok: true };
}

/**
 * Markera en tilldelning som slutförd. Tillåts för staff ELLER en
 * startup_member som är länkad till bolaget. Loggar en aktivitet
 * "<bolag> slutförde <dokument>" i feeden.
 */
export async function completeDocumentAssignmentAction(
  assignmentId: string
): Promise<DocumentActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!assignmentId) return { error: 'Tilldelning saknas.' };

  const pb = await getServerPb();

  let assignment: EducationDocumentAssignment;
  try {
    assignment = await pb
      .collection(PB_COLLECTIONS.educationDocumentAssignments)
      .getOne<EducationDocumentAssignment>(assignmentId, { expand: 'document,startup' });
  } catch {
    return { error: 'Tilldelningen hittades inte.' };
  }
  if (String(assignment.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };

  const isStaff = hasRole(user.roles, STAFF_ROLES);
  const isLinkedMember =
    hasRole(user.roles, ['startup_member']) &&
    user.linkedStartups.includes(String(assignment.startup));
  if (!isStaff && !isLinkedMember) return { error: 'Åtkomst nekad.' };

  if (assignment.status === 'completed') {
    return { ok: true };
  }

  const documentTitle = assignment.expand?.document?.title || 'dokument';
  const startupName = assignment.expand?.startup?.name || 'Bolaget';
  const now = new Date().toISOString();

  // Logga aktivitet först så vi kan länka den på tilldelningen.
  let activityId: string | undefined;
  try {
    const activity = await pb.collection('activities').create({
      startup: assignment.startup,
      kind: 'education_document',
      type: 'task',
      title: `${startupName} slutförde ${documentTitle}`,
      status: 'done',
      owner: user.id,
      due_date: now.slice(0, 10),
      completed_at: now
    });
    activityId = activity.id;
  } catch (err) {
    console.error('[education-documents] activity log failed', {
      tenant: user.tenant,
      error: err instanceof Error ? err.message : err
    });
  }

  const payload: Record<string, unknown> = {
    status: 'completed',
    completed_at: now,
    completed_by: user.id
  };
  if (activityId) payload.activity = activityId;

  try {
    try {
      await pb.collection(PB_COLLECTIONS.educationDocumentAssignments).update(assignmentId, payload);
    } catch (err) {
      const status = statusOf(err);
      if (status === 400 || status === 403) {
        const su = await getSuperuserPb();
        if (!su) throw err;
        await su.collection(PB_COLLECTIONS.educationDocumentAssignments).update(assignmentId, payload);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('[education-documents] complete failed', {
      tenant: user.tenant,
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte markera som slutförd.' };
  }

  revalidatePath('/education/documents');
  revalidatePath(`/startups/${assignment.startup}`);
  revalidatePath('/aktivitet');
  return { ok: true };
}

/** Ångra "slutförd" (staff-only) — sätter tillbaka status till assigned. */
export async function reopenDocumentAssignmentAction(
  assignmentId: string
): Promise<DocumentActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };

  const pb = await getServerPb();
  let assignment: EducationDocumentAssignment;
  try {
    assignment = await pb
      .collection(PB_COLLECTIONS.educationDocumentAssignments)
      .getOne<EducationDocumentAssignment>(assignmentId);
  } catch {
    return { error: 'Tilldelningen hittades inte.' };
  }
  if (String(assignment.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };

  const payload = { status: 'assigned', completed_at: '', completed_by: '', activity: '' };
  try {
    try {
      await pb.collection(PB_COLLECTIONS.educationDocumentAssignments).update(assignmentId, payload);
    } catch (err) {
      const status = statusOf(err);
      if (status === 400 || status === 403) {
        const su = await getSuperuserPb();
        if (!su) throw err;
        await su.collection(PB_COLLECTIONS.educationDocumentAssignments).update(assignmentId, payload);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('[education-documents] reopen failed', {
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte ångra.' };
  }

  revalidatePath('/education/documents');
  revalidatePath(`/startups/${assignment.startup}`);
  return { ok: true };
}

/** Ta bort en tilldelning (staff-only). Dokumentet behålls. */
export async function deleteDocumentAssignmentAction(
  assignmentId: string
): Promise<DocumentActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };

  const pb = await getServerPb();
  let assignment: EducationDocumentAssignment;
  try {
    assignment = await pb
      .collection(PB_COLLECTIONS.educationDocumentAssignments)
      .getOne<EducationDocumentAssignment>(assignmentId);
  } catch {
    return { error: 'Tilldelningen hittades inte.' };
  }
  if (String(assignment.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    try {
      await pb.collection(PB_COLLECTIONS.educationDocumentAssignments).delete(assignmentId);
    } catch (err) {
      const status = statusOf(err);
      if (status === 400 || status === 403) {
        const su = await getSuperuserPb();
        if (!su) throw err;
        await su.collection(PB_COLLECTIONS.educationDocumentAssignments).delete(assignmentId);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('[education-documents] delete assignment failed', {
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte ta bort tilldelningen.' };
  }

  revalidatePath('/education/documents');
  revalidatePath(`/startups/${assignment.startup}`);
  return { ok: true };
}

/** Ta bort ett dokument (staff-only). Tilldelningar cascade-raderas av PB. */
export async function deleteEducationDocumentAction(
  documentId: string
): Promise<DocumentActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: 'Ej inloggad.' };
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };

  const pb = await getServerPb();
  let doc: EducationDocument;
  try {
    doc = await pb.collection(PB_COLLECTIONS.educationDocuments).getOne<EducationDocument>(documentId);
  } catch {
    return { error: 'Dokumentet hittades inte.' };
  }
  if (String(doc.tenant) !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    try {
      await pb.collection(PB_COLLECTIONS.educationDocuments).delete(documentId);
    } catch (err) {
      const status = statusOf(err);
      if (status === 400 || status === 403) {
        const su = await getSuperuserPb();
        if (!su) throw err;
        await su.collection(PB_COLLECTIONS.educationDocuments).delete(documentId);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('[education-documents] delete document failed', {
      error: err instanceof Error ? err.message : err
    });
    return { error: 'Kunde inte ta bort dokumentet.' };
  }

  revalidatePath('/education/documents');
  return { ok: true };
}
