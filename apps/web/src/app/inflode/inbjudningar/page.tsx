import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Card, Chip, Icon } from '@/components/proto';
import {
  INVITE_STATUS_LABEL,
  canRemoveInvitation,
  formatStockholmDateTime,
  groupInvitesByStatus,
  startOfStockholmDay,
  tallyInvites,
  toPocketBaseDateTime,
  type InviteStatus
} from '@platform/shared';
import { RemoveInviteButton } from '@/components/invitations/RemoveInviteButton';
import { buildInflodeTabs } from '../_tabs';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['admin', 'incubator_lead', 'coach'] as const;
const RECENT_DAYS = 30;

interface EventRow {
  id: string;
  name?: string;
  starts_at?: string;
  location?: string;
}

interface InviteRow {
  id: string;
  event: string;
  name?: string;
  organization?: string;
  stage?: string;
  invited_at?: string;
  invite_sent_at?: string;
  invite_opened_at?: string;
  responded_at?: string;
}

const STATUS_VARIANT: Record<InviteStatus, 'active' | 'draft' | 'default'> = {
  coming: 'active',
  declined: 'default',
  opened: 'draft',
  sent: 'default',
  unsent: 'draft'
};

/**
 * Marknadsverktyg → Inbjudningar (CLAUDE.md § 53.5). Kommande event (och de
 * senaste 30 dagarna) med inbjudningsläget direkt på raden: inbjudna, öppnat,
 * kommer, avböjt, inte svarat, ej utskickade — och vilka, per status. "Öppnat"
 * = öppnat sin personliga svarslänk (ingen spårningspixel). Själva inbjudandet
 * sker per event. Läser med användarens token (RLS § 21); namn och
 * organisation visas för staff, e-postadresser aldrig.
 */
export default async function InvitationsPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, [...MANAGE_ROLES])) redirect('/inflode');
  const pb = await getServerPb();

  const from = new Date(startOfStockholmDay(new Date()).getTime() - RECENT_DAYS * 24 * 3600 * 1000);
  let events: EventRow[] = [];
  try {
    events = await pb.collection('incubator_events').getFullList<EventRow>({
      filter: pb.filter('tenant = {:t} && starts_at >= {:from} && status != "cancelled"', {
        t: user.tenant,
        from: toPocketBaseDateTime(from)
      }),
      fields: 'id,name,starts_at,location',
      sort: 'starts_at',
      batch: 200
    });
  } catch {
    events = [];
  }

  const invitesBy = new Map<string, InviteRow[]>();
  for (let i = 0; i < events.length; i += 40) {
    const part = events.slice(i, i + 40);
    const params: Record<string, string> = { t: user.tenant };
    const ors = part.map((e, j) => {
      params[`e${j}`] = e.id;
      return `event = {:e${j}}`;
    });
    try {
      const rows = await pb.collection('event_signups').getFullList<InviteRow>({
        filter: pb.filter(`tenant = {:t} && invited_at != "" && (${ors.join(' || ')})`, params),
        fields: 'id,event,name,organization,stage,invited_at,invite_sent_at,invite_opened_at,responded_at',
        sort: 'name'
      });
      for (const r of rows) invitesBy.set(r.event, [...(invitesBy.get(r.event) ?? []), r]);
    } catch {
      // Instans utan migration 1700000197: inga inbjudningar att räkna.
    }
  }

  const startOfToday = startOfStockholmDay(new Date()).getTime();
  const upcoming = events.filter((e) => (e.starts_at ? Date.parse(e.starts_at) >= startOfToday : false));
  const recent = events.filter((e) => !upcoming.includes(e)).reverse();

  const renderEvent = (e: EventRow) => {
    const rows = invitesBy.get(e.id) ?? [];
    const t = rows.length > 0 ? tallyInvites(rows) : null;
    return (
      <Card key={e.id} style={{ padding: 14 }}>
        <div className="mx-flex mx-items-c mx-gap-2" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mx-disp mx-fw-6 mx-t-13 mx-truncate">{e.name || 'Event'}</div>
            <div className="mx-t-12 mx-muted mx-truncate" style={{ marginTop: 4 }}>
              {formatStockholmDateTime(e.starts_at) || 'Datum saknas'}
              {e.location ? ` · ${e.location}` : ''}
            </div>
          </div>
          {t ? (
            <span className="mx-flex mx-gap-2" style={{ flexWrap: 'wrap' }}>
              <Chip mono>{t.invited} INBJUDNA</Chip>
              <span title="Har öppnat sin personliga svarslänk">
                <Chip mono>{t.opened} ÖPPNAT</Chip>
              </span>
              <Chip variant="active" mono>
                {t.coming} JA
              </Chip>
              <Chip mono>{t.declined} NEJ</Chip>
              {t.unanswered > 0 && (
                <Chip variant="draft" mono>
                  {t.unanswered} INTE SVARAT
                </Chip>
              )}
              {t.unsent > 0 && (
                <Chip variant="draft" mono>
                  {t.unsent} EJ UTSKICKADE
                </Chip>
              )}
            </span>
          ) : (
            <span className="mx-t-12 mx-muted">Inga inbjudningar ännu</span>
          )}
          <Link href={`/inflode/inbjudningar/${e.id}`} className="mx-btn mx-sm mx-primary">
            <Icon name="send" size={12} /> Bjud in
          </Link>
        </div>
        {rows.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="mx-t-12 mx-fw-6" style={{ cursor: 'pointer' }}>
              Visa vilka
            </summary>
            <div
              style={{
                display: 'grid',
                gap: 12,
                marginTop: 10,
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))'
              }}
            >
              {groupInvitesByStatus(rows).map((g) => (
                <div key={g.status} style={{ minWidth: 0 }}>
                  <div className="mx-flex mx-items-c mx-gap-2" style={{ marginBottom: 6 }}>
                    <Chip variant={STATUS_VARIANT[g.status]} mono>
                      {INVITE_STATUS_LABEL[g.status].toUpperCase()}
                    </Chip>
                    <span className="mx-mono mx-t-xs mx-muted">{g.rows.length}</span>
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
                    {g.rows.map((r) => (
                      <li key={r.id} className="mx-flex mx-items-c mx-gap-2 mx-t-12">
                        <span className="mx-truncate" style={{ flex: 1, minWidth: 0 }}>
                          {r.name || 'Okänd'}
                          {r.organization ? <span className="mx-muted"> · {r.organization}</span> : null}
                        </span>
                        {canRemoveInvitation(r) && <RemoveInviteButton signupId={r.id} name={r.name || 'mottagaren'} />}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        )}
      </Card>
    );
  };

  return (
    <PageShell
      title="Marknadsverktyg"
      tabs={buildInflodeTabs()}
      meta={<span className="text-[12px] text-foreground-subtle">Inbjudningar · bjud in till event och följ svaren</span>}
      actions={
        <Link href="/inflode/events/new" className="mx-btn mx-primary">
          <Icon name="plus" size={13} /> Nytt event
        </Link>
      }
    >
      <Card style={{ padding: 12, marginBottom: 16, background: 'var(--mx-paper-2)' }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-t-12 mx-muted" style={{ flexWrap: 'wrap' }}>
          <Icon name="shield" size={13} />
          <span>
            Inbjudningar går till kontakter i kontaktboken och till bolag i portföljen. Varje mottagare
            får en personlig svarslänk; kontakter kan avregistrera sig och bjuds då aldrig in igen.
            &quot;Öppnat&quot; betyder att mottagaren öppnat sin svarslänk — vi använder ingen
            spårningspixel i mejlet. De som tackar ja hamnar direkt i eventets deltagarlista — närvaron
            där styr utvärderingen och målen.
          </span>
        </div>
      </Card>

      <div className="mx-t-12 mx-muted mx-fw-6" style={{ marginBottom: 8 }}>
        Kommande event
      </div>
      {upcoming.length === 0 ? (
        <Card style={{ padding: 24, textAlign: 'center', marginBottom: 20 }}>
          <div className="mx-muted mx-t-13">Inga kommande event. Skapa ett event — eller ett från årshjulet — för att bjuda in.</div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>{upcoming.map(renderEvent)}</div>
      )}

      {recent.length > 0 && (
        <>
          <div className="mx-t-12 mx-muted mx-fw-6" style={{ marginBottom: 8 }}>
            Senaste {RECENT_DAYS} dagarna
          </div>
          <div style={{ display: 'grid', gap: 10 }}>{recent.map(renderEvent)}</div>
        </>
      )}
    </PageShell>
  );
}
