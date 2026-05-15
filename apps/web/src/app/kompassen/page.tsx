import Link from 'next/link';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  PageHead,
  SectionHead,
  Card,
  Chip,
  Avatar,
  MiniRadar,
  Icon
} from '@/components/proto';
import { SPRINT_X_AXES, type SprintXScore, type Startup, type StartupPhase } from '@platform/shared';

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

type StageFilter = 'all' | 'pre' | 'incubator' | 'scale';

const STAGE_FILTERS: { id: StageFilter; label: string; phases: StartupPhase[] }[] = [
  { id: 'all', label: 'Alla stadier', phases: [] },
  { id: 'pre', label: 'Förinkubator', phases: ['idea', 'pre_revenue'] },
  { id: 'incubator', label: 'Inkubator', phases: ['early_revenue', 'growth'] },
  { id: 'scale', label: 'Scale', phases: ['scale', 'exit'] }
];

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

export default async function KompassenPage({
  searchParams
}: {
  searchParams?: Promise<{ stage?: string }>;
}) {
  const user = await requireUser();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const params = (await searchParams) || {};
  const stageParam = String(params.stage || 'all') as StageFilter;
  const activeStage =
    STAGE_FILTERS.find((s) => s.id === stageParam) ?? STAGE_FILTERS[0];

  const pb = await getServerPb();
  let startups: StartupWithSprint[] = [];
  try {
    const sRes = await pb.collection('startups').getList<StartupWithSprint>(1, 100, {
      filter: `tenant = "${user.tenant}" && status = "active"`,
      sort: 'name'
    });
    startups = sRes.items;
  } catch {
    /* ignore */
  }

  const filtered =
    activeStage.phases.length === 0
      ? startups
      : startups.filter((s) => activeStage.phases.includes(s.phase));

  const preCount = startups.filter((s) =>
    (['idea', 'pre_revenue'] as StartupPhase[]).includes(s.phase)
  ).length;
  const scaleCount = startups.filter((s) =>
    (['scale', 'exit'] as StartupPhase[]).includes(s.phase)
  ).length;

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb="Hemmaplan / Startupkompassen"
        title="Startupkompassen"
        subtitle="Sprint X-mätning på fyra axlar: finansiering, internationalisering, hållbarhet och team. Varje bolag uppdateras månadsvis."
        actions={
          <>
            <span className="mx-btn">
              <Icon name="filter" size={13} /> Stadium: {activeStage.label}
            </span>
            {isStaff && (
              <Link href="/startups/new" className="mx-btn mx-primary">
                <Icon name="plus" size={13} /> Onboarda bolag
              </Link>
            )}
          </>
        }
      />

      {/* Filter-rad ─────────────────────────────────────── */}
      <div
        className="mx-flex mx-gap-2 mx-wrap"
        style={{ marginBottom: 16 }}
      >
        {STAGE_FILTERS.map((s) => {
          const selected = s.id === activeStage.id;
          return (
            <Link
              key={s.id}
              href={s.id === 'all' ? '/kompassen' : `/kompassen?stage=${s.id}`}
              className={`mx-chip mx-mono${selected ? ' mx-ink-chip' : ''}`}
              style={{
                textDecoration: 'none',
                cursor: 'pointer',
                fontWeight: selected ? 700 : 500
              }}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      {/* Sprint X axis strip ─────────────────────────────── */}
      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div
          className="mx-flex mx-items-c mx-gap-3 mx-wrap"
          style={{ marginBottom: 10 }}
        >
          <span className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">
            Sprint X · fyra axlar
          </span>
          <span className="mx-grow" />
          <span className="mx-mono mx-t-xs mx-muted">
            Skala 0–100 · uppdateras månadsvis
          </span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12
          }}
        >
          {SPRINT_X_AXES.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: 10,
                borderRadius: 10,
                background: 'var(--mx-paper-2)',
                border: '1px solid var(--mx-line-soft)'
              }}
            >
              <Chip variant={a.accent as 'yellow' | 'cyan' | 'green' | 'purple'} mono>
                {a.short.toUpperCase()}
              </Chip>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="mx-t-13 mx-fw-6">{a.label}</div>
                <div className="mx-t-xs mx-muted">
                  {a.id === 'funding' && 'Term sheets, rundor och intäkter.'}
                  {a.id === 'intl' && 'Marknader, partners och export.'}
                  {a.id === 'sustain' && 'LCA, klimatmål och rapportering.'}
                  {a.id === 'team' && 'Roller, kompetenser och kultur.'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Portfolio grid ─────────────────────────────────── */}
      <SectionHead
        title="Portfölj"
        label={`${filtered.length} bolag · ${preCount} i förinkubator · ${scaleCount} i scale`}
      />

      {filtered.length === 0 ? (
        <Card style={{ padding: 24, textAlign: 'center' }}>
          <div className="mx-disp mx-fw-6" style={{ fontSize: 16, marginBottom: 6 }}>
            Inga bolag i den valda kategorin
          </div>
          <div className="mx-muted mx-t-13" style={{ marginBottom: 16 }}>
            {startups.length === 0
              ? 'Kompassen är tom. Onboarda ert första bolag för att börja mäta.'
              : 'Justera filtret eller välj "Alla stadier" för att se hela portföljen.'}
          </div>
          {isStaff && startups.length === 0 && (
            <Link href="/startups/new" className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Onboarda bolag
            </Link>
          )}
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 12
          }}
        >
          {filtered.map((s) => {
            const score = normalizeScore(s.sprint_x_json);
            const sector = (s.sector || '').split(' · ')[0] || 'Ej kategoriserad';
            const accent = safeAccent(s.accent);
            return (
              <Link
                key={s.id}
                href={`/kompassen/${s.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <Card
                  className="mx-hover-card"
                  style={{
                    padding: 14,
                    cursor: 'pointer',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10
                  }}
                >
                  <div className="mx-flex mx-items-c mx-gap-2">
                    <Avatar
                      initial={s.name.slice(0, 2).toUpperCase()}
                      size="sm"
                      accent={accent}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="mx-disp mx-t-13 mx-fw-6 mx-truncate">
                        {s.name}
                      </div>
                      <div className="mx-mono mx-t-xs mx-muted mx-truncate mx-t-up">
                        {phaseLabel(s.phase)}
                      </div>
                    </div>
                    <MiniRadar score={score} size={44} />
                  </div>
                  <div
                    className="mx-t-12 mx-muted"
                    style={{ lineHeight: 1.4, minHeight: 34 }}
                  >
                    {s.pitch || s.description || 'Ingen pitch ännu.'}
                  </div>
                  <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
                    <Chip variant="default" mono>
                      {sector}
                    </Chip>
                    <span className="mx-grow" />
                    {typeof s.team_size === 'number' && s.team_size > 0 && (
                      <span className="mx-mono mx-t-xs mx-muted">
                        {s.team_size} pers
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <div
        className="mx-mt-6 mx-muted mx-t-xs mx-mono"
        style={{ textAlign: 'center' }}
      >
        Klicka på ett bolag för att se den fullständiga Sprint X-radarn och historiken.
      </div>
    </div>
  );
}
