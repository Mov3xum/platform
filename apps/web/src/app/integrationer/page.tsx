import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
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

const CATEGORIES: Record<
  IntegrationCategory,
  {
    label: string;
    description: string;
    accentBg: string;
    badgeClass: string;
    cardAccent: string;
  }
> = {
  microsoft365: {
    label: 'Microsoft 365',
    description:
      'Teams, SharePoint och Outlook för organisationer i Microsoft-ekosystemet.',
    accentBg: 'bg-movexum-pastell-bla dark:bg-movexum-morkbla/30',
    badgeClass:
      'bg-movexum-pastell-bla text-movexum-morkbla ring-movexum-bla dark:bg-movexum-morkbla/50 dark:text-movexum-pastell-bla dark:ring-movexum-djupbla',
    cardAccent: 'bg-movexum-pastell-bla dark:bg-movexum-morkbla/40'
  },
  ai: {
    label: 'AI & Analys',
    description: 'EU-suveräna AI-tjänster för djupare insikt om era bolag och team.',
    accentBg: 'bg-movexum-pastell-lila dark:bg-movexum-morklila/30',
    badgeClass:
      'bg-movexum-pastell-lila text-movexum-morklila ring-movexum-ljuslila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila dark:ring-movexum-lila',
    cardAccent: 'bg-movexum-pastell-lila dark:bg-movexum-morklila/40'
  },
  collaboration: {
    label: 'Samarbete & Whiteboarding',
    description: 'Visuella samarbetsverktyg och kunskapsbaser för era startup-team.',
    accentBg: 'bg-movexum-pastell-gul dark:bg-movexum-morkgul/20',
    badgeClass:
      'bg-movexum-pastell-gul text-movexum-morkgul ring-movexum-gul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul dark:ring-movexum-morkgul',
    cardAccent: 'bg-movexum-pastell-gul dark:bg-movexum-morkgul/30'
  },
  communication: {
    label: 'Kommunikation',
    description:
      'Synka er kommunikationsplattform och håll alla uppdaterade utan extraarbete.',
    accentBg: 'bg-movexum-pastell-gron dark:bg-movexum-morkgron/30',
    badgeClass:
      'bg-movexum-pastell-gron text-movexum-morkgron ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:ring-movexum-gron',
    cardAccent: 'bg-movexum-pastell-gron dark:bg-movexum-morkgron/40'
  },
  productivity: {
    label: 'Produktivitet & Utveckling',
    description:
      'Kodbaser, arbetsytor och alternativa kontorspaketen för er teknikdrivna verksamhet.',
    accentBg: 'bg-movexum-pastell-orange dark:bg-movexum-morkorange/30',
    badgeClass:
      'bg-movexum-pastell-orange text-movexum-morkorange ring-movexum-orange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange dark:ring-movexum-orange',
    cardAccent: 'bg-movexum-pastell-orange dark:bg-movexum-morkorange/40'
  }
};

const CATEGORY_ORDER: IntegrationCategory[] = [
  'microsoft365',
  'ai',
  'collaboration',
  'communication',
  'productivity'
];

const VALUE_PROPS = [
  {
    title: 'Per konto',
    description:
      'Varje organisation konfigurerar sina egna integrationer. Inget delat, inget läckage.'
  },
  {
    title: 'EU-suveränt',
    description:
      'Alla integrationer auditeras mot Movexums dataskyddspolicy. Ingen data lämnar EU.'
  },
  {
    title: 'En miljö',
    description: 'Era verktyg pratar med plattformen — inte tvärtom. Ni väljer vad som visas var.'
  }
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

  // ── Hämta provider-katalog ────────────────────────────────────
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

  // ── Hämta tenant-status för respektive provider ───────────────
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

  const footerNumber = String(VALUE_PROPS.length + 1).padStart(2, '0');

  return (
    <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
      <header className="mb-10">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-link">
          Plattformsinställningar
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground">
          Integrationer
        </h1>
        <p className="mt-3 max-w-2xl text-base text-foreground-muted">
          Anslut de verktyg ni redan använder och bygg er organisations unika digitala
          miljö. Varje konto konfigureras separat — ni bestämmer exakt vad som synkas och för
          vilka bolag.
        </p>
      </header>

      <div className="mb-10 grid gap-4 sm:grid-cols-3">
        {VALUE_PROPS.map((prop, idx) => (
          <ValueProp
            key={prop.title}
            placeholder={String(idx + 1).padStart(2, '0')}
            title={prop.title}
            description={prop.description}
          />
        ))}
      </div>

      {views.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-strong bg-surface/50 px-8 py-16 text-center">
          <h3 className="text-lg font-semibold text-foreground">
            Inga integrationer tillgängliga
          </h3>
          <p className="mt-2 text-sm text-foreground-muted">
            Katalogen är tom. Kontakta Movexum för att komma igång.
          </p>
        </div>
      ) : (
        <div className="space-y-12">
          {CATEGORY_ORDER.map((cat) => {
            const config = CATEGORIES[cat];
            const integrations = byCategory[cat];
            if (integrations.length === 0) return null;

            return (
              <section key={cat}>
                <div className="mb-5 flex flex-wrap items-end gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">{config.label}</h2>
                    <p className="mt-0.5 text-sm text-foreground-muted">
                      {config.description}
                    </p>
                  </div>
                  <span
                    className={`ml-auto rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${config.badgeClass}`}
                  >
                    {integrations.length}{' '}
                    {integrations.length === 1 ? 'integration' : 'integrationer'}
                  </span>
                </div>

                <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  {integrations.map((integration) => (
                    <IntegrationCard
                      key={integration.id}
                      integration={integration}
                      config={config}
                      canRequest={isStaff}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-14 rounded-3xl border border-dashed border-strong bg-surface/50 px-8 py-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-default bg-canvas-subtle text-xs font-semibold tracking-[0.08em] text-foreground-muted">
          {footerNumber}
        </div>
        <h3 className="mt-3 text-lg font-semibold text-foreground">
          Saknar du en integration?
        </h3>
        <p className="mt-2 max-w-sm mx-auto text-sm text-foreground-muted">
          Berättar du vilket verktyg ni vill ansluta så prioriterar vi det i
          utvecklingsroadmapen. Vi bygger integrationer baserade på era faktiska behov.
        </p>
        <a
          href="mailto:hampus@boxmeal.se"
          className="mt-5 inline-flex items-center justify-center rounded-full border border-default bg-surface px-6 py-2.5 text-sm font-semibold text-foreground transition hover:bg-canvas-subtle"
        >
          Begär integration →
        </a>
      </div>
    </main>
  );
}

function ValueProp({
  placeholder,
  title,
  description
}: {
  placeholder: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4 rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-default bg-canvas-subtle text-xs font-semibold tracking-[0.08em] text-foreground-muted">
        {placeholder}
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-foreground-muted">{description}</p>
      </div>
    </div>
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
      <span className="shrink-0 rounded-full bg-movexum-pastell-gron px-2.5 py-0.5 text-xs font-medium text-movexum-morkgron ring-1 ring-movexum-ljusgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron dark:ring-movexum-gron">
        Ansluten
      </span>
    );
  }
  if (tenantStatus === 'pilot_requested') {
    return (
      <span className="shrink-0 rounded-full bg-movexum-pastell-gul px-2.5 py-0.5 text-xs font-medium text-movexum-morkgul ring-1 ring-movexum-gul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
        Pilot begärd
      </span>
    );
  }
  if (availability === 'beta') {
    return (
      <span className="shrink-0 rounded-full bg-movexum-pastell-lila px-2.5 py-0.5 text-xs font-medium text-movexum-morklila ring-1 ring-movexum-ljuslila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila">
        Beta — pilot
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-canvas-subtle px-2.5 py-0.5 text-xs font-medium text-foreground-muted ring-1 ring-default">
      På roadmap
    </span>
  );
}

function IntegrationCard({
  integration,
  config,
  canRequest
}: {
  integration: ProviderView;
  config: typeof CATEGORIES[IntegrationCategory];
  canRequest: boolean;
}) {
  return (
    <article className="flex flex-col overflow-hidden rounded-3xl border border-default bg-surface shadow-sm shadow-movexum-svart/5 transition hover:border-strong hover:shadow-md">
      <div className={`${config.cardAccent} px-6 py-4`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-default bg-surface text-xs font-semibold tracking-[0.08em] text-foreground-muted">
              {integration.placeholder}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{integration.name}</h3>
              <p className="text-xs text-foreground-muted">{integration.tagline}</p>
            </div>
          </div>
          <StatusBadge
            tenantStatus={integration.tenantStatus}
            availability={integration.availability}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-6 py-5">
        <p className="text-sm text-foreground-muted">{integration.description}</p>

        <ul className="space-y-1.5">
          {integration.features.map((feature) => (
            <li
              key={feature}
              className="flex items-start gap-2 text-xs text-foreground-muted"
            >
              <span className="mt-0.5 text-foreground-subtle" aria-hidden="true">
                —
              </span>
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-2">
          <IntegrationActivateButton
            providerId={integration.id}
            integrationName={integration.name}
            providerPlaceholder={integration.placeholder}
            availability={integration.availability}
            tenantStatus={integration.tenantStatus}
            canRequest={canRequest}
            accentClass={config.cardAccent}
          />
        </div>
      </div>
    </article>
  );
}
