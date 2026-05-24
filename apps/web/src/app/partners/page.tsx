import Link from 'next/link';
import type { Partner } from '@platform/shared';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem, RailStat, RailEmpty } from '@/components/PageRail';

const EMPTY_RESULT_FILTER = 'id = ""';

function sanitizeRecordIds(ids: string[]): string[] {
  return ids.filter((id) => /^[a-zA-Z0-9_-]{6,64}$/.test(id));
}

export default async function PartnersPage() {
  const user = await requireUser();

  if (!canAccessModuleForUser(user.roles, 'partners', user.disabledModules)) {
    return (
      <PageShell title="Partneröversikt">
        <div className="mx-auto max-w-md py-12 text-center">
          <h2 className="text-base font-semibold text-foreground">Behörighet saknas</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            Din roll har inte tillgång till partneröversikten.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-flex items-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:bg-brand-hover"
          >
            Till dashboard
          </Link>
        </div>
      </PageShell>
    );
  }

  const pb = await getServerPb();
  let partners: Partner[] = [];
  const isScopedViewer =
    hasRole(user.roles, ['startup_member', 'partner']) &&
    !hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  try {
    let scopedPartnerIds: string[] | null = null;
    if (isScopedViewer) {
      if (user.linkedStartups.length === 0) {
        scopedPartnerIds = [];
      } else {
        const linkedStartupIds = sanitizeRecordIds(user.linkedStartups);
        if (linkedStartupIds.length === 0) {
          scopedPartnerIds = [];
        } else {
          const linkedFilter = linkedStartupIds.map((id) => `startup = "${id}"`).join(' || ');
          const engagements = await pb
            .collection('partner_engagements')
            .getFullList<{ partner?: string }>({
              filter: `tenant = "${user.tenant}" && (${linkedFilter})`,
              fields: 'partner'
            });
          scopedPartnerIds = Array.from(
            new Set(
              engagements
                .map((item) => (typeof item.partner === 'string' ? item.partner : ''))
                .filter(Boolean)
            )
          );
        }
      }
    }

    let partnerFilter = `tenant = "${user.tenant}"`;
    if (scopedPartnerIds !== null) {
      if (scopedPartnerIds.length === 0) {
        partnerFilter = `tenant = "${user.tenant}" && ${EMPTY_RESULT_FILTER}`;
      } else {
        partnerFilter = `tenant = "${user.tenant}" && (${scopedPartnerIds
          .map((id) => `id = "${id}"`)
          .join(' || ')})`;
      }
    }

    const result = await pb.collection('partners').getList<Partner>(1, 50, {
      filter: partnerFilter,
      sort: 'name'
    });
    partners = result.items;
  } catch (error) {
    console.error('[partners] failed to load partners', {
      tenant: user.tenant,
      userId: user.id,
      error
    });
  }

  const byType = partners.reduce<Record<string, number>>((acc, p) => {
    const type = p.type || 'okänt';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  const rail = (
    <>
      <RailSection label="Sammanfattning">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Partners" value={partners.length} />
          <RailStat label="Typer" value={Object.keys(byType).length} />
        </div>
      </RailSection>

      <RailSection label="Per typ">
        {Object.entries(byType).length === 0 ? (
          <RailEmpty>Inga partners ännu.</RailEmpty>
        ) : (
          Object.entries(byType).map(([type, count]) => (
            <RailItem
              key={type}
              icon="link"
              iconTone="brand"
              title={type}
              meta={`${count} ${count === 1 ? 'partner' : 'partners'}`}
            />
          ))
        )}
      </RailSection>
    </>
  );

  const canManage = hasRole(user.roles, ['admin', 'incubator_lead']);

  return (
    <PageShell
      title="Partneröversikt"
      meta={
        <span className="text-[12px] text-foreground-subtle">
          {user.tenantName || 'tenanten'}
        </span>
      }
      actions={
        canManage ? (
          <Link
            href="/partners/new"
            className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
          >
            + Ny partner
          </Link>
        ) : undefined
      }
      rightPanel={rail}
    >
      <div className="py-6">
        {partners.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-10 text-center">
            <p className="text-sm text-foreground-muted">
              Inga partners hittades ännu. Läggs till via PocketBase eller kommande adminflöde.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {partners.map((partner) => (
              <Link
                key={partner.id}
                href={`/partners/${partner.id}`}
                className="block rounded-2xl border border-default bg-surface p-5 transition hover:border-strong"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                  {partner.type}
                </p>
                <h2 className="mt-2 text-[15px] font-semibold text-foreground">{partner.name}</h2>
                <p className="mt-3 text-[13px] text-foreground-muted">
                  {partner.notes || 'Ingen extra information tillagd.'}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
