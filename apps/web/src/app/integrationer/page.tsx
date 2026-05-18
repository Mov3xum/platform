import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat } from '@/components/PageRail';
import { IntegrationActivateButton } from './IntegrationActivateButton';

type IntegrationCategory =
  | 'microsoft365'
  | 'ai'
  | 'collaboration'
  | 'communication'
  | 'productivity';

type Availability = 'planned' | 'beta' | 'available';
type TenantStatus = 'available' | 'pilot_requested' | 'connected' | 'disabled';

interface ProviderRecord {
  id: string;
  slug: string;
  name: string;
  category: IntegrationCategory;
  placeholder: string;
  tagline: string;
  description: string;
  features: unknown;
  availability: Availability;
  sort_order?: number;
  active?: boolean;
}

interface TenantIntegrationRecord {
  id: string;
  provider: string;
  status: TenantStatus;
}

interface ProviderView {
  id: string;
  slug: string;
  name: string;
  category: IntegrationCategory;
  placeholder: string;
  tagline: string;
  description: string;
  features: string[];
  availability: Availability;
  tenantStatus: TenantStatus;
}

const CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  microsoft365: 'Microsoft 365',
  ai: 'AI & analys',
  collaboration: 'Samarbete',
  communication: 'Kommunikation',
  productivity: 'Produktivitet'
};

const CATEGORY_ORDER: IntegrationCategory[] = [
  'microsoft365',
  'ai',
  'collaboration',
  'communication',
  'productivity'
];

function toFeatures(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

export default async function IntegrationerPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'integrationer', user.disabledModules))
    redirect('/dashboard');

  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead']);
  const pb = await getServerPb();

  let providers: ProviderRecord[] = [];
  try {
    const res = await pb
      .collection('integration_providers')
      .getList<ProviderRecord>(1, 100, {
        filter: 'active = true',
        sort: 'sort_order,name'
      });
    providers = res.items;
  } catch (error) {
    console.error('[integrationer] failed to load providers', { error });
  }

  const statusByProviderId = new Map<string, TenantStatus>();
  try {
    const res = await pb
      .collection('tenant_integrations')
      .getList<TenantIntegrationRecord>(1, 200, {
        filter: `tenant = "${user.tenant}"`,
        fields: 'id,provider,status'
      });
    for (const row of res.items) {
      statusByProviderId.set(row.provider, row.status);
    }
  } catch (error) {
    console.error('[integrationer] failed to load tenant integrations', {
      tenant: user.tenant,
      error
    });
  }

  const views: ProviderView[] = providers.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    placeholder: p.placeholder || p.slug.slice(0, 2).toUpperCase(),
    tagline: p.tagline,
    description: p.description,
    features: toFeatures(p.features),
    availability: p.availability,
    tenantStatus: statusByProviderId.get(p.id) || 'available'
  }));

  const byCategory = CATEGORY_ORDER.reduce<Record<IntegrationCategory, ProviderView[]>>(
    (acc, cat) => {
      acc[cat] = views.filter((v) => v.category === cat);
      return acc;
    },
    {} as Record<IntegrationCategory, ProviderView[]>
  );

  const connected = views.filter((v) => v.tenantStatus === 'connected').length;
  const pilots = views.filter((v) => v.tenantStatus === 'pilot_requested').length;
  const available = views.filter((v) => v.availability === 'available').length;

  const rail = (
    <>
      <RailSection label="Översikt">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Totalt" value={views.length} />
          <RailStat label="Anslutna" value={connected} />
          <RailStat label="Pilot" value={pilots} />
          <RailStat label="Tillgängliga" value={available} />
        </div>
      </RailSection>

      <RailSection label="Kategorier">
        {CATEGORY_ORDER.map((cat) => {
          const count = byCategory[cat]?.length || 0;
          if (count === 0) return null;
          return (
            <div
              key={cat}
              className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px]"
            >
              <span className="text-foreground">{CATEGORY_LABEL[cat]}</span>
              <span className="font-mono text-[11px] text-foreground-subtle">{count}</span>
            </div>
          );
        })}
      </RailSection>
    </>
  );

  return (
    <PageShell title="Integrationer" rightPanel={rail}>
      <div className="space-y-8 py-6">
        {views.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center">
            <h3 className="text-base font-semibold text-foreground">
              Inga integrationer tillgängliga
            </h3>
            <p className="mt-2 text-[13px] text-foreground-muted">
              Katalogen är tom. Kontakta Movexum för att komma igång.
            </p>
          </div>
        ) : (
          CATEGORY_ORDER.map((cat) => {
            const integrations = byCategory[cat];
            if (integrations.length === 0) return null;

            return (
              <section key={cat}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                    {CATEGORY_LABEL[cat]}
                  </h2>
                  <span className="font-mono text-[11px] text-foreground-subtle">
                    {integrations.length}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {integrations.map((integration) => (
                    <IntegrationCard
                      key={integration.id}
                      integration={integration}
                      canRequest={isStaff}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}

        <div className="rounded-2xl border border-dashed border-default p-8 text-center">
          <h3 className="text-base font-semibold text-foreground">
            Saknar du en integration?
          </h3>
          <p className="mx-auto mt-2 max-w-sm text-[13px] text-foreground-muted">
            Berätta vilket verktyg ni vill ansluta så prioriterar vi det i roadmapen.
          </p>
          <a
            href="mailto:hampus@boxmeal.se"
            className="mt-4 inline-flex items-center justify-center rounded-lg border border-default bg-surface px-4 py-2 text-[13px] font-medium text-foreground transition hover:bg-canvas-muted"
          >
            Begär integration →
          </a>
        </div>
      </div>
    </PageShell>
  );
}

function StatusBadge({
  tenantStatus,
  availability
}: {
  tenantStatus: TenantStatus;
  availability: Availability;
}) {
  if (tenantStatus === 'connected') {
    return (
      <span className="shrink-0 rounded-md bg-movexum-pastell-gron px-2 py-0.5 text-[11px] font-medium text-movexum-morkgron dark:bg-[#152916] dark:text-[#88b48b]">
        Ansluten
      </span>
    );
  }
  if (tenantStatus === 'pilot_requested') {
    return (
      <span className="shrink-0 rounded-md bg-movexum-pastell-gul px-2 py-0.5 text-[11px] font-medium text-movexum-morkgul dark:bg-[#2e150a] dark:text-[#ca9323]">
        Pilot begärd
      </span>
    );
  }
  if (availability === 'beta') {
    return (
      <span className="shrink-0 rounded-md bg-movexum-pastell-lila px-2 py-0.5 text-[11px] font-medium text-movexum-morklila dark:bg-[#1f1a3d] dark:text-[#c9b6fb]">
        Beta
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-md bg-canvas-muted px-2 py-0.5 text-[11px] font-medium text-foreground-muted">
      På roadmap
    </span>
  );
}

function IntegrationCard({
  integration,
  canRequest
}: {
  integration: ProviderView;
  canRequest: boolean;
}) {
  return (
    <article className="flex flex-col rounded-2xl border border-default bg-surface transition hover:border-strong">
      <div className="border-b border-default px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-default bg-canvas-subtle text-[10.5px] font-semibold tracking-[0.08em] text-foreground-muted">
              {integration.placeholder}
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-foreground">{integration.name}</h3>
              <p className="text-[11.5px] text-foreground-subtle">{integration.tagline}</p>
            </div>
          </div>
          <StatusBadge
            tenantStatus={integration.tenantStatus}
            availability={integration.availability}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 py-4">
        <p className="text-[13px] text-foreground-muted">{integration.description}</p>

        {integration.features.length > 0 && (
          <ul className="space-y-1">
            {integration.features.map((feature) => (
              <li
                key={feature}
                className="flex items-start gap-2 text-[11.5px] text-foreground-muted"
              >
                <span className="mt-0.5 text-foreground-subtle">—</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto pt-2">
          <IntegrationActivateButton
            providerId={integration.id}
            integrationName={integration.name}
            providerPlaceholder={integration.placeholder}
            availability={integration.availability}
            tenantStatus={integration.tenantStatus}
            canRequest={canRequest}
            accentClass="bg-canvas-muted"
          />
        </div>
      </div>
    </article>
  );
}
