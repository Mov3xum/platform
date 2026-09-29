'use server';

import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { escFilter } from '@/lib/pb-filter';
import { logAiUsage } from '@/lib/ai/usage';
import {
  matchTeam,
  type TeamCandidate
} from '@/lib/ai/team-match';
import {
  sanitizeCompetences,
  type CompetenceId,
  type MissionParticipantRole,
  type Role
} from '@platform/shared';

// CLAUDE.md § 29 — Server action för AI-teamförslag (Fas 1).
// Staff beskriver ett uppdrag → AI:n föreslår kompetenser + kandidater.
//
// Kandidater = RIKTIGA användare i systemet (Movexum-personal i tenanten) som
// själva angett sina kompetenser som taggar under /min-profil. Bolagsmedlemmar,
// observatörer och externa CRM-kontakter är ALDRIG kandidater — teamen är
// interna Movexum-team. En kollega utan kompetenstaggar kan inte matchas och
// listas därför inte (modellen skulle bara gissa på namn).
//
// Människa-i-loopen: förslaget AUTO-tilldelar aldrig (klienten lägger till
// valda personer i deltagarlistan, som staff sedan bekräftar genom att skapa
// uppdraget).

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const MATCH_MODEL = 'mistral-small-latest';

export interface SuggestedMemberView {
  id: string;
  name: string;
  title?: string;
  role: MissionParticipantRole;
  reason: string;
  confidence: number;
  competences: CompetenceId[];
}

export type SuggestTeamResult =
  | {
      ok: true;
      neededCompetences: CompetenceId[];
      members: SuggestedMemberView[];
      externalNote: string | null;
      summary: string;
      needsReview: boolean;
      /** Antal kollegor som kunde matchas (har kompetenstaggar). */
      candidateCount: number;
    }
  | { ok: false; error: string };

interface UserRow {
  id: string;
  display_name?: string;
  email?: string;
  title?: string;
  roles?: string[];
  competences?: unknown;
}

/**
 * Laddar matchningsbara kollegor: staff i tenanten med minst en kompetenstagg.
 * Fail-soft → [] (anroparen förklarar för användaren).
 */
async function loadTaggedStaffCandidates(
  pb: Awaited<ReturnType<typeof getServerPb>>,
  tenantId: string
): Promise<TeamCandidate[]> {
  const candidates: TeamCandidate[] = [];
  try {
    const res = await pb.collection('users').getList<UserRow>(1, 200, {
      filter: `tenant = "${escFilter(tenantId)}"`,
      sort: 'display_name',
      fields: 'id,display_name,email,title,roles,competences'
    });
    for (const u of res.items) {
      // Bara Movexum-personal — bolagsmedlemmar/observatörer bemannar inte team.
      if (!Array.isArray(u.roles) || !u.roles.some((r) => STAFF_ROLES.includes(r as Role))) {
        continue;
      }
      const competences = sanitizeCompetences(u.competences);
      // Bara den som faktiskt angett kompetenser kan matchas.
      if (competences.length === 0) continue;
      candidates.push({
        id: String(u.id),
        name: u.display_name || (u.email ? u.email.split('@')[0] : String(u.id)),
        title: u.title || undefined,
        competences
      });
    }
  } catch {
    /* fail-soft */
  }
  return candidates;
}

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

  // ── Kandidater: interna kollegor som angett kompetenstaggar ──────────────
  const candidates = await loadTaggedStaffCandidates(pb, user.tenant);
  if (candidates.length === 0) {
    return {
      ok: false,
      error:
        'Ingen kollega har angett sina kompetenser ännu. Be teamet fylla i ' +
        'kompetenstaggar under Min profil — AI:n matchar bara mot dem.'
    };
  }
  const byId = new Map(candidates.map((c) => [c.id, c]));

  // ── Valfri bolagskontext (kort etikett, ingen PII) ─────────────────────
  let startupContext: string | undefined;
  if (input.startupId) {
    try {
      const s = await pb
        .collection('startups')
        .getOne(input.startupId, { fields: 'id,name,industri,phase,tenant' });
      const rec = s as unknown as { name?: string; industri?: string; phase?: string; tenant?: string };
      if (rec.tenant === user.tenant) {
        startupContext = [rec.name, rec.industri, rec.phase].filter(Boolean).join(' · ');
      }
    } catch {
      /* ignore */
    }
  }

  const { result, usage } = await matchTeam({ description, startupContext, candidates });

  void logAiUsage(pb, {
    tenant: user.tenant,
    userId: user.id,
    surface: 'suggestions',
    model: MATCH_MODEL,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut
  });

  const members: SuggestedMemberView[] = result.members.map((m) => {
    const cand = byId.get(m.id);
    return {
      id: m.id,
      name: cand?.name || m.id,
      title: cand?.title,
      role: m.role,
      reason: m.reason,
      confidence: m.confidence,
      competences: cand?.competences ?? []
    };
  });

  return {
    ok: true,
    neededCompetences: result.neededCompetences,
    members,
    externalNote: result.externalNote,
    summary: result.summary,
    needsReview: result.needsReview,
    candidateCount: candidates.length
  };
}
