import 'server-only';
import { isSparkId, normalizeSparkInterview } from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { notifySparkSubmission } from '@/lib/core/write';
import { SPARK_INTERVIEWS, SPARK_MIGRATION_HINT } from './data';

/**
 * SPARK:s publika sida /energi/<tenant-slug> (CLAUDE.md § 61): företaget
 * anmäler sig självt med samma adaptiva formulär som intervjuerna.
 *
 * Ingen användarsession → allt går via SUPERUSER, så tenant-scope är kritiskt
 * (§ 23.2-mönstret): tenanten resolvas på sin globalt unika slug och stämplas
 * på posten — aldrig något ur request-bodyn. Anmälan landar som INSKICKAD och
 * förs in i registret av Movexum (allt går via Movexum).
 *
 * Delningslänkar: `?via=<användar-id>` pekar ut partnern (t.ex. en kommun)
 * som spred länken. Id:t godtas bara om det är en partner eller
 * Movexum-personal i SAMMA tenant; annars ignoreras det tyst.
 */

export interface SparkPublicTenant {
  id: string;
  slug: string;
  name: string;
}

const SLUG_RE = /^[a-z0-9-]{2,64}$/;
const REFERRER_ROLES = ['partner', 'admin', 'incubator_lead', 'coach'];

export async function resolveSparkTenant(slug: string): Promise<SparkPublicTenant | null> {
  const s = (slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(s)) return null;
  const su = await getSuperuserPb();
  if (!su.ok) {
    console.error('[spark] public tenant fetch: superuser unavailable', su.reason);
    return null;
  }
  try {
    const t = await su.pb
      .collection('tenants')
      .getFirstListItem<{ id: string; slug: string; name?: string }>(su.pb.filter('slug = {:s}', { s }), { fields: 'id,slug,name' });
    return { id: t.id, slug: t.slug, name: t.name || 'Movexum' };
  } catch {
    return null;
  }
}

export interface SparkReferrer {
  id: string;
  /** Det som visas för företaget: partnerns organisation, annars visningsnamnet. */
  label: string;
}

/** Vem som spred länken — bara partner/personal i samma tenant. Aldrig e-post. */
export async function resolveSparkReferrer(tenantId: string, via: string | undefined | null): Promise<SparkReferrer | null> {
  if (!isSparkId(via)) return null;
  const su = await getSuperuserPb();
  if (!su.ok) return null;
  try {
    const u = await su.pb.collection('users').getOne<{ id: string; tenant?: string; roles?: string[]; organization?: string; display_name?: string; name?: string }>(via, {
      fields: 'id,tenant,roles,organization,display_name,name'
    });
    if (String(u.tenant) !== tenantId) return null;
    if (!(u.roles ?? []).some((r) => REFERRER_ROLES.includes(r))) return null;
    return { id: u.id, label: (u.organization || u.display_name || u.name || 'en partner').slice(0, 120) };
  } catch {
    return null;
  }
}

export type SparkPublicResult = { ok: true } | { ok: false; error: string; status: number };

export async function submitPublicSparkInterview(
  tenant: SparkPublicTenant,
  body: { answers: unknown; consent: unknown; via?: unknown }
): Promise<SparkPublicResult> {
  if (body.consent !== true) return { ok: false, status: 400, error: 'Du behöver godkänna hur uppgifterna hanteras innan du skickar in.' };
  const norm = normalizeSparkInterview(body.answers, { submit: true });
  if (!norm.ok) return { ok: false, status: 400, error: norm.issue.message };
  const su = await getSuperuserPb();
  if (!su.ok) return { ok: false, status: 503, error: 'Anmälan kan inte tas emot just nu. Försök igen senare.' };
  const referrer = await resolveSparkReferrer(tenant.id, typeof body.via === 'string' ? body.via : null);
  const now = new Date().toISOString();
  let id: string;
  try {
    const created = await su.pb.collection(SPARK_INTERVIEWS).create<{ id: string }>({
      tenant: tenant.id,
      company_name: String(norm.value.company.name ?? ''),
      org_nr: typeof norm.value.company.org_nr === 'string' ? norm.value.company.org_nr : '',
      roles: norm.value.roles,
      answers: norm.value,
      status: 'submitted',
      source: 'self',
      interviewer_org: referrer ? `Via ${referrer.label}` : '',
      referred_by: referrer?.id ?? '',
      consent_at: now,
      submitted_at: now
    });
    id = created.id;
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    console.error('[spark] public submit failed', { status });
    return { ok: false, status: 503, error: status === 404 ? SPARK_MIGRATION_HINT : 'Anmälan kunde inte sparas. Försök igen.' };
  }
  await notifySparkSubmission(su.pb, { tenant: tenant.id, interviewId: id, companyName: String(norm.value.company.name ?? ''), source: 'self' });
  return { ok: true };
}
