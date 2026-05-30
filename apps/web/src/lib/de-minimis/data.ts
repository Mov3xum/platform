import 'server-only';
import type PocketBase from 'pocketbase';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { hasRole } from '@/lib/rbac';
import {
  DEFAULT_DE_MINIMIS_REGELVERK,
  FORORDNING_KODER,
  type DeMinimisRegel,
  type DeMinimisRegelverkRecord
} from '@platform/shared';
import type { SessionUser } from '@/lib/auth.server';
import type { Role } from '@platform/shared';

export const DE_MINIMIS_STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

/** Får användaren hantera ett bolags de minimis-data? Staff alltid; en
 * `startup_member` bara för sitt eget länkade bolag. */
export function canManageStartupDeMinimis(user: SessionUser, startupId: string): boolean {
  if (hasRole(user.roles, DE_MINIMIS_STAFF_ROLES)) return true;
  if (hasRole(user.roles, ['startup_member']) && user.linkedStartups.includes(startupId)) {
    return true;
  }
  return false;
}

/**
 * Laddar regelverket från `de_minimis_regelverk`-collectionen och faller
 * tillbaka på de kanoniska defaults om en kod saknas (eller hela
 * collectionen är tom). Garanterar alltid att alla fyra koderna finns.
 */
export async function loadRegelverk(pb: PocketBase): Promise<DeMinimisRegel[]> {
  let rows: DeMinimisRegelverkRecord[] = [];
  try {
    rows = await pb
      .collection(PB_COLLECTIONS.deMinimisRegelverk)
      .getFullList<DeMinimisRegelverkRecord>({ sort: 'sort_order' });
  } catch {
    rows = [];
  }

  return FORORDNING_KODER.map((kod) => {
    const found = rows.find((r) => r.kod === kod);
    const fallback = DEFAULT_DE_MINIMIS_REGELVERK.find((r) => r.kod === kod)!;
    if (!found) return fallback;
    return {
      kod,
      forordning_text: found.forordning_text || fallback.forordning_text,
      tillampning: found.tillampning || fallback.tillampning,
      tak_eur:
        typeof found.tak_eur === 'number' && found.tak_eur >= 0
          ? found.tak_eur
          : fallback.tak_eur,
      period: found.period || fallback.period,
      giltig_t_o_m: found.giltig_t_o_m || fallback.giltig_t_o_m
    };
  });
}
