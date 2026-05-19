import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole, canActivateConnector } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat } from '@/components/PageRail';
import { hasHandler as hasIntegrationHandler } from '@/lib/integrations/registry';
import { IntegrationActivateButton } from './IntegrationActivateButton';
import { ConnectorCard } from '@/components/ConnectorCard';
import { BUILTINS, isConnectorAllowedForTenant } from '@/lib/ai/builtins';
import { listActiveConnectors, type MistralConnector } from '@/lib/ai/connectors';

type IntegrationCategory =
  | 'microsoft365'
  | 'ai'
  | 'collaboration'
  | 'communication'
  | 'productivity'
  | 'marketing'
  | 'learning';

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
  productivity: 'Produktivitet',
  marketing: 'Marknadsföring',
  learning: 'Lärande & program'
};

const CATEGORY_ORDER: IntegrationCategory[] = [
  'marketing',
  'learning',
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

export default async function IntegrationerPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = (await searchParams) ?? {};
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

  // ── Mistral-connectors (parallellt med Mistrals API + DB) ───────────────
  type ConnectorActivation = {
    id: string;
    connector_kind: 'builtin' | 'mcp';
    connector_id: string;
    status: 'active' | 'disabled' | 'oauth_pending';
  };

  const [tenant, activationList, mistralConnectors] = await Promise.all([
    pb.collection('tenants').getOne(user.tenant).catch(() => null),
    pb
      .collection('user_mistral_connectors')
      .getList<ConnectorActivation>(1, 200, {
        filter: `user = "${user.id}"`
      })
      .catch(() => ({ items: [] as ConnectorActivation[] })),
    listActiveConnectors().catch(() => [] as MistralConnector[])
  ]);

  const tenantAllowlist: string[] =
    tenant && Array.isArray((tenant as Record<string, unknown>).allowed_mistral_connectors)
      ? ((tenant as Record<string, unknown>).allowed_mistral_connectors as string[])
      : [];

  const activationStatus = new Map<string, ConnectorActivation['status']>();
  for (const row of activationList.items) {
    activationStatus.set(`${row.connector_kind}:${row.connector_id}`, row.status);
  }

  type ConnectorCardData = {
    kind: 'builtin' | 'mcp';
    id: string;
    title: string;
    blurb: string;
    riskClass: 'minimal' | 'begränsad' | 'högrisk';
    residency: string;
    requiresAuth: boolean;
    status: 'active' | 'disabled' | 'oauth_pending' | 'unactivated';
    allowed: boolean;
    notAllowedReason?: string;
  };

  const connectorCards: ConnectorCardData[] = [
    ...BUILTINS.map<ConnectorCardData>((b) => {
      const allowed =
        isConnectorAllowedForTenant('builtin', b.id, tenantAllowlist, { isStaff }) &&
        canActivateConnector(user.roles, { kind: 'builtin', id: b.id }, tenantAllowlist);
      return {
        kind: 'builtin',
        id: b.id,
        title: b.label,
        blurb: b.blurb,
        riskClass: b.riskClass,
        residency: b.residency,
        requiresAuth: false,
        status: activationStatus.get(`builtin:${b.id}`) ?? 'unactivated',
        allowed,
        notAllowedReason: b.costSensitive && !isStaff
          ? 'Admin måste lägga till i tenant-allowlistan'
          : undefined
      };
    }),
    // Defensiv filtrering: skala bort connectors som Mistral av någon
    // anledning markerar inaktiva — fixen i listActiveConnectors filtrerar
    // primärt, det här är en backstop.
    ...mistralConnectors
      .filter((c) => c.active !== false)
      .map<ConnectorCardData>((c) => {
        const allowed = canActivateConnector(
          user.roles,
          { kind: 'mcp', id: c.id },
          tenantAllowlist
        );
        return {
          kind: 'mcp',
          id: c.id,
          title: c.name,
          blurb: c.description || 'Anpassad MCP-connector från ditt Mistral-workspace.',
          riskClass: 'begränsad',
          residency: 'FR/EU',
          requiresAuth: c.requires_auth,
          status: activationStatus.get(`mcp:${c.id}`) ?? 'unactivated',
          allowed
        };
      })
  ];

  const activatedConnectors = connectorCards.filter((c) => c.status === 'active').length;

  const rail = (
    <>
      <RailSection label="Översikt">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Totalt" value={views.length + connectorCards.length} />
          <RailStat label="Anslutna" value={connected + activatedConnectors} />
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
        {params.error && (
          <div className="rounded-2xl bg-movexum-pastell-orange px-5 py-4 text-[13px] text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
            {params.error}
          </div>
        )}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Mistral-connectors
            </h2>
            <span className="font-mono text-[11px] text-foreground-subtle">
              {connectorCards.length}
            </span>
          </div>
          <p className="mb-4 text-[12.5px] leading-relaxed text-foreground-muted">
            Aktivera Mistrals inbyggda verktyg och anpassade MCP-connectors från
            ditt Mistral-workspace. Aktivering är per användare. Drivs av Mistral /
            Le Chat (Frankrike, EU-suveränt). Konfidentiella anteckningar
            exkluderas alltid.
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {connectorCards.map((c) => (
              <ConnectorCard
                key={`${c.kind}-${c.id}`}
                kind={c.kind}
                connectorId={c.id}
                title={c.title}
                blurb={c.blurb}
                riskClass={c.riskClass}
                residency={c.residency}
                status={c.status}
                allowed={c.allowed}
                notAllowedReason={c.notAllowedReason}
                requiresAuth={c.requiresAuth}
              />
            ))}
          </div>
          {mistralConnectors.length === 0 && (
            <p className="mt-3 text-[11.5px] text-foreground-subtle">
              Inga anpassade MCP-connectors hittades i ditt Mistral-workspace.
              Lägg till dem på{' '}
              <a
                href="https://chat.mistral.ai/settings/connectors"
                target="_blank"
                rel="noopener noreferrer"
                className="text-link hover:underline"
              >
                chat.mistral.ai/settings/connectors
              </a>
              .
            </p>
          )}
        </section>

        {isStaff && (
          <section>
            <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Manuella importer
            </h2>
            <a
              href="/admin/import-bolagslista"
              className="block rounded-2xl border border-default bg-surface p-5 transition hover:bg-canvas-subtle"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Bolagslista (Excel)
                  </div>
                  <p className="mt-1 text-[13px] text-foreground-muted">
                    Ladda upp Movexums Bolagslista och fyll på{' '}
                    <code className="font-mono text-xs">startups</code> +{' '}
                    <code className="font-mono text-xs">startup_financials</code>{' '}
                    idempotent. Underlag för AI-agenterna.
                  </p>
                </div>
                <span className="rounded-full bg-movexum-pastell-gron px-3 py-1 text-xs font-medium text-movexum-morkgron">
                  Tillgänglig
                </span>
              </div>
            </a>
          </section>
        )}

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
            providerSlug={integration.slug}
            integrationName={integration.name}
            providerPlaceholder={integration.placeholder}
            availability={integration.availability}
            tenantStatus={integration.tenantStatus}
            canRequest={canRequest}
            hasHandler={hasIntegrationHandler(integration.slug)}
            accentClass="bg-canvas-muted"
          />
        </div>
      </div>
    </article>
  );
}
