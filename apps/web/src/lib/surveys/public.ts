import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { toSurvey, type Survey } from './store';

// Publik (oinloggad) resolvning av enkäter på /u/<public_slug> (CLAUDE.md § 39).
// Samma princip som lib/compass/public.ts: superuser-klient, EN aktiv enkät
// resolvas på sin globalt unika slug och tenant härleds FRÅN enkäten — aldrig
// från request-bodyn. Filtervärden binds via pb.filter().
export async function resolvePublicSurvey(
  slug: string
): Promise<{ pb: PocketBase; survey: Survey } | null> {
  const s = (slug || '').trim();
  if (!s || s.length > 60) return null;
  const su = await getSuperuserPb();
  if (!su.ok) {
    console.error('[surveys] public fetch: superuser unavailable', su.reason);
    return null;
  }
  try {
    const rec = await su.pb
      .collection('surveys')
      .getFirstListItem(su.pb.filter('public_slug = {:s} && is_active = true', { s }));
    const survey = toSurvey(rec as never);
    if (!survey.tenant || survey.questions.length === 0) return null;
    return { pb: su.pb, survey };
  } catch {
    return null;
  }
}
