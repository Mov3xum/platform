import 'server-only';
import { mergeCompetenceTagVocabulary, type CompetenceTagDef } from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';

/**
 * Hashtag-vokabulären för ytor där användaren INTE får läsa `competence_tags`
 * (bolagsmedlemmar — kollektionen är staff/observer-only, § 29.7). Läses med
 * superusern men bär bara slug/etikett/område — inga personuppgifter. Samma
 * sammanslagning (seed + tenantens taggar) som personalens vy.
 */
export async function loadPublicTagVocabularyForTenant(tenant: string): Promise<CompetenceTagDef[]> {
  const su = await getSuperuserPb();
  if (!su.ok) return mergeCompetenceTagVocabulary([]);
  try {
    const rows = await su.pb.collection('competence_tags').getList<Record<string, unknown>>(1, 500, {
      filter: su.pb.filter('tenant = {:tenant}', { tenant }),
      fields: 'slug,label,area,status'
    });
    return mergeCompetenceTagVocabulary(rows.items);
  } catch {
    return mergeCompetenceTagVocabulary([]);
  }
}
