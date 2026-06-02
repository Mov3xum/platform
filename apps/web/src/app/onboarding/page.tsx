import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { escFilter } from '@/lib/pb-filter';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageShell } from '@/components/PageShell';
import { OnboardingRunner } from '../education/OnboardingRunner';
import type { OnboardingFlow, OnboardingModule, OnboardingProgress } from '@platform/shared';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'onboarding', user.disabledModules)) {
    redirect('/dashboard');
  }

  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const linkedId = user.linkedStartups[0];

  // Staff utan eget bolag styr onboardingen i byggaren i stället.
  if (!linkedId) {
    if (isStaff) redirect('/education/onboarding');
    return (
      <PageShell title="Onboarding">
        <div className="py-6">
          <div className="rounded-3xl border border-dashed border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">
            Ditt konto är inte kopplat till något bolag än — kontakta Movexum.
          </div>
        </div>
      </PageShell>
    );
  }

  const pb = await getServerPb();

  // Hämta tenantens aktiva default-onboarding.
  let flow: OnboardingFlow | null = null;
  try {
    flow = await pb
      .collection(PB_COLLECTIONS.onboardingFlows)
      .getFirstListItem<OnboardingFlow>(
        `tenant = "${escFilter(user.tenant)}" && is_default = true && status = "active"`
      );
  } catch {
    flow = null;
  }

  if (!flow) {
    return (
      <PageShell title="Onboarding">
        <div className="py-6">
          <div className="rounded-3xl border border-dashed border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">
            Ingen onboarding är publicerad för ert bolag just nu. Hör av dig till din Movexum-coach
            om du har frågor om programmet.
          </div>
        </div>
      </PageShell>
    );
  }

  // Hämta ev. befintlig progress för bolaget.
  let progress: OnboardingProgress | null = null;
  try {
    progress = await pb
      .collection(PB_COLLECTIONS.onboardingProgress)
      .getFirstListItem<OnboardingProgress>(
        `tenant = "${escFilter(user.tenant)}" && flow = "${escFilter(flow.id)}" && startup = "${escFilter(linkedId)}"`
      );
  } catch {
    progress = null;
  }

  const modules = (flow.modules as OnboardingModule[] | undefined) ?? [];
  const initialAnswers = (progress?.answers_json as Record<string, unknown> | undefined) ?? {};

  return (
    <PageShell title="Onboarding">
      <main className="mx-auto w-full max-w-4xl space-y-6 py-6">
        <header className="rounded-3xl border border-default bg-gradient-to-br from-movexum-pastell-bla/50 to-surface p-6 dark:from-brand/10">
          <h1 className="font-heading text-2xl font-semibold text-foreground">{flow.title}</h1>
          {flow.intro ? (
            <p className="mt-2 whitespace-pre-line text-sm text-foreground-muted">{flow.intro}</p>
          ) : (
            <p className="mt-2 text-sm text-foreground-muted">
              Gå igenom modulerna nedan för att slutföra er onboarding. Framsteget sparas.
            </p>
          )}
          <p className="mt-3 text-xs text-foreground-subtle">
            <Link href="/min-oversikt" className="text-link hover:underline">
              ← Tillbaka till Min översikt
            </Link>
          </p>
        </header>

        <OnboardingRunner
          flowId={flow.id}
          startupId={linkedId}
          modules={modules}
          initialAnswers={initialAnswers}
          initialStatus={progress?.status}
        />
      </main>
    </PageShell>
  );
}
