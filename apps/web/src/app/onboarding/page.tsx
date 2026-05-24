import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem } from '@/components/PageRail';

const STEPS = [
  { id: 1, title: 'Registrera företagsinformation', icon: 'doc' },
  { id: 2, title: 'Ladda upp dokument', icon: 'upload' },
  { id: 3, title: 'Signera NDA och inkubatoravtal', icon: 'badge-check' },
  { id: 4, title: 'Möte med ansvarig coach', icon: 'calendar' }
];

export default async function OnboardingPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'onboarding', user.disabledModules)) {
    redirect('/dashboard');
  }

  const rail = (
    <RailSection label="Stegen">
      {STEPS.map((s) => (
        <RailItem
          key={s.id}
          icon={s.icon}
          iconTone="brand"
          title={s.title}
          meta={`Steg ${s.id} av ${STEPS.length}`}
        />
      ))}
    </RailSection>
  );

  return (
    <PageShell title="Digital onboarding" rightPanel={rail}>
      <div className="mx-auto w-full max-w-3xl space-y-6 py-6">
        <p className="text-[14px] text-foreground-muted">
          Komplettera de fyra stegen för att avsluta din onboarding. Du kan pausa när som helst —
          framsteget sparas automatiskt.
        </p>

        <div className="rounded-2xl border border-default bg-surface p-6">
          <ol className="space-y-3">
            {STEPS.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-4 rounded-xl border border-default px-4 py-3.5"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-canvas-muted font-mono text-[12px] text-foreground-muted">
                  {String(s.id).padStart(2, '0')}
                </span>
                <span className="flex-1 text-[14px] text-foreground">{s.title}</span>
                <span className="text-[11px] uppercase tracking-wider text-foreground-subtle">
                  Att göra
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </PageShell>
  );
}
