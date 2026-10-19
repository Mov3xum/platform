import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { StudentLoginForm } from '@/components/talent/StudentLoginForm';
import { loadTalentPublic } from '../_data';
import { PublicCard, TalentPublicShell } from '../_shell';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Logga in', robots: { index: false } };

const ERROR: Record<string, string> = {
  lank: 'Länken är ogiltig eller har gått ut (den gäller i 30 minuter). Be om en ny nedan.',
  konfig: 'Inloggning är inte möjlig just nu. Kontakta Movexum.'
};

export default async function StudentLoginPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ fel?: string }> }) {
  const { tenant } = await params;
  const { fel } = await searchParams;
  const { resolved, branding, student } = await loadTalentPublic(tenant);
  if (student) redirect(`/s/${encodeURIComponent(resolved.tenant.slug)}/jag`);
  return (
    <TalentPublicShell tenant={resolved.tenant} branding={branding} student={null} active="logga-in" title="Logga in med din e-post" body="Vi mejlar en inloggningslänk. Inget lösenord.">
      <PublicCard>
        {fel && ERROR[fel] ? (
          <p className="mx-t-sm" style={{ margin: 0, color: 'var(--movexum-morkorange)' }}>
            {ERROR[fel]}
          </p>
        ) : null}
        <StudentLoginForm tenantSlug={resolved.tenant.slug} />
      </PublicCard>
    </TalentPublicShell>
  );
}
