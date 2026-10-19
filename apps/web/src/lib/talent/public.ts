import 'server-only';
import { cookies } from 'next/headers';
import type PocketBase from 'pocketbase';
import {
  competenceTagLabelFromSlug,
  isStudentProfileExpired,
  mergeCompetenceTagVocabulary,
  needPeriodLabel,
  publicCompanyLabel,
  type CompetenceTagDef,
  type TalentCompensation,
  type TalentNeedKind,
  type TalentWorkMode
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { STUDENT_SESSION_COOKIE, studentSessionSecret, verifyStudentSession } from './student-session';
import { STUDENT_PROFILES, TALENT_NEEDS, getNeed, listNeeds, normalizeStudent, type StudentProfileRow, type TalentNeedRow } from './data';

/**
 * Publik (oinloggad) sida för studenter: /s/<tenant-slug> (CLAUDE.md § 54).
 *
 * Det finns ingen användarsession → läsning/skrivning sker via SUPERUSER.
 * Därför är tenant-scope kritiskt (§ 23.2-mönstret): tenanten resolvas på
 * sin globalt unika `slug`, och ALLT som läses eller skrivs filtreras på den
 * tenanten — aldrig på något ur request-bodyn. Studentens identitet kommer ur
 * den HMAC-signerade sessionscookien (`student-session.ts`); profilen slås
 * ALLTID upp på nytt och måste tillhöra samma tenant.
 */

export interface PublicTalentTenant {
  id: string;
  slug: string;
  name: string;
}

export interface ResolvedTalentTenant {
  pb: PocketBase;
  tenant: PublicTalentTenant;
}

const SLUG_RE = /^[a-z0-9-]{2,64}$/;

export async function resolveTalentTenant(slug: string): Promise<ResolvedTalentTenant | null> {
  const s = (slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  const su = await getSuperuserPb();
  if (!su.ok) {
    console.error('[talent] public tenant fetch: superuser unavailable', su.reason);
    return null;
  }
  try {
    const t = await su.pb
      .collection('tenants')
      .getFirstListItem<{ id: string; slug: string; name?: string }>(su.pb.filter('slug = {:s}', { s }), { fields: 'id,slug,name' });
    return { pb: su.pb, tenant: { id: t.id, slug: t.slug, name: t.name || 'Movexum' } };
  } catch {
    return null;
  }
}

/** Det en ANONYM besökare får se av ett behov — aldrig interna fält (granskningsnot, kontaktperson, skapare). */
export interface PublicTalentNeed {
  id: string;
  title: string;
  kind: TalentNeedKind;
  description: string;
  tags: string[];
  scope: string;
  period: string;
  starts_at: string | null;
  ends_at: string | null;
  compensation: TalentCompensation;
  compensation_note: string;
  location: string;
  work_mode: TalentWorkMode;
  supervisor: boolean;
  deadline: string | null;
  company: string;
  published_at: string | null;
}

export function toPublicNeed(n: TalentNeedRow, tenantName: string): PublicTalentNeed {
  return {
    id: n.id,
    title: n.title,
    kind: n.kind,
    description: n.description,
    tags: n.tags,
    scope: n.scope,
    period: needPeriodLabel(n),
    starts_at: n.starts_at,
    ends_at: n.ends_at,
    compensation: n.compensation,
    compensation_note: n.compensation_note,
    location: n.location,
    work_mode: n.work_mode,
    supervisor: n.supervisor,
    deadline: n.deadline,
    company: publicCompanyLabel(n, n.startupName, tenantName),
    published_at: n.published_at
  };
}

function deadlinePassed(n: TalentNeedRow, today: string): boolean {
  return Boolean(n.deadline && n.deadline < today);
}

/** Publicerade behov med sista ansökningsdag som inte passerat. */
export async function listPublishedNeeds(resolved: ResolvedTalentTenant): Promise<{ items: PublicTalentNeed[]; error?: string }> {
  const res = await listNeeds(resolved.pb, resolved.tenant.id, { statuses: ['published'] });
  if (res.error || res.missing) return { items: [], error: res.error ?? 'Studentsidan är inte aktiverad än.' };
  const today = new Date().toISOString().slice(0, 10);
  return {
    items: res.items
      .filter((n) => !deadlinePassed(n, today))
      .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
      .map((n) => toPublicNeed(n, resolved.tenant.name))
  };
}

export async function getPublishedNeed(resolved: ResolvedTalentTenant, id: string): Promise<{ need: TalentNeedRow; view: PublicTalentNeed } | null> {
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(id)) return null;
  const n = await getNeed(resolved.pb, resolved.tenant.id, id);
  if (!n || n.status !== 'published') return null;
  return { need: n, view: toPublicNeed(n, resolved.tenant.name) };
}

/** Hashtag-vokabulären (seed + tenantens godkända/föreslagna) — bara slug/etikett/område, inga personuppgifter. */
export async function loadPublicTagVocabulary(resolved: ResolvedTalentTenant): Promise<CompetenceTagDef[]> {
  try {
    const rows = await resolved.pb.collection('competence_tags').getList<Record<string, unknown>>(1, 500, {
      filter: resolved.pb.filter('tenant = {:tenant}', { tenant: resolved.tenant.id }),
      fields: 'slug,label,area,status'
    });
    return mergeCompetenceTagVocabulary(rows.items);
  } catch {
    return mergeCompetenceTagVocabulary([]);
  }
}

export function tagLabel(vocabulary: readonly CompetenceTagDef[], slug: string): string {
  return vocabulary.find((t) => t.slug === slug)?.label ?? competenceTagLabelFromSlug(slug);
}

// ── Studentens session ──────────────────────────────────────────────────────

/** Profilen bakom sessionscookien — bara om den finns, tillhör tenanten, inte är avregistrerad eller utgången. */
export async function loadStudentSession(resolved: ResolvedTalentTenant): Promise<StudentProfileRow | null> {
  const jar = await cookies();
  const raw = jar.get(STUDENT_SESSION_COOKIE)?.value;
  const profileId = verifyStudentSession(raw, studentSessionSecret());
  if (!profileId) return null;
  return loadStudentById(resolved, profileId);
}

export async function loadStudentById(resolved: ResolvedTalentTenant, profileId: string): Promise<StudentProfileRow | null> {
  try {
    const raw = await resolved.pb.collection(STUDENT_PROFILES).getOne<Record<string, unknown>>(profileId);
    const p = normalizeStudent(raw);
    if (p.tenant !== resolved.tenant.id || p.status === 'withdrawn') return null;
    if (isStudentProfileExpired(p.expires_at, new Date())) return null;
    return p;
  } catch {
    return null;
  }
}

export { TALENT_NEEDS };
