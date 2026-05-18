import Link from 'next/link';
import {
  activateConnectorFormAction,
  deactivateConnectorFormAction
} from '@/lib/actions/connectors';
import { Chip } from '@/components/proto';

export interface ConnectorCardProps {
  kind: 'builtin' | 'mcp';
  connectorId: string;
  icon: string;
  title: string;
  blurb: string;
  riskClass: 'minimal' | 'begränsad' | 'högrisk';
  residency: string;
  status: 'active' | 'disabled' | 'oauth_pending' | 'unactivated';
  allowed: boolean;
  notAllowedReason?: string;
  requiresAuth?: boolean;
}

// Återanvändbart connector-kort. Action-formulären pekar mot
// `activateConnectorFormAction` resp. `deactivateConnectorFormAction`.
export function ConnectorCard({
  kind,
  connectorId,
  icon,
  title,
  blurb,
  riskClass,
  residency,
  status,
  allowed,
  notAllowedReason,
  requiresAuth
}: ConnectorCardProps) {
  const isActive = status === 'active';
  const isPending = status === 'oauth_pending';

  const chatHref = `/toolbox/connectors/${kind}/${encodeURIComponent(connectorId)}`;

  return (
    <div className="flex flex-col rounded-2xl border border-default bg-surface p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-base">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-foreground">{title}</div>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            <Chip mono>{kind === 'builtin' ? 'Built-in' : 'MCP'}</Chip>
            <Chip mono>{residency}</Chip>
            <Chip mono>{`risk: ${riskClass}`}</Chip>
            {requiresAuth && <Chip mono>OAuth</Chip>}
          </div>
        </div>
      </div>

      <p className="mb-4 line-clamp-3 min-h-[3.6em] text-[12.5px] leading-relaxed text-foreground-muted">
        {blurb}
      </p>

      <div className="mt-auto flex items-center justify-between gap-3">
        {isActive ? (
          <>
            <Link
              href={chatHref}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
            >
              Öppna chatt
            </Link>
            <form action={deactivateConnectorFormAction}>
              <input type="hidden" name="kind" value={kind} />
              <input type="hidden" name="connectorId" value={connectorId} />
              <button
                type="submit"
                className="text-[12px] text-foreground-subtle underline-offset-2 hover:text-foreground hover:underline"
              >
                Avaktivera
              </button>
            </form>
          </>
        ) : isPending ? (
          <span className="text-[12.5px] text-foreground-muted">
            Väntar på OAuth-samtycke…
          </span>
        ) : allowed ? (
          <form action={activateConnectorFormAction}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="connectorId" value={connectorId} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
            >
              Aktivera
            </button>
          </form>
        ) : (
          <span className="text-[12px] text-foreground-subtle">
            {notAllowedReason || 'Inte tillåten i tenanten'}
          </span>
        )}
      </div>
    </div>
  );
}
