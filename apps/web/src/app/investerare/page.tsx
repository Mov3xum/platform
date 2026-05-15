import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import { PageHead } from '@/components/proto';

export default async function InvesterarePage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'partner'])) {
    redirect('/idag');
  }
  return (
    <div className="mx-view-pad mx-wide">
      <PageHead crumb="Hemmaplan / Investerarrelationer" title="Investerarrelationer" subtitle="Laddar..." />
    </div>
  );
}
