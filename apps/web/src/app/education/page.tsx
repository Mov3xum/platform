import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageHead, Card, Icon, Chip } from '@/components/proto';
import {
  EducationTrackLane,
  type TrackModule
} from '@/components/EducationTrackLane';
import type { Workshop, WorkshopAssignment } from '@platform/shared';

type Accent = 'yellow' | 'green' | 'cyan' | 'purple';

interface TrackDef {
  id: 'funding' | 'sustain' | 'intl' | 'team';
  label: string;
  accent: Accent;
  keywords: string[]; // för fallback-matching mot workshop.title
}

const TRACKS: TrackDef[] = [
  {
    id: 'funding',
    label: 'Kapitalanskaffning',
    accent: 'yellow',
    keywords: [
      'kapital',
      'finans',
      'investerar',
      'pitch',
      'term sheet',
      'cap table',
      'due diligence',
      'dd',
      'fund'
    ]
  },
  {
    id: 'sustain',
    label: 'Hållbarhet',
    accent: 'green',
    keywords: ['hållbar', 'sustain', 'csrd', 'klimat', 'lca', 'cirkul']
  },
  {
    id: 'intl',
    label: 'Internationalisering',
    accent: 'cyan',
    keywords: [
      'internation',
      'export',
      'marknad',
      'tysk',
      'eu-stöd',
      'distribution',
      'global'
    ]
  },
  {
    id: 'team',
    label: 'Team & ledarskap',
    accent: 'purple',
    keywords: [
      'team',
      'ledar',
      'rekryt',
      'aktieägar',
      'options',
      'kultur',
      'styrelse'
    ]
  }
];

function classifyWorkshop(workshop: Workshop): TrackDef['id'] | null {
  const title = workshop.title.toLowerCase();
  for (const t of TRACKS) {
    if (t.keywords.some((k) => title.includes(k))) return t.id;
  }
  return null;
}

export default async function EducationPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'education', user.disabledModules)) redirect('/idag');
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const isStartupMember = hasRole(user.roles, ['startup_member']);

  let workshops: Workshop[] = [];
  let assignments: WorkshopAssignment[] = [];

  try {
    const workshopsResult = await pb
      .collection(PB_COLLECTIONS.workshops)
      .getList<Workshop>(1, 200, {
        filter: `tenant = "${user.tenant}" && active = true`,
        sort: 'title'
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

  // ── Bygg lane-data per spår ────────────────────────────────────
  const trackBuckets: Record<TrackDef['id'], TrackModule[]> = {
    funding: [],
    sustain: [],
    intl: [],
    team: []
  };
  const unclassified: Workshop[] = [];

  for (const w of workshops) {
    const trackId = classifyWorkshop(w);
    const status = statusByWorkshop.get(w.id) || 'not_started';
    const blocks = (w.content_blocks || []).length;
    const lengthLabel = blocks > 0 ? `${blocks * 15} min` : `v${w.version}`;
    const item: TrackModule = { workshop: w, status, lengthLabel };
    if (trackId) {
      trackBuckets[trackId].push(item);
    } else {
      unclassified.push(w);
    }
  }

  // ── Workshop-matcharens förslag (heuristik: visa "Pågående" eller "Ej startad" per spår) ─
  const matcherSuggestions: { trackLabel: string; workshopTitle: string }[] = [];
  for (const t of TRACKS) {
    const next =
      trackBuckets[t.id].find((m) => m.status === 'in_progress') ||
      trackBuckets[t.id].find((m) => m.status === 'not_started');
    if (next) {
      matcherSuggestions.push({
        trackLabel: t.label,
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
          isStaff ? (
            <Link href="/education/new" className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Skapa modul
            </Link>
          ) : null
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
                .map((s) => `${s.trackLabel} → ${s.workshopTitle}`)
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
      {TRACKS.map((track) => (
        <EducationTrackLane
          key={track.id}
          trackId={track.id}
          trackLabel={track.label}
          accent={track.accent}
          modules={trackBuckets[track.id]}
        />
      ))}

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
