import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { WorkshopAssignForm } from '../../WorkshopAssignForm';
import { WorkshopStatusBadge } from '@/components/Badges';
import type { Workshop, WorkshopAssignment, WorkshopBlock, WorkshopModule } from '@platform/shared';

const BLOCK_TYPE_LABELS: Record<string, string> = {
  question: 'Fråga',
  exercise: 'Övning',
  instruction: 'Instruktion',
  video: 'Film',
  image: 'Bild',
  ai_chat: 'AI-chatt',
  ai_pipeline: 'AI-pipeline',
  coach_review: 'Coach-granskning',
  commit_document: 'Commit dokument',
  test: 'Quiz',
  summary: 'Sammanfattning'
};

const BLOCK_TYPE_COLORS: Record<string, string> = {
  question:
    'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
  exercise:
    'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  instruction: 'bg-canvas-subtle text-foreground-muted',
  video:
    'bg-movexum-pastell-bla text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla',
  image:
    'bg-movexum-pastell-bla text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla',
  ai_chat:
    'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
  ai_pipeline:
    'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
  coach_review:
    'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  commit_document:
    'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  test:
    'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  summary: 'bg-canvas-subtle text-foreground-muted'
};

const BLOCK_TYPE_ICONS: Record<string, string> = {
  question: '?',
  exercise: 'EX',
  instruction: 'IN',
  video: '▶',
  image: '⬛',
  ai_chat: 'AI',
  ai_pipeline: 'PI',
  coach_review: 'CR',
  commit_document: 'CM',
  test: 'Q',
  summary: '∑'
};

function BlockTypePill({ type }: { type: string }) {
  const colorClass =
    BLOCK_TYPE_COLORS[type] ?? 'bg-canvas-subtle text-foreground-muted';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${colorClass}`}
    >
      <span className="font-mono text-[10px]">{BLOCK_TYPE_ICONS[type] ?? '▪'}</span>
      {BLOCK_TYPE_LABELS[type] ?? type}
    </span>
  );
}

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
        ? [{ id: 'main', title: 'Workshop', blocks: rawBlocks }]
        : [];

  const totalBlocks = modules.reduce((acc, m) => acc + m.blocks.length, 0);

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
      await pb
        .collection(PB_COLLECTIONS.workshopAssignments)
        .getList<WorkshopAssignment>(1, 10, {
          filter: `tenant = "${user.tenant}" && workshop = "${id}"`,
          sort: '-created',
          expand: 'startup'
        })
    ).items;
  } catch {
    recentAssignments = [];
  }

  const statusDot =
    workshop.status === 'active'
      ? 'bg-movexum-gron'
      : workshop.status === 'archived'
        ? 'bg-movexum-orange'
        : 'bg-foreground-subtle';

  const updatedAt = new Date(workshop.updated).toLocaleDateString('sv-SE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 lg:px-8">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link href="/education" className="text-sm text-foreground-muted hover:text-foreground">
          ← Utbildning
        </Link>
      </div>

      {/* Hero header */}
      <header className="relative mb-8 overflow-hidden rounded-3xl border border-default bg-surface shadow-sm shadow-movexum-svart/5">
        {/* Top accent strip */}
        <div className="h-1 w-full bg-brand" />
        <div className="p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <WorkshopStatusBadge status={workshop.status} />
                <span className="inline-flex items-center gap-1.5 rounded-full bg-canvas-subtle px-2.5 py-0.5 text-xs text-foreground-subtle">
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
                  v{workshop.version}
                </span>
                {!workshop.active ? (
                  <span className="rounded-full bg-movexum-pastell-orange px-2.5 py-0.5 text-xs font-medium text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
                    Ej aktiv i katalogen
                  </span>
                ) : null}
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                {workshop.title}
              </h1>
              {workshop.goal ? (
                <p className="mt-2 text-base text-foreground-muted">{workshop.goal}</p>
              ) : null}
              {workshop.instructions ? (
                <div className="mt-4 rounded-2xl border border-default bg-canvas-subtle/50 p-4 text-sm text-foreground-muted">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                    Instruktioner
                  </p>
                  {workshop.instructions}
                </div>
              ) : null}
              {/* Stats row */}
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-foreground-subtle">
                <span>
                  <span className="font-semibold text-foreground">{modules.length}</span>
                  {' '}modul{modules.length !== 1 ? 'er' : ''}
                </span>
                <span>·</span>
                <span>
                  <span className="font-semibold text-foreground">{totalBlocks}</span>
                  {' '}block
                </span>
                <span>·</span>
                <span>Uppdaterad {updatedAt}</span>
              </div>
            </div>

            {/* Edit button */}
            {isStaff ? (
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/education/workshops/${id}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-canvas-subtle"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                  </svg>
                  Redigera
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Modules & blocks */}
          <section className="rounded-3xl border border-default bg-surface shadow-sm shadow-movexum-svart/5">
            <div className="border-b border-default px-6 py-4">
              <h2 className="text-base font-semibold text-foreground">Workshopmoment</h2>
            </div>
            <div className="p-6">
              {modules.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <span className="text-3xl">📭</span>
                  <p className="text-sm text-foreground-subtle">Inga moduler definierade ännu.</p>
                  {isStaff ? (
                    <Link
                      href={`/education/workshops/${id}/edit`}
                      className="mt-2 text-sm font-medium text-link hover:underline"
                    >
                      Lägg till moduler →
                    </Link>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-6">
                  {modules.map((mod, modIdx) => (
                    <div key={mod.id}>
                      {/* Module header */}
                      <div className="mb-3 flex items-center gap-3">
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground shadow-sm">
                          {modIdx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-foreground">{mod.title}</h3>
                          {mod.description ? (
                            <p className="text-xs text-foreground-subtle">{mod.description}</p>
                          ) : null}
                        </div>
                        <span className="shrink-0 text-xs text-foreground-subtle">
                          {mod.blocks.length} block
                        </span>
                      </div>

                      {mod.blocks.length === 0 ? (
                        <p className="ml-10 text-sm text-foreground-subtle">Inga block.</p>
                      ) : (
                        <ol className="ml-10 space-y-2.5">
                          {mod.blocks.map((block, blockIdx) => (
                            <li
                              key={block.id}
                              className="rounded-2xl border border-default bg-canvas-subtle/40 p-4 transition hover:border-brand/30 hover:bg-canvas-subtle"
                            >
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="tabular-nums text-xs text-foreground-subtle">
                                  {modIdx + 1}.{blockIdx + 1}
                                </span>
                                <BlockTypePill type={block.type} />
                                {block.required ? (
                                  <span className="rounded-full bg-movexum-pastell-orange px-2 py-0.5 text-xs font-medium text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange">
                                    obligatorisk
                                  </span>
                                ) : null}
                              </div>
                              <p className="font-medium text-foreground">{block.title}</p>
                              {block.instructions ? (
                                <p className="mt-1 text-sm text-foreground-muted line-clamp-2">
                                  {block.instructions}
                                </p>
                              ) : null}
                              {block.desired_result ? (
                                <p className="mt-1 text-xs text-foreground-subtle">
                                  <span className="font-medium">Mål:</span> {block.desired_result}
                                </p>
                              ) : null}
                              {block.video_url ? (
                                <a
                                  href={block.video_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-link hover:underline"
                                >
                                  ▶ Öppna video
                                </a>
                              ) : null}
                              {block.type === 'test' && (block.options ?? []).length > 0 ? (
                                <ul className="mt-2 space-y-1">
                                  {(block.options ?? []).map((opt) => (
                                    <li
                                      key={opt.id}
                                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${
                                        opt.isCorrect
                                          ? 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
                                          : 'text-foreground-muted'
                                      }`}
                                    >
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
            </div>
          </section>

          {/* Recent assignments */}
          {recentAssignments.length > 0 ? (
            <section className="rounded-3xl border border-default bg-surface shadow-sm shadow-movexum-svart/5">
              <div className="border-b border-default px-6 py-4">
                <h2 className="text-base font-semibold text-foreground">
                  Senaste tilldelningar
                </h2>
              </div>
              <ul className="divide-y divide-default">
                {recentAssignments.map((assignment) => {
                  const statusColors: Record<string, string> = {
                    planned:
                      'bg-movexum-pastell-bla text-movexum-morkbla dark:bg-movexum-morkbla/60 dark:text-movexum-pastell-bla',
                    in_progress:
                      'bg-movexum-pastell-lila text-movexum-morklila dark:bg-movexum-morklila/40 dark:text-movexum-pastell-lila',
                    done:
                      'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
                  };
                  const statusLabels: Record<string, string> = {
                    planned: 'Planerad',
                    in_progress: 'Pågår',
                    done: 'Klar'
                  };
                  return (
                    <li key={assignment.id}>
                      <Link
                        href={`/education/assignments/${assignment.id}`}
                        className="flex items-center justify-between px-6 py-4 transition hover:bg-canvas-subtle"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {assignment.expand?.startup?.name ?? 'Bolag'}
                          </p>
                          <p className="text-xs text-foreground-subtle">
                            {new Date(assignment.created).toLocaleDateString('sv-SE')}
                          </p>
                        </div>
                        <span
                          className={`ml-4 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[assignment.status] ?? 'bg-canvas-subtle text-foreground-muted'}`}
                        >
                          {statusLabels[assignment.status] ?? assignment.status}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          {/* AI settings card */}
          <div className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
            <div className="mb-3 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-movexum-pastell-lila text-sm dark:bg-movexum-morklila/40">
                🤖
              </span>
              <h3 className="text-sm font-semibold text-foreground">AI-inställning</h3>
            </div>
            <p className="text-xs leading-relaxed text-foreground-muted">
              {workshop.ai_system_prompt || 'Ingen systemprompt satt.'}
            </p>
          </div>

          {/* Metadata card */}
          <div className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Detaljer</h3>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-foreground-subtle">Nyckel</dt>
                <dd className="font-mono text-foreground-muted">{workshop.key}</dd>
              </div>
              {(workshop.audience_roles ?? []).length > 0 ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-foreground-subtle">Målgrupp</dt>
                  <dd className="text-right text-foreground-muted">
                    {workshop.audience_roles.join(', ')}
                  </dd>
                </div>
              ) : null}
              {workshop.output_requirements ? (
                <div className="flex flex-col gap-1">
                  <dt className="text-foreground-subtle">Outputkrav</dt>
                  <dd className="text-foreground-muted">{workshop.output_requirements}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-2">
                <dt className="text-foreground-subtle">Skapad</dt>
                <dd className="text-foreground-muted">
                  {new Date(workshop.created).toLocaleDateString('sv-SE')}
                </dd>
              </div>
            </dl>
          </div>

          {/* Assign form */}
          {isStaff ? <WorkshopAssignForm workshopId={id} startups={startups} /> : null}
        </aside>
      </div>
    </main>
  );
}
