import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModule, hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageHead, Card, Icon, Chip } from '@/components/proto';
import {
  EducationTrackLane,
  type TrackModule
} from '@/components/EducationTrackLane';
import type { Workshop, WorkshopArea, WorkshopAssignment } from '@platform/shared';

type Accent = 'yellow' | 'green' | 'cyan' | 'purple';
const TRACK_ACCENTS: Accent[] = ['yellow', 'green', 'cyan', 'purple'];

export default async function EducationPage() {
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'education')) redirect('/idag');
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
      await pb.collection(PB_COLLECTIONS.workshopAssignments).getList<WorkshopAssignment>(1, 200, {
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

  // ── Aggregera status per workshop (bästa status över alla tilldelningar) ─
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

  // ── Bygg lane-data per område ───────────────────────────────────
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
      unclassified.push(w);
    }
  }

  const lanes = areas.map((area, index) => ({
    id: area.id,
    label: area.name,
    accent: TRACK_ACCENTS[index % TRACK_ACCENTS.length],
    modules: areaBuckets.get(area.id) || []
  }));

  // ── Workshop-matcharens förslag (visa "Pågående" eller "Ej startad" per område) ─
  const matcherSuggestions: { areaLabel: string; workshopTitle: string }[] = [];
  for (const lane of lanes) {
    const next =
      lane.modules.find((m) => m.status === 'in_progress') ||
      lane.modules.find((m) => m.status === 'not_started');
    if (next) {
      matcherSuggestions.push({
        areaLabel: lane.label,
        workshopTitle: next.workshop.title
      });
    }
  }

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb="Hemmaplan / Utbildning"
        title="Utbildning"
        subtitle="Spår per Sprint X-axel. Workshop-matcharen föreslår nästa modul baserat på var bolaget står."
        actions={
          <>
            <button className="mx-btn" type="button">
              <Icon name="filter" size={13} /> Bolag
            </button>
            {isStaff && (
              <Link href="/education/new" className="mx-btn mx-primary">
                <Icon name="plus" size={13} /> Skapa modul
              </Link>
            )}
          </>
        }
      />

      {/* AI-bannern */}
      {matcherSuggestions.length > 0 && (
        <Card
          style={{
            padding: 14,
            background: 'var(--mx-cyan-tint)',
            borderColor: 'transparent',
            marginBottom: 16
          }}
        >
          <div className="mx-flex mx-items-c mx-gap-3 mx-wrap">
            <Icon name="sparkle" size={16} style={{ color: 'var(--mx-cyan)' }} />
            <span
              className="mx-mono mx-t-xs mx-t-up mx-fw-6"
              style={{ color: '#0e3b44' }}
            >
              Workshop-matcharen föreslår
            </span>
            <span className="mx-t-13" style={{ color: '#0e3b44' }}>
              {matcherSuggestions
                .slice(0, 4)
                .map((s) => `${s.areaLabel} → ${s.workshopTitle}`)
                .join(' · ')}
            </span>
            <span className="mx-grow" />
            {isStaff && (
              <Link href="/uppdrag" className="mx-btn mx-sm mx-primary">
                Tilldela alla
              </Link>
            )}
          </div>
        </Card>
      )}

      {/* Lanes */}
      {lanes.map((track) => (
        <EducationTrackLane
          key={track.id}
          trackId={track.id}
          trackLabel={track.label}
          accent={track.accent}
          modules={track.modules}
        />
      ))}

      {/* TODO: workshops utan tydlig spårtillhörighet — visa i en extra lane */}
      {unclassified.length > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
          <div className="mx-card-head">
            <Chip mono>Övriga moduler</Chip>
            <span className="mx-grow" />
            <span className="mx-mono mx-t-xs mx-muted">{unclassified.length}</span>
          </div>
          <div className="mx-flex" style={{ padding: 16, overflowX: 'auto', gap: 8 }}>
            {unclassified.map((w) => (
              <Link
                key={w.id}
                href={`/education/workshops/${w.id}`}
                style={{
                  textDecoration: 'none',
                  color: 'inherit',
                  flexShrink: 0
                }}
              >
                <div className="mx-card" style={{ padding: 12, minWidth: 200 }}>
                  <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
                    <Chip mono>{w.status}</Chip>
                  </div>
                  <div className="mx-t-13 mx-fw-6 mx-mb-2">{w.title}</div>
                  <div className="mx-mono mx-t-xs mx-muted">v{w.version}</div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {workshops.length === 0 && (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <span className="mx-t-13 mx-muted">Inga workshops ännu.</span>
        </Card>
      )}
    </div>
  );
}
