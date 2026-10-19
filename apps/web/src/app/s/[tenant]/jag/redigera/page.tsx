import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { StudentProfileForm } from '@/components/talent/StudentProfileForm';
import { loadTalentPublic } from '../../_data';
import { PublicCard, TalentPublicShell } from '../../_shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Redigera profil', robots: { index: false } };

export default async function EditStudentPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const { resolved, branding, student, vocabulary } = await loadTalentPublic(tenant);
  if (!student) redirect(`/s/${encodeURIComponent(resolved.tenant.slug)}/logga-in`);
  return (
    <TalentPublicShell tenant={resolved.tenant} branding={branding} student={student} active="jag" title="Redigera din profil">
      <PublicCard>
        <StudentProfileForm tenantSlug={resolved.tenant.slug} tenantName={resolved.tenant.name} vocabulary={vocabulary} mode="edit" initial={student} />
      </PublicCard>
    </TalentPublicShell>
  );
}
