import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { WorkshopAssignForm } from '../../WorkshopAssignForm';
import { WorkshopStatusBadge } from '@/components/Badges';
import { deleteWorkshopFormAction } from '@/lib/actions/workshops';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { pbFileUrl } from '@/lib/pb-file';
import type { Workshop, WorkshopAssignment, WorkshopBlock, WorkshopModule } from '@platform/shared';

const BLOCK_TYPE_EMOJIS: Record<string, string> = {
  question: '❓',
  exercise: '✏️',
  instruction: '📖',
  video: '🎬',
  image: '🖼️',
  ai_chat: '🤖',
  test: '📝',
  summary: '📊'
};

export default async function WorkshopDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'education', user.disabledModules)) notFound();
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);

  let workshop: Workshop;
  try {
    workshop = await pb.collection(PB_COLLECTIONS.workshops).getOne<Workshop>(id);
  } catch {
    notFound();
  }
  if (workshop.tenant !== user.tenant) notFound();

  // Resolve modules (prefer new structure, fall back to flat blocks)
  const rawModules = Array.isArray(workshop.modules) && (workshop.modules as WorkshopModule[]).length > 0
    ? (workshop.modules as WorkshopModule[])
    : [];
  const rawBlocks = Array.isArray(workshop.content_blocks)
    ? (workshop.content_blocks as WorkshopBlock[])
    : [];
  const modules: WorkshopModule[] =
    rawModules.length > 0
      ? rawModules
      : rawBlocks.length > 0
        ? [{ id: 'main', title: 'Workshop', blocks: rawBlocks }]
        : [];

  const totalBlocks = modules.reduce((acc, m) => acc + m.blocks.length, 0);
  const heroImageUrl = pbFileUrl('workshops', workshop.id, workshop.image, '800x450');

  let startups: Array<{ id: string; name: string }> = [];
  let recentAssignments: WorkshopAssignment[] = [];
  if (isStaff) {
    try {
      startups = (
        await pb.collection('startups').getList<{ id: string; name: string }>(1, 200, {
          filter: `tenant = "${user.tenant}" && status = "active"`,
          sort: 'name',
          fields: 'id,name'
        })
      ).items;
    } catch {
      startups = [];
    }
  }

  try {
    recentAssignments = (
      await pb.collection(PB_COLLECTIONS.workshopAssignments).getList<WorkshopAssignment>(1, 10, {
        filter: `tenant = "${user.tenant}" && workshop = "${id}"`,
        sort: '-created',
        expand: 'startup'
      })
    ).items;
  } catch {
    recentAssignments = [];
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/education" className="text-sm text-foreground-muted hover:text-foreground">
          ← Utbildning
        </Link>
      </div>

      <header className="mb-8 overflow-hidden rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        {heroImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroImageUrl}
            alt=""
            className="-mx-6 -mt-6 mb-5 aspect-[3/1] w-[calc(100%+3rem)] max-w-none object-cover"
          />
        ) : null}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <WorkshopStatusBadge status={workshop.status} />
            <span className="text-xs text-foreground-subtle">Version {workshop.version}</span>
          </div>
          {isStaff ? (
            <div className="flex items-center gap-2">
              <Link
                href={`/education/workshops/${id}/edit`}
                className="inline-flex items-center justify-center rounded-full border border-default bg-surface px-4 py-1.5 text-xs font-semibold text-foreground-muted transition hover:bg-canvas-subtle"
              >
                Redigera
              </Link>
              <ConfirmDeleteButton
                action={deleteWorkshopFormAction}
                hiddenField={{ name: 'workshop_id', value: id }}
                label="Radera"
                variant="ghost"
                description={`Radera "${workshop.title}"? Alla tilldelningar försvinner.`}
              />
            </div>
          ) : null}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{workshop.title}</h1>
        {workshop.goal ? <p className="mt-3 text-sm text-foreground-muted">{workshop.goal}</p> : null}
        {workshop.instructions ? (
          <div className="mt-4 rounded-2xl border border-default bg-canvas-subtle/40 p-4 text-sm text-foreground-muted">
            {workshop.instructions}
          </div>
        ) : null}
        <p className="mt-3 text-xs text-foreground-subtle">
          {modules.length} modul{modules.length !== 1 ? 'er' : ''} · {totalBlocks} block
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-3xl border border-default bg-surface p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">Workshopmoment</h2>
            {modules.length === 0 ? (
              <p className="text-sm text-foreground-subtle">Inga moduler definierade.</p>
            ) : (
              <div className="space-y-5">
                {modules.map((mod, modIdx) => (
                  <div key={mod.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                        {modIdx + 1}
                      </span>
                      <h3 className="font-semibold text-foreground">{mod.title}</h3>
                      {mod.description ? (
                        <span className="text-xs text-foreground-subtle">— {mod.description}</span>
                      ) : null}
                    </div>
                    {mod.blocks.length === 0 ? (
                      <p className="ml-8 text-sm text-foreground-subtle">Inga block.</p>
                    ) : (
                      <ol className="ml-8 space-y-2">
                        {mod.blocks.map((block, blockIdx) => (
                          <li key={block.id} className="rounded-2xl border border-default p-3">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <span className="text-xs text-foreground-subtle">
                                {modIdx + 1}.{blockIdx + 1}
                              </span>
                              <span className="text-sm">
                                {BLOCK_TYPE_EMOJIS[block.type] ?? '▪️'}
                              </span>
                              <span className="inline-flex rounded-full bg-movexum-pastell-bla px-2 py-0.5 text-xs font-medium text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla">
                                {block.type}
                              </span>
                              {block.required ? (
                                <span className="text-xs text-movexum-morkorange">obligatorisk</span>
                              ) : null}
                            </div>
                            <p className="font-medium text-foreground">{block.title}</p>
                            {block.instructions ? (
                              <p className="mt-0.5 text-sm text-foreground-muted line-clamp-2">
                                {block.instructions}
                              </p>
                            ) : null}
                            {block.desired_result ? (
                              <p className="mt-0.5 text-xs text-foreground-subtle">
                                Mål: {block.desired_result}
                              </p>
                            ) : null}
                            {block.video_url ? (
                              <a
                                href={block.video_url}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-1 inline-flex text-xs font-medium text-link hover:underline"
                              >
                                Öppna video →
                              </a>
                            ) : null}
                            {block.type === 'test' && (block.options ?? []).length > 0 ? (
                              <ul className="mt-1 space-y-0.5">
                                {(block.options ?? []).map((opt) => (
                                  <li key={opt.id} className="flex items-center gap-1.5 text-xs text-foreground-muted">
                                    <span>{opt.isCorrect ? '✓' : '○'}</span>
                                    {opt.text}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {recentAssignments.length > 0 ? (
            <section className="rounded-3xl border border-default bg-surface p-6">
              <h2 className="mb-4 text-lg font-semibold text-foreground">Senaste tilldelningar</h2>
              <ul className="space-y-3">
                {recentAssignments.map((assignment) => (
                  <li key={assignment.id}>
                    <Link
                      href={`/education/assignments/${assignment.id}`}
                      className="flex items-center justify-between rounded-2xl border border-default p-4 transition hover:bg-canvas-subtle"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {assignment.expand?.startup?.name ?? 'Bolag'}
                        </p>
                        <p className="text-xs text-foreground-subtle">
                          {new Date(assignment.created).toLocaleString('sv-SE')}
                        </p>
                      </div>
                      <span className="text-xs font-medium text-foreground-muted">{assignment.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-default bg-surface p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">AI-inställning</h3>
            <p className="text-xs text-foreground-muted">
              {workshop.ai_system_prompt || 'Ingen systemprompt satt.'}
            </p>
          </div>
          {isStaff ? <WorkshopAssignForm workshopId={id} startups={startups} /> : null}
        </aside>
      </div>
    </main>
  );
}
