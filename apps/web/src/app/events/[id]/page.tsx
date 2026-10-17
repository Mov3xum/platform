import Link from 'next/link';
import { escFilter } from '@/lib/pb-filter';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  PageHead,
  Card,
  CardHead,
  Chip,
  Icon,
  Meta,
  SectionHead
} from '@/components/proto';
import { deleteEventFormAction } from '@/lib/actions/events';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { Participants, type ParticipantRow } from './Participants';
import { FollowUpSurveys } from '@/components/surveys/FollowUpSurveys';
import { getRecordInTenant } from '@/lib/core/write/helpers';
import {
  EVENT_PHASE_LABEL,
  EVENT_SIGNUP_STAGE_LABEL,
  annualWheelRangeLabel,
  eventPhase,
  eventSignupFunnel,
  formatStockholmDateTime,
  isEventSignupStage,
  type EventSignup,
  type EventSignupStage,
  type IncubatorEvent,
  type Role
} from '@platform/shared';

const STAGE_ACCENT: Record<EventSignupStage, string> = {
  signup: '#005470',
  attended: '#00a8de',
  meeting: '#6138b5',
  application: '#d67e47',
  admitted: '#4a7d4a'
};

/** Alltid svensk tid — servern kör i UTC. */
function formatDateTime(iso: string): string {
  return formatStockholmDateTime(iso) || iso;
}

export default async function EventDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ varning?: string }>;
}) {
  const { id } = await params;
  const { varning } = (await searchParams) ?? {};
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'observer'])) {
    redirect('/chatt');
  }
  const pb = await getServerPb();

  let event: IncubatorEvent | null = null;
  try {
    event = await pb.collection(PB_COLLECTIONS.events).getOne<IncubatorEvent>(id);
  } catch {
    notFound();
  }
  if (!event || event.tenant !== user.tenant) notFound();
  // Fasen följer klockan i svensk tid — "LIVE" visas bara medan eventet pågår.
  const phase = eventPhase(event, new Date());

  let signups: EventSignup[] = [];
  try {
    const res = await pb.collection(PB_COLLECTIONS.eventSignups).getList<EventSignup>(1, 500, {
      filter: `tenant = "${escFilter(user.tenant)}" && event = "${escFilter(id)}"`,
      sort: '-created',
      expand: 'startup'
    });
    signups = res.items;
  } catch {
    /* ignore */
  }

  const canEdit = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  // Årshjulsaktiviteten eventet genomför (§ 53). Tenant-verifierad läsning;
  // en raderad post visas helt enkelt inte.
  const wheelItem = event.wheel_item
    ? await getRecordInTenant<{
        id: string;
        tenant?: string;
        title?: string;
        year?: number;
        month?: number;
        day?: number;
        end_month?: number;
        end_day?: number;
      }>(
        pb,
        { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
        'annual_wheel_items',
        event.wheel_item,
        'id,tenant,title,year,month,day,end_month,end_day'
      )
    : null;

  const funnelData = eventSignupFunnel(signups).map((f) => ({
    ...f,
    label: EVENT_SIGNUP_STAGE_LABEL[f.stage],
    color: STAGE_ACCENT[f.stage]
  }));
  const maxCount = Math.max(1, ...funnelData.map((f) => f.count));

  const participantRows: ParticipantRow[] = signups.map((s) => ({
    id: s.id,
    name: s.name,
    detail: s.organization || s.email || '',
    stage: isEventSignupStage(s.stage) ? s.stage : 'signup',
    startup: s.expand?.startup ? { id: s.expand.startup.id, name: s.expand.startup.name } : undefined
  }));

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb={`Dashboard / Events / ${event.name}`}
        title={event.name}
        subtitle={event.description || `Event av typen ${event.type}`}
        actions={
          <>
            <Link href="/events" className="mx-btn">
              ← Tillbaka
            </Link>
            {phase === 'live' && (
              <Chip variant="active" mono dot>
                LIVE
              </Chip>
            )}
            {canEdit && (
              <>
                <Link href={`/events/${event.id}/edit`} className="mx-btn">
                  Redigera
                </Link>
                <ConfirmDeleteButton
                  action={deleteEventFormAction}
                  hiddenField={{ name: 'event_id', value: event.id }}
                  label="Radera"
                  variant="ghost"
                  description={`Radera "${event.name}"? Alla anmälningar tas också bort.`}
                />
              </>
            )}
          </>
        }
      />

      {varning === 'arshjul' && (
        <div
          role="status"
          className="mx-t-13 mx-flex mx-items-c mx-gap-2"
          style={{ marginTop: 12, padding: '8px 12px', borderRadius: 10, background: 'var(--movexum-pastell-gul)', color: 'var(--movexum-morkgul)' }}
        >
          <Icon name="alert" size={13} /> Eventet skapades, men kopplingen till årshjulet kunde inte sparas —
          PocketBase saknar fältet. Kör migration 1700000194 (eller &ldquo;Sync PocketBase&rdquo;).
        </div>
      )}

      {/* ── Metadata ─────────────────────────────────────── */}
      <Card style={{ padding: 16, marginTop: 12 }}>
        <div
          className="mx-flex mx-items-c"
          style={{ flexWrap: 'wrap', gap: 24 }}
        >
          <Meta
            label="När"
            value={<span className="mx-mono mx-fw-6 mx-t-13">{formatDateTime(event.starts_at)}</span>}
          />
          {event.ends_at && (
            <Meta
              label="Slut"
              value={<span className="mx-mono mx-fw-6 mx-t-13">{formatDateTime(event.ends_at)}</span>}
            />
          )}
          {event.location && (
            <Meta label="Plats" value={<span className="mx-t-13 mx-fw-6">{event.location}</span>} />
          )}
          {wheelItem && (
            <Meta
              label="Årshjulet"
              value={
                <Link
                  href={`/arshjul?item=${encodeURIComponent(wheelItem.id)}`}
                  className="mx-t-13 mx-fw-6"
                  title={annualWheelRangeLabel({ ...wheelItem, year: wheelItem.year ?? new Date().getFullYear() })}
                >
                  {wheelItem.title || 'Aktivitet'} →
                </Link>
              }
            />
          )}
          <Meta label="Typ" value={<Chip mono>{event.type}</Chip>} />
          <Meta
            label="Status"
            value={
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Chip mono>{EVENT_PHASE_LABEL[phase]}</Chip>
                {phase === 'completed' && event.status !== 'completed' && (
                  <span
                    className="text-[11px] text-foreground-subtle"
                    title="Statusfältet är fortfarande satt till ett tidigare värde; eventets tid har passerat."
                  >
                    (tiden har passerat · fält: {event.status})
                  </span>
                )}
              </span>
            }
          />
          <Meta
            label="Anmälda"
            value={<span className="mx-disp mx-fw-6 mx-t-15">{event.signups_count || 0}</span>}
          />
          <Meta
            label="Närvarande"
            value={<span className="mx-disp mx-fw-6 mx-t-15">{event.attended_count || 0}</span>}
          />
          <Meta
            label="Antagna"
            value={<span className="mx-disp mx-fw-6 mx-t-15">{event.admitted_count || 0}</span>}
          />
        </div>
      </Card>

      <div
        style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 12 }}
      >
        {/* ── Deltagare ────────────────────────────────── */}
        <Participants eventId={event.id} rows={participantRows} canEdit={canEdit} />

        {/* ── Funnel ────────────────────────────────────── */}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <CardHead label="Konverteringstratt" />
          <div style={{ padding: 20 }}>
            {signups.length === 0 ? (
              <div className="mx-muted mx-t-13" style={{ textAlign: 'center', padding: 12 }}>
                Inga data att visa än.
              </div>
            ) : (
              funnelData.map((f, i) => {
                const widthPct = (f.count / maxCount) * 100;
                const conv =
                  i === 0 || funnelData[i - 1].count === 0
                    ? null
                    : Math.round((f.count / funnelData[i - 1].count) * 100);
                return (
                  <div key={f.stage} style={{ marginBottom: 14 }}>
                    <div className="mx-flex mx-items-c mx-justify-b mx-mb-1">
                      <span className="mx-t-13 mx-fw-6">{f.label}</span>
                      <div className="mx-flex mx-gap-2 mx-items-c">
                        {conv != null && <Chip mono>{conv}%</Chip>}
                        <span className="mx-disp mx-fw-6 mx-t-15">{f.count}</span>
                      </div>
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: 22,
                        background: 'var(--mx-paper-3, #f4f4f4)',
                        borderRadius: 6,
                        overflow: 'hidden'
                      }}
                    >
                      <div
                        style={{
                          width: `${widthPct}%`,
                          height: '100%',
                          background: f.color,
                          borderRadius: 6,
                          transition: 'width .3s'
                        }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      <SectionHead title="Uppföljning" label="enkät" />
      <FollowUpSurveys
        pb={pb}
        tenant={user.tenant}
        kind="event"
        id={event.id}
        canCreate={canEdit}
      />

      <SectionHead title="Notes" label="metadata" />
      <Card style={{ padding: 16 }}>
        {event.description ? (
          <div className="mx-t-13" style={{ whiteSpace: 'pre-wrap' }}>
            {event.description}
          </div>
        ) : (
          <div className="mx-muted mx-t-13">Ingen beskrivning tillagd.</div>
        )}
      </Card>
    </div>
  );
}
