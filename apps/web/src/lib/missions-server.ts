import 'server-only';
import type { Mission, MissionParticipant, MissionParticipantRole, Role } from '@platform/shared';
import { hasRole } from '@/lib/rbac';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach'];

export interface MissionContext {
  canView: boolean;
  canEdit: boolean;
  canComment: boolean;
  canChangeStatus: boolean;
  canAdvanceStage: boolean;
  isParticipant: boolean;
  isObserver: boolean;
  participantRole?: MissionParticipantRole;
  allParticipantIds: string[];
  primaryStartupId?: string;
  startupIds: string[];
}

function readParticipants(mission: Mission): MissionParticipant[] {
  const raw = mission.participants_json;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is MissionParticipant =>
      !!p && typeof p === 'object' && typeof (p as MissionParticipant).user_id === 'string'
  );
}

export function unionParticipantIds(mission: Mission): string[] {
  const ids = new Set<string>();
  if (mission.issuer) ids.add(mission.issuer);
  if (mission.mentor) ids.add(mission.mentor);
  for (const r of mission.recipients || []) ids.add(r);
  for (const p of readParticipants(mission)) ids.add(p.user_id);
  return Array.from(ids);
}

export function getStartupIds(mission: Mission): string[] {
  const ids: string[] = [];
  if (Array.isArray(mission.startups)) {
    for (const id of mission.startups) {
      if (typeof id === 'string' && id) ids.push(id);
    }
  }
  if (mission.startup && !ids.includes(mission.startup)) {
    ids.unshift(mission.startup);
  }
  return ids;
}

export function getParticipantRole(
  mission: Mission,
  userId: string
): MissionParticipantRole | undefined {
  const participants = readParticipants(mission);
  const direct = participants.find((p) => p.user_id === userId);
  if (direct) return direct.role;
  // Bakåtkompat: existerande missions utan participants_json — tolka
  // issuer som lead, mentor som observer, recipients som contributor.
  if (mission.issuer === userId) return 'lead';
  if (mission.mentor === userId) return 'observer';
  if (Array.isArray(mission.recipients) && mission.recipients.includes(userId)) {
    return 'contributor';
  }
  return undefined;
}

export function getMissionContext(
  mission: Mission,
  userId: string,
  userRoles: Role[] | undefined
): MissionContext {
  const isStaff = hasRole(userRoles, STAFF_ROLES);
  const isAdmin = hasRole(userRoles, ['admin', 'incubator_lead']);
  const isOnlyObserverRole = hasRole(userRoles, ['observer']) && !hasRole(userRoles, [
    'admin',
    'incubator_lead',
    'coach',
    'mentor',
    'partner',
    'startup_member'
  ]);

  const participantRole = getParticipantRole(mission, userId);
  const isParticipant = participantRole !== undefined;
  const isObserverParticipant = participantRole === 'observer';

  const startupIds = getStartupIds(mission);
  const allParticipantIds = unionParticipantIds(mission);

  // Synlighet
  const tenantWide = (mission.visibility ?? 'tenant') === 'tenant';
  const canView = isStaff || tenantWide || isParticipant;

  // Skrivrättigheter
  const canEdit = isAdmin || mission.issuer === userId;
  const canComment =
    canView && !isOnlyObserverRole && !isObserverParticipant;
  const canChangeStatus =
    isStaff ||
    (isParticipant && participantRole !== 'observer');
  const canAdvanceStage = canChangeStatus;

  return {
    canView,
    canEdit,
    canComment,
    canChangeStatus,
    canAdvanceStage,
    isParticipant,
    isObserver: isObserverParticipant || isOnlyObserverRole,
    participantRole,
    allParticipantIds,
    primaryStartupId: startupIds[0],
    startupIds
  };
}

export function deriveRecipientsFromParticipants(participants: MissionParticipant[]): string[] {
  return participants
    .filter((p) => p.role !== 'observer')
    .map((p) => p.user_id);
}
