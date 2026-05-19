import Link from 'next/link';
import { Calendar, ExternalLink, AlertTriangle } from 'lucide-react';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { PageShell } from '@/components/PageShell';
import { ConnectorLogo } from '@/components/ConnectorLogo';
import {
  connectAppIntegrationFormAction,
  disconnectAppIntegrationFormAction
} from '@/lib/actions/app-integrations';
import {
  findIntegrationRow,
  getActiveTokens,
  markExpired
} from '@/lib/app-integrations/storage';
import { outlookCalendarProvider } from '@/lib/app-integrations/providers/outlook_calendar/provider';
import { fetchCalendarEvents } from '@/lib/app-integrations/providers/outlook_calendar/calendar';
import { OutlookCalendarView } from './CalendarView';

const PROVIDER_SLUG = 'outlook_calendar';

export const dynamic = 'force-dynamic';

export default async function OutlookCalendarPage() {
  const user = await requireUser();
  const pb = await getServerPb();

  const row = await findIntegrationRow(pb, user.id, PROVIDER_SLUG);
  const isConnected = row?.status === 'active' && row.auth_data;

  let events: Awaited<ReturnType<typeof fetchCalendarEvents>> = [];
  let fetchError: string | null = null;

  if (isConnected && row) {
    try {
      const tokens = await getActiveTokens({
        pb,
        row,
        provider: outlookCalendarProvider
      });
      const now = new Date();
      const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      events = await fetchCalendarEvents({
        tokens,
        from: now,
        to: horizon,
        timezone: 'Europe/Stockholm'
      });
    } catch (err) {
      fetchError = err instanceof Error ? err.message : 'Okänt fel mot Microsoft Graph.';
      await markExpired(pb, row.id, fetchError);
    }
  }

  return (
    <PageShell title="Outlook Calendar">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pb-16 pt-2">
        <header className="flex items-start gap-4 rounded-2xl border border-default bg-surface p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-canvas-muted">
            <ConnectorLogo kind="mcp" connectorId="outlook_calendar" connectorName="Outlook" size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-[18px] font-semibold text-foreground">
              {outlookCalendarProvider.meta.title}
            </h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-foreground-muted">
              {outlookCalendarProvider.meta.blurb}
            </p>
            <p className="mt-2 text-[11px] uppercase tracking-[0.06em] text-foreground-subtle">
              Datalokalisering: {outlookCalendarProvider.meta.residency} ·
              Scopes: {outlookCalendarProvider.meta.scopes.join(', ')}
            </p>
          </div>
          <div className="shrink-0">
            {isConnected ? (
              <form action={disconnectAppIntegrationFormAction}>
                <input type="hidden" name="provider" value={PROVIDER_SLUG} />
                <button
                  type="submit"
                  className="text-[12.5px] text-foreground-subtle underline-offset-2 hover:text-foreground hover:underline"
                >
                  Koppla bort
                </button>
              </form>
            ) : (
              <form action={connectAppIntegrationFormAction}>
                <input type="hidden" name="provider" value={PROVIDER_SLUG} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-brand-foreground hover:bg-brand-hover"
                >
                  Anslut Outlook
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </form>
            )}
          </div>
        </header>

        {row?.account_label && isConnected ? (
          <div className="text-[12.5px] text-foreground-muted">
            Ansluten som <span className="font-medium text-foreground">{row.account_label}</span>
          </div>
        ) : null}

        {fetchError ? (
          <div className="flex items-start gap-3 rounded-2xl border border-movexum-morkorange/30 bg-movexum-pastell-orange/40 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-movexum-morkorange" />
            <div className="text-[12.5px] leading-relaxed text-movexum-morkorange">
              Kunde inte hämta händelser: {fetchError}. Koppla bort och anslut igen.
            </div>
          </div>
        ) : null}

        {!isConnected && !fetchError ? (
          <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-8 text-center">
            <Calendar className="mx-auto h-8 w-8 text-foreground-subtle" />
            <p className="mt-3 text-[13px] text-foreground-muted">
              Anslut din Outlook för att se kommande möten direkt här. Vi använder
              Microsoft Graph med <code className="rounded bg-canvas-muted px-1.5 py-0.5 font-mono text-[11.5px]">Calendars.Read</code> —
              read-only.
            </p>
            <p className="mt-2 text-[11px] text-foreground-subtle">
              Dina tokens lagras AES-256-GCM-krypterade i Movexums databas på UpCloud (EU).
            </p>
          </div>
        ) : null}

        {isConnected && !fetchError ? (
          <OutlookCalendarView events={events} />
        ) : null}

        <div className="rounded-xl bg-canvas-subtle p-3 text-[11.5px] text-foreground-subtle">
          ⓘ Vi hämtar data direkt från Microsoft Graph vid varje sidladdning. Inget
          cachas i Movexums databas — bara dina OAuth-tokens lagras. Du kan
          koppla bort när som helst; tokens raderas från vår DB och din Azure-app
          revokas via{' '}
          <Link
            href="https://myapps.microsoft.com"
            className="text-link hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            myapps.microsoft.com
          </Link>
          .
        </div>
      </div>
    </PageShell>
  );
}
