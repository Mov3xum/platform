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

export default async function IdagPage() {
  const user = await requireUser();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);
  const pb = await getServerPb();

  // ── Counts ─────────────────────────────────────────────
  let activeStartupsCount = 0;
  let activeMissionsCount = 0;
  let toolRunsToday = 0;
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

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const r = await pb.collection('tool_runs').getList(1, 1, {
      filter: pb.filter('tenant = {:tenant} && created >= {:createdFrom}', {
        tenant: user.tenant,
        createdFrom: today.toISOString()
      }),
      fields: 'id'
    });
    toolRunsToday = r.totalItems;
  } catch {
    /* ignore */
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
  const aiDraftCount = report ? 1 : 0;

  return (
    <div className="mx-view-pad">
      <PageHead
        crumb="Hemmaplan / Idag"
        title={`${greeting()}, ${firstName}.`}
        subtitle={`${fmtDate(today)}. ${activeMissionsCount} aktiva uppdrag och AI har förberett ${aiDraftCount} utkast.`}
        actions={
          <Link href="/uppdrag" className="mx-btn mx-primary">
            <Icon name="plus" size={13} /> Nytt uppdrag
          </Link>
        }
      />

      {/* ── KPI puls-rad ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiBlock
          label="I PROGRAM"
          value={activeStartupsCount || '—'}
          hint="startups"
          spark={
            activeStartupsCount > 0 ? (
              <Spark data={[8, 9, 10, 10, 11, 12, 12, 13, activeStartupsCount]} color="#4a7d4a" />
            ) : null
          }
          foot={
            <Chip variant="green" mono>
              {activeStartupsCount > 8 ? '+2 denna vecka' : 'Snart fullbokat'}
            </Chip>
          }
        />
        <KpiBlock
          label="AKTIVA UPPDRAG"
          value={activeMissionsCount || '—'}
          hint="över flera vågor"
          spark={
            activeMissionsCount > 0 ? (
              <Spark data={[5, 6, 6, 7, 7, 8, 7, 7, activeMissionsCount]} color="#6138b5" />
            ) : null
          }
          foot={
            <span className="mx-t-xs mx-mono mx-muted">
              {activeMissionsCount} aktiva
            </span>
          }
        />
        <KpiBlock
          label="AI-KÖRNINGAR IDAG"
          value={toolRunsToday || '0'}
          hint="verktyg"
          foot={
            <Chip variant="cyan" mono>
              <Icon name="sparkle" size={10} /> Mistral EU
            </Chip>
          }
        />
        <KpiBlock
          label={report ? `RAPPORT ${report.recipient_label || ''}` : 'RAPPORTER'}
          value={report ? `${report.completion || 0}%` : '—'}
          hint={report ? 'auto-ifyllt' : 'inga utkast'}
          spark={
            report ? <Spark data={[12, 28, 40, 55, 62, 68, 72, 75, report.completion || 0]} color="#4b2718" /> : null
          }
          foot={
            report ? (
              <Link href={`/rapporter`}>
                <Chip variant="review" mono>
                  Granska sektioner
                </Chip>
              </Link>
            ) : null
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
                Inget händer just nu. Skapa ditt första uppdrag eller kör ett AI-verktyg.
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
                href="/kompassen"
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
                  <Link href="/kompassen" className="mx-btn mx-sm mx-ghost">
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
