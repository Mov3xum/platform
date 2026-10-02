import 'server-only';
import type PocketBase from 'pocketbase';
import {
  computeTeamLoads,
  mergeCompetenceTagVocabulary,
  sanitizeCompetences,
  sanitizeDevelopmentInterests,
  sanitizeUserCompetenceTags,
  type CompetenceId,
  type CompetenceTagDef,
  type MissionLoadRow,
  type Role,
  type TeamMemberLoad,
  type UserCompetenceTag
} from '@platform/shared';

// CLAUDE.md § 29.7 — Enda läsvägen för kompetens-hashtags, kollegornas
// profiler och NUVARANDE belastning (aktiva team). Reads går via den
// inkommande klienten (användarens token → RLS § 21). Fail-soft överallt:
// ett omigrerat schema ger seed-vokabulären / tomma listor, aldrig krasch.
// Kollektioner adresseras på NAMN (§ 30.4 p. 1).

export const COMPETENCE_TAGS = 'competence_tags';
const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

interface TagRow {
  slug?: unknown;
  label?: unknown;
  area?: unknown;
}

/** Seed + tenantens egna taggar (unik per slug). */
export async function loadCompetenceTagVocabulary(
  pb: PocketBase,
  tenantId: string
): Promise<CompetenceTagDef[]> {
  let rows: TagRow[] = [];
  try {
    const res = await pb.collection(COMPETENCE_TAGS).getList<TagRow>(1, 500, {
      filter: pb.filter('tenant = {:tenant}', { tenant: tenantId }),
      fields: 'slug,label,area',
      sort: 'label'
    });
    rows = res.items;
  } catch {
    /* fail-soft: seed-listan räcker */
  }
  return mergeCompetenceTagVocabulary(rows);
}

/**
 * Registrerar taggar som ännu inte finns i tenantens vokabulär som
 * `suggested`, så de dyker upp i kollegornas autocomplete. Best-effort:
 * ett fel här blockerar aldrig profil-sparningen. Dubbletter (unikt index
 * tenant+slug) tolkas som "finns redan".
 */
export async function registerCompetenceTags(
  pb: PocketBase,
  input: { tenantId: string; userId: string; tags: readonly UserCompetenceTag[]; vocabulary: readonly CompetenceTagDef[] }
): Promise<void> {
  const known = new Set(input.vocabulary.map((t) => t.slug));
  for (const t of input.tags) {
    if (known.has(t.tag)) continue;
    try {
      await pb.collection(COMPETENCE_TAGS).create({
        tenant: input.tenantId,
        slug: t.tag,
        label: t.tag.replace(/-/g, ' '),
        area: t.area,
        status: 'suggested',
        created_by: input.userId
      });
      known.add(t.tag);
    } catch {
      /* fail-soft (unik-konflikt eller omigrerat schema) */
    }
  }
}

/** Belastning per användar-id ur tenantens pågående uppdrag. */
export async function loadTeamLoads(pb: PocketBase, tenantId: string): Promise<Map<string, TeamMemberLoad>> {
  try {
    const res = await pb.collection('missions').getList<MissionLoadRow>(1, 500, {
      filter: pb.filter('tenant = {:tenant}', { tenant: tenantId }),
      fields: 'status,issuer,mentor,recipients,participants_json',
      sort: '-updated'
    });
    return computeTeamLoads(res.items);
  } catch {
    return new Map();
  }
}

export interface StaffProfile {
  id: string;
  name: string;
  title?: string;
  roles: string[];
  isStaff: boolean;
  competences: CompetenceId[];
  tags: UserCompetenceTag[];
  developmentInterests: string[];
}

interface UserRow {
  id: string;
  display_name?: string;
  email?: string;
  title?: string;
  roles?: unknown;
  competences?: unknown;
  competence_tags?: unknown;
  development_interests?: unknown;
}

/**
 * Alla användare i tenanten med kompetensprofil (sanerad). `isStaff` =
 * Movexum-personal (den krets som kan ingå i tvärfunktionella team).
 * Visningsnamn, aldrig e-post, lämnar funktionen.
 */
export async function loadStaffProfiles(
  pb: PocketBase,
  tenantId: string,
  vocabulary: readonly CompetenceTagDef[]
): Promise<StaffProfile[]> {
  try {
    const res = await pb.collection('users').getList<UserRow>(1, 200, {
      filter: pb.filter('tenant = {:tenant}', { tenant: tenantId }),
      sort: 'display_name',
      fields: 'id,display_name,email,title,roles,competences,competence_tags,development_interests'
    });
    return res.items.map((u) => {
      const roles = Array.isArray(u.roles) ? u.roles.map(String) : [];
      const tags = sanitizeUserCompetenceTags(u.competence_tags, vocabulary);
      return {
        id: String(u.id),
        name: u.display_name || (u.email ? u.email.split('@')[0] : String(u.id)),
        title: u.title || undefined,
        roles,
        isStaff: roles.some((r) => STAFF_ROLES.includes(r as Role)),
        competences: sanitizeCompetences(u.competences),
        tags,
        developmentInterests: sanitizeDevelopmentInterests(u.development_interests)
      };
    });
  } catch {
    return [];
  }
}
