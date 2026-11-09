import Link from 'next/link';
import { hasRole } from '@/lib/rbac';
import { FollowUpSurveys } from '@/components/surveys/FollowUpSurveys';
import { findIntegrationRow, getActiveTokens, markExpired } from '@/lib/app-integrations/storage';
import { outlookCalendarProvider } from '@/lib/app-integrations/providers/outlook_calendar/provider';
import { fetchCalendarEvents } from '@/lib/app-integrations/providers/outlook_calendar/calendar';
import {
  matchEventsToContacts,
  matchedEventsForStartup,
  type EmailIndex,
  type EventMatch
} from '@/lib/app-integrations/providers/outlook_calendar/match';
import { LogMeetingButton } from '../LogMeetingButton';
import { StartupContactsSection } from '../StartupContactsSection';
import { StartupMissionsSection } from '../StartupMissionsSection';
import { StartupTalentSection } from '../StartupTalentSection';
import { loadStartupPage } from '../_shared/context';
import { Empty, PillLink, Section, SectionNav, StatusPill, TabPage, formatDate, formatDateTime } from '../_shared/ui';

interface TeamMemberRecord {
  id: string;
  name: string;
  role_title?: string;
  email?: string;
  is_founder?: boolean;
}

interface StartupContactRecord {
  id: string;
  expand?: { contact?: { id: string; first_name?: string; last_name?: string; email?: string } };
}

type TaskKind = 'call' | 'meeting' | 'email' | 'prep' | 'followup' | 'admin' | 'other';
type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled' | 'backlog' | 'review';

interface TaskRecord {
  id: string;
  kind: TaskKind;
  description: string;
  starts_at?: string;
  due_at?: string;
  status: TaskStatus;
}

const taskKindLabels: Record<TaskKind, string> = {
  call: 'Samtal',
  meeting: 'Möte',
  email: 'E-post',
  prep: 'Förberedelse',
  followup: 'Uppföljning',
  admin: 'Administration',
  other: 'Övrigt'
};

const taskStatusLabels: Record<TaskStatus, string> = {
  backlog: 'Backlogg',
  open: 'Öppen',
  in_progress: 'Pågår',
  review: 'Granskas',
  blocked: 'Blockerad',
  done: 'Klar',
  cancelled: 'Avbruten'
};

/**
 * Flik "Team & nätverk": bolagets team, delade kontakter ur kontaktboken,
 * möten (Outlook, live) och uppgifter, tvärfunktionella team och
 * uppföljningsenkäter.
 */
export default async function StartupNetworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, pb, flags } = await loadStartupPage(id);
  const byStartup = pb.filter('startup = {:startup}', { startup: id });

  const [team, startupContacts, tasks] = await Promise.all([
    pb
      .collection('startup_team_members')
      .getList<TeamMemberRecord>(1, 50, { filter: byStartup, sort: '-is_founder,name' })
      .then((r) => r.items, () => null),
    pb
      .collection('startup_contacts')
      .getList<StartupContactRecord>(1, 100, { filter: byStartup, expand: 'contact' })
      .then((r) => r.items, () => [] as StartupContactRecord[]),
    pb
      .collection('tasks')
      .getList<TaskRecord>(1, 50, {
        filter: pb.filter('startup = {:startup} && tenant = {:tenant}', { startup: id, tenant: user.tenant }),
        sort: '-starts_at'
      })
      .then((r) => r.items, () => null)
  ]);

  // § 14.4: transient e-post→entitet-index för att matcha Outlook-möten mot
  // bolagets kontakter och team. Aldrig sparat, aldrig loggat.
  const emailIndex: EmailIndex = new Map();
  const addEmail = (email: string | undefined, entry: { kind: 'contact' | 'team'; refId: string; name: string }) => {
    const key = email?.trim().toLowerCase();
    if (!key) return;
    const list = emailIndex.get(key) ?? [];
    list.push({ ...entry, startupId: id });
    emailIndex.set(key, list);
  };
  for (const sc of startupContacts) {
    const c = sc.expand?.contact;
    if (!c) continue;
    addEmail(c.email, { kind: 'contact', refId: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Kontakt' });
  }
  for (const m of team ?? []) addEmail(m.email, { kind: 'team', refId: m.id, name: m.name });

  let outlookConnected = false;
  let outlookMeetings: EventMatch[] = [];
  let outlookError: string | null = null;
  if (emailIndex.size > 0) {
    try {
      const row = await findIntegrationRow(pb, user.id, 'outlook_calendar');
      if (row?.status === 'active' && row.auth_data) {
        outlookConnected = true;
        const tokens = await getActiveTokens({ pb, row, provider: outlookCalendarProvider });
        const now = Date.now();
        const events = await fetchCalendarEvents({
          tokens,
          from: new Date(now - 30 * 86_400_000),
          to: new Date(now + 30 * 86_400_000),
          timezone: 'Europe/Stockholm'
        });
        outlookMeetings = matchedEventsForStartup(matchEventsToContacts(events, emailIndex), id).sort(
          (a, b) => Date.parse(b.event.start) - Date.parse(a.event.start)
        );
      }
    } catch (err) {
      outlookError = err instanceof Error ? err.message : 'Okänt fel mot Microsoft Graph.';
      const row = await findIntegrationRow(pb, user.id, 'outlook_calendar').catch(() => null);
      if (row) await markExpired(pb, row.id, outlookError);
    }
  }
  const canLogMeeting = flags.isStaff;
  const openTasks = (tasks ?? []).filter((t) => t.status !== 'done' && t.status !== 'cancelled');

  return (
    <TabPage>
      <SectionNav
        items={[
          { href: '#team', label: 'Team', count: team?.length },
          ...(flags.isStaffOrObserver ? [{ href: '#kontakter', label: 'Kontakter' }] : []),
          { href: '#moten', label: 'Möten & uppgifter', count: openTasks.length },
          { href: '#team-uppdrag', label: 'Tvärfunktionella team' },
          { href: '#studenter', label: 'Studenter & talang' },
          { href: '#uppfoljning', label: 'Uppföljning' }
        ]}
      />

      <Section id="team" title="Team">
        {team === null ? (
          <Empty>Teamet kunde inte läsas just nu.</Empty>
        ) : team.length === 0 ? (
          <Empty>Inga teammedlemmar registrerade.</Empty>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {team.map((m) => (
              <li key={m.id} className="rounded-2xl border border-default p-4">
                <p className="font-medium text-foreground">
                  {m.name}
                  {m.is_founder ? (
                    <span className="ml-2 rounded-full bg-movexum-pastell-lila px-2 py-0.5 text-[11px] font-medium text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila">
                      Grundare
                    </span>
                  ) : null}
                </p>
                {m.role_title ? <p className="text-sm text-foreground-muted">{m.role_title}</p> : null}
                {m.email ? (
                  <a href={`mailto:${m.email}`} className="mt-1 block truncate text-sm text-link hover:underline">
                    {m.email}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {flags.isStaffOrObserver ? <StartupContactsSection pb={pb} tenantId={user.tenant} startupId={id} /> : null}

      <Section
        id="moten"
        title="Möten & uppgifter"
        action={<PillLink href={`/startups/${id}/aktiviteter`}>Bolagets tavla</PillLink>}
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">Möten från Outlook</h3>
              {outlookConnected ? (
                <span className="text-[11px] uppercase tracking-[0.06em] text-foreground-subtle">Live · din kalender</span>
              ) : null}
            </div>
            {!outlookConnected ? (
              <p className="rounded-2xl border border-dashed border-default bg-canvas-subtle/50 p-4 text-sm text-foreground-muted">
                <Link href="/integrationer/outlook-calendar" className="text-link hover:underline">
                  Anslut din Outlook
                </Link>{' '}
                för att se möten med bolagets kontakter här. Read-only, inget sparas.
              </p>
            ) : outlookError ? (
              <Empty>Kunde inte hämta möten just nu. Koppla om Outlook.</Empty>
            ) : outlookMeetings.length === 0 ? (
              <Empty>Inga möten (±30 dagar) med bolagets kontakter i din kalender.</Empty>
            ) : (
              <ul className="divide-y divide-default">
                {outlookMeetings.map((m) => (
                  <li key={m.event.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {m.event.webLink ? (
                          <a href={m.event.webLink} target="_blank" rel="noopener noreferrer" className="hover:text-brand hover:underline">
                            {m.event.subject}
                          </a>
                        ) : (
                          m.event.subject
                        )}
                      </p>
                      <p className="text-xs text-foreground-subtle">
                        {formatDateTime(m.event.start)}
                        {m.contactName ? ` · ${m.contactName}` : ''}
                      </p>
                    </div>
                    {canLogMeeting ? (
                      <LogMeetingButton
                        subject={m.event.subject}
                        startsAt={m.event.start}
                        endsAt={m.event.end}
                        startupId={id}
                        contactId={m.contactRefId}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Uppgifter</h3>
            {tasks === null ? (
              <Empty>Uppgifterna kunde inte läsas just nu.</Empty>
            ) : tasks.length === 0 ? (
              <Empty>Inga uppgifter registrerade för bolaget.</Empty>
            ) : (
              <ul className="divide-y divide-default">
                {tasks.slice(0, 15).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{t.description}</p>
                      <p className="text-xs text-foreground-subtle">
                        {taskKindLabels[t.kind] ?? 'Uppgift'}
                        {t.due_at ? ` · ${formatDate(t.due_at)}` : t.starts_at ? ` · ${formatDate(t.starts_at)}` : ''}
                      </p>
                    </div>
                    <StatusPill
                      label={taskStatusLabels[t.status] ?? t.status}
                      variant={t.status === 'done' ? 'success' : t.status === 'cancelled' || t.status === 'blocked' ? 'neutral' : 'info'}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Section>

      <StartupMissionsSection pb={pb} tenantId={user.tenant} startupId={id} />

      <StartupTalentSection pb={pb} tenantId={user.tenant} startupId={id} isStaff={flags.isStaff} />

      <Section id="uppfoljning" title="Uppföljning">
        <FollowUpSurveys
          pb={pb}
          tenant={user.tenant}
          kind="startup"
          id={id}
          canCreate={hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])}
          compact
        />
      </Section>
    </TabPage>
  );
}
