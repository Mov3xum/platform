import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { StudentProfileForm } from '@/components/talent/StudentProfileForm';
import { loadTalentPublic } from '../_data';
import { PublicCard, TalentPublicShell } from '../_shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Skapa studentprofil', robots: { index: false } };

export default async function RegisterPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const { resolved, branding, student, vocabulary } = await loadTalentPublic(tenant);
  if (student) redirect(`/s/${encodeURIComponent(resolved.tenant.slug)}/jag`);
  return (
    <TalentPublicShell
      tenant={resolved.tenant}
      branding={branding}
      student={null}
      active="registrera"
      title="Skapa din studentprofil"
      body="Berätta vad du kan och vad du söker. Vi bekräftar din e-post med en länk — inget lösenord behövs. Bolagen ser din profil anonymt tills du själv tar kontakt."
    >
      <PublicCard>
        <StudentProfileForm tenantSlug={resolved.tenant.slug} tenantName={resolved.tenant.name} vocabulary={vocabulary} mode="register" />
      </PublicCard>
    </TalentPublicShell>
  );
}
