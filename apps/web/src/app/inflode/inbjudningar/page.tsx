import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Card, Chip, Icon } from '@/components/proto';
import {
  formatStockholmDateTime,
  startOfStockholmDay,
  toPocketBaseDateTime
} from '@platform/shared';
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

interface Tally {
  invited: number;
  coming: number;
  declined: number;
  unsent: number;
}

/**
 * Marknadsverktyg → Inbjudningar (CLAUDE.md § 53.5). Kommande event (och de
 * senaste 30 dagarna) med inbjudningsläget: inbjudna, kommer, avböjt, ej
 * utskickade. Själva inbjudandet sker per event. Läser med användarens token
 * (RLS § 21) — bara antal visas här, inga personer.
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

  const tallies = new Map<string, Tally>();
  for (let i = 0; i < events.length; i += 40) {
    const part = events.slice(i, i + 40);
    const params: Record<string, string> = { t: user.tenant };
    const ors = part.map((e, j) => {
      params[`e${j}`] = e.id;
      return `event = {:e${j}}`;
    });
    try {
      const rows = await pb.collection('event_signups').getFullList<{ event: string; stage?: string; invited_at?: string; invite_sent_at?: string }>({
        filter: pb.filter(`tenant = {:t} && invited_at != "" && (${ors.join(' || ')})`, params),
        fields: 'event,stage,invited_at,invite_sent_at'
      });
      for (const r of rows) {
        const t = tallies.get(r.event) ?? { invited: 0, coming: 0, declined: 0, unsent: 0 };
        t.invited++;
        if (r.stage === 'declined') t.declined++;
        else if (r.stage !== 'invited') t.coming++;
        if (r.stage === 'invited' && !r.invite_sent_at) t.unsent++;
        tallies.set(r.event, t);
      }
    } catch {
      // Instans utan migration 1700000197: inga inbjudningar att räkna.
    }
  }

  const startOfToday = startOfStockholmDay(new Date()).getTime();
  const upcoming = events.filter((e) => (e.starts_at ? Date.parse(e.starts_at) >= startOfToday : false));
  const recent = events.filter((e) => !upcoming.includes(e)).reverse();

  const renderEvent = (e: EventRow) => {
    const t = tallies.get(e.id);
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
              <Chip variant="active" mono>
                {t.coming} KOMMER
              </Chip>
              {t.declined > 0 && <Chip mono>{t.declined} AVBÖJT</Chip>}
              {t.unsent > 0 && <Chip variant="draft" mono>{t.unsent} EJ UTSKICKADE</Chip>}
            </span>
          ) : (
            <span className="mx-t-12 mx-muted">Inga inbjudningar ännu</span>
          )}
          <Link href={`/inflode/inbjudningar/${e.id}`} className="mx-btn mx-sm mx-primary">
            <Icon name="send" size={12} /> Bjud in
          </Link>
        </div>
      </Card>
    );
  };

  return (
    <PageShell
      title="Marknadsverktyg"
      tabs={buildInflodeTabs()}
      meta={<span className="text-[12px] text-foreground-subtle">Inbjudningar · bjud in till event och följ svaren</span>}
      actions={
        <Link href="/events/new" className="mx-btn mx-primary">
          <Icon name="plus" size={13} /> Nytt event
        </Link>
      }
    >
      <Card style={{ padding: 12, marginBottom: 16, background: 'var(--mx-paper-2)' }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-t-12 mx-muted" style={{ flexWrap: 'wrap' }}>
          <Icon name="shield" size={13} />
          <span>
            Inbjudningar går till kontakter i kontaktboken. Varje mottagare får en personlig svarslänk
            och kan avregistrera sig; avregistrerade bjuds aldrig in igen. De som tackar ja hamnar
            direkt i eventets deltagarlista — närvaron där styr utvärderingen och målen.
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
