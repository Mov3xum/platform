// Inställningar → Kompetenser (CLAUDE.md § 29.7, steg 3).
// Ledningens vy över hashtag-vokabulären: godkännandekö, täckning per
// hashtag (antal personer + nivåer + lärande), kompetensgap (taggar ingen
// har, och taggar som efterfrågats av uppdrag utan täckning) och
// inaktuella profiler. Allt läses med användarens token (RLS § 21) och
// räknas live av ren, enhetstestad logik i @platform/shared — inget lagras.

import {
  competenceCoverageGaps,
  competenceProfileStatus,
  summarizeCompetenceCoverage,
  uncoveredNeededTags,
  type CompetenceProfileStatus
} from '@platform/shared';
import { getServerPb } from '@/lib/auth.server';
import {
  loadCompetenceTagRecords,
  loadCompetenceTagVocabulary,
  loadCompletedMissions,
  loadStaffProfiles,
  loadTeamCapSetting,
  loadTeamLoadsForCap
} from '@/lib/team/competence-tags.server';
import { TeamCapCard, type TeamCapPerson } from './TeamCapCard';
import { requireSettingsUser, SettingsSectionPage } from '../shared';
import { CompetenceTagsManager, type StaffProfileRow } from './CompetenceTagsManager';

export const dynamic = 'force-dynamic';

export default async function KompetenserPage() {
  const user = await requireSettingsUser();
  const pb = await getServerPb();

  const { rows: tagRecords, error: vocabularyError } = await loadCompetenceTagRecords(pb, user.tenant);
  const vocabulary = await loadCompetenceTagVocabulary(pb, user.tenant);
  const [profiles, { missions: completedMissions, complete: missionsComplete }, capSetting, teamLoads] =
    await Promise.all([
      loadStaffProfiles(pb, user.tenant, vocabulary),
      loadCompletedMissions(pb, user.tenant),
      loadTeamCapSetting(pb, user.tenant),
      loadTeamLoadsForCap(pb, user.tenant)
    ]);

  const staff = profiles.filter((p) => p.isStaff);
  const coverage = summarizeCompetenceCoverage(
    staff.map((p) => ({ id: p.id, name: p.name, tags: p.tags, developmentInterests: p.developmentInterests })),
    vocabulary
  );
  const gaps = competenceCoverageGaps(coverage);
  const neededGaps = uncoveredNeededTags(completedMissions, coverage);

  const capPeople: TeamCapPerson[] = staff
    .map((p) => ({ id: p.id, name: p.name, active: teamLoads.loads.get(p.id)?.active ?? 0 }))
    .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name, 'sv'));

  const now = new Date();
  const staffRows: StaffProfileRow[] = staff
    .map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title,
      tagCount: p.tags.length,
      updatedAt: p.competenceUpdatedAt,
      status: competenceProfileStatus(p.competenceUpdatedAt, p.tags.length > 0, now) as CompetenceProfileStatus
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sv'));

  return (
    <SettingsSectionPage
      slug="kompetenser"
      roles={user.roles}
      intro={
        <>
          Vokabulären av kompetens-hashtags som personalen väljer bland under Min profil,
          och som teamförslagen rankar på. Här sätter ledningen hur många team en person får
          ingå i samtidigt, godkänner nya förslag, ser hur väl organisationen täcker varje
          kompetens och vilka profiler som behöver uppdateras.
        </>
      }
    >
      <TeamCapCard
        cap={capSetting.cap}
        configured={capSetting.configured}
        schemaReady={capSetting.schemaReady}
        people={capPeople}
        loadComplete={teamLoads.complete}
      />
      <CompetenceTagsManager
        tagRecords={tagRecords}
        vocabularyError={vocabularyError}
        coverage={coverage}
        gaps={gaps}
        neededGaps={neededGaps}
        missionsComplete={missionsComplete}
        staff={staffRows}
      />
    </SettingsSectionPage>
  );
}
