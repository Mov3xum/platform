import 'server-only';
import { listAllForTenant } from '@/lib/pb.server';
import {
  buildPortfolioMap,
  irlAverageByStartup,
  type PortfolioMapData,
  type PortfolioMapPhaseEntry,
  type PortfolioMapStartupInput
} from '@platform/shared';

/**
 * Läsvägen för portföljkartan på Översikt (CLAUDE.md § 37.7). Allt läses med
 * användarens token (RLS § 21). Bolagen krävs — kan de inte läsas kastas felet
 * vidare. IRL-bedömningar och fashistorik är fail-soft: kartan ritas ändå, med
 * en notering om vad som saknas.
 */

const STARTUP_FIELDS = 'id,name,phase,status,irl_level,intagsdatum,created,owner,coaches';
// Alumner, pausade och avböjda bolag hör inte hemma på kartan — de filtreras
// redan i frågan (och en gång till i `buildPortfolioMap`).
const STARTUP_FILTER =
  'phase != "alumni" && phase != "paus" && status != "alumni" && status != "rejected" && status != "paused"';
const IRL_FIELDS = 'startup,assessed_at,crl,tmrl,brl,srl,trl,iprl,frl';
const MAX_STARTUPS = 5_000;
const MAX_ROWS = 20_000;

export interface PortfolioMapResult {
  data: PortfolioMapData;
  /** Ärliga noteringar om underlaget (kapning, saknade källor). */
  notices: string[];
}

export async function loadPortfolioMap(userId: string, today: string): Promise<PortfolioMapResult> {
  const [startupsRes, irlRes, historyRes] = await Promise.allSettled([
    listAllForTenant<PortfolioMapStartupInput>('startups', {
      filter: STARTUP_FILTER,
      sort: 'id',
      fields: STARTUP_FIELDS,
      scopeToStartupField: 'id',
      maxRows: MAX_STARTUPS
    }),
    listAllForTenant<Record<string, unknown>>('startup_readiness_assessments', {
      sort: '-assessed_at',
      fields: IRL_FIELDS,
      scopeToStartupField: 'startup',
      maxRows: MAX_ROWS
    }),
    listAllForTenant<PortfolioMapPhaseEntry>('startup_phase_history', {
      sort: '-entered_at',
      fields: 'startup,phase,entered_at',
      scopeToStartupField: 'startup',
      maxRows: MAX_ROWS
    })
  ]);

  if (startupsRes.status !== 'fulfilled') throw startupsRes.reason;

  const notices: string[] = [];
  if (!startupsRes.value.complete) {
    notices.push(`Kartan bygger på de första ${startupsRes.value.items.length} av ${startupsRes.value.total} bolag.`);
  }

  let irlByStartup = new Map<string, number>();
  if (irlRes.status === 'fulfilled') {
    irlByStartup = irlAverageByStartup(irlRes.value.items);
    if (!irlRes.value.complete) {
      notices.push(`IRL bygger på de ${irlRes.value.items.length} senaste av ${irlRes.value.total} bedömningar.`);
    }
  } else {
    notices.push('IRL-bedömningarna kunde inte läsas — kartan visar bolagskortets reservvärde.');
    console.error('[portfolio-map] irl read failed', { status: statusOf(irlRes.reason) });
  }

  let phaseEntries: PortfolioMapPhaseEntry[] = [];
  if (historyRes.status === 'fulfilled') {
    phaseEntries = historyRes.value.items;
    if (!historyRes.value.complete) {
      notices.push('Fashistoriken är kapad — för en del bolag räknas tiden från intagsdatum.');
    }
  } else {
    notices.push('Fashistoriken kunde inte läsas — tiden räknas från intagsdatum.');
    console.error('[portfolio-map] phase history read failed', { status: statusOf(historyRes.reason) });
  }

  const data = buildPortfolioMap({
    startups: startupsRes.value.items,
    irlByStartup,
    phaseEntries,
    today,
    userId
  });
  if (data.missingIrl > 0) {
    notices.push(
      data.missingIrl === 1
        ? '1 bolag saknar IRL och visas inte på kartan.'
        : `${data.missingIrl} bolag saknar IRL och visas inte på kartan.`
    );
  }
  if (data.approxSince > 0) {
    notices.push(
      data.approxSince === 1
        ? '1 bolag saknar inskrivningsdatum — tiden räknas från att bolaget lades in i systemet.'
        : `${data.approxSince} bolag saknar inskrivningsdatum — tiden räknas från att de lades in i systemet.`
    );
  }
  return { data, notices };
}

function statusOf(err: unknown): number | undefined {
  return typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined;
}
