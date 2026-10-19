import 'server-only';
import type PocketBase from 'pocketbase';
import {
  cleanIrlText,
  latestIrlReading,
  normalizeIrlAxisNotes,
  normalizeIrlLevel,
  normalizeIrlProfile,
  IRL_NOTE_MAX,
  type IrlReading
} from '@platform/shared';
import type { IrlAssessmentView } from '@/components/irl/IrlWorkspace';

/**
 * Enda läsvägen för KTH IRL-bedömningar på bolagskortet. Läser med
 * användarens token — kollektionen är staff/observer-only (§ 21.7), så en
 * bolagsmedlem får en tom lista. Fail-soft: ett läsfel ger `error` (visas)
 * i stället för en tyst tom radar.
 */
export async function loadIrlAssessments(
  pb: PocketBase,
  tenant: string,
  startupId: string,
  limit = 20
): Promise<{ assessments: IrlAssessmentView[]; error?: string }> {
  try {
    const res = await pb.collection('startup_readiness_assessments').getList<Record<string, unknown>>(1, limit, {
      filter: pb.filter('tenant = {:tenant} && startup = {:startup}', { tenant, startup: startupId }),
      sort: '-assessed_at',
      expand: 'assessed_by',
      fields: 'id,assessed_at,crl,tmrl,brl,srl,trl,iprl,frl,axis_notes,note,expand.assessed_by.display_name'
    });
    const assessments = res.items
      .map((r) => {
        const expand = r.expand as { assessed_by?: { display_name?: string } } | undefined;
        return {
          id: String(r.id),
          assessedAt: String(r.assessed_at || ''),
          assessorName: expand?.assessed_by?.display_name || undefined,
          profile: normalizeIrlProfile(r),
          srl: normalizeIrlLevel(r.srl),
          axisNotes: normalizeIrlAxisNotes(r.axis_notes),
          note: cleanIrlText(r.note, IRL_NOTE_MAX) || undefined
        } satisfies IrlAssessmentView;
      })
      // Vinnova-rader kan sakna alla KTH-axlar (bara srl) — de ritas inte.
      .filter((a) => Object.keys(a.profile).length > 0);
    return { assessments };
  } catch (err) {
    const status = typeof err === 'object' && err && 'status' in err ? (err as { status?: number }).status : undefined;
    console.error('[irl] load failed', { status });
    return { assessments: [], error: 'IRL-bedömningarna kunde inte läsas just nu.' };
  }
}

/**
 * Bolagets gällande IRL (CLAUDE.md § 52.2) — samma bedömning som
 * bolagskortets radar visar som senaste (`latestIrlReading`). Delas av
 * Bedömning excellens (§ 51) och flytten av IRL-svar till bolagskortet, så
 * IRL har EN källa. `null` = ingen bedömning; ett läsfel kastas vidare.
 */
export async function loadLatestIrlReading(pb: PocketBase, tenant: string, startupId: string): Promise<IrlReading | null> {
  const res = await pb.collection('startup_readiness_assessments').getList<Record<string, unknown>>(1, 20, {
    filter: pb.filter('tenant = {:tenant} && startup = {:startup}', { tenant, startup: startupId }),
    sort: '-assessed_at',
    fields: 'assessed_at,crl,tmrl,brl,srl,trl,iprl,frl,axis_notes'
  });
  return latestIrlReading(res.items);
}
