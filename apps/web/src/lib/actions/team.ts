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
  inferCompetencesFromText,
  sanitizeCompetences,
  type CompetenceId,
  type MissionParticipantRole,
  type Role
} from '@platform/shared';

// CLAUDE.md § 29 — Server action för AI-teamförslag (Fas 1).
// Staff beskriver ett uppdrag → AI:n föreslår kompetenser + kandidater.
// Människa-i-loopen: förslaget AUTO-tilldelar aldrig (klienten lägger till
// valda personer i deltagarlistan, som staff sedan bekräftar genom att skapa
// uppdraget).

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const MATCH_MODEL = 'mistral-small-latest';

export interface SuggestedMemberView {
  id: string;
  kind: 'user' | 'contact';
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

interface ContactRow {
  id: string;
  first_name?: string;
  last_name?: string;
  primary_role?: string;
  skills?: string;
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
  const tenantFilter = `tenant = "${escFilter(user.tenant)}"`;

  // ── Kandidater: interna users med kompetenser ──────────────────────────
  const candidates: TeamCandidate[] = [];
  const byId = new Map<string, TeamCandidate>();
  try {
    const res = await pb.collection('users').getList<UserRow>(1, 200, {
      filter: tenantFilter,
      sort: 'display_name',
      fields: 'id,display_name,email,title,roles,competences'
    });
    for (const u of res.items) {
      // Bara potentiella resurser (staff) — bolagsmedlemmar bemannar inte team.
      if (!Array.isArray(u.roles) || !u.roles.some((r) => STAFF_ROLES.includes(r as Role))) {
        continue;
      }
      const comp = sanitizeCompetences(u.competences);
      const cand: TeamCandidate = {
        id: String(u.id),
        kind: 'user',
        name: u.display_name || (u.email ? u.email.split('@')[0] : String(u.id)),
        title: u.title || undefined,
        competences: comp
      };
      candidates.push(cand);
      byId.set(cand.id, cand);
    }
  } catch {
    /* fail-soft */
  }

  // ── Kandidater: externa contacts med skills (kompetens härleds) ────────
  try {
    const res = await pb.collection('contacts').getList<ContactRow>(1, 200, {
      filter: tenantFilter,
      sort: 'last_name',
      fields: 'id,first_name,last_name,primary_role,skills'
    });
    for (const c of res.items) {
      const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || String(c.id);
      const inferred = inferCompetencesFromText(c.skills);
      const cand: TeamCandidate = {
        id: String(c.id),
        kind: 'contact',
        name,
        title: c.primary_role || undefined,
        competences: inferred,
        skillsText: c.skills || undefined
      };
      candidates.push(cand);
      byId.set(cand.id, cand);
    }
  } catch {
    /* fail-soft — contacts kanske inte finns i tenanten */
  }

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
      kind: m.kind,
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
    needsReview: result.needsReview
  };
}
