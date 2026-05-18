import Link from 'next/link';
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
import { SignupDeleteButton } from './SignupDeleteButton';
import type { EventSignup, EventSignupStage, IncubatorEvent } from '@platform/shared';

const STAGE_ORDER: EventSignupStage[] = [
  'signup',
  'attended',
  'meeting',
  'application',
  'admitted'
];
const STAGE_LABEL: Record<EventSignupStage, string> = {
  signup: 'Anmäld',
  attended: 'Närvarande',
  meeting: 'Möte bokat',
  application: 'Ansökan',
  admitted: 'Antagen'
};
const STAGE_ACCENT: Record<EventSignupStage, string> = {
  signup: '#005470',
  attended: '#00a8de',
  meeting: '#6138b5',
  application: '#d67e47',
  admitted: '#4a7d4a'
};
const STAGE_VARIANT: Record<
  EventSignupStage,
  'default' | 'cyan' | 'purple' | 'copper' | 'green'
> = {
  signup: 'cyan',
  attended: 'default',
  meeting: 'purple',
  application: 'copper',
  admitted: 'green'
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('sv-SE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default async function EventDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'observer'])) {
    redirect('/idag');
  }
  const pb = await getServerPb();

  let event: IncubatorEvent | null = null;
  try {
    event = await pb.collection(PB_COLLECTIONS.events).getOne<IncubatorEvent>(id);
  } catch {
    notFound();
  }
  if (!event || event.tenant !== user.tenant) notFound();

  let signups: EventSignup[] = [];
  try {
    const res = await pb.collection(PB_COLLECTIONS.eventSignups).getList<EventSignup>(1, 500, {
      filter: `tenant = "${user.tenant}" && event = "${id}"`,
      sort: '-created',
      expand: 'startup'
    });
    signups = res.items;
  } catch {
    /* ignore */
  }

  // Funnel cumulative counts
  const stageCounts: Record<EventSignupStage, number> = {
    signup: 0,
    attended: 0,
    meeting: 0,
    application: 0,
    admitted: 0
  };
  for (const s of signups) {
    const idx = STAGE_ORDER.indexOf(s.stage);
    for (let i = 0; i <= idx; i++) stageCounts[STAGE_ORDER[i]] += 1;
  }
  const funnelData = STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    count: stageCounts[stage],
    color: STAGE_ACCENT[stage]
  }));
  const maxCount = Math.max(1, ...funnelData.map((f) => f.count));

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb={`Hemmaplan / Events / ${event.name}`}
        title={event.name}
        subtitle={event.description || `Event av typen ${event.type}`}
        actions={
          <>
            <Link href="/events" className="mx-btn">
              ← Tillbaka
            </Link>
            {event.status === 'live' && (
              <Chip variant="active" mono dot>
                LIVE
              </Chip>
            )}
            {hasRole(user.roles, ['admin', 'incubator_lead', 'coach']) && (
              <>
                <Link href={`/events/${event.id}/edit`} className="mx-btn">
                  Redigera
                </Link>
                <button className="mx-btn mx-primary">
                  <Icon name="plus" size={13} /> Lägg till anmäld
                </button>
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
          <Meta label="Typ" value={<Chip mono>{event.type}</Chip>} />
          <Meta label="Status" value={<Chip mono>{event.status}</Chip>} />
          <Meta
            label="Anmälda"
            value={<span className="mx-disp mx-fw-6 mx-t-15">{event.signups_count || 0}</span>}
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
        {/* ── Signups list ──────────────────────────────── */}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <CardHead
            label={`Anmälda · ${signups.length}`}
            right={
              <span className="mx-mono mx-t-xs mx-muted">{signups.length} totalt</span>
            }
          />
          {signups.length === 0 ? (
            <div
              className="mx-muted mx-t-13"
              style={{ padding: 24, textAlign: 'center' }}
            >
              Inga anmälningar registrerade än.
            </div>
          ) : (
            <div>
              {signups.map((s, i) => (
                <div
                  key={s.id}
                  className="mx-flex mx-items-c mx-gap-3"
                  style={{
                    padding: '12px 16px',
                    borderBottom:
                      i < signups.length - 1 ? '1px solid var(--mx-line-soft)' : 'none'
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mx-t-13 mx-fw-6 mx-truncate">{s.name}</div>
                    <div className="mx-mono mx-t-xs mx-muted mx-truncate">
                      {s.organization || s.email || '—'}
                    </div>
                  </div>
                  {s.expand?.startup && (
                    <Link
                      href={`/startups/${s.expand.startup.id}`}
                      className="mx-mono mx-t-xs mx-muted"
                      style={{ textDecoration: 'none' }}
                    >
                      → {s.expand.startup.name}
                    </Link>
                  )}
                  <Chip variant={STAGE_VARIANT[s.stage]} mono>
                    {STAGE_LABEL[s.stage]}
                  </Chip>
                  {hasRole(user.roles, ['admin', 'incubator_lead', 'coach']) && (
                    <SignupDeleteButton signupId={s.id} signupName={s.name} />
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

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
