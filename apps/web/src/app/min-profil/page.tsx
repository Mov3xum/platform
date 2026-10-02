// Movexum OS — Min profil (CLAUDE.md § 29 / § 29.7)
// Självservice: yrkestitel, bio, kompetens-hashtags med nivå och
// utvecklingsintressen. Driver teammatchningen (hashtag > område) tillsammans
// med nuvarande belastning.

import { requireUser, getServerPb } from '@/lib/auth.server';
import {
  sanitizeDevelopmentInterests,
  sanitizeUserCompetenceTags,
  type CompetenceTagDef,
  type UserCompetenceTag
} from '@platform/shared';
import { PageHead } from '@/components/proto';
import { loadCompetenceTagVocabulary, loadTeamLoads } from '@/lib/team/competence-tags.server';
import { MinProfilForm } from './MinProfilForm';

export default async function MinProfilPage() {
  const user = await requireUser();
  const pb = await getServerPb();

  const vocabulary: CompetenceTagDef[] = await loadCompetenceTagVocabulary(pb, user.tenant);

  let title = '';
  let bio = '';
  let tags: UserCompetenceTag[] = [];
  let developmentInterests: string[] = [];
  try {
    const rec = await pb.collection('users').getOne(user.id, {
      fields: 'id,title,bio,competences,competence_tags,development_interests'
    });
    const r = rec as unknown as {
      title?: string;
      bio?: string;
      competence_tags?: unknown;
      development_interests?: unknown;
    };
    title = r.title || '';
    bio = r.bio || '';
    tags = sanitizeUserCompetenceTags(r.competence_tags, vocabulary);
    developmentInterests = sanitizeDevelopmentInterests(r.development_interests);
  } catch {
    /* fail-soft: tomt formulär om fälten saknas (ej migrerat schema) */
  }

  // Egen belastning — samma räkning som teammatchningen använder, så man ser
  // vad kollegorna ser när de sätter ihop ett team.
  const loads = await loadTeamLoads(pb, user.tenant);
  const myLoad = loads.get(user.id) ?? { active: 0, leading: 0 };

  return (
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb="Dashboard / Min profil"
        title="Min profil"
        subtitle="Din titel och dina kompetenser som hashtags. Detta används när tvärfunktionella team sätts ihop utifrån ett uppdrags behov — tillsammans med hur många team du redan ingår i."
      />
      <MinProfilForm
        initialTitle={title}
        initialBio={bio}
        initialTags={tags}
        initialDevelopmentInterests={developmentInterests}
        vocabulary={vocabulary}
        load={myLoad}
      />
    </div>
  );
}
