import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  PageHead,
  Card,
  CardHead,
  Chip,
  Avatar,
  KpiBlock,
  Icon
} from '@/components/proto';
import type { Alumni, AlumniTag, Partner } from '@platform/shared';

type AvatarAccent = 'ink' | 'green' | 'purple' | 'brown' | 'copper' | 'yellow' | 'cyan';

const ACCENT_CYCLE: AvatarAccent[] = ['brown', 'green', 'cyan', 'yellow', 'purple', 'copper'];
const EMPTY_RESULT_FILTER = 'id = ""';

function sanitizeRecordIds(ids: string[]): string[] {
  return ids.filter((id) => /^[a-zA-Z0-9_-]{6,64}$/.test(id));
}

const DEMO_ALUMNI: Alumni[] = [
  {
    id: 'demo-bjorn',
    tenant: 'demo',
    name: 'Björn Lund',
    company: 'Geocode → Bolaget såldes 2023',
    exit_year: 2023,
    tag: 'exit',
    active_mentor: true,
    accent: 'brown',
    created: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    updated: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'demo-sara',
    tenant: 'demo',
    name: 'Sara Tegnér',
    company: 'Klimatika → Exit 2024',
    exit_year: 2024,
    tag: 'exit',
    active_mentor: true,
    accent: 'green',
    created: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
    updated: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'demo-erik',
    tenant: 'demo',
    name: 'Erik Holmström',
    company: 'Norrkraft (scale 2025)',
    tag: 'scale',
    active_mentor: true,
    accent: 'cyan',
    created: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updated: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'demo-linn',
    tenant: 'demo',
    name: 'Linn Wikström',
    company: 'Solva (i drift)',
    tag: 'active',
    active_mentor: true,
    accent: 'yellow',
    created: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    updated: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  },
  {
    id: 'demo-daniel',
    tenant: 'demo',
    name: 'Daniel Friberg',
    company: 'Backenta (i drift)',
    tag: 'active',
    active_mentor: false,
    accent: 'purple',
    created: new Date(Date.now() - 110 * 24 * 60 * 60 * 1000).toISOString(),
    updated: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()
  }
];

function alumniTagChip(tag: AlumniTag): { variant: 'done' | 'green' | 'active' | 'review' | 'archive'; label: string } {
  switch (tag) {
    case 'exit':
      return { variant: 'done', label: 'Exit' };
    case 'scale':
      return { variant: 'green', label: 'Scale' };
    case 'active':
      return { variant: 'active', label: 'Aktiv' };
    case 'mentor':
      return { variant: 'review', label: 'Mentor' };
    case 'paused':
      return { variant: 'archive', label: 'Pausad' };
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return 'just nu';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return 'just nu';
  if (hours < 24) return `för ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'igår';
  if (days < 7) return `för ${days} dagar`;
  return `för ${Math.floor(days / 7)}v`;
}

interface ActivityRecord {
  id: string;
  type: string;
  title: string;
  status: string;
  kind?: string;
  created: string;
  expand?: {
    owner?: { id: string; display_name?: string; email: string };
    startup?: { id: string; name: string };
  };
}

export default async function CommunityPage() {
  const user = await requireUser();
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead']);
  const isScopedViewer =
    hasRole(user.roles, ['startup_member', 'partner']) &&
    !hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  // Hämta alumni
  let alumni: Alumni[] = [];
  let usingDemoAlumni = false;
  try {
    const aRes = await pb.collection(PB_COLLECTIONS.alumni).getList<Alumni>(1, 100, {
      filter: `tenant = "${user.tenant}"`,
      sort: '-created'
    });
    alumni = aRes.items;
  } catch {
    /* ignore */
  }

  if (alumni.length === 0) {
    alumni = DEMO_ALUMNI;
    usingDemoAlumni = true;
  }

  // Hämta partners (KPI-räknare)
  let partnersCount = 0;
  try {
    const pRes = await pb.collection('partners').getList<Partner>(1, 1, {
      filter: `tenant = "${user.tenant}"`,
      fields: 'id'
    });
    partnersCount = pRes.totalItems;
  } catch {
    /* ignore */
  }
  if (partnersCount === 0 && usingDemoAlumni) partnersCount = 14;

  // KPIer
  const alumniCount = alumni.length;
  const activeMentors = alumni.filter((a) => a.active_mentor).length;
  const exits = alumni.filter((a) => a.tag === 'exit');
  const exitsCount = exits.length;
  const exitsHint =
    exits
      .slice(0, 2)
      .map((e) => (e.company ? e.company.split(/[→·-]/)[0].trim() : e.name))
      .filter(Boolean)
      .join(' · ') || '—';

  // Hämta senaste aktiviteter
  let activities: ActivityRecord[] = [];
  try {
    let linkedFilter = '';
    if (isScopedViewer) {
      const linkedStartupIds = sanitizeRecordIds(user.linkedStartups);
      linkedFilter =
        linkedStartupIds.length > 0
          ? ` && (${linkedStartupIds.map((id) => `startup = "${id}"`).join(' || ')})`
          : ` && ${EMPTY_RESULT_FILTER}`;
    }
    const aRes = await pb.collection('activities').getList<ActivityRecord>(1, 12, {
      filter: `startup.tenant = "${user.tenant}"${linkedFilter}`,
      sort: '-created',
      expand: 'owner,startup'
    });
    activities = aRes.items;
  } catch {
    /* ignore */
  }

  // Nya alumni de senaste 30 dagarna
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentAlumni = alumni.filter((a) => new Date(a.created).getTime() >= cutoff);

  type FeedEntry = {
    key: string;
    who: string;
    accent: AvatarAccent;
    text: string;
    at: string;
  };

  const feed: FeedEntry[] = [
    ...recentAlumni.map<FeedEntry>((a, i) => ({
      key: `alum-${a.id}`,
      who: a.name,
      accent: (a.accent as AvatarAccent) || ACCENT_CYCLE[i % ACCENT_CYCLE.length],
      text: `bjöds in som alumni${a.company ? ` · ${a.company}` : ''}.`,
      at: a.created
    })),
    ...activities.map<FeedEntry>((act, i) => {
      const ownerName = act.expand?.owner?.display_name || act.expand?.owner?.email || 'En medlem';
      const startupName = act.expand?.startup?.name;
      return {
        key: `act-${act.id}`,
        who: ownerName,
        accent: ACCENT_CYCLE[i % ACCENT_CYCLE.length],
        text: `${act.title}${startupName ? ` · ${startupName}` : ''}.`,
        at: act.created
      };
    })
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8);

  // Fallback för flöde
  const feedFallback: FeedEntry[] =
    feed.length > 0
      ? feed
      : [
          {
            key: 'demo-bjorn',
            who: 'Björn Lund',
            accent: 'brown',
            text: 'Bjöd in 2 till Sommarmingel · Alumni.',
            at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
          },
          {
            key: 'demo-maja',
            who: 'Maja Sundberg',
            accent: 'green',
            text: 'Postade tråd: "Term sheet-fallgropar 2026".',
            at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
          },
          {
            key: 'demo-lars',
            who: 'Lars Holm',
            accent: 'green',
            text: 'Slutförde mentorskap för Skogsnod.',
            at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString()
          }
        ];

  const topMentors = alumni.filter((a) => a.active_mentor).slice(0, 5);
  const mentorsFallback: Alumni[] =
    topMentors.length > 0 ? topMentors : alumni.slice(0, 5);

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb="Hemmaplan / Community"
        title="Community & alumni"
        subtitle="Mentorer, alumni och nätverk. Egna inloggningar — kan bjudas in till uppdrag och events."
        actions={
          <>
            <button type="button" className="mx-btn">
              <Icon name="filter" size={13} /> Grupp
            </button>
            {isStaff && (
              <button type="button" className="mx-btn mx-primary">
                <Icon name="plus" size={13} /> Bjud in
              </button>
            )}
          </>
        }
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 16
        }}
      >
        <KpiBlock
          label="ALUMNI"
          value={alumniCount || '—'}
          hint={
            recentAlumni.length > 0 ? `+${recentAlumni.length} senaste 30 dagar` : 'totalt'
          }
        />
        <KpiBlock
          label="AKTIVA MENTORER"
          value={activeMentors || '—'}
          hint="tillgängliga för uppdrag"
        />
        <KpiBlock
          label="PARTNERS"
          value={partnersCount || '—'}
          hint="från partners-modulen"
        />
        <KpiBlock label="EXITS" value={exitsCount || '—'} hint={exitsHint} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        {/* Community-flöde */}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <CardHead
            label="Community-flöde"
            right={
              <button type="button" className="mx-btn mx-sm mx-ghost">
                <Icon name="filter" size={12} />
              </button>
            }
          />
          <div style={{ padding: '4px 16px 12px' }}>
            {feedFallback.map((it, i) => {
              const firstName = it.who.split(' ')[0];
              return (
                <div
                  key={it.key}
                  className="mx-flex mx-gap-3 mx-items-c"
                  style={{
                    padding: '12px 0',
                    borderBottom:
                      i < feedFallback.length - 1 ? '1px solid var(--mx-line-soft)' : 'none'
                  }}
                >
                  <Avatar initial={initials(it.who)} size="sm" accent={it.accent} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mx-t-13">
                      <span className="mx-fw-6">{firstName}</span>{' '}
                      <span className="mx-muted">{it.text}</span>
                    </div>
                    <div className="mx-mono mx-t-xs mx-muted mx-t-up">{relativeTime(it.at)}</div>
                  </div>
                  <button type="button" className="mx-btn mx-sm mx-ghost">
                    <Icon name="chevron" size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Alumni · top mentorer */}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <CardHead
            label="Alumni · top mentorer"
            right={<button type="button" className="mx-btn mx-sm mx-ghost">Alla →</button>}
          />
          <div style={{ padding: '4px 16px 12px' }}>
            {mentorsFallback.length === 0 ? (
              <div className="mx-muted mx-t-13" style={{ padding: '16px 0', textAlign: 'center' }}>
                Inga mentorer ännu — bjud in alumni för att börja.
              </div>
            ) : (
              mentorsFallback.map((a, i) => {
                const chip = alumniTagChip(a.tag);
                return (
                  <div
                    key={a.id}
                    className="mx-flex mx-items-c mx-gap-3"
                    style={{
                      padding: '12px 0',
                      borderBottom:
                        i < mentorsFallback.length - 1 ? '1px solid var(--mx-line-soft)' : 'none'
                    }}
                  >
                    <Avatar
                      initial={initials(a.name)}
                      size="md"
                      accent={(a.accent as AvatarAccent) || ACCENT_CYCLE[i % ACCENT_CYCLE.length]}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="mx-t-13 mx-fw-6 mx-truncate">{a.name}</div>
                      <div className="mx-t-12 mx-muted mx-truncate">
                        {a.company || (a.exit_year ? `Exit ${a.exit_year}` : '—')}
                      </div>
                    </div>
                    <Chip variant={chip.variant} mono>
                      {chip.label}
                    </Chip>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      {usingDemoAlumni && (
        <div
          className="mx-mono mx-t-xs mx-muted"
          style={{ marginTop: 12, padding: '0 4px', fontStyle: 'italic' }}
        >
          Demo-data visas — bjud in din första alumnus för att se riktig data.
        </div>
      )}
    </div>
  );
}
