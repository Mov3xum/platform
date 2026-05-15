import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  PageHead,
  Card,
  CardHead,
  Chip,
  Avatar,
  BigRadar,
  Icon
} from '@/components/proto';
import { SprintXCheckinForm } from '@/components/SprintXCheckinForm';
import {
  SPRINT_X_AXES,
  type SprintXAxis,
  type SprintXScore,
  type SprintXCheckin,
  type Startup,
  type StartupPhase
} from '@platform/shared';

type StartupWithSprint = Startup & {
  sprint_x_json?: SprintXScore;
  sector?: string;
  pitch?: string;
  next_milestone?: string;
  team_size?: number;
  accent?: string;
};

type AvatarAccent = 'ink' | 'green' | 'purple' | 'brown' | 'copper' | 'yellow' | 'cyan';
const VALID_ACCENTS: AvatarAccent[] = ['ink', 'green', 'purple', 'brown', 'copper', 'yellow', 'cyan'];

function safeAccent(raw: unknown): AvatarAccent {
  if (typeof raw === 'string' && (VALID_ACCENTS as string[]).includes(raw)) {
    return raw as AvatarAccent;
  }
  return 'ink';
}

function normalizeScore(raw: SprintXScore | undefined): SprintXScore {
  return {
    funding: Number(raw?.funding) || 0,
    intl: Number(raw?.intl) || 0,
    sustain: Number(raw?.sustain) || 0,
    team: Number(raw?.team) || 0
  };
}

function phaseLabel(phase: StartupPhase): string {
  const labels: Record<StartupPhase, string> = {
    idea: 'Idéfas',
    pre_revenue: 'Pre-revenue',
    early_revenue: 'Tidig intäkt',
    growth: 'Tillväxt',
    scale: 'Scale',
    exit: 'Exit'
  };
  return labels[phase] ?? phase;
}

const AXIS_ACCENT: Record<SprintXAxis, 'yellow' | 'cyan' | 'green' | 'purple'> = {
  funding: 'yellow',
  intl: 'cyan',
  sustain: 'green',
  team: 'purple'
};

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('sv-SE', {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default async function KompassenStartupPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const canLog = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);

  const pb = await getServerPb();

  let startup: StartupWithSprint | null = null;
  try {
    startup = await pb
      .collection('startups')
      .getOne<StartupWithSprint>(id);
  } catch {
    notFound();
  }
  if (!startup) notFound();
  if (startup.tenant !== user.tenant) notFound();

  const score = normalizeScore(startup.sprint_x_json);

  let checkins: SprintXCheckin[] = [];
  try {
    const res = await pb
      .collection(PB_COLLECTIONS.sprintXCheckins)
      .getList<SprintXCheckin>(1, 50, {
        filter: pb.filter('tenant = {:tenant} && startup = {:startup}', {
          tenant: user.tenant,
          startup: id
        }),
        sort: '-created',
        expand: 'logged_by'
      });
    checkins = res.items;
  } catch {
    /* ignore — table may be empty */
  }

  const accent = safeAccent(startup.accent);
  const monthLabel = new Date().toLocaleDateString('sv-SE', {
    month: 'long',
    year: 'numeric'
  });

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb={`Hemmaplan / Startupkompassen / ${startup.name}`}
        title={startup.name}
        subtitle={
          startup.pitch ||
          startup.description ||
          `Sprint X-profil för ${startup.name}.`
        }
        actions={
          <>
            <Link href="/kompassen" className="mx-btn">
              <Icon name="arrow" size={13} style={{ transform: 'rotate(180deg)' }} /> Tillbaka
            </Link>
            <Link href={`/startups/${startup.id}`} className="mx-btn">
              Öppna profil
            </Link>
          </>
        }
      />

      <div
        className="mx-flex mx-items-c mx-gap-3 mx-wrap"
        style={{ marginBottom: 16 }}
      >
        <Avatar initial={startup.name.slice(0, 2).toUpperCase()} size="md" accent={accent} />
        <div>
          <Chip variant="default" mono>
            {phaseLabel(startup.phase)}
          </Chip>{' '}
          {startup.sector && (
            <Chip variant="default" mono>
              {startup.sector.split(' · ')[0]}
            </Chip>
          )}
        </div>
        <span className="mx-grow" />
        {typeof startup.team_size === 'number' && startup.team_size > 0 && (
          <span className="mx-mono mx-t-xs mx-muted">
            {startup.team_size} personer i team
          </span>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 420px) minmax(0, 1fr)',
          gap: 16
        }}
      >
        {/* BigRadar card ────────────────────────── */}
        <Card style={{ padding: 18 }}>
          <CardHead
            label="Sprint X · radar"
            right={<span className="mx-mono mx-t-xs mx-muted">{monthLabel}</span>}
          />
          <div style={{ marginTop: 8 }}>
            <BigRadar score={score} size={360} />
          </div>

          <div
            style={{
              borderTop: '1px solid var(--mx-line-soft)',
              paddingTop: 12,
              marginTop: 8
            }}
          >
            <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">
              Nästa milstolpe
            </div>
            <div className="mx-t-13 mx-fw-6">
              {startup.next_milestone || startup.next_step || 'Ingen milstolpe satt.'}
            </div>

            {canLog ? (
              <SprintXCheckinForm
                startupId={startup.id}
                currentScore={score}
                defaultAxis="funding"
              />
            ) : (
              <div
                className="mx-mt-3 mx-muted mx-t-xs mx-mono"
                style={{
                  padding: 10,
                  background: 'var(--mx-paper-2)',
                  border: '1px solid var(--mx-line-soft)',
                  borderRadius: 8
                }}
              >
                Endast Movexum-personal och coacher kan logga check-ins.
              </div>
            )}
          </div>
        </Card>

        {/* Timeline ──────────────────────────────── */}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <CardHead
            label="Sprint X · check-ins"
            right={
              <span className="mx-mono mx-t-xs mx-muted">
                {checkins.length} {checkins.length === 1 ? 'check-in' : 'check-ins'}
              </span>
            }
          />
          <div style={{ padding: '4px 16px 12px' }}>
            {checkins.length === 0 ? (
              <div
                className="mx-muted mx-t-13"
                style={{ padding: 24, textAlign: 'center' }}
              >
                Inga check-ins ännu.{' '}
                {canLog
                  ? 'Logga den första via knappen till vänster.'
                  : 'Personalen har inte loggat någon check-in ännu.'}
              </div>
            ) : (
              checkins.map((c, i) => {
                const axisMeta = SPRINT_X_AXES.find((a) => a.id === c.axis);
                const accentName = AXIS_ACCENT[c.axis];
                const delta = c.value_to - c.value_from;
                const loggedBy = c.expand?.logged_by;
                const loggedName =
                  loggedBy?.display_name || loggedBy?.email || 'Okänd';
                return (
                  <div
                    key={c.id}
                    className="mx-flex mx-gap-3"
                    style={{
                      alignItems: 'flex-start',
                      padding: '12px 0',
                      borderBottom:
                        i < checkins.length - 1
                          ? '1px solid var(--mx-line-soft)'
                          : 'none'
                    }}
                  >
                    <div
                      className="mx-mono mx-t-xs mx-fw-6"
                      style={{ minWidth: 80, color: 'var(--mx-ink)' }}
                    >
                      {fmtDate(c.created)}
                    </div>
                    <div
                      style={{
                        width: 3,
                        alignSelf: 'stretch',
                        borderRadius: 3,
                        background: `var(--mx-${accentName})`
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="mx-flex mx-items-c mx-gap-2 mx-wrap mx-mb-1"
                      >
                        <Chip variant={accentName} mono>
                          {axisMeta?.label ?? c.axis}
                        </Chip>
                        <span className="mx-disp mx-fw-6" style={{ fontSize: 15 }}>
                          {c.value_from} → {c.value_to}
                        </span>
                        <Chip
                          variant={delta > 0 ? 'active' : delta < 0 ? 'review' : 'default'}
                          mono
                        >
                          {delta > 0 ? '+' : ''}
                          {delta}
                        </Chip>
                      </div>
                      {c.note && (
                        <div
                          className="mx-t-13 mx-muted"
                          style={{ lineHeight: 1.4 }}
                        >
                          {c.note}
                        </div>
                      )}
                      <div
                        className="mx-flex mx-items-c mx-gap-2 mx-mt-2"
                      >
                        <Avatar
                          initial={loggedName.slice(0, 2).toUpperCase()}
                          size="xs"
                          accent="ink"
                        />
                        <span className="mx-t-xs mx-muted">{loggedName}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
