import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat } from '@/components/PageRail';
import { getHandler } from '@/lib/integrations/registry';
import { ConnectForm } from './ConnectForm';
import { SyncButton } from './SyncButton';
import { DisconnectForm } from './DisconnectForm';

interface ProviderRecord {
  id: string;
  slug: string;
  name: string;
  category: string;
  placeholder: string;
  tagline: string;
  description: string;
  features: unknown;
  availability: string;
}

interface TenantIntegrationRecord {
  id: string;
  provider: string;
  status: 'available' | 'pilot_requested' | 'connected' | 'disabled';
  last_sync_at?: string;
  last_sync_status?: 'success' | 'failed' | 'partial';
  last_sync_summary?: string;
  connected_at?: string;
}

interface SyncRunRecord {
  id: string;
  status: 'started' | 'success' | 'failed' | 'partial';
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  records_created?: number;
  records_updated?: number;
  records_skipped?: number;
  error_message?: string;
}

interface IntegrationRecordRow {
  id: string;
  record_type: string;
  title: string;
  summary: string;
  url: string;
  occurred_at: string;
  synced_at: string;
}

function formatDate(iso?: string) {
  if (!iso) return '–';
  try {
    return new Date(iso).toLocaleString('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function toFeatures(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

export default async function IntegrationDetailPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'integrationer', user.disabledModules)) {
    redirect('/dashboard');
  }

  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead']);
  const isAdmin = hasRole(user.roles, ['admin']);
  const handler = getHandler(slug);
  const pb = await getServerPb();

  let provider: ProviderRecord | null = null;
  try {
    provider = await pb
      .collection('integration_providers')
      .getFirstListItem<ProviderRecord>(`slug = "${slug}" && active = true`);
  } catch {
    provider = null;
  }
  if (!provider) notFound();

  let tenantIntegration: TenantIntegrationRecord | null = null;
  try {
    tenantIntegration = await pb
      .collection('tenant_integrations')
      .getFirstListItem<TenantIntegrationRecord>(
        `tenant = "${user.tenant}" && provider = "${provider.id}"`
      );
  } catch {
    tenantIntegration = null;
  }

  const isRegistry = handler?.kind === 'company_registry';

  let syncRuns: SyncRunRecord[] = [];
  let recentRecords: IntegrationRecordRow[] = [];
  let registryStats: { startupsWithOrgNr: number; startupsWithFinancials: number } | null =
    null;
  if (tenantIntegration && isStaff) {
    try {
      const runs = await pb
        .collection('integration_sync_runs')
        .getList<SyncRunRecord>(1, 10, {
          filter: `tenant_integration = "${tenantIntegration.id}"`,
          sort: '-started_at'
        });
      syncRuns = runs.items;
    } catch {
      /* ignore */
    }
  }
  if (tenantIntegration && !isRegistry) {
    try {
      const recs = await pb
        .collection('integration_records')
        .getList<IntegrationRecordRow>(1, 20, {
          filter: `tenant_integration = "${tenantIntegration.id}"`,
          sort: '-occurred_at'
        });
      recentRecords = recs.items;
    } catch {
      /* ignore */
    }
  }
  if (tenantIntegration && isRegistry) {
    try {
      const startupsRes = await pb
        .collection('startups')
        .getList(1, 1, {
          filter: `tenant = "${user.tenant}" && org_nr != ""`,
          fields: 'id'
        });
      const financialsRes = await pb
        .collection('startup_financials')
        .getList<{ startup: string }>(1, 500, {
          filter: `tenant = "${user.tenant}" && source = "allabolag"`,
          fields: 'startup'
        });
      const uniqueStartups = new Set(financialsRes.items.map((r) => r.startup));
      registryStats = {
        startupsWithOrgNr: startupsRes.totalItems,
        startupsWithFinancials: uniqueStartups.size
      };
    } catch {
      registryStats = { startupsWithOrgNr: 0, startupsWithFinancials: 0 };
    }
  }

  const status = tenantIntegration?.status || 'available';
  const isConnected = status === 'connected';
  const features = toFeatures(provider.features);

  const rail = (
    <>
      <RailSection label="Status">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Anslutning" value={isConnected ? 'På' : 'Av'} />
          <RailStat
            label="Senaste synk"
            value={
              tenantIntegration?.last_sync_at
                ? formatDate(tenantIntegration.last_sync_at).slice(0, 10)
                : '–'
            }
          />
          <RailStat label="Poster" value={recentRecords.length} />
          <RailStat label="Synk-runs" value={syncRuns.length} />
        </div>
      </RailSection>
      <RailSection label="Regelefterlevnad">
        <div className="space-y-1.5 px-3 py-1 text-[12px] text-foreground-muted">
          <div>
            <span className="text-foreground-subtle">Residency:</span>{' '}
            {handler?.residency || 'Okänd'}
          </div>
          <div>
            <span className="text-foreground-subtle">Riskklass:</span>{' '}
            {handler?.riskClass || '–'}
          </div>
        </div>
      </RailSection>
    </>
  );

  return (
    <PageShell
      title={provider.name}
      meta={
        <span className="rounded-md bg-canvas-muted px-2 py-0.5 text-[11px] font-medium text-foreground-muted">
          {provider.tagline}
        </span>
      }
      rightPanel={rail}
    >
      <div className="space-y-6 py-6">
        <Link
          href="/integrationer"
          className="inline-block text-[12px] text-foreground-subtle hover:text-foreground"
        >
          ← Tillbaka till katalogen
        </Link>

        {handler && (
          <div className="rounded-2xl border border-default bg-canvas-subtle px-4 py-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Dataskydd & EU-residency
            </p>
            <p className="mt-1 text-[13px] text-foreground-muted">
              {handler.complianceNote}
            </p>
          </div>
        )}

        <section className="rounded-2xl border border-default bg-surface px-5 py-4">
          <p className="text-[13px] text-foreground-muted">{provider.description}</p>
          {features.length > 0 && (
            <ul className="mt-3 space-y-1">
              {features.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-[12px] text-foreground-muted"
                >
                  <span className="mt-0.5 text-foreground-subtle">—</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {!handler ? (
          <section className="rounded-2xl border border-dashed border-default px-5 py-6 text-center">
            <p className="text-[13px] text-foreground-muted">
              Den här leverantören har ännu inte ett aktivt syncgränssnitt.
              Använd "Begär pilot" på katalogsidan.
            </p>
          </section>
        ) : !isStaff ? (
          <section className="rounded-2xl border border-default bg-canvas-subtle px-5 py-4 text-[13px] text-foreground-muted">
            Endast admin och inkubatorledning kan ansluta och köra synk.
          </section>
        ) : !isConnected ? (
          <section className="rounded-2xl border border-default bg-surface px-5 py-5">
            <h2 className="text-[14px] font-semibold text-foreground">
              Anslut {provider.name}
            </h2>
            <p className="mt-1 text-[12px] text-foreground-muted">
              Inloggningsuppgifter krypteras med AES-256-GCM innan de sparas.
            </p>
            <div className="mt-4">
              <ConnectForm
                providerSlug={slug}
                providerName={provider.name}
                fields={handler.credentialFields}
              />
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-default bg-surface px-5 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-semibold text-foreground">
                  Aktiv koppling
                </h2>
                <p className="mt-1 text-[12px] text-foreground-muted">
                  Senaste synk: {formatDate(tenantIntegration?.last_sync_at)}
                  {tenantIntegration?.last_sync_summary
                    ? ` — ${tenantIntegration.last_sync_summary}`
                    : ''}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SyncButton
                tenantIntegrationId={tenantIntegration!.id}
                providerSlug={slug}
              />
              {isAdmin && (
                <DisconnectForm
                  tenantIntegrationId={tenantIntegration!.id}
                  providerName={provider.name}
                />
              )}
            </div>
          </section>
        )}

        {isConnected && syncRuns.length > 0 && (
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Senaste synk-runs
            </h3>
            <div className="overflow-hidden rounded-2xl border border-default bg-surface">
              <table className="w-full text-[12px]">
                <thead className="bg-canvas-subtle text-left text-foreground-subtle">
                  <tr>
                    <th className="px-3 py-2 font-medium">Start</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Skapade</th>
                    <th className="px-3 py-2 font-medium">Uppdaterade</th>
                    <th className="px-3 py-2 font-medium">Tid</th>
                  </tr>
                </thead>
                <tbody>
                  {syncRuns.map((run) => (
                    <tr key={run.id} className="border-t border-default">
                      <td className="px-3 py-2 text-foreground">
                        {formatDate(run.started_at)}
                      </td>
                      <td className="px-3 py-2 text-foreground-muted">
                        {run.status}
                        {run.error_message ? ` — ${run.error_message}` : ''}
                      </td>
                      <td className="px-3 py-2 text-foreground-muted">
                        {run.records_created ?? 0}
                      </td>
                      <td className="px-3 py-2 text-foreground-muted">
                        {run.records_updated ?? 0}
                      </td>
                      <td className="px-3 py-2 text-foreground-subtle">
                        {run.duration_ms ? `${Math.round(run.duration_ms)} ms` : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {isConnected && isRegistry && registryStats && (
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Bolagsregister-täckning
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-default bg-surface px-4 py-3">
                <p className="text-[11px] text-foreground-subtle">Bolag med org-nr</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {registryStats.startupsWithOrgNr}
                </p>
              </div>
              <div className="rounded-2xl border border-default bg-surface px-4 py-3">
                <p className="text-[11px] text-foreground-subtle">
                  Bolag med Allabolag-financials
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {registryStats.startupsWithFinancials}
                </p>
              </div>
            </div>
            <p className="mt-3 text-[12px] text-foreground-muted">
              Bolagsregister-providers skriver direkt till bolagskorten och
              <code className="mx-1 rounded bg-canvas-subtle px-1 py-0.5 text-[11px]">
                startup_financials
              </code>
              — det finns inga separata "poster" att lista här. Se varje bolags
              "Finansiell historik"-sektion för detaljer.
            </p>
          </section>
        )}

        {isConnected && !isRegistry && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Senaste synkade poster
              </h3>
              <Link
                href={`/integrationer/${slug}/poster`}
                className="text-[11px] text-link hover:underline"
              >
                Alla poster →
              </Link>
            </div>
            {recentRecords.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-default px-4 py-6 text-center text-[12px] text-foreground-muted">
                Inga poster ännu. Klicka "Synka nu" för att hämta data.
              </div>
            ) : (
              <ul className="divide-y divide-default rounded-2xl border border-default bg-surface">
                {recentRecords.map((rec) => (
                  <li key={rec.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-foreground">
                          {rec.title}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-foreground-muted">
                          {rec.summary}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md bg-canvas-muted px-2 py-0.5 text-[10.5px] font-medium text-foreground-muted">
                        {rec.record_type}
                      </span>
                    </div>
                    <p className="mt-1 text-[10.5px] text-foreground-subtle">
                      {formatDate(rec.occurred_at)}
                      {rec.url && (
                        <>
                          {' · '}
                          <a
                            href={rec.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-link hover:underline"
                          >
                            Öppna hos {provider.name}
                          </a>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </PageShell>
  );
}
