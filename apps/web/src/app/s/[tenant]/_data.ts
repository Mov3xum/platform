import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getPublicTenantBranding } from '@/lib/compass/public';
import { loadPublicTagVocabulary, loadStudentSession, resolveTalentTenant } from '@/lib/talent/public';

/** En resolvning per request (layout/sida) — tenant, branding, ev. studentsession och vokabulären. */
export const loadTalentPublic = cache(async (slug: string) => {
  const resolved = await resolveTalentTenant(slug);
  if (!resolved) notFound();
  const [branding, student, vocabulary] = await Promise.all([
    getPublicTenantBranding(resolved.pb, resolved.tenant.id),
    loadStudentSession(resolved),
    loadPublicTagVocabulary(resolved)
  ]);
  return { resolved, branding, student, vocabulary };
});
