import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { Chip } from '@/components/proto';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat, RailItem } from '@/components/PageRail';
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

  const stageCounts: Record<EventSignupStage, number> = {
    signup: 0,
    attended: 0,
    meeting: 0,
    application: 0,
    admitted: 0
  };
  for (const s of allSignups) {
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
  const admittedTotal = funnelData[funnelData.length - 1].count;
  const cac = admittedTotal > 0 ? Math.round(100_000 / admittedTotal) : null;

  const totalLeads = events.reduce((s, e) => s + (e.leads_count || 0), 0);
  const totalAdmitted = events.reduce((s, e) => s + (e.admitted_count || 0), 0);

  const rail = (
    <>
      <RailSection label="Översikt">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Events" value={events.length} />
          <RailStat label="Kommande" value={upcoming.length} />
          <RailStat label="Leads totalt" value={totalLeads} />
          <RailStat label="Antagna" value={totalAdmitted} />
        </div>
      </RailSection>

      {liveEvent && (
        <RailSection label="Live nu">
          <RailItem
            icon="spark"
            iconTone="success"
            title={liveEvent.name}
            meta={`${liveEvent.signups_count ?? 0} anmälda · ${liveEvent.attended_count ?? 0} incheckade`}
            href={`/events/${liveEvent.id}`}
          />
        </RailSection>
      )}

      <RailSection label="Kommande">
        {upcoming.length === 0 ? (
          <div className="px-2 py-4 text-center text-[12px] text-foreground-subtle">
            Inga kommande events.
          </div>
        ) : (
          upcoming.slice(0, 4).map((e) => (
            <RailItem
              key={e.id}
              icon="calendar"
              iconTone="brand"
              title={e.name}
              meta={`${shortMonth(new Date(e.starts_at))} ${new Date(e.starts_at).getDate()} · ${e.signups_count ?? 0} anmälda`}
              href={`/events/${e.id}`}
            />
          ))
        )}
      </RailSection>
    </>
  );

  const canManage = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  return (
    <PageShell
      title="Events"
      rightPanel={rail}
      actions={
        canManage ? (
          <Link
            href="/events/new"
            className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
          >
            + Nytt event
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-6 py-6">
        {funnelEvent && (
          <section className="rounded-2xl border border-default bg-surface">
            <div className="flex items-center justify-between border-b border-default px-5 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                {funnelEvent.name} — konverteringstratt
              </span>
              <span className="font-mono text-[11px] text-foreground-subtle">
                {cac ? `CAC ~ ${cac.toLocaleString('sv-SE')} kr` : '—'}
              </span>
            </div>
            <div className="space-y-3 p-5">
              {funnelData.map((f, i) => {
                const widthPct = (f.count / maxCount) * 100;
                const conv =
                  i === 0 || funnelData[i - 1].count === 0
                    ? null
                    : Math.round((f.count / funnelData[i - 1].count) * 100);
                return (
                  <div key={f.stage}>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[13px] font-medium text-foreground">{f.label}</span>
                      <div className="flex items-center gap-2">
                        {conv != null && <Chip mono>{conv}%</Chip>}
                        <span className="font-mono text-[13px] font-semibold text-foreground tabular-nums">
                          {f.count}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-canvas-muted">
                      <div
                        className="h-full transition-all"
                        style={{ width: `${widthPct}%`, background: f.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
            Vilka events ger oss bolag?
          </h2>
          <div className="rounded-2xl border border-default bg-surface">
            {past.length === 0 ? (
              <div className="px-5 py-8 text-center text-[13px] text-foreground-muted">
                Inga avslutade events att rapportera än.
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-left">
                  <tr className="text-[10.5px] font-semibold uppercase tracking-wide text-foreground-subtle">
                    <th className="px-5 py-3">Event</th>
                    <th className="px-2 py-3 text-right">Anmälda</th>
                    <th className="px-2 py-3 text-right">Leads</th>
                    <th className="px-2 py-3 text-right">Antagna</th>
                    <th className="px-2 py-3 text-right">CR</th>
                    <th className="px-5 py-3">Senast</th>
                  </tr>
                </thead>
                <tbody>
                  {past.map((e) => {
                    const s = e.signups_count || 0;
                    const adm = e.admitted_count || 0;
                    const cr = s > 0 ? Math.round((adm / s) * 100) : 0;
                    return (
                      <tr key={e.id} className="border-t border-default">
                        <td className="px-5 py-3 font-medium text-foreground">
                          <Link href={`/events/${e.id}`} className="hover:underline">
                            {e.name}
                          </Link>
                        </td>
                        <td className="px-2 py-3 text-right font-mono">{s}</td>
                        <td className="px-2 py-3 text-right font-mono">{e.leads_count || 0}</td>
                        <td className="px-2 py-3 text-right">
                          <Chip variant="green" mono>
                            {adm}
                          </Chip>
                        </td>
                        <td className="px-2 py-3 text-right font-mono">{cr}%</td>
                        <td className="px-5 py-3 font-mono text-[11px] text-foreground-subtle">
                          {ageString(e.starts_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
