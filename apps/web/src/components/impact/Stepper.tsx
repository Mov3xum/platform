import Link from 'next/link';
import { impactHref } from '@/lib/impact/tabs';

const STEPS = [
  { label: 'Skapa bolag', description: 'Bolagsinformation', completedLabel: 'Bolagsinformation sparad', href: null as null | 'vasentlighet' | 'analys' | 'dashboard' },
  { label: 'Bolagsöversikt', description: 'Väsentliga områden', completedLabel: 'Väsentliga områden granskade', href: 'vasentlighet' as const },
  { label: 'Informationsgap', description: 'Kompletteringar', completedLabel: 'Kompletteringar klara', href: 'analys' as const },
  { label: 'Dashboard', description: 'Dashboard', completedLabel: 'Dashboard klar', href: 'dashboard' as const }
];

/** Analysens fyra steg (originalets Stepper); `current` = 1 väsentlighet, 2 informationsgap, 3 dashboard. */
export function Stepper({ current, startupId }: { current: 1 | 2 | 3; startupId: string }) {
  const currentStep = current + 1;
  return (
    <div className="mb-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Analysens fyra steg">
      {STEPS.map((step, index) => {
        const number = index + 1;
        const completed = number < currentStep;
        const active = number === currentStep;
        const content = (
          <>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold mx-tnum ${active || completed ? 'bg-brand text-brand-foreground' : 'bg-canvas-muted text-foreground-subtle'}`}>
              {number}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{step.label}</span>
              <span className="block text-xs text-foreground-subtle">{active ? 'Nuvarande steg' : completed ? step.completedLabel : `Öppna ${step.description.toLowerCase()}`}</span>
            </span>
          </>
        );
        const className = `group flex items-center gap-3 rounded-xl border p-3 transition ${active ? 'border-strong bg-surface shadow-sm shadow-movexum-svart/5' : 'border-default bg-surface'}`;
        return step.href ? (
          <Link key={step.label} href={impactHref(startupId, step.href)} aria-current={active ? 'step' : undefined} className={`${className} hover:border-strong hover:bg-canvas-subtle`}>
            {content}
          </Link>
        ) : (
          <div key={step.label} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
