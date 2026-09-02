import 'server-only';
import type PocketBase from 'pocketbase';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import type { MissionStage, MissionType } from '@platform/shared';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { validateDateOnly, validateNonEmptyText, validateOptionalText } from './validators';
import { getRecordInTenant, writeWithFallback } from './helpers';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';

/**
 * Uppdrag (`missions`, § 29) via chatten — skapas ALLTID som UTKAST
 * (status 'draft'): teamet kopplas på (gärna med AI-teamförslaget) och
 * uppdraget startas av en människa i /uppdrag (människa-i-loopen, art. 14).
 * Agenten sätter inga deltagare — den kan inte slå upp användar-id:n
 * (`users` är denylistad, § 9.3); actorn blir lead.
 */

const MISSION_TYPES: MissionType[] = [
  'workshop',
  'sprint_x',
  'community',
  'report',
  'onboarding',
  'project',
  'custom'
];

// Speglar DEFAULT_STAGES i lib/actions/missions.ts (privat i en
// 'use server'-fil → kan inte importeras). Ändras stegen där, ändra här.
const DEFAULT_DRAFT_STAGES: Record<string, { id: string; label: string }[]> = {
  project: [
    { id: 'kickoff', label: 'Kickoff' },
    { id: 'planera', label: 'Planera' },
    { id: 'genomfor', label: 'Genomför' },
    { id: 'uppfoljning', label: 'Uppföljning' }
  ],
  custom: [
    { id: 'assigned', label: 'Tilldelat' },
    { id: 'in_progress', label: 'Utförs' },
    { id: 'done', label: 'Klart' }
  ]
};

function draftStages(type: MissionType): MissionStage[] {
  const base = DEFAULT_DRAFT_STAGES[type] ?? DEFAULT_DRAFT_STAGES.custom;
  return base.map((s) => ({ ...s, done: false }));
}

export interface CreateMissionDraftParams {
  title: string;
  type?: string | null;
  description?: string | null;
  startupId?: string | null;
  dueDate?: string | null;
}

export interface CreatedMissionDraftResult {
  missionId: string;
  title: string;
  missionPath: string;
}

export async function createMissionDraft(
  pb: PocketBase,
  actor: Actor,
  params: CreateMissionDraftParams
): Promise<WriteResult<CreatedMissionDraftResult>> {
  const policy = canCreateRecord(actor, 'missions');
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skapande nekat.'
    );
  }

  const title = validateNonEmptyText(params.title, 'title', 200);
  if (!title.ok) return fail('INVALID_VALUE', title.error);
  if (title.value.length < 2) return fail('INVALID_VALUE', 'Titel måste vara minst 2 tecken.');

  const type: MissionType = MISSION_TYPES.includes(params.type as MissionType)
    ? (params.type as MissionType)
    : 'custom';

  const description = validateOptionalText(params.description, 'description', 4000);
  if (!description.ok) return fail('INVALID_VALUE', description.error);

  const dueDate = validateDateOnly(params.dueDate, 'due_date');
  if (!dueDate.ok) return fail('INVALID_VALUE', dueDate.error);

  const startupId = params.startupId?.trim() || '';
  let startupName: string | undefined;
  if (startupId) {
    const startup = await getRecordInTenant<{ id: string; tenant?: string; name?: string }>(
      pb,
      actor,
      'startups',
      startupId,
      'id,tenant,name'
    );
    if (!startup) return fail('NOT_FOUND', 'Bolaget hittades inte i din organisation.');
    startupName = startup.name;
  }

  const now = new Date().toISOString();
  let created: { id: string };
  try {
    created = await writeWithFallback(pb, (client) =>
      client.collection(PB_COLLECTIONS.missions).create<{ id: string }>({
        tenant: actor.tenant,
        title: title.value,
        type,
        status: 'draft',
        issuer: actor.id,
        recipients: [],
        mentor: null,
        startup: startupId || null,
        startups: startupId ? [startupId] : [],
        participants_json: [
          { user_id: actor.id, role: 'lead', added_at: now, added_by: actor.id }
        ],
        visibility: 'tenant',
        due_date: dueDate.value || null,
        description: description.value ?? '',
        stages_json: draftStages(type),
        artifacts_json: [],
        accent: 'purple'
      })
    );
  } catch (err) {
    return fail('DB_ERROR', err instanceof Error ? err.message : 'Kunde inte skapa uppdraget.');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: 'missions',
    record_id: created.id,
    after_value: {
      title: title.value,
      type,
      status: 'draft',
      startup: startupId || undefined,
      startup_name: startupName,
      due_date: dueDate.value ?? undefined
    }
  });

  return ok({
    missionId: created.id,
    title: title.value,
    missionPath: `/uppdrag/${created.id}`
  });
}

export { MISSION_TYPES };
