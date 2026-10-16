import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listConnectedRegistries, listScreenableStartups } from '@/lib/excellence/data.server';
import { listAssignableResourcesForTenant } from '@/lib/assignments/collaboration';
import { ExcellenceWorkspace } from './ExcellenceWorkspace';
import { HowItWorks } from './HowItWorks';

export const dynamic = 'force-dynamic';

// Bedömning excellens (CLAUDE.md § 51): förscreening av ett bolag och dess
// koncern mot art. 22 GBER / de minimis och Vinnovas målgrupp, med färsk data
// från bolagsregistret (Roaring) eller det som redan är sparat. Deterministiskt
// underlag — ingen AI, inget beslut; bedömningen arkiveras som PDF i Filer (§ 51.3).
export default async function BedomningExcellensPage({
  searchParams
}: {
  searchParams: Promise<{ startup?: string }>;
}) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'bedomning_excellens', user.enabledModules)) redirect('/hem');
  const { startup } = await searchParams;
  const initialStartupId = startup && /^[a-z0-9]{1,30}$/i.test(startup) ? startup : undefined;
  // Färska uppslag debiteras per anrop — samma krets som "Testa mot org-nr".
  const canLookup = hasRole(user.roles, ['admin', 'incubator_lead']);
  const pb = await getServerPb();
  const [startups, registries, coaches] = await Promise.all([
    listScreenableStartups(pb, user.tenant),
    canLookup ? listConnectedRegistries(pb, user.tenant) : Promise.resolve([]),
    // Kollegor en begäran om komplettering kan gå till (§ 51.6) — aldrig den inloggade själv.
    listAssignableResourcesForTenant(pb, user.tenant).then((rows) => rows.filter((r) => r.id !== user.id))
  ]);
  const senderName = user.name && !user.name.includes('@') ? user.name : undefined;

  return (
    <PageShell
      title="Bedömning excellens"
      meta={
        <span className="text-sm text-foreground-subtle">
          Art. 22 GBER · de minimis · Vinnovas målgrupp — hela koncernen
        </span>
      }
    >
      <div className="space-y-5">
        <HowItWorks />
        <ExcellenceWorkspace
          startups={startups}
          registries={registries}
          canLookup={canLookup}
          initialStartupId={initialStartupId}
          coaches={coaches}
          senderName={senderName}
        />
      </div>
    </PageShell>
  );
}
