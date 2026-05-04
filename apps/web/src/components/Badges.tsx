import type { StartupPhase } from '@platform/shared';
import { phaseLabels, phaseTokens, statusLabels, type StartupStatus } from '@/lib/labels';

export function PhaseBadge({ phase }: { phase: StartupPhase }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
      title={phaseLabels[phase]}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: phaseTokens[phase] }}
      />
      {phaseLabels[phase]}
    </span>
  );
}

const statusClasses: Record<StartupStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  alumni: 'bg-slate-100 text-slate-700 ring-slate-200',
  paused: 'bg-amber-50 text-amber-700 ring-amber-200',
  rejected: 'bg-red-50 text-red-700 ring-red-200'
};

export function StatusBadge({ status }: { status: StartupStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${statusClasses[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}
