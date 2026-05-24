import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';

interface ProviderRow {
  id: string;
  name: string;
  slug: string;
}

interface TenantIntegrationRow {
  id: string;
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

const PAGE_SIZE = 50;

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

export default async function IntegrationRecordsPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  const { slug } = await params;
  const { type, page } = await searchParams;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'integrationer', user.disabledModules)) {
    redirect('/dashboard');
  }

  const pb = await getServerPb();

  let provider: ProviderRow | null = null;
  try {
    provider = await pb
      .collection('integration_providers')
      .getFirstListItem<ProviderRow>(`slug = "${slug}" && active = true`);
  } catch {
    provider = null;
  }
  if (!provider) notFound();

  let tenantIntegration: TenantIntegrationRow | null = null;
  try {
    tenantIntegration = await pb
      .collection('tenant_integrations')
      .getFirstListItem<TenantIntegrationRow>(
        `tenant = "${user.tenant}" && provider = "${provider.id}"`
      );
  } catch {
    tenantIntegration = null;
  }

  if (!tenantIntegration) {
    return (
      <PageShell title={`${provider.name} – poster`}>
        <div className="py-6">
          <p className="text-[13px] text-foreground-muted">
            Integrationen är inte aktiverad för er ännu.
          </p>
          <Link
            href={`/integrationer/${slug}`}
            className="mt-3 inline-block text-[12px] text-link hover:underline"
          >
            ← Tillbaka
          </Link>
        </div>
      </PageShell>
    );
  }

  const currentPage = Math.max(1, parseInt(page || '1', 10) || 1);
  const filterParts = [`tenant_integration = "${tenantIntegration.id}"`];
  if (type) filterParts.push(`record_type = "${type}"`);

  let result: { items: IntegrationRecordRow[]; totalPages: number } = {
    items: [],
    totalPages: 1
  };
  try {
    const res = await pb
      .collection('integration_records')
      .getList<IntegrationRecordRow>(currentPage, PAGE_SIZE, {
        filter: filterParts.join(' && '),
        sort: '-occurred_at'
      });
    result = { items: res.items, totalPages: res.totalPages };
  } catch {
    /* ignore */
  }

  const recordTypes = Array.from(new Set(result.items.map((r) => r.record_type)));

  return (
    <PageShell title={`${provider.name} – poster`}>
      <div className="space-y-4 py-6">
        <Link
          href={`/integrationer/${slug}`}
          className="inline-block text-[12px] text-foreground-subtle hover:text-foreground"
        >
          ← Tillbaka
        </Link>

        {recordTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 text-[11.5px]">
            <Link
              href={`/integrationer/${slug}/poster`}
              className={`rounded-md px-2.5 py-1 ${
                !type
                  ? 'bg-brand text-brand-foreground'
                  : 'bg-canvas-muted text-foreground-muted hover:bg-canvas-subtle'
              }`}
            >
              Alla
            </Link>
            {recordTypes.map((rt) => (
              <Link
                key={rt}
                href={`/integrationer/${slug}/poster?type=${encodeURIComponent(rt)}`}
                className={`rounded-md px-2.5 py-1 ${
                  type === rt
                    ? 'bg-brand text-brand-foreground'
                    : 'bg-canvas-muted text-foreground-muted hover:bg-canvas-subtle'
                }`}
              >
                {rt}
              </Link>
            ))}
          </div>
        )}

        {result.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default px-4 py-8 text-center text-[13px] text-foreground-muted">
            Inga poster med detta filter.
          </div>
        ) : (
          <ul className="divide-y divide-default rounded-2xl border border-default bg-surface">
            {result.items.map((rec) => (
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

        {result.totalPages > 1 && (
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-foreground-subtle">
              Sida {currentPage} av {result.totalPages}
            </span>
            <div className="flex gap-2">
              {currentPage > 1 && (
                <Link
                  href={`/integrationer/${slug}/poster?${
                    type ? `type=${encodeURIComponent(type)}&` : ''
                  }page=${currentPage - 1}`}
                  className="rounded-md bg-canvas-muted px-3 py-1.5 text-foreground-muted hover:bg-canvas-subtle"
                >
                  ← Föregående
                </Link>
              )}
              {currentPage < result.totalPages && (
                <Link
                  href={`/integrationer/${slug}/poster?${
                    type ? `type=${encodeURIComponent(type)}&` : ''
                  }page=${currentPage + 1}`}
                  className="rounded-md bg-canvas-muted px-3 py-1.5 text-foreground-muted hover:bg-canvas-subtle"
                >
                  Nästa →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
