import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { WorkshopStatusBadge } from '@/components/Badges';
import { WorkshopRunner } from '../../../WorkshopRunner';
import type { Workshop, WorkshopAssignment, WorkshopBlock, WorkshopModule } from '@platform/shared';

export const dynamic = 'force-dynamic';

// Förhandsgranskning/testläge för workshops (CLAUDE.md § 18.5): staff kör
// workshopen exakt som ett bolag ser den — via WorkshopRunner i preview-läge
// med en syntetisk tilldelning. Ingenting persisteras; AI-momenten går mot
// preview-actions (fiktivt exempelbolag). Motsvarar onboarding-förhands-
// granskningen (/education/onboarding/[id]/preview).
export default async function WorkshopPreviewPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'education', user.disabledModules)) redirect('/dashboard');
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) {
    redirect(`/education/workshops/${id}`);
  }

  const pb = await getServerPb();
  let workshop: Workshop;
  try {
    workshop = await pb.collection(PB_COLLECTIONS.workshops).getOne<Workshop>(id);
  } catch {
    notFound();
  }
  if (workshop.tenant !== user.tenant) notFound();

  // Resolve modules — samma fallback som genomför-sidan (assignments/[id]).
  const rawModules =
    Array.isArray(workshop.modules) && (workshop.modules as WorkshopModule[]).length > 0
      ? (workshop.modules as WorkshopModule[])
      : [];
  const rawBlocks = Array.isArray(workshop.content_blocks)
    ? (workshop.content_blocks as WorkshopBlock[])
    : [];
  const modules: WorkshopModule[] =
    rawModules.length > 0
      ? rawModules
      : rawBlocks.length > 0
        ? [{ id: 'module_main', title: workshop.title, blocks: rawBlocks }]
        : [];

  // Syntetisk tilldelning: id/startup används aldrig i preview-läget — bara
  // `workshop` (för preview-actions) och tomma svar/artefakter som startläge.
  const previewAssignment: WorkshopAssignment = {
    id: 'preview',
    tenant: user.tenant,
    workshop: workshop.id,
    startup: '',
    assigned_by: user.id,
    status: 'in_progress',
    progress_json: {},
    answers_json: {},
    takeaway_json: {},
    artifacts_json: {},
    ai_thread_json: [],
    created: '',
    updated: ''
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <Link
          href={`/education/workshops/${id}`}
          className="text-sm text-foreground-muted hover:text-foreground"
        >
          ← Till workshopen
        </Link>
        <Link
          href={`/education/workshops/${id}/edit`}
          className="text-sm font-medium text-link hover:underline"
        >
          Redigera →
        </Link>
      </div>

      <header className="mb-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <WorkshopStatusBadge status={workshop.status} />
          <span className="inline-flex rounded-full bg-movexum-pastell-gul px-2 py-0.5 text-xs font-medium text-movexum-morkgul dark:bg-movexum-morkgul/30 dark:text-movexum-pastell-gul">
            Förhandsgranskning
          </span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{workshop.title}</h1>
        {workshop.goal ? <p className="mt-3 text-sm text-foreground-muted">{workshop.goal}</p> : null}
        {workshop.instructions ? (
          <div className="mt-4 rounded-2xl border border-default bg-canvas-subtle/40 p-4 text-sm text-foreground-muted">
            {workshop.instructions}
          </div>
        ) : null}
      </header>

      <div className="mb-6 rounded-2xl border border-movexum-bla/30 bg-movexum-pastell-bla px-4 py-3 dark:border-movexum-djupbla/50 dark:bg-movexum-morkbla/30">
        <p className="text-xs text-movexum-morkbla dark:text-movexum-pastell-bla">
          🔒 AI-verktyg drivs av <strong>Mistral / Le Chat</strong> (Frankrike, EU-suveränt).
          Konfidentiella anteckningar exkluderas alltid.
        </p>
      </div>

      <WorkshopRunner assignment={previewAssignment} modules={modules} isStaff preview />
    </main>
  );
}
