import 'server-only';
import type PocketBase from 'pocketbase';
import { logAgentAction } from '@/lib/core/write/audit';
import type { Actor } from '@/lib/core/write/types';
import {
  ACTIVE_MISSION_STATUSES,
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
  id?: string;
  slug?: unknown;
  label?: unknown;
  area?: unknown;
  status?: unknown;
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
      fields: 'id,slug,label,area,status',
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
 * `suggested`, så de dyker upp i kollegornas autocomplete. Anroparen har
 * redan verifierat att aktören är Movexum-personal (§ 29.7) — createRule är
 * dessutom body-låst (status suggested, eget created_by, egen tenant).
 * Best-effort: ett fel här blockerar aldrig profil-sparningen; dubbletter
 * (unikt index tenant+slug) tolkas som "finns redan". Varje ny post
 * auditeras PII-fritt i `agent_actions` (slug + område).
 */
export async function registerCompetenceTags(
  pb: PocketBase,
  input: { actor: Actor; tags: readonly UserCompetenceTag[]; vocabulary: readonly CompetenceTagDef[] }
): Promise<void> {
  const known = new Set(input.vocabulary.map((t) => t.slug));
  for (const t of input.tags) {
    if (known.has(t.tag)) continue;
    try {
      const rec = await pb.collection(COMPETENCE_TAGS).create<{ id: string }>({
        tenant: input.actor.tenant,
        slug: t.tag,
        label: t.tag.replace(/-/g, ' '),
        area: t.area,
        status: 'suggested',
        created_by: input.actor.id
      });
      known.add(t.tag);
      await logAgentAction(pb, {
        actor: input.actor,
        action_type: 'create',
        collection: COMPETENCE_TAGS,
        record_id: rec.id,
        after_value: { slug: t.tag, area: t.area, status: 'suggested' }
      });
    } catch {
      /* fail-soft (unik-konflikt eller omigrerat schema) */
    }
  }
}

export interface TeamLoads {
  loads: Map<string, TeamMemberLoad>;
  /** false när läsningen kapades eller felade — visa aldrig som exakt (§ 33.4). */
  complete: boolean;
}

const LOAD_PAGE = 200;
const LOAD_MAX_ROWS = 2000;

/**
 * Belastning per användar-id ur tenantens PÅGÅENDE uppdrag (statusfilter i
 * frågan, paginerat upp till ett tak). Läses med anroparens token → RLS § 21:
 * bara staff (som ser hela tenantens uppdrag) får en sann bild — anroparna
 * visar därför belastning enbart för staff.
 */
export async function loadTeamLoads(pb: PocketBase, tenantId: string): Promise<TeamLoads> {
  const statusFilter = ACTIVE_MISSION_STATUSES.map((s) => `status = "${s}"`).join(' || ');
  const rows: MissionLoadRow[] = [];
  try {
    let page = 1;
    for (;;) {
      const res = await pb.collection('missions').getList<MissionLoadRow>(page, LOAD_PAGE, {
        filter: pb.filter(`tenant = {:tenant} && (${statusFilter})`, { tenant: tenantId }),
        fields: 'status,issuer,mentor,recipients,participants_json',
        sort: '-updated'
      });
      rows.push(...res.items);
      if (res.items.length < LOAD_PAGE || rows.length >= res.totalItems) break;
      if (rows.length >= LOAD_MAX_ROWS) {
        return { loads: computeTeamLoads(rows), complete: false };
      }
      page += 1;
    }
    return { loads: computeTeamLoads(rows), complete: true };
  } catch {
    return { loads: new Map(), complete: false };
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
