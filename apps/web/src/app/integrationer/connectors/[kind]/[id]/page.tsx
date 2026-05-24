import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { PageShell } from '@/components/PageShell';
import { MessageList } from '../../../../toolbox/runs/[id]/MessageList';
import { AI_OUTPUT_WARNING_TEXT } from '@/lib/ai/ui-text';
import { ConnectorChatForm } from './ConnectorChatForm';
import { getBuiltin } from '@/lib/ai/builtins';
import { listActiveConnectors } from '@/lib/ai/connectors';
import { isAllowedModel, defaultModelForConnectors } from '@/lib/ai/models';
import type { ToolModel, ToolRunMessage } from '@platform/shared';

interface ConnectorRun {
  id: string;
  status: string;
  messages?: ToolRunMessage[];
  output_md?: string;
  model?: string;
  created: string;
}

interface Activation {
  id: string;
  status: 'active' | 'disabled' | 'oauth_pending';
}

export default async function ConnectorChatPage({
  params
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind: kindParam, id: connectorIdParam } = await params;
  if (kindParam !== 'builtin' && kindParam !== 'mcp') notFound();
  const kind = kindParam as 'builtin' | 'mcp';
  const connectorId = decodeURIComponent(connectorIdParam);

  const user = await requireUser();
  const pb = await getServerPb();

  // Hämta aktivering + metadata för titel/blurb parallellt.
  const [activationList, mistralList] = await Promise.all([
    pb
      .collection('user_mistral_connectors')
      .getList<Activation>(1, 1, {
        filter: `user = "${user.id}" && connector_kind = "${kind}" && connector_id = "${connectorId}"`
      }),
    kind === 'mcp' ? listActiveConnectors() : Promise.resolve([])
  ]);

  if (activationList.totalItems === 0 || activationList.items[0].status !== 'active') {
    redirect(
      `/integrationer?error=${encodeURIComponent(
        'Aktivera connectorn först innan du kan chatta med den.'
      )}`
    );
  }

  // Senaste run för denna connector (för att fortsätta chatten).
  let run: ConnectorRun | null = null;
  try {
    const recent = await pb.collection('tool_runs').getList<ConnectorRun>(1, 1, {
      filter: `tenant = "${user.tenant}" && triggered_by = "${user.id}" && connector_kind = "${kind}" && connector_id = "${connectorId}"`,
      sort: '-created'
    });
    if (recent.totalItems > 0) {
      run = recent.items[0];
    }
  } catch {
    run = null;
  }

  let title = connectorId;
  let blurb = '';
  let icon = '🔌';
  if (kind === 'builtin') {
    const b = getBuiltin(connectorId);
    if (!b) notFound();
    title = b.label;
    blurb = b.blurb;
    icon = b.icon;
  } else {
    const m = mistralList.find((c) => c.id === connectorId);
    if (m) {
      title = m.name;
      blurb = m.description || 'Anpassad MCP-connector från ditt Mistral-workspace.';
    }
  }

  const defaultModel: ToolModel = isAllowedModel(run?.model)
    ? (run!.model as ToolModel)
    : defaultModelForConnectors();

  const messages: ToolRunMessage[] = run?.messages ?? [];

  return (
    <PageShell title={title}>
      <div className="max-w-4xl py-6">
        <header className="mb-6 flex items-start gap-4 rounded-3xl border border-default bg-surface p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-canvas-muted text-2xl">
            {icon}
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground-muted">{blurb}</p>
            <p className="mt-2 text-[12px] text-foreground-subtle">
              📡 Connector använder Mistral — verifiera resultatet innan delning.
            </p>
          </div>
          <Link
            href="/integrationer"
            className="text-[12px] text-foreground-subtle underline-offset-2 hover:text-foreground hover:underline"
          >
            ← Integrationer
          </Link>
        </header>

        {messages.length > 0 ? (
          <section className="mb-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Chatt</h2>
              <span className="text-xs text-foreground-subtle">
                ⚠️ {AI_OUTPUT_WARNING_TEXT}
              </span>
            </div>
            <MessageList messages={messages} />
          </section>
        ) : (
          <div className="mb-6 rounded-3xl border border-dashed border-strong bg-surface/50 p-8 text-center">
            <p className="text-[13px] text-foreground-muted">
              Inga meddelanden ännu. Skriv ditt första nedan.
            </p>
          </div>
        )}

        <ConnectorChatForm
          kind={kind}
          connectorId={connectorId}
          runId={run?.id}
          defaultModel={defaultModel}
        />
      </div>
    </PageShell>
  );
}
