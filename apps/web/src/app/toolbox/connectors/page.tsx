import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, canActivateConnector } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { ConnectorCard } from '@/components/ConnectorCard';
import { BUILTINS, isConnectorAllowedForTenant } from '@/lib/ai/builtins';
import { listActiveConnectors } from '@/lib/ai/connectors';

interface ActivationRow {
  id: string;
  connector_kind: 'builtin' | 'mcp';
  connector_id: string;
  status: 'active' | 'disabled' | 'oauth_pending';
}

type Status = ActivationRow['status'] | 'unactivated';

export default async function ConnectorsPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'agenter', user.disabledModules)) {
    redirect('/idag');
  }

  const pb = await getServerPb();

  // Hämta tenantens allowlist och användarens aktiveringar parallellt
  // med Mistrals connector-lista.
  const [tenant, activationsList, mistralConnectors] = await Promise.all([
    pb.collection('tenants').getOne(user.tenant),
    pb.collection('user_mistral_connectors').getList<ActivationRow>(1, 200, {
      filter: `user = "${user.id}"`
    }),
    listActiveConnectors()
  ]);

  const tenantAllowlist: string[] = Array.isArray(tenant.allowed_mistral_connectors)
    ? (tenant.allowed_mistral_connectors as string[])
    : [];

  const statusIndex = new Map<string, Status>();
  for (const row of activationsList.items) {
    statusIndex.set(`${row.connector_kind}:${row.connector_id}`, row.status);
  }

  function statusFor(kind: 'builtin' | 'mcp', id: string): Status {
    return statusIndex.get(`${kind}:${id}`) ?? 'unactivated';
  }

  return (
    <PageShell title="Mistral-connectors">
      <div className="py-6">
        {params.error && (
          <div className="mb-6 rounded-2xl bg-movexum-pastell-orange px-5 py-4 text-[13px] text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
            {params.error}
          </div>
        )}

        <div className="mb-6 rounded-3xl border border-default bg-surface p-6">
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            Vad är connectors?
          </h2>
          <p className="text-[13px] leading-relaxed text-foreground-muted">
            Connectors är Mistrals first-party-verktyg (sök, code-interpreter,
            bildgenerering, bibliotek) och anpassade MCP-integrationer som är
            aktiverade i ditt Mistral-workspace. Klicka <em>Aktivera</em> på en
            connector för att kunna chatta direkt med den. AI-verktyg drivs av
            Mistral / Le Chat (Frankrike, EU-suveränt). Konfidentiella
            anteckningar exkluderas alltid.
          </p>
        </div>

        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
          Mistrals inbyggda verktyg
        </h3>
        <div className="mb-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {BUILTINS.map((b) => {
            const status = statusFor('builtin', b.id);
            const allowed =
              isConnectorAllowedForTenant('builtin', b.id, tenantAllowlist) &&
              canActivateConnector(user.roles, { kind: 'builtin', id: b.id }, tenantAllowlist);
            return (
              <ConnectorCard
                key={`builtin-${b.id}`}
                kind="builtin"
                connectorId={b.id}
                icon={b.icon}
                title={b.label}
                blurb={b.blurb}
                riskClass={b.riskClass}
                residency={b.residency}
                status={status}
                allowed={allowed}
                notAllowedReason={
                  b.costSensitive
                    ? 'Admin måste lägga till i tenant-allowlistan'
                    : 'Inte tillåten i tenanten'
                }
                requiresAuth={false}
              />
            );
          })}
        </div>

        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
          Anpassade MCP-connectors ({mistralConnectors.length})
        </h3>
        {mistralConnectors.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-8 text-center text-[13px] text-foreground-muted">
            Inga aktiva MCP-connectors i ditt Mistral-workspace.
            <br />
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
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {mistralConnectors.map((c) => {
              const status = statusFor('mcp', c.id);
              const allowed = canActivateConnector(
                user.roles,
                { kind: 'mcp', id: c.id },
                tenantAllowlist
              );
              return (
                <ConnectorCard
                  key={`mcp-${c.id}`}
                  kind="mcp"
                  connectorId={c.id}
                  icon="🔌"
                  title={c.name}
                  blurb={c.description || 'Anpassad MCP-connector från ditt Mistral-workspace.'}
                  riskClass="begränsad"
                  residency="FR/EU"
                  status={status}
                  allowed={allowed}
                  requiresAuth={c.requires_auth}
                />
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
