// Movexum OS — TrackLane för utbildning.
// Renderar en horisontellt scrollande rad av workshop-kort, grupperade per
// område/spår. Stödjer omslagsbilder på både spåret och enskilda workshops.

import Link from 'next/link';
import type { Workshop, WorkshopAssignmentStatus } from '@platform/shared';

type Accent = 'yellow' | 'green' | 'cyan' | 'purple';

export interface TrackModule {
  workshop: Workshop;
  status: WorkshopAssignmentStatus | 'not_started';
  lengthLabel?: string;
  imageUrl?: string | null;
}

interface TrackLaneProps {
  trackId: string;
  trackLabel: string;
  accent: Accent;
  modules: TrackModule[];
  imageUrl?: string | null;
}

const ACCENT_DOT: Record<Accent, string> = {
  yellow: 'bg-movexum-gul',
  green: 'bg-movexum-gron',
  cyan: 'bg-movexum-bla',
  purple: 'bg-movexum-lila'
};

const ACCENT_PLACEHOLDER: Record<Accent, string> = {
  yellow: 'bg-movexum-pastell-gul text-movexum-morkgul',
  green: 'bg-movexum-pastell-gron text-movexum-morkgron',
  cyan: 'bg-movexum-pastell-bla text-movexum-morkbla',
  purple: 'bg-movexum-pastell-lila text-movexum-lila'
};

const ACCENT_ACTIVE_BORDER: Record<Accent, string> = {
  yellow: 'border-movexum-gul',
  green: 'border-movexum-gron',
  cyan: 'border-movexum-bla',
  purple: 'border-movexum-lila'
};

function StatusPill({
  status,
  accent
}: {
  status: TrackModule['status'];
  accent: Accent;
}) {
  if (status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-movexum-pastell-gron px-2 py-0.5 text-[10.5px] font-medium text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
        ✓ Klar
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium text-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${ACCENT_DOT[accent]}`} />
        Pågående
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-canvas-muted px-2 py-0.5 text-[10.5px] font-medium text-foreground-subtle">
      Ej startad
    </span>
  );
}

export function EducationTrackLane({ trackLabel, accent, modules, imageUrl }: TrackLaneProps) {
  const doneCount = modules.filter((m) => m.status === 'done').length;

  return (
    <section className="overflow-hidden rounded-2xl border border-default bg-surface">
      <div className="flex items-center gap-3 border-b border-default px-4 py-3">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg object-cover"
            loading="lazy"
          />
        ) : (
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${ACCENT_PLACEHOLDER[accent]}`}
          >
            {trackLabel.trim().charAt(0).toUpperCase() || '#'}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13.5px] font-semibold text-foreground">{trackLabel}</h2>
          <p className="font-mono text-[11px] text-foreground-subtle">
            {doneCount}/{modules.length} klara
          </p>
        </div>
      </div>

      {modules.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-foreground-subtle">
          Inga moduler i detta spår ännu.
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto p-4">
          {modules.map((m) => {
            const isActive = m.status === 'in_progress';
            const initial = m.workshop.title.trim().charAt(0).toUpperCase() || 'W';
            return (
              <Link
                key={m.workshop.id}
                href={`/education/workshops/${m.workshop.id}`}
                className={`group block w-[210px] flex-shrink-0 overflow-hidden rounded-xl border bg-canvas-subtle/40 transition hover:shadow-sm hover:shadow-movexum-svart/5 ${
                  isActive ? `${ACCENT_ACTIVE_BORDER[accent]} border-2` : 'border-default hover:border-strong'
                }`}
              >
                <div className="relative aspect-[16/10] w-full overflow-hidden">
                  {m.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.imageUrl}
                      alt=""
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  ) : (
                    <span
                      className={`flex h-full w-full items-center justify-center text-2xl font-semibold ${ACCENT_PLACEHOLDER[accent]}`}
                    >
                      {initial}
                    </span>
                  )}
                </div>
                <div className="space-y-1.5 p-3">
                  <StatusPill status={m.status} accent={accent} />
                  <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
                    {m.workshop.title}
                  </p>
                  <p className="font-mono text-[11px] text-foreground-subtle">
                    {m.lengthLabel || `v${m.workshop.version}`}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
