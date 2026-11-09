import 'server-only';
import type PocketBase from 'pocketbase';
import { revalidatePath } from 'next/cache';
import { writeWithFallback } from '@/lib/core/write/helpers';
import { getStartupIds } from '@/lib/missions-server';
import type { Mission, MissionStatus } from '@platform/shared';

// CLAUDE.md § 29.4 — när ett tvärfunktionellt team (uppdrag/projekt) når
// status `done` sammanställs det på varje kopplat bolagskort:
//   1. en `activities`-rad (kind='mission', status='done') per bolag så att
//      slutförandet syns i bolagskortets Aktiviteter + den globala feeden,
//   2. sektionen "Tvärfunktionella team" på bolagskortet läser själva
//      uppdraget (team, steg, dokumentation) live — ingen kopia lagras.
//
// PII-fritt: titeln bär bara uppdragets titel (verksamhetsdata). Fail-soft:
// en instans utan migration 1700000155 eller ett skrivfel blockerar aldrig
// statusändringen. Superuser-fallback bara vid PB v0.23.4:s tysta
// regel-nekande (§ 21.3) — rollen/behörigheten är redan prövad av anroparen.

export const MISSION_ACTIVITY_KIND = 'mission';

/** Sant när övergången previous → next innebär att uppdraget slutförs. */
export function isMissionCompletionTransition(
  previous: MissionStatus,
  next: MissionStatus
): boolean {
  return next === 'done' && previous !== 'done';
}

export function missionCompletionActivityTitle(title: string): string {
  const t = String(title || '').trim().slice(0, 150) || 'Uppdrag';
  return `Tvärfunktionellt team slutfört: ${t}`;
}

/**
 * Loggar slutförandet på varje bolag uppdraget är kopplat till och
 * revaliderar bolagskorten. Returnerar antal skrivna rader (0 = inga bolag
 * eller alla skrivningar föll — aldrig ett kastat fel).
 */
export async function logMissionCompletion(
  pb: PocketBase,
  mission: Mission,
  actorId: string
): Promise<number> {
  const startupIds = getStartupIds(mission);
  if (startupIds.length === 0) return 0;

  const title = missionCompletionActivityTitle(mission.title);
  const completedAt = new Date().toISOString();
  let written = 0;

  for (const startupId of startupIds) {
    try {
      await writeWithFallback(pb, (client) =>
        client.collection('activities').create({
          startup: startupId,
          type: 'task',
          kind: MISSION_ACTIVITY_KIND,
          title,
          status: 'done',
          owner: actorId,
          completed_at: completedAt
        })
      );
      written += 1;
    } catch {
      /* fail-soft — sammanställningen på kortet läser uppdraget direkt */
    }
    revalidatePath(`/startups/${startupId}`);
  }
  revalidatePath('/aktivitet');
  return written;
}
