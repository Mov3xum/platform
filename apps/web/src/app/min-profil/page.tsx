// Movexum OS — Min profil (CLAUDE.md § 29)
// Självservice: yrkestitel, bio och kompetenser. Driver team-matchningen.

import { requireUser, getServerPb } from '@/lib/auth.server';
import { sanitizeCompetences, type CompetenceId } from '@platform/shared';
import { PageHead } from '@/components/proto';
import { MinProfilForm } from './MinProfilForm';

export default async function MinProfilPage() {
  const user = await requireUser();
  const pb = await getServerPb();

  let title = '';
  let bio = '';
  let competences: CompetenceId[] = [];
  try {
    const rec = await pb.collection('users').getOne(user.id, {
      fields: 'id,title,bio,competences'
    });
    const r = rec as unknown as { title?: string; bio?: string; competences?: unknown };
    title = r.title || '';
    bio = r.bio || '';
    competences = sanitizeCompetences(r.competences);
  } catch {
    /* fail-soft: tomt formulär om fälten saknas (ej migrerat schema) */
  }

  return (
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb="Hemmaplan / Min profil"
        title="Min profil"
        subtitle="Din titel och dina kompetenser. Detta används för att sätta ihop tvärfunktionella team utifrån ett uppdrags behov."
      />
      <MinProfilForm
        initialTitle={title}
        initialBio={bio}
        initialCompetences={competences}
      />
    </div>
  );
}
