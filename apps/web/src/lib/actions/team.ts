'use server';

import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { logAiUsage } from '@/lib/ai/usage';
import { assertWithinAiBudget, AiBudgetExceededError } from '@/lib/ai/budget.server';
import { composeTeam, extractTeamNeed, TEAM_MATCH_MODEL } from '@/lib/ai/team-match';
import {
  loadCompetenceTagVocabulary,
  loadStaffProfiles,
  loadTeamLoads
} from '@/lib/team/competence-tags.server';
import {
  TEAM_SHORTLIST_SIZE,
  rankTeamCandidates,
  teamNeedGaps,
  type CompetenceId,
  type CompetenceLevel,
  type LoadLevel,
  type MissionParticipantRole,
  type RankableCandidate,
  type Role,
  type TeamMemberLoad,
  type UserCompetenceTag
} from '@platform/shared';

// CLAUDE.md § 29 / § 29.7 — Server action för AI-teamförslag.
//
// Kandidater = RIKTIGA användare i systemet (Movexum-personal i tenanten)
// som angett kompetens-hashtags (eller, för äldre profiler, områden) under
// /min-profil. Bolagsmedlemmar, observatörer och externa CRM-kontakter är
// ALDRIG kandidater — teamen är interna Movexum-team.
//
// Flöde: behov (AI + heuristik) → DETERMINISTISK rankning med hashtag/nivå,
// bolagsrelation och NUVARANDE BELASTNING (aktiva team) → AI sätter ihop
// teamet ur shortlistan. Allt som visas (poäng, skäl, belastning) kommer ur
// den rena rankningen, så förslaget är förklarbart även när modellen inte
// svarar. Människa-i-loopen: förslaget AUTO-tilldelar aldrig.

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export interface SuggestedMemberView {
  id: string;
  name: string;
  title?: string;
  role: MissionParticipantRole;
  reason: string;
  confidence: number;
  competences: CompetenceId[];
  tags: UserCompetenceTag[];
  matchedTags: Array<{ tag: string; level: CompetenceLevel }>;
  load: TeamMemberLoad;
  loadLevel: LoadLevel;
  score: number;
}

export interface ShortlistEntryView {
  id: string;
  name: string;
  title?: string;
  score: number;
  reasons: string[];
  load: TeamMemberLoad;
  loadLevel: LoadLevel;
}

export type SuggestTeamResult =
  | {
      ok: true;
      neededCompetences: CompetenceId[];
      neededTags: string[];
      members: SuggestedMemberView[];
      /** Hela den rankade shortlistan (för "fler kandidater"). */
      shortlist: ShortlistEntryView[];
      gaps: { tags: string[]; areas: CompetenceId[] };
      externalNote: string | null;
      summary: string;
      needsReview: boolean;
      /** Antal kollegor som kunde matchas (har kompetensprofil). */
      candidateCount: number;
      /** false = belastningen kunde inte läsas komplett (visa som osäker). */
      loadComplete: boolean;
    }
  | { ok: false; error: string };

export async function suggestTeamAction(input: {
  description: string;
  startupId?: string;
}): Promise<SuggestTeamResult> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) {
    return { ok: false, error: 'Bara Movexum-personal kan föreslå team.' };
  }
  const description = String(input.description || '').trim();
  if (description.length < 10) {
    return { ok: false, error: 'Beskriv uppdraget i minst en mening (10 tecken).' };
  }

  const pb = await getServerPb();

  // Månadstaket (§ 9.6) prövas före de två Mistral-anropen.
  try {
    await assertWithinAiBudget(pb, user.tenant);
  } catch (err) {
    if (err instanceof AiBudgetExceededError) return { ok: false, error: err.message };
    throw err;
  }

  // ── Underlag (parallellt, alla fail-soft) ───────────────────────────────
  const vocabulary = await loadCompetenceTagVocabulary(pb, user.tenant);
  const [profiles, { loads, complete: loadComplete }] = await Promise.all([
    loadStaffProfiles(pb, user.tenant, vocabulary),
    loadTeamLoads(pb, user.tenant)
  ]);

  // ── Valfri bolagskontext (kort etikett, ingen PII) + relation ──────────
  let startupContext: string | undefined;
  const relatedUserIds = new Set<string>();
  if (input.startupId) {
    try {
      const s = await pb
        .collection('startups')
        .getOne(input.startupId, { fields: 'id,name,industri,phase,tenant,coaches,owner' });
      const rec = s as unknown as {
        name?: string;
        industri?: string;
        phase?: string;
        tenant?: string;
        coaches?: unknown;
        owner?: unknown;
      };
      if (rec.tenant === user.tenant) {
        startupContext = [rec.name, rec.industri, rec.phase].filter(Boolean).join(' · ');
        if (Array.isArray(rec.coaches)) rec.coaches.forEach((c) => relatedUserIds.add(String(c)));
        if (typeof rec.owner === 'string' && rec.owner) relatedUserIds.add(rec.owner);
      }
    } catch {
      /* ignore */
    }
  }

  // ── Kandidater: interna kollegor med kompetensprofil ────────────────────
  const candidates: RankableCandidate[] = profiles
    .filter((p) => p.isStaff && (p.tags.length > 0 || p.competences.length > 0))
    .map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title,
      tags: p.tags,
      areas: p.competences,
      developmentInterests: p.developmentInterests,
      load: loads.get(p.id) ?? { active: 0, leading: 0 },
      relatedToStartup: relatedUserIds.has(p.id)
    }));
  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        'Ingen kollega har angett sina kompetenser ännu. Be teamet fylla i ' +
        'hashtags under Min profil — AI:n matchar bara mot dem.'
    };
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  // ── Steg 1: behov ───────────────────────────────────────────────────────
  const needRes = await extractTeamNeed({ description, startupContext, vocabulary });

  // ── Steg 2: deterministisk rankning (hashtag/nivå/relation/belastning) ──
  const ranked = rankTeamCandidates(needRes.need, candidates);
  const shortlist = ranked.filter((r) => r.score > 0).slice(0, TEAM_SHORTLIST_SIZE);
  const gaps = teamNeedGaps(needRes.need, candidates);

  // ── Steg 3: AI sätter ihop teamet ur shortlistan ────────────────────────
  const composed = await composeTeam({ description, startupContext, need: needRes.need, shortlist, gaps });

  void logAiUsage(pb, {
    tenant: user.tenant,
    userId: user.id,
    surface: 'suggestions',
    model: TEAM_MATCH_MODEL,
    tokensIn: needRes.usage.tokensIn + composed.usage.tokensIn,
    tokensOut: needRes.usage.tokensOut + composed.usage.tokensOut
  });

  const rankedById = new Map(ranked.map((r) => [r.id, r]));
  const members: SuggestedMemberView[] = composed.result.members.map((m) => {
    const r = rankedById.get(m.id);
    const p = profileById.get(m.id);
    return {
      id: m.id,
      name: p?.name || m.id,
      title: p?.title,
      role: m.role,
      reason: m.reason,
      confidence: m.confidence,
      competences: p?.competences ?? [],
      tags: p?.tags ?? [],
      matchedTags: r?.matchedTags ?? [],
      load: r?.load ?? { active: 0, leading: 0 },
      loadLevel: r?.loadLevel ?? 'free',
      score: r?.score ?? 0
    };
  });

  return {
    ok: true,
    neededCompetences: needRes.need.areas,
    neededTags: needRes.need.tags,
    members,
    shortlist: shortlist.map((r) => ({
      id: r.id,
      name: r.name,
      title: r.title,
      score: r.score,
      reasons: r.reasons,
      load: r.load,
      loadLevel: r.loadLevel
    })),
    gaps,
    externalNote: composed.result.externalNote,
    summary: composed.result.summary,
    needsReview: composed.result.needsReview || needRes.aiFailed,
    candidateCount: candidates.length,
    loadComplete
  };
}
