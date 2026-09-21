'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import type { Role } from '@platform/shared';

// CLAUDE.md § 29 — radera uppdragsdokumentation. Uppladdning sker via
// route-handlern (/api/missions/[id]/documents); radering via denna action.
// Staff-only, tenant-verifierad i koden (defense-in-depth ovanpå PB-reglerna).

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export async function deleteMissionDocumentAction(
  documentId: string,
  missionId: string
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) {
    return { ok: false, error: 'Endast personal kan radera dokumentation.' };
  }

  const pb = await getServerPb();
  let row: { id: string; tenant?: string };
  try {
    row = await pb
      .collection(PB_COLLECTIONS.missionDocuments)
      .getOne(documentId, { fields: 'id,tenant' });
  } catch {
    return { ok: false, error: 'Dokumentet hittades inte.' };
  }
  if (row.tenant !== user.tenant) {
    return { ok: false, error: 'Åtkomst nekad.' };
  }

  try {
    await pb.collection(PB_COLLECTIONS.missionDocuments).delete(documentId);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Kunde inte radera dokumentet.'
    };
  }

  revalidatePath(`/uppdrag/${missionId}`);
  return { ok: true };
}
