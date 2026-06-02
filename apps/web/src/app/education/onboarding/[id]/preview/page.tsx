import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { OnboardingRunner } from '../../../OnboardingRunner';
import type { OnboardingFlow, OnboardingModule } from '@platform/shared';

export const dynamic = 'force-dynamic';

export default async function OnboardingPreviewPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'education', user.disabledModules)) redirect('/dashboard');
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) redirect('/education');

  const pb = await getServerPb();
  let flow: OnboardingFlow;
  try {
    flow = await pb.collection(PB_COLLECTIONS.onboardingFlows).getOne<OnboardingFlow>(id);
  } catch {
    notFound();
  }
  if (String(flow.tenant) !== user.tenant) notFound();

  const modules = (flow.modules as OnboardingModule[] | undefined) ?? [];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/education/onboarding" className="text-sm text-foreground-muted hover:text-foreground">
          ← Till onboarding
        </Link>
        <Link
          href={`/education/onboarding/${flow.id}/edit`}
          className="text-sm font-medium text-link hover:underline"
        >
          Redigera →
        </Link>
      </div>
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{flow.title}</h1>
        {flow.intro ? <p className="mt-2 text-sm text-foreground-muted">{flow.intro}</p> : null}
      </header>

      <OnboardingRunner flowId={flow.id} startupId="" modules={modules} preview />
    </main>
  );
}
