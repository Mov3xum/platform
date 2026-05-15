import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  PageHead,
  Card,
  CardHead,
  Chip,
  Icon,
  SectionHead
} from '@/components/proto';
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

const MONTHS_SV = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];

function shortMonth(d: Date): string {
  return MONTHS_SV[d.getMonth()];
}

function ageString(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diffDays = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `om ${-diffDays}d`;
  if (diffDays < 30) return `${diffDays}d sen`;
  const m = Math.floor(diffDays / 30);
  if (m < 12) return `${m} mån sen`;
  return `${Math.floor(m / 12)} år sen`;
}

export default async function EventsPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'observer'])) {
    redirect('/idag');
  }

  const pb = await getServerPb();
  let events: IncubatorEvent[] = [];
  let allSignups: EventSignup[] = [];

  try {
    const res = await pb.collection(PB_COLLECTIONS.events).getList<IncubatorEvent>(1, 100, {
      filter: `tenant = "${user.tenant}"`,
      sort: '-starts_at'
    });
    events = res.items;
  } catch {
    /* ignore */
  }

  // Fetch signups for the funnel target (latest live or upcoming)
  const liveEvent = events.find((e) => e.status === 'live') || null;
  const now = Date.now();
  const upcoming = events
    .filter((e) => e.status === 'planned' && new Date(e.starts_at).getTime() >= now - 86400000)
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const past = events
    .filter((e) => e.status === 'completed' || new Date(e.starts_at).getTime() < now - 86400000)
    .slice(0, 12);

  const funnelEvent = liveEvent || upcoming[0] || null;

  if (funnelEvent) {
    try {
      const sRes = await pb
        .collection(PB_COLLECTIONS.eventSignups)
        .getList<EventSignup>(1, 500, {
          filter: `tenant = "${user.tenant}" && event = "${funnelEvent.id}"`,
          fields: 'id,stage,event'
        });
      allSignups = sRes.items;
    } catch {
      /* ignore */
    }
  }

  // Build funnel counts
  const stageCounts: Record<EventSignupStage, number> = {
    signup: 0,
    attended: 0,
    meeting: 0,
    application: 0,
    admitted: 0
  };
  for (const s of allSignups) {
    // count cumulative: signup counts everyone, attended counts attended+down etc
    const idx = STAGE_ORDER.indexOf(s.stage);
    for (let i = 0; i <= idx; i++) {
      stageCounts[STAGE_ORDER[i]] += 1;
    }
  }

  const funnelData = STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    count: stageCounts[stage],
    color: STAGE_ACCENT[stage]
  }));
  const maxCount = Math.max(1, ...funnelData.map((f) => f.count));

  // Estimated CAC: total tenant event cost is unknown — use a per-event nominal of 100 000 kr
  // divided by admitted, or — if 0 admitted — show "—"
  const admittedTotal = funnelData[funnelData.length - 1].count;
  const cac = admittedTotal > 0 ? Math.round(100_000 / admittedTotal) : null;

  return (
    <div className="mx-view-pad mx-wide" style={{ padding: '20px 24px 80px' }}>
      <PageHead
        crumb="Hemmaplan / Events"
        title="Events"
        subtitle="Spåra inflöde i realtid. Vilka events ger oss bolag?"
        actions={
          <>
            <button className="mx-btn">
              <Icon name="calendar" size={13} /> Kalendervy
            </button>
            <button className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Nytt event
            </button>
          </>
        }
      />

      {/* ── Live banner ────────────────────────────────────── */}
      {liveEvent && (
        <Card
          ink
          style={{
            padding: 16,
            marginBottom: 16
          }}
        >
          <div className="mx-flex mx-items-c mx-gap-3">
            <div style={{ position: 'relative', width: 10, height: 10 }}>
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 999,
                  background: '#88b48b'
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  inset: -4,
                  borderRadius: 999,
                  background: '#88b48b',
                  opacity: 0.35
                }}
              />
            </div>
            <span
              className="mx-mono mx-t-xs mx-t-up mx-fw-6"
              style={{ color: '#88b48b' }}
            >
              LIVE NU
            </span>
            <span
              className="mx-disp mx-fw-6"
              style={{ fontSize: 15, color: 'white' }}
            >
              {liveEvent.name} · {liveEvent.signups_count ?? 0} anmälda ·{' '}
              {liveEvent.attended_count ?? 0} incheckade
            </span>
            <span className="mx-grow" />
            <Link
              href={`/events/${liveEvent.id}`}
              className="mx-btn mx-sm"
              style={{
                background: 'rgba(255,255,255,.1)',
                borderColor: 'transparent',
                color: 'white'
              }}
            >
              Öppna eventyta →
            </Link>
          </div>
        </Card>
      )}

      <div
        style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginTop: 12 }}
      >
        {/* ── Kommande timeline ──────────────────────────── */}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <CardHead
            label="Kommande"
            right={<span className="mx-mono mx-t-xs mx-muted">{upcoming.length} planerade</span>}
          />
          <div style={{ padding: '4px 16px 12px' }}>
            {upcoming.length === 0 ? (
              <div
                className="mx-muted mx-t-13"
                style={{ padding: 24, textAlign: 'center' }}
              >
                Inga kommande events. Skapa det första.
              </div>
            ) : (
              upcoming.map((e, i) => {
                const d = new Date(e.starts_at);
                return (
                  <Link
                    key={e.id}
                    href={`/events/${e.id}`}
                    className="mx-flex mx-gap-3 mx-items-c"
                    style={{
                      padding: '14px 0',
                      borderBottom:
                        i < upcoming.length - 1 ? '1px solid var(--mx-line-soft)' : 'none',
                      textDecoration: 'none',
                      color: 'inherit'
                    }}
                  >
                    <div style={{ width: 56, textAlign: 'center' }}>
                      <div className="mx-mono mx-t-xs mx-muted mx-t-up">
                        {shortMonth(d).toUpperCase()}
                      </div>
                      <div
                        className="mx-disp mx-fw-6"
                        style={{ fontSize: 24, lineHeight: 1 }}
                      >
                        {d.getDate().toString().padStart(2, '0')}
                      </div>
                    </div>
                    <div
                      style={{
                        width: 3,
                        height: 36,
                        background: `var(--mx-${e.accent || 'cyan'}, #00a8de)`,
                        borderRadius: 3
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mx-flex mx-items-c mx-gap-2">
                        <span className="mx-disp mx-fw-6 mx-t-13 mx-truncate">{e.name}</span>
                        {e.status === 'live' && (
                          <Chip variant="active" mono dot>
                            LIVE
                          </Chip>
                        )}
                      </div>
                      <div className="mx-mono mx-t-xs mx-muted mx-t-up">{e.type}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="mx-disp mx-fw-6 mx-t-13">{e.signups_count ?? 0}</div>
                      <div className="mx-mono mx-t-xs mx-muted">ANMÄLDA</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div
                        className="mx-disp mx-fw-6 mx-t-13"
                        style={{
                          color: (e.leads_count ?? 0) > 0 ? 'var(--mx-green)' : 'var(--mx-muted-2)'
                        }}
                      >
                        {e.leads_count ?? 0}
                      </div>
                      <div className="mx-mono mx-t-xs mx-muted">LEADS</div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </Card>

        {/* ── Funnel card ──────────────────────────────── */}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <CardHead
            label={funnelEvent ? `${funnelEvent.name} · funnel` : 'Konverteringstratt'}
            right={<span className="mx-mono mx-t-xs mx-muted">denna period</span>}
          />
          <div style={{ padding: 20 }}>
            {!funnelEvent ? (
              <div className="mx-muted mx-t-13" style={{ textAlign: 'center', padding: 12 }}>
                Inget aktivt event att visa.
              </div>
            ) : (
              <>
                {funnelData.map((f, i) => {
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
                          height: 24,
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
                })}
                <div
                  style={{
                    marginTop: 16,
                    paddingTop: 14,
                    borderTop: '1px solid var(--mx-line-soft)'
                  }}
                >
                  <div className="mx-flex mx-items-c mx-justify-b">
                    <span className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">
                      CAC per antaget bolag
                    </span>
                    <span className="mx-disp mx-fw-6 mx-t-15">
                      {cac ? `~ ${cac.toLocaleString('sv-SE')} kr` : '—'}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* ── ROI table ─────────────────────────────────── */}
      <SectionHead title="Vilka events ger oss bolag?" label="senaste 12 mån · alla källor" />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {past.length === 0 ? (
          <div className="mx-muted mx-t-13" style={{ padding: 24, textAlign: 'center' }}>
            Inga avslutade events att rapportera än.
          </div>
        ) : (
          <table className="mx-tbl" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '10px 16px' }}>Event</th>
                <th style={{ width: 90, textAlign: 'right', padding: '10px 8px' }}>Anmälda</th>
                <th style={{ width: 80, textAlign: 'right', padding: '10px 8px' }}>Leads</th>
                <th style={{ width: 90, textAlign: 'right', padding: '10px 8px' }}>Antagna</th>
                <th style={{ width: 80, textAlign: 'right', padding: '10px 8px' }}>CR</th>
                <th style={{ width: 120, padding: '10px 16px' }}>Senast</th>
              </tr>
            </thead>
            <tbody>
              {past.map((e) => {
                const s = e.signups_count || 0;
                const adm = e.admitted_count || 0;
                const cr = s > 0 ? Math.round((adm / s) * 100) : 0;
                return (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--mx-line-soft)' }}>
                    <td style={{ padding: '10px 16px' }} className="mx-fw-6">
                      <Link
                        href={`/events/${e.id}`}
                        style={{ color: 'inherit', textDecoration: 'none' }}
                      >
                        {e.name}
                      </Link>
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 8px' }} className="mx-mono">
                      {s}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 8px' }} className="mx-mono">
                      {e.leads_count || 0}
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 8px' }} className="mx-mono">
                      <Chip variant="green" mono>
                        {adm}
                      </Chip>
                    </td>
                    <td style={{ textAlign: 'right', padding: '10px 8px' }} className="mx-mono">
                      {cr}%
                    </td>
                    <td style={{ padding: '10px 16px' }} className="mx-muted mx-mono mx-t-xs">
                      {ageString(e.starts_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
