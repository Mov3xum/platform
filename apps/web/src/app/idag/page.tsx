import Link from 'next/link';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  PageHead,
  Card,
  CardHead,
  Chip,
  Avatar,
  Spark,
  MiniRadar,
  KpiBlock,
  Icon
} from '@/components/proto';
import DashboardChat from '@/components/DashboardChat';
import type {
  Startup,
  Mission,
  IncubatorEvent,
  IncubatorReport,
  ToolRun,
  SprintXScore
} from '@platform/shared';

type StartupWithSprint = Startup & { sprint_x_json?: SprintXScore; accent?: string };

function greeting() {
  const h = new Date().getHours();
  if (h < 10) return 'God morgon';
  if (h < 13) return 'God förmiddag';
  if (h < 17) return 'God eftermiddag';
  return 'God kväll';
}

function fmtDate(d: Date) {
  const days = ['Söndag', 'Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag'];
  const months = [
    'januari',
    'februari',
    'mars',
    'april',
    'maj',
    'juni',
    'juli',
    'augusti',
    'september',
    'oktober',
    'november',
    'december'
  ];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function svCount(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export default async function IdagPage() {
  const user = await requireUser();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);
  const pb = await getServerPb();

  // ── Counts ─────────────────────────────────────────────
  let activeStartupsCount = 0;
  let activeMissionsCount = 0;
  let myOpenMissionsCount = 0;
  let myFollowupsTodayCount = 0;
  let myToolRunsTodayCount = 0;
  let myActiveStartupsCount = 0;
  let report: IncubatorReport | null = null;
  let startups: StartupWithSprint[] = [];
  let recentMissions: Mission[] = [];
  let recentRuns: ToolRun[] = [];
  let upcomingEvents: IncubatorEvent[] = [];

  try {
    const sRes = await pb.collection('startups').getList<StartupWithSprint>(1, 50, {
      filter: pb.filter('tenant = {:tenant} && status = {:status}', {
        tenant: user.tenant,
        status: 'active'
      }),
      sort: '-created'
    });
    startups = sRes.items;
    activeStartupsCount = sRes.totalItems;
  } catch {
    /* ignore */
  }

  try {
    const mRes = await pb.collection(PB_COLLECTIONS.missions).getList<Mission>(1, 6, {
      filter: pb.filter('tenant = {:tenant} && status != {:done} && status != {:archived}', {
        tenant: user.tenant,
        done: 'done',
        archived: 'archived'
      }),
      sort: '-updated',
      expand: 'issuer,recipients,startup'
    });
    recentMissions = mRes.items;
    activeMissionsCount = mRes.totalItems;
  } catch {
    /* ignore */
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  try {
    const ownRuns = await pb.collection('tool_runs').getList(1, 1, {
      filter: pb.filter(
        'tenant = {:tenant} && triggered_by = {:userId} && created >= {:createdFrom} && created < {:createdTo}',
        {
          tenant: user.tenant,
          userId: user.id,
          createdFrom: dayStart.toISOString(),
          createdTo: dayEnd.toISOString()
        }
      ),
      fields: 'id'
    });
    myToolRunsTodayCount = ownRuns.totalItems;
  } catch {
    /* ignore */
  }

  try {
    const ownMissions = await pb.collection(PB_COLLECTIONS.missions).getList<Mission>(1, 1, {
      filter: pb.filter(
        'tenant = {:tenant} && status != {:done} && status != {:archived} && (issuer = {:userId} || recipients ?= {:userId})',
        {
          tenant: user.tenant,
          done: 'done',
          archived: 'archived',
          userId: user.id
        }
      ),
      fields: 'id'
    });
    myOpenMissionsCount = ownMissions.totalItems;
  } catch {
    /* ignore */
  }

  try {
    const ownActivities = await pb.collection('activities').getList(1, 1, {
      filter: pb.filter(
        'startup.tenant = {:tenant} && owner = {:userId} && status != {:done} && status != {:cancelled} && due_date >= {:from} && due_date < {:to}',
        {
          tenant: user.tenant,
          userId: user.id,
          done: 'done',
          cancelled: 'cancelled',
          from: dayStart.toISOString().slice(0, 10),
          to: dayEnd.toISOString().slice(0, 10)
        }
      ),
      fields: 'id'
    });
    myFollowupsTodayCount = ownActivities.totalItems;
  } catch {
    /* ignore */
  }

  if (isStaff) {
    try {
      const ownStartups = await pb.collection('startups').getList(1, 1, {
        filter: pb.filter(
          'tenant = {:tenant} && status = {:status} && (owner = {:userId} || coaches ?= {:userId})',
          {
            tenant: user.tenant,
            status: 'active',
            userId: user.id
          }
        ),
        fields: 'id'
      });
      myActiveStartupsCount = ownStartups.totalItems;
    } catch {
      /* ignore */
    }
  } else {
    myActiveStartupsCount = user.linkedStartups.length;
  }

  try {
    const rRes = await pb.collection(PB_COLLECTIONS.reports).getList<IncubatorReport>(1, 1, {
      filter: pb.filter('tenant = {:tenant} && status = {:status}', {
        tenant: user.tenant,
        status: 'draft_ai'
      }),
      sort: '-updated'
    });
    report = rRes.items[0] || null;
  } catch {
    /* ignore */
  }

  try {
    const runRes = await pb.collection('tool_runs').getList<ToolRun>(1, 6, {
      filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
      sort: '-created',
      expand: 'tool,startup'
    });
    recentRuns = runRes.items;
  } catch {
    /* ignore */
  }

  try {
    const evRes = await pb
      .collection(PB_COLLECTIONS.events)
      .getList<IncubatorEvent>(1, 4, {
        filter: pb.filter('tenant = {:tenant} && (status = {:planned} || status = {:live})', {
          tenant: user.tenant,
          planned: 'planned',
          live: 'live'
        }),
        sort: 'starts_at'
      });
    upcomingEvents = evRes.items;
  } catch {
    /* ignore */
  }

  const firstName = user.name.split(' ')[0] || user.email;
  const today = new Date();
  const aiDraftsAvailable = Boolean(report);

  return (
    <div className="mx-view-pad">
      <PageHead
        crumb="Hemmaplan / Idag"
        title={`${greeting()}, ${firstName}.`}
        subtitle={`${fmtDate(today)}. Du har ${svCount(myOpenMissionsCount, 'öppet uppdrag', 'öppna uppdrag')}, ${svCount(myFollowupsTodayCount, 'uppföljning', 'uppföljningar')} idag och AI har förberett ${aiDraftsAvailable ? 'ett' : 'inga'} utkast.`}
        actions={
          <Link href="/uppdrag" className="mx-btn mx-primary">
            <Icon name="plus" size={13} /> Nytt uppdrag
          </Link>
        }
      />

      {/* ── KPI puls-rad ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiBlock
          label="BOLAG JAG ANSVARAR FÖR"
          value={myActiveStartupsCount || 0}
          hint="aktiva bolag"
          spark={
            myActiveStartupsCount > 0 ? (
              <Spark data={[2, 2, 3, 3, 4, 4, 5, 5, myActiveStartupsCount]} color="#4a7d4a" />
            ) : null
          }
          foot={
            <Chip variant="green" mono>
              {myActiveStartupsCount > 0 ? 'Pågående coaching' : 'Koppla bolag'}
            </Chip>
          }
        />
        <KpiBlock
          label="MINA ÖPPNA UPPDRAG"
          value={myOpenMissionsCount || 0}
          hint="egna ansvar"
          spark={
            myOpenMissionsCount > 0 ? (
              <Spark data={[1, 2, 2, 3, 3, 4, 4, 5, myOpenMissionsCount]} color="#6138b5" />
            ) : null
          }
          foot={
            <span className="mx-t-xs mx-mono mx-muted">
              Fokus idag
            </span>
          }
        />
        <KpiBlock
          label="MINA AI-KÖRNINGAR IDAG"
          value={myToolRunsTodayCount || 0}
          hint="mistral"
          foot={
            <Chip variant="purple" mono>
              <Icon name="sparkle" size={10} /> Mistral EU
            </Chip>
          }
        />
        <KpiBlock
          label="UPPFÖLJNINGAR IDAG"
          value={myFollowupsTodayCount || 0}
          hint="ägda aktiviteter"
          spark={
            myFollowupsTodayCount > 0 ? (
              <Spark data={[0, 1, 1, 2, 2, 2, 3, 3, myFollowupsTodayCount]} color="#ca9323" />
            ) : null
          }
          foot={
            <Link href="/aktivitet">
              <Chip variant="yellow" mono>
                Öppna agenda
              </Chip>
            </Link>
          }
        />
      </div>

      {/* ── Två kolumner ─────────────────────────────────── */}
      <div
        className="mx-mt-6"
        style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}
      >
        {/* Aktivitetsström */}
        <Card style={{ overflow: 'hidden' }}>
          <CardHead
            label="Aktivitetsström"
            right={
              <>
                <Chip mono>
                  <span className="mx-dot" style={{ background: 'var(--mx-st-active)' }} /> LIVE
                </Chip>
                <Link href="/aktivitet" className="mx-btn mx-sm mx-ghost">
                  <Icon name="filter" size={12} /> Filter
                </Link>
              </>
            }
          />
          <div style={{ padding: '4px 8px' }}>
            {recentRuns.length === 0 && recentMissions.length === 0 ? (
              <div className="mx-muted mx-t-13" style={{ padding: 24, textAlign: 'center' }}>
                Inget händer just nu. Skapa ditt första uppdrag eller kör en AI-agent.
              </div>
            ) : (
              <>
                {recentMissions.map((m, i) => {
                  const issuer = m.expand?.issuer;
                  return (
                    <Link
                      key={m.id}
                      href={`/uppdrag/${m.id}`}
                      style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'flex-start',
                        padding: '12px 12px',
                        borderBottom: '1px solid var(--mx-line-soft)',
                        textDecoration: 'none',
                        color: 'inherit'
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: 'var(--mx-purple-tint)',
                          color: 'var(--mx-purple-ink)',
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0
                        }}
                      >
                        <Icon name="flow" size={14} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mx-flex mx-items-c mx-gap-2" style={{ fontSize: 13 }}>
                          {issuer && (
                            <>
                              <Avatar
                                initial={(issuer.display_name || issuer.email).slice(0, 2)}
                                size="xs"
                                accent="ink"
                              />
                              <span className="mx-fw-6">
                                {(issuer.display_name || issuer.email).split(' ')[0]}
                              </span>
                            </>
                          )}
                          <span className="mx-muted mx-t-12">{m.title}</span>
                        </div>
                        <div className="mx-flex mx-items-c mx-gap-2" style={{ marginTop: 4 }}>
                          <span className="mx-mono mx-t-xs mx-muted mx-t-up">
                            {new Date(m.updated).toLocaleTimeString('sv-SE', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                          <span className="mx-mono mx-t-xs mx-muted-2">·</span>
                          <span className="mx-mono mx-t-xs mx-muted mx-t-up">
                            {m.status.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                      <Icon name="chevron" size={13} className="mx-muted" />
                    </Link>
                  );
                })}

                {recentRuns.map((r, i) => {
                  const tool = r.expand?.tool;
                  return (
                    <Link
                      key={r.id}
                      href={`/toolbox/runs/${r.id}`}
                      style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'flex-start',
                        padding: '12px 12px',
                        borderBottom:
                          i < recentRuns.length - 1 ? '1px solid var(--mx-line-soft)' : 'none',
                        textDecoration: 'none',
                        color: 'inherit'
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: 'var(--mx-cyan-tint-2)',
                          color: '#002c40',
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0
                        }}
                      >
                        <Icon name="sparkle" size={14} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mx-flex mx-items-c mx-gap-2" style={{ fontSize: 13 }}>
                          <Chip variant="cyan" mono>
                            <Icon name="sparkle" size={10} /> {tool?.name || 'AI'}
                          </Chip>
                          <span className="mx-muted mx-t-12">
                            {r.expand?.startup?.name || 'Portfölj'}
                          </span>
                        </div>
                        <div className="mx-flex mx-items-c mx-gap-2" style={{ marginTop: 4 }}>
                          <span className="mx-mono mx-t-xs mx-muted mx-t-up">
                            {new Date(r.created).toLocaleTimeString('sv-SE', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                          <span className="mx-mono mx-t-xs mx-muted-2">·</span>
                          <span className="mx-mono mx-t-xs mx-muted mx-t-up">{r.status}</span>
                        </div>
                      </div>
                      <Icon name="chevron" size={13} className="mx-muted" />
                    </Link>
                  );
                })}
              </>
            )}
          </div>
        </Card>

        {/* Sido-kolumn */}
        <div className="mx-flex mx-col mx-gap-4">
          <DashboardChat className="mt-0" />

          {/* AI-kommittén */}
          <Card ink style={{ overflow: 'hidden', padding: 0 }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              <div className="mx-flex mx-items-c mx-gap-2">
                <Icon name="sparkle" size={14} style={{ color: '#f0d22e' }} />
                <span
                  className="mx-mono mx-t-xs mx-fw-6 mx-t-up"
                  style={{ color: 'rgba(255,255,255,.55)' }}
                >
                  AI har förberett
                </span>
              </div>
              <div
                className="mx-disp mx-mt-1"
                style={{ fontSize: 16, fontWeight: 500, color: 'white' }}
              >
                {report ? 'Tre saker väntar på dig' : 'AI-agenter klara att aktiveras'}
              </div>
            </div>
            <div style={{ padding: 8 }}>
              {report && (
                <Link
                  href="/rapporter"
                  style={{
                    display: 'block',
                    padding: '10px 8px',
                    borderRadius: 8,
                    textDecoration: 'none'
                  }}
                >
                  <div className="mx-flex mx-items-c mx-gap-2">
                    <Chip mono>
                      <span style={{ color: '#f0d22e' }}>Rapportskrivaren</span>
                    </Chip>
                    <span
                      className="mx-mono mx-t-xs"
                      style={{ color: 'rgba(255,255,255,.4)', marginLeft: 'auto' }}
                    >
                      Öppna →
                    </span>
                  </div>
                  <div style={{ color: 'rgba(255,255,255,.85)', fontSize: 13, marginTop: 4 }}>
                    {report.title} — utkast klart att granska.
                  </div>
                </Link>
              )}
              <Link
                href="/inflode"
                style={{
                  display: 'block',
                  padding: '10px 8px',
                  borderRadius: 8,
                  textDecoration: 'none'
                }}
              >
                <div className="mx-flex mx-items-c mx-gap-2">
                  <Chip mono>
                    <span style={{ color: '#f0d22e' }}>Branschspanen</span>
                  </Chip>
                  <span
                    className="mx-mono mx-t-xs"
                    style={{ color: 'rgba(255,255,255,.4)', marginLeft: 'auto' }}
                  >
                    Visa →
                  </span>
                </div>
                <div style={{ color: 'rgba(255,255,255,.85)', fontSize: 13, marginTop: 4 }}>
                  Ny Horizon-utlysning matchar 1 av dina bolag.
                </div>
              </Link>
              <Link
                href="/uppdrag"
                style={{
                  display: 'block',
                  padding: '10px 8px',
                  borderRadius: 8,
                  textDecoration: 'none'
                }}
              >
                <div className="mx-flex mx-items-c mx-gap-2">
                  <Chip mono>
                    <span style={{ color: '#f0d22e' }}>Workshop-matcharen</span>
                  </Chip>
                  <span
                    className="mx-mono mx-t-xs"
                    style={{ color: 'rgba(255,255,255,.4)', marginLeft: 'auto' }}
                  >
                    Skapa uppdrag →
                  </span>
                </div>
                <div style={{ color: 'rgba(255,255,255,.85)', fontSize: 13, marginTop: 4 }}>
                  3 bolag saknar hållbarhets-checkin.
                </div>
              </Link>
            </div>
          </Card>

          {/* Kommande events */}
          {upcomingEvents.length > 0 && (
            <Card style={{ overflow: 'hidden' }}>
              <CardHead
                label={`Kommande · ${upcomingEvents.length}`}
                right={
                  <Link href="/events" className="mx-btn mx-sm mx-ghost">
                    Alla →
                  </Link>
                }
              />
              <div style={{ padding: '4px 12px 12px' }}>
                {upcomingEvents.map((ev, i) => {
                  const d = new Date(ev.starts_at);
                  return (
                    <Link
                      key={ev.id}
                      href={`/events`}
                      style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'center',
                        padding: '10px 0',
                        borderBottom:
                          i < upcomingEvents.length - 1 ? '1px solid var(--mx-line-soft)' : 'none',
                        textDecoration: 'none',
                        color: 'inherit'
                      }}
                    >
                      <div
                        className="mx-mono mx-t-xs mx-fw-6"
                        style={{ color: '#002c40', minWidth: 38 }}
                      >
                        {d.toLocaleDateString('sv-SE', { day: '2-digit', month: 'short' })}
                      </div>
                      <div
                        style={{
                          width: 3,
                          height: 28,
                          background: `var(--mx-${ev.accent || 'cyan'})`,
                          borderRadius: 3
                        }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="mx-t-13 mx-fw-6 mx-truncate">{ev.name}</div>
                        <div className="mx-t-xs mx-muted mx-truncate">{ev.type}</div>
                      </div>
                      {ev.status === 'live' && (
                        <Chip variant="active" mono dot>
                          LIVE
                        </Chip>
                      )}
                    </Link>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Portfölj-puls */}
          {startups.length > 0 && (
            <Card style={{ overflow: 'hidden' }}>
              <CardHead
                label="Portfölj-puls · Sprint X"
                right={
                  <Link href="/inflode" className="mx-btn mx-sm mx-ghost">
                    Alla →
                  </Link>
                }
              />
              <div style={{ padding: 12 }}>
                {startups.slice(0, 4).map((s, i) => (
                  <Link
                    key={s.id}
                    href={`/startups/${s.id}`}
                    style={{
                      display: 'flex',
                      gap: 12,
                      alignItems: 'center',
                      padding: '8px 4px',
                      borderBottom: i < 3 ? '1px solid var(--mx-line-soft)' : 'none',
                      textDecoration: 'none',
                      color: 'inherit'
                    }}
                  >
                    <Avatar
                      initial={s.name.slice(0, 2).toUpperCase()}
                      size="sm"
                      accent={(s.accent as 'cyan' | 'green' | 'purple' | 'copper' | 'yellow') || 'ink'}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="mx-t-13 mx-fw-6 mx-truncate">{s.name}</div>
                      <div className="mx-t-xs mx-muted mx-truncate">{s.phase}</div>
                    </div>
                    <MiniRadar
                      score={
                        s.sprint_x_json || { funding: 0, intl: 0, sustain: 0, team: 0 }
                      }
                      size={36}
                    />
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
