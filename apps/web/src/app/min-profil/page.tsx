// Movexum OS — Min profil (CLAUDE.md § 29 / § 29.7)
// Självservice: yrkestitel, bio, kompetens-hashtags med nivå och
// utvecklingsintressen. Driver teammatchningen (hashtag > område) tillsammans
// med nuvarande belastning mot teamtaket. Samma formulär finns i Mitt konto.

import { requireUser, getServerPb } from '@/lib/auth.server';
import { PageHead } from '@/components/proto';
import { loadMyCompetenceProfile } from '@/lib/team/my-competence-profile.server';
import { MinProfilForm } from './MinProfilForm';

export default async function MinProfilPage() {
  const user = await requireUser();
  const pb = await getServerPb();
  const p = await loadMyCompetenceProfile(pb, user);

  return (
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb="Dashboard / Min profil"
        title="Min profil"
        subtitle="Din titel och dina kompetenser som hashtags. Detta används när tvärfunktionella team sätts ihop utifrån ett uppdrags behov — tillsammans med hur många team du redan ingår i."
      />
      <MinProfilForm
        initialTitle={p.title}
        initialBio={p.bio}
        initialTags={p.tags}
        initialDevelopmentInterests={p.developmentInterests}
        vocabulary={p.vocabulary}
        load={p.load}
        competenceUpdatedAt={p.competenceUpdatedAt}
        teamCap={p.teamCap}
      />
    </div>
  );
}
