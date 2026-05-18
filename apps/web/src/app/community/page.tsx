import Link from 'next/link';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { Avatar, Chip, Icon } from '@/components/proto';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat, RailEmpty } from '@/components/PageRail';
import type { Alumni, AlumniTag, Partner } from '@platform/shared';

type AvatarAccent = 'ink' | 'green' | 'purple' | 'brown' | 'copper' | 'yellow' | 'cyan';

const ACCENT_CYCLE: AvatarAccent[] = ['brown', 'green', 'cyan', 'yellow', 'purple', 'copper'];
const EMPTY_RESULT_FILTER = 'id = ""';

function sanitizeRecordIds(ids: string[]): string[] {
  return ids.filter((id) => /^[a-zA-Z0-9_-]{6,64}$/.test(id));
}

function alumniTagChip(
  tag: AlumniTag
): { variant: 'done' | 'green' | 'active' | 'review' | 'archive'; label: string } {
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

  let alumni: Alumni[] = [];
  try {
    const aRes = await pb.collection(PB_COLLECTIONS.alumni).getList<Alumni>(1, 100, {
      filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
      sort: '-created'
    });
    alumni = aRes.items;
  } catch {
    /* collection may not exist yet */
  }

  let partnersCount = 0;
  try {
    const pRes = await pb.collection('partners').getList<Partner>(1, 1, {
      filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
      fields: 'id'
    });
    partnersCount = pRes.totalItems;
  } catch {
    /* ignore */
  }

  const alumniCount = alumni.length;
  const activeMentors = alumni.filter((a) => a.active_mentor).length;
  const exits = alumni.filter((a) => a.tag === 'exit');
  const exitsCount = exits.length;

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
      filter: pb.filter('startup.tenant = {:tenant}', { tenant: user.tenant }) + linkedFilter,
      sort: '-created',
      expand: 'owner,startup'
    });
    activities = aRes.items;
  } catch {
    /* ignore */
  }

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
      const ownerName =
        act.expand?.owner?.display_name || act.expand?.owner?.email || 'En medlem';
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
    .slice(0, 10);

  const topMentors = alumni.filter((a) => a.active_mentor).slice(0, 5);
  const mentorsFallback: Alumni[] = topMentors.length > 0 ? topMentors : alumni.slice(0, 5);

  const rail = (
    <>
      <RailSection label="Översikt">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat
            label="Alumni"
            value={alumniCount}
            hint={recentAlumni.length > 0 ? `+${recentAlumni.length} 30 dgr` : undefined}
          />
          <RailStat label="Mentorer" value={activeMentors} />
          <RailStat label="Partners" value={partnersCount} />
          <RailStat label="Exits" value={exitsCount} />
        </div>
      </RailSection>

      <RailSection label="Top mentorer">
        {mentorsFallback.length === 0 ? (
          <RailEmpty>Inga alumni ännu.</RailEmpty>
        ) : (
          mentorsFallback.map((a, i) => {
            const chip = alumniTagChip(a.tag);
            return (
              <div key={a.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <Avatar
                  initial={initials(a.name)}
                  size="sm"
                  accent={(a.accent as AvatarAccent) || ACCENT_CYCLE[i % ACCENT_CYCLE.length]}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-foreground">
                    {a.name}
                  </div>
                  <div className="truncate text-[11px] text-foreground-subtle">
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
      </RailSection>
    </>
  );

  const actions = isStaff ? (
    <Link
      href="/installningar"
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
    >
      <Icon name="plus" size={12} /> Bjud in
    </Link>
  ) : null;

  return (
    <PageShell title="Community & alumni" actions={actions} rightPanel={rail}>
      <div className="py-6">
        {feed.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-foreground-muted">
            Inga aktiviteter ännu — bjud in alumni och starta uppdrag för att se flödet.
          </div>
        ) : (
          <div className="rounded-2xl border border-default bg-surface">
            <div className="border-b border-default px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Community-flöde
            </div>
            <ul>
              {feed.map((it, i) => {
                const firstName = it.who.split(' ')[0];
                return (
                  <li
                    key={it.key}
                    className={`flex items-center gap-3 px-5 py-3 ${
                      i < feed.length - 1 ? 'border-b border-default' : ''
                    }`}
                  >
                    <Avatar initial={initials(it.who)} size="sm" accent={it.accent} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px]">
                        <span className="font-semibold text-foreground">{firstName}</span>{' '}
                        <span className="text-foreground-muted">{it.text}</span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-wide text-foreground-subtle">
                        {relativeTime(it.at)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </PageShell>
  );
}
