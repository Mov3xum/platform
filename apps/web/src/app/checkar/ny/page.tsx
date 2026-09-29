import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listCheckTypes } from '@/lib/support-checks/data';
import { isPureStartupMember } from '@platform/shared';
import { ApplicationForm, type CheckTypeOption } from '../ApplicationForm';
import { loadStartupOptions } from '../form-data';
import { BackLink } from '../ui';

export const dynamic = 'force-dynamic';

export default async function NyAnsokanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const isMember = isPureStartupMember(user.roles);
  if (!isMember && !canAccessModuleForUser(user.roles, 'checkar', user.enabledModules)) redirect('/hem');
  if (isMember && user.linkedStartups.length === 0) redirect('/min-oversikt');
  const sp = await searchParams;
  const pb = await getServerPb();
  const [types, startups] = await Promise.all([listCheckTypes(pb, user.tenant, { activeOnly: true }), loadStartupOptions(pb, user)]);
  const typeOptions: CheckTypeOption[] = types.map((t) => ({ id: t.id, label: t.title, description: t.description, maxAmountSek: t.max_amount_sek, requiresFinalReport: t.requires_final_report !== false }));
  const preType = typeof sp.typ === 'string' && types.some((t) => t.id === sp.typ) ? sp.typ : undefined;
  const preStartup = typeof sp.bolag === 'string' && startups.some((s) => s.id === sp.bolag) ? sp.bolag : undefined;

  return (
    <PageShell title="Ny ansökan om stödcheck" meta={<BackLink href={isMember ? '/min-oversikt' : '/checkar'} label={isMember ? 'Min översikt' : 'Alla ansökningar'} />}>
      <div className="mx-auto w-full max-w-4xl">
        {types.length === 0 ? (
          <p className="text-sm text-foreground-muted">Det finns inga öppna stödcheckar att söka just nu.</p>
        ) : startups.length === 0 ? (
          <p className="text-sm text-foreground-muted">Ditt konto är inte kopplat till något bolag.</p>
        ) : (
          <ApplicationForm mode="create" types={typeOptions} startups={startups} initial={{ checkTypeId: preType, startupId: preStartup }} lockStartup={isMember} />
        )}
      </div>
    </PageShell>
  );
}
