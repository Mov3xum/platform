import { Icon } from '@/components/proto';

interface DetailedMetrics {
  activitiesCount: number;
  notesCount: number;
  milestonesCount: number;
  documentsCount: number;
  teamMembersCount: number;
  workshopsCount: number;
  toolRunsCount: number;
}

interface StartupItem {
  id: string;
  name: string;
  phase: string;
  status: string;
  irl_level?: number;
  next_step?: string;
}

interface MetricChip {
  label: string;
  value: number;
  icon: string;
  href: string;
}

export function StartupDetailDashboard({
  startup,
  metrics
}: {
  startup: StartupItem;
  metrics: DetailedMetrics;
}) {
  const irl = startup.irl_level || 0;

  const chips: MetricChip[] = [
    { label: 'Aktiviteter', value: metrics.activitiesCount, icon: 'flow', href: '#activities' },
    { label: 'Anteckningar', value: metrics.notesCount, icon: 'doc', href: '#notes' },
    { label: 'Dokument', value: metrics.documentsCount, icon: 'doc', href: '#edu-documents' },
    { label: 'Verktyg', value: metrics.toolRunsCount, icon: 'sparkle', href: '#tools' },
    { label: 'Workshops', value: metrics.workshopsCount, icon: 'cap', href: '#workshops' },
    { label: 'Milstolpar', value: metrics.milestonesCount, icon: 'target', href: '#milestones' },
    { label: 'Team', value: metrics.teamMembersCount, icon: 'people', href: '#team' }
  ];

  return (
    <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5 sm:p-8">
      <h2 className="mb-6 text-lg font-semibold text-foreground">Bolagshälsa</h2>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* IRL Level */}
        <div className="flex flex-col items-center justify-center rounded-2xl border border-default bg-canvas-subtle/40 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
            IRL-nivå
          </p>
          <p className="mt-4 text-6xl font-bold text-movexum-morklila dark:text-movexum-pastell-lila">
            {irl || '–'}
          </p>
          <p className="mt-2 text-xs text-foreground-muted">av 9</p>
          {irl ? (
            <div className="mt-4 w-full">
              <div className="h-2 overflow-hidden rounded-full bg-canvas-subtle">
                <div
                  className="h-full bg-movexum-morklila dark:bg-movexum-pastell-lila"
                  style={{ width: `${(irl / 9) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="mt-3 text-center text-[11px] text-foreground-subtle">
              Ingen IRL-nivå satt än.
            </p>
          )}
        </div>

        {/* Next step + metric chips */}
        <div className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-default bg-movexum-pastell-lila/20 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-movexum-morklila dark:text-movexum-pastell-lila">
              Nästa steg
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {startup.next_step || 'Inget nästa steg definierat ännu.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {chips.map((chip) => (
              <a
                key={chip.label}
                href={chip.href}
                className="flex flex-col gap-1 rounded-2xl border border-default bg-canvas-subtle/40 p-4 transition hover:border-brand/40 hover:bg-canvas-subtle"
              >
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                  <Icon name={chip.icon} size={12} /> {chip.label}
                </span>
                <span className="text-2xl font-bold text-foreground">{chip.value}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
