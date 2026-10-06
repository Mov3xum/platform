import 'server-only';
import type PocketBase from 'pocketbase';
import { ACTIVE_MISSION_STATUSES, membersOverTeamCap } from '@platform/shared';
import { loadTeamCap, loadTeamLoadsForCap } from '@/lib/team/competence-tags.server';

// CLAUDE.md § 29.7 — teamtaket som HÅRD gräns: en person som redan ingår i
// `cap` pågående team kan inte läggas till i ytterligare ett pågående team.
// Prövas i server-actions (klienten är aldrig säkerhetsgränsen) när ett
// uppdrag skapas som pågående, när deltagare läggs till i ett pågående
// uppdrag och när ett utkast/avslutat uppdrag blir pågående igen.

export function isActiveMissionStatus(status: string | null | undefined): boolean {
  return (ACTIVE_MISSION_STATUSES as readonly string[]).includes(String(status ?? ''));
}

/**
 * Returnerar ett svenskt felmeddelande när någon av `memberIds` (utom de i
 * `alreadyInMission`) redan nått taket, annars null. Visningsnamn — aldrig
 * e-post — slås upp med anroparens token.
 */
export async function teamCapViolation(
  pb: PocketBase,
  tenantId: string,
  memberIds: readonly string[],
  alreadyInMission: readonly string[] = []
): Promise<string | null> {
  if (memberIds.length === 0) return null;
  const [cap, loads] = await Promise.all([loadTeamCap(pb, tenantId), loadTeamLoadsForCap(pb, tenantId)]);
  const blocked = membersOverTeamCap(memberIds, loads.loads, cap, alreadyInMission);
  if (blocked.length === 0) return null;

  const names: string[] = [];
  for (const id of blocked.slice(0, 5)) {
    try {
      const u = await pb.collection('users').getOne<{ display_name?: string }>(id, { fields: 'id,display_name' });
      names.push(u.display_name?.trim() || 'En kollega');
    } catch {
      names.push('En kollega');
    }
  }
  const who = names.join(', ') + (blocked.length > names.length ? ` m.fl.` : '');
  return `${who} ingår redan i ${cap} pågående team, vilket är taket (max ${cap} samtidigt). Avsluta ett team, välj någon annan, eller be ledningen höja taket under Inställningar → Kompetenser.`;
}
