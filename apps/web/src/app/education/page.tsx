import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { Icon, Chip } from '@/components/proto';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem, RailStat } from '@/components/PageRail';
import {
  EducationTrackLane,
  type TrackModule
} from '@/components/EducationTrackLane';
import type { Workshop, WorkshopArea, WorkshopAssignment } from '@platform/shared';

type Accent = 'yellow' | 'green' | 'cyan' | 'purple';
const TRACK_ACCENTS: Accent[] = ['yellow', 'green', 'cyan', 'purple'];

export default async function EducationPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'education', user.disabledModules)) redirect('/idag');
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const isStartupMember = hasRole(user.roles, ['startup_member']);

  let workshops: Workshop[] = [];
  let areas: WorkshopArea[] = [];
  let assignments: WorkshopAssignment[] = [];

  try {
    const workshopsResult = await pb
      .collection(PB_COLLECTIONS.workshops)
      .getList<Workshop>(1, 200, {
        filter: `tenant = "${user.tenant}" && active = true`,
        sort: 'title',
        expand: 'area'
      });
    workshops = workshopsResult.items;
  } catch (error) {
    console.error('[education] failed to load workshops', {
      tenant: user.tenant,
      userId: user.id,
      error
    });
  }

  try {
    areas = (
      await pb.collection(PB_COLLECTIONS.workshopAreas).getList<WorkshopArea>(1, 200, {
        filter: `tenant = "${user.tenant}"`,
        sort: 'name'
      })
    ).items;
  } catch (error) {
    console.error('[education] failed to load workshop areas', {
      tenant: user.tenant,
      userId: user.id,
      error
    });
  }

  try {
    const linkedFilter =
      isStartupMember && user.linkedStartups.length > 0
        ? user.linkedStartups.map((id) => `startup = "${id}"`).join(' || ')
        : '';
    assignments = (
      await pb
        .collection(PB_COLLECTIONS.workshopAssignments)
        .getList<WorkshopAssignment>(1, 200, {
          filter: `tenant = "${user.tenant}"${linkedFilter ? ` && (${linkedFilter})` : ''}`,
          sort: '-created',
          expand: 'workshop,startup'
        })
    ).items;
  } catch (error) {
    console.error('[education] failed to load assignments', {
      tenant: user.tenant,
      userId: user.id,
      error
    });
  }

  const statusByWorkshop = new Map<string, 'done' | 'in_progress' | 'not_started'>();
  for (const a of assignments) {
    const wid = String(a.workshop);
    const current = statusByWorkshop.get(wid);
    if (a.status === 'done') {
      statusByWorkshop.set(wid, 'done');
    } else if (a.status === 'in_progress' && current !== 'done') {
      statusByWorkshop.set(wid, 'in_progress');
    } else if (!current) {
      statusByWorkshop.set(wid, 'not_started');
    }
  }

  const areaBuckets = new Map<string, TrackModule[]>(
    areas.map((area) => [area.id, []] as const)
  );
  const unclassified: Workshop[] = [];

  for (const w of workshops) {
    const status = statusByWorkshop.get(w.id) || 'not_started';
    const blocks = (w.content_blocks || []).length;
    const lengthLabel = blocks > 0 ? `${blocks * 15} min` : `v${w.version}`;
    const item: TrackModule = { workshop: w, status, lengthLabel };
    const areaId = typeof w.area === 'string' ? w.area : '';
    if (areaId && areaBuckets.has(areaId)) {
      areaBuckets.get(areaId)?.push(item);
    } else {
      if (areaId) {
        console.warn('[education] workshop references missing area', {
          workshopId: w.id,
          areaId,
          tenant: user.tenant
        });
      }
      unclassified.push(w);
    }
  }

  const lanes = areas.map((area, index) => ({
    id: area.id,
    label: area.name,
    accent: TRACK_ACCENTS[index % TRACK_ACCENTS.length],
    modules: areaBuckets.get(area.id) || []
  }));

  const matcherSuggestions: { areaLabel: string; workshopTitle: string; workshopId: string }[] =
    [];
  for (const lane of lanes) {
    const next =
      lane.modules.find((m) => m.status === 'in_progress') ||
      lane.modules.find((m) => m.status === 'not_started');
    if (next) {
      matcherSuggestions.push({
        areaLabel: lane.label,
        workshopTitle: next.workshop.title,
        workshopId: next.workshop.id
      });
    }
  }

  const total = workshops.length;
  const done = Array.from(statusByWorkshop.values()).filter((s) => s === 'done').length;
  const inProgress = Array.from(statusByWorkshop.values()).filter((s) => s === 'in_progress')
    .length;

  const rail = (
    <>
      <RailSection label="Översikt">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Moduler" value={total} />
          <RailStat label="Klara" value={done} />
          <RailStat label="Pågående" value={inProgress} />
          <RailStat label="Spår" value={lanes.length} />
        </div>
      </RailSection>

      {matcherSuggestions.length > 0 && (
        <RailSection label="Nästa modul per spår">
          {matcherSuggestions.slice(0, 6).map((s) => (
            <RailItem
              key={s.workshopId}
              icon="arrow"
              iconTone="accent"
              title={s.workshopTitle}
              meta={s.areaLabel}
              href={`/education/workshops/${s.workshopId}`}
            />
          ))}
        </RailSection>
      )}
    </>
  );

  const actions = isStaff ? (
    <Link
      href="/education/new"
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-brand-foreground hover:bg-brand-hover"
    >
      <Icon name="plus" size={12} /> Skapa modul
    </Link>
  ) : null;

  return (
    <PageShell title="Utbildning" actions={actions} rightPanel={rail}>
      <div className="space-y-4 py-6">
        {lanes.map((track) => (
          <EducationTrackLane
            key={track.id}
            trackId={track.id}
            trackLabel={track.label}
            accent={track.accent}
            modules={track.modules}
          />
        ))}

        {unclassified.length > 0 && (
          <div className="rounded-2xl border border-default bg-surface">
            <div className="flex items-center gap-2 border-b border-default px-4 py-3">
              <Chip mono>Övriga moduler</Chip>
              <span className="flex-1" />
              <span className="font-mono text-[11px] text-foreground-subtle">
                {unclassified.length}
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto p-4">
              {unclassified.map((w) => (
                <Link
                  key={w.id}
                  href={`/education/workshops/${w.id}`}
                  className="block min-w-[200px] flex-shrink-0 rounded-xl border border-default bg-canvas-subtle p-3 transition hover:border-strong"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <Chip mono>{w.status}</Chip>
                  </div>
                  <div className="mb-2 text-[13px] font-semibold text-foreground">{w.title}</div>
                  <div className="font-mono text-[11px] text-foreground-subtle">v{w.version}</div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {workshops.length === 0 && (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-[13px] text-foreground-muted">
            Inga workshops ännu.
          </div>
        )}
      </div>
    </PageShell>
  );
}
