import 'server-only';
import type PocketBase from 'pocketbase';
import {
  buildLagesredovisning,
  PROGRAM_START,
  type BuildOptions,
  type LagesredovisningInput,
  type LagesredovisningResult,
  type PeriodWindow,
  type ServiceTimeEntry,
  type StartupServiceCost,
  type StartupReadinessAssessment,
  type StartupStateAidPeriod,
  type Startup
} from '@platform/shared';
import { escFilter } from '@/lib/pb-filter';

/** Default-timpris om varken post eller tenant har ett (underlaget: 641 kr). */
export const FALLBACK_HOURLY_RATE = 641;

async function fetchAll<T>(
  pb: PocketBase,
  collection: string,
  filter: string
): Promise<T[]> {
  try {
    return (await pb.collection(collection).getFullList({ filter, sort: '-created' })) as unknown as T[];
  } catch {
    // Kollektionen kan saknas (migration ej applicerad ännu) → degradera mjukt.
    return [];
  }
}

export interface LagesredovisningDataset extends LagesredovisningResult {
  period: PeriodWindow;
  programStart: string;
  fallbackRate: number;
  startupCount: number;
  startupList: Array<{ id: string; name: string }>;
}

/**
 * Bygger Vinnovas lägesredovisning för en tenant och period — varje cell
 * auto-fylls från systemets data (startups + tid + kostnader + readiness +
 * statsstödsperioder). Tenant-isolering enforce:as i varje filter.
 */
export async function buildVinnovaLagesredovisning(
  pb: PocketBase,
  tenant: string,
  period: PeriodWindow,
  opts?: { hourlyRate?: number }
): Promise<LagesredovisningDataset> {
  const tf = `tenant = "${escFilter(tenant)}"`;

  // Aktiva bolag i tenanten (rapporten gäller pågående statsstödsbolag).
  let startups: Startup[] = [];
  try {
    startups = (await pb.collection('startups').getFullList({
      filter: `${tf} && status = "active"`,
      sort: 'name'
    })) as unknown as Startup[];
  } catch {
    startups = [];
  }

  const [times, costs, readiness, aidPeriods] = await Promise.all([
    fetchAll<ServiceTimeEntry>(pb, 'service_time_entries', tf),
    fetchAll<StartupServiceCost>(pb, 'startup_service_costs', tf),
    fetchAll<StartupReadinessAssessment>(pb, 'startup_readiness_assessments', tf),
    fetchAll<StartupStateAidPeriod>(pb, 'startup_state_aid_periods', tf)
  ]);

  const byStartup = <T extends { startup: string }>(rows: T[]): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const arr = m.get(r.startup) || [];
      arr.push(r);
      m.set(r.startup, arr);
    }
    return m;
  };
  const timeMap = byStartup(times);
  const costMap = byStartup(costs);
  const readyMap = byStartup(readiness);
  const aidMap = byStartup(aidPeriods);

  const inputs: LagesredovisningInput[] = startups.map((s) => ({
    startup: {
      id: s.id,
      name: s.name,
      org_nr: s.org_nr,
      status: s.status,
      vinnova_focus: s.vinnova_focus,
      sni_code: s.sni_code,
      state_aid_start_at: s.state_aid_start_at,
      vinnova_funding_end_at: s.vinnova_funding_end_at
    },
    timeEntries: (timeMap.get(s.id) || []).map((t) => ({
      activity_kind: t.activity_kind,
      hours: t.hours,
      hourly_rate_sek: t.hourly_rate_sek ?? null,
      occurred_on: t.occurred_on
    })),
    costs: (costMap.get(s.id) || []).map((c) => ({
      cost_type: c.cost_type,
      amount_sek: c.amount_sek,
      incurred_on: c.incurred_on
    })),
    readiness: (readyMap.get(s.id) || []).map((r) => ({
      assessed_at: r.assessed_at,
      crl: r.crl ?? null,
      tmrl: r.tmrl ?? null,
      brl: r.brl ?? null,
      srl: r.srl ?? null,
      criteria_checked_at: r.criteria_checked_at ?? null
    })),
    stateAidPeriods: (aidMap.get(s.id) || []).map((p) => ({
      basis: p.basis,
      sni_code: p.sni_code ?? null,
      valid_from: p.valid_from,
      valid_to: p.valid_to ?? null
    }))
  }));

  const fallbackRate = opts?.hourlyRate ?? FALLBACK_HOURLY_RATE;
  const buildOpts: BuildOptions = { reportPeriod: period, programStart: PROGRAM_START, fallbackRate };
  const result = buildLagesredovisning(inputs, buildOpts);

  return {
    ...result,
    period,
    programStart: PROGRAM_START,
    fallbackRate,
    startupCount: startups.length,
    startupList: startups.map((s) => ({ id: s.id, name: s.name }))
  };
}
