// Movexum OS — Nytt tvärfunktionellt team (uppdrag/projekt)
// Formulär för att sätta upp ett team runt ett uppdrag. Stages auto-genereras
// utifrån typ. Deltagare = Movexum-personal (CLAUDE.md § 29) — bolagsmedlemmar,
// observatörer och externa kontakter listas inte.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { ALL_ROLES, type CompetenceId, type Role, type TeamMemberLoad, type UserCompetenceTag } from '@platform/shared';
import {
  loadCompetenceTagVocabulary,
  loadStaffProfiles,
  loadTeamCap,
  loadTeamLoadsForCap
} from '@/lib/team/competence-tags.server';
import { PageHead, Icon } from '@/components/proto';
import { NewMissionForm } from './NewMissionForm';
import { createMissionAction } from '@/lib/actions/missions';

interface UserOption {
  id: string;
  label: string;
  competences?: CompetenceId[];
  tags?: UserCompetenceTag[];
  load?: TeamMemberLoad;
}

interface StartupOption {
  id: string;
  name: string;
}

const MEMBER_ROLES: Role[] = ALL_ROLES.filter((r) => r !== 'observer');

export default async function NewMissionPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, MEMBER_ROLES)) {
    redirect('/uppdrag');
  }

  const pb = await getServerPb();
  let users: UserOption[] = [];
  let startups: StartupOption[] = [];

  // Kompetensprofiler (hashtags/nivå) + nuvarande belastning (§ 29.7) —
  // samma läsväg som teamförslaget, så pickern visar vad AI:n ser.
  // Belastning + teamtak (§ 29.7): räknas över hela tenanten (bara räknare)
  // och visas bara för staff — en bolagsmedlem ser inga kollegors belastning.
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const vocabulary = await loadCompetenceTagVocabulary(pb, user.tenant);
  const [profiles, { loads }, teamCap] = await Promise.all([
    loadStaffProfiles(pb, user.tenant, vocabulary),
    isStaff ? loadTeamLoadsForCap(pb, user.tenant) : Promise.resolve({ loads: new Map(), complete: false }),
    loadTeamCap(pb, user.tenant)
  ]);
  // Bara Movexum-personal kan ingå i ett tvärfunktionellt team.
  users = profiles
    .filter((p) => p.isStaff)
    .map((p) => ({
      id: p.id,
      label: p.name,
      competences: p.competences,
      tags: p.tags,
      load: isStaff ? (loads.get(p.id) ?? { active: 0, leading: 0 }) : undefined
    }));

  try {
    const res = await pb.collection('startups').getList(1, 100, {
      filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
      sort: 'name'
    });
    startups = res.items.map((s) => {
      const rec = s as unknown as { id: string; name: string };
      return { id: String(rec.id), name: rec.name };
    });
  } catch {
    /* ignore */
  }

  return (
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb="Hemmaplan / Tvärfunktionella team / Nytt"
        title="Nytt tvärfunktionellt team"
        subtitle="Beskriv uppdraget, låt AI:n föreslå kollegor utifrån deras kompetenstaggar, koppla bolag och starta samarbetet. Stegen i flödet skapas utifrån typ."
        actions={
          <Link href="/uppdrag" className="mx-btn mx-sm mx-ghost">
            <Icon name="arrow" size={12} /> Tillbaka
          </Link>
        }
      />

      <NewMissionForm
        action={createMissionAction}
        users={users}
        startups={startups}
        currentUserId={user.id}
        teamCap={teamCap}
      />
    </div>
  );
}
