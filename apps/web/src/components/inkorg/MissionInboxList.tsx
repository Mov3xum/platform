import Link from 'next/link';
import { Icon } from '@/components/proto';
import type { Mission, MissionStatus } from '@platform/shared';

const STATUS_LABEL: Record<MissionStatus, string> = {
  draft: 'Utkast',
  preparation: 'Förberedelse',
  in_progress: 'Pågående',
  review: 'Granskning',
  done: 'Klart',
  archived: 'Arkiverat'
};

const TYPE_LABEL: Record<string, string> = {
  workshop: 'Workshop',
  sprint_x: 'Sprint X',
  community: 'Community',
  report: 'Rapport',
  onboarding: 'Onboarding',
  project: 'Projekt',
  custom: 'Uppdrag'
};

function fmtDate(s?: string) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { month: 'short', day: '2-digit' });
}

export function MissionInboxList({ missions }: { missions: Mission[] }) {
  if (missions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-default p-8 text-center">
        <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-canvas-muted text-foreground-subtle">
          <Icon name="briefcase" size={18} />
        </div>
        <p className="text-[12.5px] text-foreground-subtle">
          Du är inte deltagare i några aktiva projekt eller uppdrag just nu.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {missions.map((m) => {
        const due = fmtDate(m.due_date);
        return (
          <Link
            key={m.id}
            href={`/uppdrag/${m.id}`}
            className="block rounded-2xl border border-default bg-surface p-4 shadow-sm shadow-movexum-svart/5 transition hover:border-brand/40 hover:shadow-md"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-movexum-pastell-lila text-movexum-lila">
                <Icon name="briefcase" size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10.5px] font-medium text-foreground-muted">
                    {TYPE_LABEL[m.type] || m.type}
                  </span>
                  <span className="rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10.5px] font-medium text-foreground-muted">
                    {STATUS_LABEL[m.status]}
                  </span>
                  {m.expand?.startup && (
                    <span className="rounded-md bg-canvas-muted px-1.5 py-0.5 text-[10.5px] text-foreground-muted">
                      {m.expand.startup.name}
                    </span>
                  )}
                </div>
                <h3 className="mt-1 font-heading text-[14.5px] font-semibold text-foreground">
                  {m.title}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-foreground-subtle">
                  {due && (
                    <span className="inline-flex items-center gap-1">
                      <Icon name="calendar" size={11} /> deadline {due}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Icon name="people" size={11} />{' '}
                    {(m.recipients?.length || 0) + 1} deltagare
                  </span>
                </div>
              </div>
              <Icon name="chevron" size={14} className="shrink-0" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
