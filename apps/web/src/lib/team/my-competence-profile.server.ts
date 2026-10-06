import 'server-only';
import type PocketBase from 'pocketbase';
import {
  sanitizeDevelopmentInterests,
  sanitizeUserCompetenceTags,
  type CompetenceTagDef,
  type TeamMemberLoad,
  type UserCompetenceTag
} from '@platform/shared';
import {
  loadCompetenceTagVocabulary,
  loadTeamCap,
  loadTeamLoadsForCap
} from '@/lib/team/competence-tags.server';

// CLAUDE.md § 29.7 — den inloggades egen kompetensprofil + belastning mot
// teamtaket. Delas av /min-profil och /konto så båda visar exakt samma sak
// (ingen divergerande kopia). Profilfälten läses med användarens egen token;
// belastningen räknas över hela tenanten (bara den egna siffran lämnar
// funktionen), så "2 av 3 team" stämmer även när ett av teamen bara syns för
// deltagarna. Fail-soft: tomt formulär mot ett omigrerat schema.

export interface MyCompetenceProfile {
  vocabulary: CompetenceTagDef[];
  title: string;
  bio: string;
  tags: UserCompetenceTag[];
  developmentInterests: string[];
  competenceUpdatedAt: string | null;
  load: TeamMemberLoad;
  teamCap: number;
}

export async function loadMyCompetenceProfile(
  pb: PocketBase,
  user: { id: string; tenant: string }
): Promise<MyCompetenceProfile> {
  const vocabulary = await loadCompetenceTagVocabulary(pb, user.tenant);
  const profile: MyCompetenceProfile = {
    vocabulary,
    title: '',
    bio: '',
    tags: [],
    developmentInterests: [],
    competenceUpdatedAt: null,
    load: { active: 0, leading: 0 },
    teamCap: 3
  };
  const [rec, loads, cap] = await Promise.all([
    pb
      .collection('users')
      .getOne(user.id, {
        fields: 'id,title,bio,competences,competence_tags,development_interests,competence_updated_at'
      })
      .catch(() => null),
    loadTeamLoadsForCap(pb, user.tenant),
    loadTeamCap(pb, user.tenant)
  ]);
  if (rec) {
    const r = rec as unknown as {
      title?: string;
      bio?: string;
      competence_tags?: unknown;
      development_interests?: unknown;
      competence_updated_at?: string;
    };
    profile.title = r.title || '';
    profile.bio = r.bio || '';
    profile.tags = sanitizeUserCompetenceTags(r.competence_tags, vocabulary);
    profile.developmentInterests = sanitizeDevelopmentInterests(r.development_interests);
    profile.competenceUpdatedAt = r.competence_updated_at || null;
  }
  profile.load = loads.loads.get(user.id) ?? { active: 0, leading: 0 };
  profile.teamCap = cap;
  return profile;
}
