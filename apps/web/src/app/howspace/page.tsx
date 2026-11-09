import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { RailNote, RailSection, RailStat } from '@/components/PageRail';
import { Chip, Icon } from '@/components/proto';
import { howspaceStatusLabel, type HowspaceWorkspaceView } from '@platform/shared';
import { loadHowspaceOverview } from '@/lib/howspace/data';
import { howspaceAppUrl } from '@/lib/integrations/providers/howspace/handler';

export const dynamic = 'force-dynamic';

/**
 * Howspace (CLAUDE.md § 59) — Movexums workspaces i Howspace samlade på en
 * sida: deltagarstatistik, senaste synk och ett klick in i rätt workspace.
 * Själva arbetet sker i Howspace (öppnas i egen flik, inloggning via SSO mot
 * Howspace); ingen inbäddning — vår CSP sätter frame-src 'none' och
 * tredjepartskakor i iframes är opålitliga. Läser med användarens token
 * (RLS § 21). Ingen AI-funktion på sidan → ingen transparensbanner.
 */

function formatDate(iso: string | null) {
  if (!iso) return '–';
  try {
    return new Date(iso).toLocaleString('sv-SE', {
      timeZone: 'Europe/Stockholm',
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

function syncStatusLabel(status: 'success' | 'failed' | 'partial' | null): string {
  switch (status) {
    case 'success':
      return 'Lyckades';
    case 'partial':
      return 'Delvis';
    case 'failed':
      return 'Misslyckades';
    default:
      return '–';
  }
}

function WorkspaceCard({ ws }: { ws: HowspaceWorkspaceView }) {
  const status = howspaceStatusLabel(ws.status);
  return (
    <article className="flex h-full flex-col rounded-2xl border border-default bg-surface px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-heading text-[15px] font-semibold leading-snug text-foreground">{ws.name}</h2>
        {status.label ? <Chip variant={status.tone === 'default' ? 'default' : status.tone}>{status.label}</Chip> : null}
      </div>
      {ws.summary ? <p className="mt-2 text-[13px] text-foreground-muted">{ws.summary}</p> : null}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        <div>
          <dt className="text-foreground-subtle">Deltagare</dt>
          <dd className="mx-tnum font-semibold text-foreground">{ws.participantCount ?? '–'}</dd>
        </div>
        <div>
          <dt className="text-foreground-subtle">Aktiva</dt>
          <dd className="mx-tnum font-semibold text-foreground">{ws.activeCount ?? '–'}</dd>
        </div>
      </dl>
      <div className="mt-auto flex items-center justify-between gap-3 pt-4">
        <span className="text-[11px] text-foreground-subtle">
          {ws.statsAt ? `Statistik ${formatDate(ws.statsAt).slice(0, 10)}` : 'Ingen statistik synkad'}
        </span>
        {ws.url ? (
          <a href={ws.url} target="_blank" rel="noopener noreferrer" className="mx-btn mx-primary">
            Öppna i Howspace <Icon name="external" size={12} />
          </a>
        ) : (
          <span className="text-[11px] text-foreground-subtle">Länk saknas</span>
        )}
      </div>
    </article>
  );
}

export default async function HowspacePage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'howspace', user.enabledModules)) redirect('/hem');

  const pb = await getServerPb();
  const overview = await loadHowspaceOverview(pb, user.tenant);
  const appUrl = howspaceAppUrl();
  const canManage = hasRole(user.roles, ['admin', 'incubator_lead']);
  const settingsHref = '/integrationer/howspace';

  const rail = (
    <>
      <RailSection label="Status">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Koppling" value={overview.connected ? 'Ansluten' : 'Ej ansluten'} />
          <RailStat label="Workspaces" value={overview.workspaces.length} />
          <RailStat label="Senaste synk" value={overview.lastSyncAt ? formatDate(overview.lastSyncAt).slice(0, 10) : '–'} />
          <RailStat label="Utfall" value={syncStatusLabel(overview.lastSyncStatus)} />
        </div>
      </RailSection>
      <RailSection label="Inloggning">
        <RailNote>
          Du loggar in i Howspace med ditt Movexum-konto via SSO. Länkarna öppnas i en egen flik — plattformen bäddar
          aldrig in Howspace och lagrar inga deltagaruppgifter, bara räknare.
        </RailNote>
      </RailSection>
      {canManage ? (
        <RailSection label="Administration">
          <div className="px-3 py-1">
            <Link href={settingsHref} className="text-[12px] text-link hover:underline">
              Hantera integrationen →
            </Link>
          </div>
        </RailSection>
      ) : null}
    </>
  );

  return (
    <PageShell
      title="Howspace"
      meta={
        <span className="rounded-md bg-canvas-muted px-2 py-0.5 text-[11px] font-medium text-foreground-muted">
          Collaborative learning · Finland (EU)
        </span>
      }
      actions={
        <a href={appUrl} target="_blank" rel="noopener noreferrer" className="mx-btn mx-primary">
          Öppna Howspace <Icon name="external" size={12} />
        </a>
      }
      rightPanel={rail}
    >
      <div className="space-y-6 py-6">
        {overview.notices.map((n) => (
          <div
            key={n}
            className="rounded-2xl border border-movexum-morkgul/40 bg-movexum-pastell-gul px-4 py-3 text-[13px] text-movexum-morkgul"
          >
            {n}
          </div>
        ))}

        {!overview.connected ? (
          <section className="rounded-2xl border border-dashed border-default px-5 py-6">
            <h2 className="font-heading text-[15px] font-semibold text-foreground">
              Howspace är inte anslutet än
            </h2>
            <p className="mt-2 max-w-prose text-[13px] text-foreground-muted">
              Knappen &quot;Öppna Howspace&quot; fungerar redan — du landar i Howspace och loggar in med SSO. För att
              era workspaces ska listas här med deltagarstatistik behöver Partner API:t anslutas med en API-token
              från ert Howspace-konto.
            </p>
            {!overview.providerKnown ? (
              <p className="mt-2 text-[12px] text-foreground-subtle">
                Katalograden för Howspace saknas på den här instansen — kör migration 1700000213 (Sync PocketBase).
              </p>
            ) : null}
            <div className="mt-4">
              {canManage ? (
                <Link href={settingsHref} className="mx-btn">
                  Anslut Howspace i Integrationer
                </Link>
              ) : (
                <p className="text-[12px] text-foreground-subtle">
                  Be en administratör eller inkubatorledningen ansluta Howspace under Inställningar → Integrationer.
                </p>
              )}
            </div>
          </section>
        ) : overview.workspaces.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-default px-5 py-6">
            <h2 className="font-heading text-[15px] font-semibold text-foreground">Inga workspaces synkade än</h2>
            <p className="mt-2 max-w-prose text-[13px] text-foreground-muted">
              Kopplingen är aktiv men ingen synk har hämtat workspaces.
              {overview.lastSyncSummary ? ` Senaste synk: ${overview.lastSyncSummary}` : ''}
            </p>
            {canManage ? (
              <div className="mt-4">
                <Link href={settingsHref} className="mx-btn">
                  Kör &quot;Synka nu&quot; i Integrationer
                </Link>
              </div>
            ) : null}
          </section>
        ) : (
          <section>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Era workspaces
              </h2>
              <span className="text-[11px] text-foreground-subtle">
                Synkat {formatDate(overview.lastSyncAt)}
              </span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {overview.workspaces.map((ws) => (
                <WorkspaceCard key={ws.id} ws={ws} />
              ))}
            </div>
          </section>
        )}
      </div>
    </PageShell>
  );
}
