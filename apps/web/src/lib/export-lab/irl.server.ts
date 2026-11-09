import 'server-only';
import type PocketBase from 'pocketbase';
import type { ExportIrlSource } from '@platform/shared';
import { loadLatestIrlReading } from '@/lib/irl/data.server';

/**
 * Bolagets gällande KTH IRL för Export Lab (CLAUDE.md § 58 / § 52.2) — samma
 * bedömning som bolagskortets radar visar som senaste. IRL har EN källa;
 * Export Lab läser den och skriver aldrig. Fail-soft: ett läsfel ger `null`
 * (analysen körs då utan IRL och säger det) — aldrig ett tyst 0.
 */
export async function loadExportIrl(pb: PocketBase, tenant: string, startupId: string): Promise<ExportIrlSource | null> {
  try {
    const reading = await loadLatestIrlReading(pb, tenant, startupId);
    if (!reading || Object.keys(reading.profile).length === 0) return null;
    return { profile: reading.profile, axisNotes: reading.axisNotes, assessedAt: reading.assessedAt };
  } catch (err) {
    console.warn('[exportlab] irl read failed', { status: (err as { status?: number })?.status ?? 0 });
    return null;
  }
}
