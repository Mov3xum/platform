import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listConnectedRegistries, listScreenableStartups } from '@/lib/excellence/data.server';
import { ExcellenceWorkspace } from './ExcellenceWorkspace';

export const dynamic = 'force-dynamic';

// Bedömning excellens (CLAUDE.md § 51): förscreening av ett bolag och dess
// koncern mot art. 22 GBER / de minimis och Vinnovas målgrupp, med färsk data
// från bolagsregistret (Roaring) eller det som redan är sparat. Deterministiskt
// underlag — ingen AI, inget beslut, inget sparas.
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
  const [startups, registries] = await Promise.all([
    listScreenableStartups(pb, user.tenant),
    canLookup ? listConnectedRegistries(pb, user.tenant) : Promise.resolve([])
  ]);

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
        <p className="text-sm text-foreground-muted">
          Följer tankemodellen för SMF-stöd och excellens: steg 1 utreder ägande, grundförutsättningar
          och tröskelvärden för startup-bolaget och dess anknutna/partnerföretag, steg 2 Vinnovas
          målgrupp och steg 3 excellensvillkoren. Varje punkt får Ja / Nej / Okänt med källa — inget
          gissas och inget beslut fattas här. Registerdata från Roaring hämtas utan att sparas;
          synka bolagskortet separat när du vill behålla den.
        </p>
        <ExcellenceWorkspace
          startups={startups}
          registries={registries}
          canLookup={canLookup}
          initialStartupId={initialStartupId}
        />
      </div>
    </PageShell>
  );
}
