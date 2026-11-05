import Link from 'next/link';
import { exportHref } from '@/lib/export-lab/tabs';

const STEPS = [
  { label: 'Skapa bolag', description: 'Innovation & ambition', completedLabel: 'Underlag sparat', href: null as null | 'marknader' | 'analys' | 'plan' },
  { label: 'Exportprofil', description: 'Marknader & mognad', completedLabel: 'Marknader granskade', href: 'marknader' as const },
  { label: 'Informationsgap', description: 'Kompletteringar', completedLabel: 'Kompletteringar klara', href: 'analys' as const },
  { label: 'Exportplan', description: 'Exportplan', completedLabel: 'Exportplan klar', href: 'plan' as const }
];

/** Export Labs fyra steg; `current` = 1 exportprofil, 2 informationsgap, 3 exportplan. */
export function ExportStepper({ current, startupId }: { current: 1 | 2 | 3; startupId: string }) {
  const currentStep = current + 1;
  return (
    <div className="mb-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Analysens fyra steg">
      {STEPS.map((step, index) => {
        const number = index + 1;
        const completed = number < currentStep;
        const active = number === currentStep;
        const content = (
          <>
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold mx-tnum ${active || completed ? 'bg-movexum-djupbla text-movexum-vit dark:bg-movexum-bla dark:text-movexum-morkbla' : 'bg-canvas-muted text-foreground-subtle'}`}>
              {number}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{step.label}</span>
              <span className="block text-xs text-foreground-subtle">{active ? 'Nuvarande steg' : completed ? step.completedLabel : `Öppna ${step.description.toLowerCase()}`}</span>
            </span>
          </>
        );
        const className = `group flex items-center gap-3 rounded-xl border p-3 transition ${active ? 'border-movexum-djupbla/40 bg-movexum-pastell-bla/50 shadow-sm shadow-movexum-svart/5 dark:bg-movexum-morkbla/30' : 'border-default bg-surface'}`;
        return step.href ? (
          <Link key={step.label} href={exportHref(startupId, step.href)} aria-current={active ? 'step' : undefined} className={`${className} hover:border-movexum-djupbla/40 hover:bg-movexum-pastell-bla/40 dark:hover:bg-movexum-morkbla/30`}>
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
