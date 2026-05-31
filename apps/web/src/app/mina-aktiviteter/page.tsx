import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole, canRunTool } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { escFilter } from '@/lib/pb-filter';
import { pbFileUrl } from '@/lib/pb-file';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto/Icon';
import {
  WorkshopAssignmentStatusBadge,
  ToolCategoryBadge
} from '@/components/Badges';
import { DocumentCompleteButton } from '@/app/education/documents/DocumentCompleteButton';
import {
  educationDocumentKindLabels,
  isPureStartupMember,
  type EducationDocumentAssignment,
  type Tool,
  type WorkshopAssignment
} from '@platform/shared';

export const dynamic = 'force-dynamic';

interface StartupRecord {
  id: string;
  tenant: string;
  name: string;
}

function stripHtml(value?: string): string {
  return (value || '').replace(/<[^>]+>/g, '').trim();
}

function Card({
  title,
  count,
  children
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-default bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
        {typeof count === 'number' ? (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-canvas-muted px-2 py-0.5 text-xs font-semibold text-foreground-muted">
            {count}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">
      {children}
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="mb-2 flex items-end justify-between">
        <span className="text-sm font-medium text-foreground-muted">
          {done} av {total} aktiviteter slutförda
        </span>
        <span className="font-heading text-2xl font-semibold text-foreground">{pct}%</span>
      </div>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-canvas-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default async function MinaAktiviteterPage({
  searchParams
}: {
  searchParams: Promise<{ startup?: string }>;
}) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'mina_aktiviteter', user.disabledModules)) {
    redirect('/chatt');
  }

  const isMember = isPureStartupMember(user.roles);
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor', 'observer']);
  const { startup: startupParam } = await searchParams;

  // Bolagsmedlem ser sitt eget bolag; staff/coach kan granska ett specifikt
  // bolags progress via ?startup=<id> (länkas från bolagskortet/Pågående).
  const targetId = isMember ? user.linkedStartups[0] : startupParam;

  if (!targetId) {
    if (isStaff) redirect('/pagaende');
    return (
      <PageShell title="Aktiviteter">
        <div className="py-6">
          <Empty>Ditt konto är inte kopplat till något bolag än — kontakta Movexum.</Empty>
        </div>
      </PageShell>
    );
  }

  const pb = await getServerPb();

  let startup: StartupRecord | null = null;
  try {
    startup = await pb.collection('startups').getOne<StartupRecord>(targetId);
    if (String(startup.tenant) !== user.tenant) startup = null;
  } catch {
    startup = null;
  }

  if (!startup) {
    return (
      <PageShell title="Aktiviteter">
        <div className="py-6">
          <Empty>Kunde inte ladda bolaget just nu. Försök igen eller kontakta Movexum.</Empty>
        </div>
      </PageShell>
    );
  }

  const canManageDocs = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const isLinkedMember =
    hasRole(user.roles, ['startup_member']) && user.linkedStartups.includes(targetId);
  const canCompleteDocs = canManageDocs || isLinkedMember;
  // Staff som granskar ett annat bolag öppnar inte genomför-flöden.
  const canRunActivities = isLinkedMember;

  // Tilldelade workshops.
  let workshops: WorkshopAssignment[] = [];
  try {
    const res = await pb
      .collection(PB_COLLECTIONS.workshopAssignments)
      .getList<WorkshopAssignment>(1, 100, {
        filter: `tenant = "${escFilter(user.tenant)}" && startup = "${escFilter(targetId)}"`,
        sort: '-created',
        expand: 'workshop'
      });
    workshops = res.items;
  } catch (error) {
    console.error('[mina-aktiviteter] failed to load workshops', { startupId: targetId, error });
  }

  // Tilldelade utbildningsdokument.
  let documentAssignments: EducationDocumentAssignment[] = [];
  try {
    const res = await pb
      .collection(PB_COLLECTIONS.educationDocumentAssignments)
      .getList<EducationDocumentAssignment>(1, 100, {
        filter: `tenant = "${escFilter(user.tenant)}" && startup = "${escFilter(targetId)}"`,
        sort: '-created',
        expand: 'document'
      });
    documentAssignments = res.items;
  } catch (error) {
    console.error('[mina-aktiviteter] failed to load document assignments', {
      startupId: targetId,
      error
    });
  }

  // Tilldelade verktyg — körbara för bolaget.
  let tools: Tool[] = [];
  try {
    const res = await pb.collection('tools').getList<Tool>(1, 200, {
      filter: `tenant = "${escFilter(user.tenant)}" && active = true`,
      sort: 'category,name'
    });
    // canRunTool utvärderas mot bolaget oavsett vem som tittar (staff ser
    // vilka verktyg bolaget har tillgång till).
    tools = res.items.filter((tool) => canRunTool(['startup_member'], tool, { isLinkedStartup: true }));
  } catch (error) {
    console.error('[mina-aktiviteter] failed to load tools', { startupId: targetId, error });
  }

  // Progress: bara workshops + dokument räknas (verktyg är öppningsbara, inte
  // "slutförbara" med ett status-fält).
  const total = workshops.length + documentAssignments.length;
  const done =
    workshops.filter((w) => w.status === 'done').length +
    documentAssignments.filter((d) => d.status === 'completed').length;

  return (
    <PageShell title="Aktiviteter">
      <div className="space-y-6 py-6">
        {/* Progressöversikt */}
        <section className="rounded-3xl border border-default bg-surface p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-heading text-2xl font-semibold text-foreground">
                {isMember ? 'Dina aktiviteter' : `Aktiviteter — ${startup.name}`}
              </h1>
              <p className="mt-1 text-sm text-foreground-muted">
                Workshops, dokument och verktyg som tilldelats bolaget under inkubatorprogrammet.
              </p>
            </div>
            {!isMember ? (
              <Link
                href={`/startups/${targetId}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
              >
                Bolagskortet <Icon name="external" size={14} />
              </Link>
            ) : null}
          </div>
          {total === 0 ? (
            <Empty>Inga aktiviteter tilldelade än. Movexum lägger till workshops och dokument efter hand.</Empty>
          ) : (
            <ProgressBar done={done} total={total} />
          )}
        </section>

        {/* Workshops */}
        <Card title="Workshops" count={workshops.length}>
          {workshops.length === 0 ? (
            <Empty>Inga tilldelade workshops än.</Empty>
          ) : (
            <ul className="space-y-3">
              {workshops.map((assignment) => {
                const workshop = assignment.expand?.workshop;
                const completed = assignment.status === 'done';
                return (
                  <li
                    key={assignment.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-default p-4"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${
                          completed
                            ? 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
                            : 'bg-canvas-muted text-foreground-subtle'
                        }`}
                      >
                        <Icon name={completed ? 'check' : 'cap'} size={completed ? 24 : 20} />
                      </span>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-heading text-sm font-semibold text-foreground">
                            {workshop?.title ?? 'Workshop'}
                          </h3>
                          <WorkshopAssignmentStatusBadge status={assignment.status} />
                        </div>
                        {assignment.instructions ? (
                          <p className="mt-1 text-xs text-foreground-muted">{assignment.instructions}</p>
                        ) : null}
                        {assignment.due_date ? (
                          <p className="mt-1 text-xs text-foreground-subtle">
                            Deadline {new Date(assignment.due_date).toLocaleDateString('sv-SE')}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <Link
                      href={`/education/assignments/${assignment.id}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-link transition hover:bg-canvas-subtle"
                    >
                      {canRunActivities ? (completed ? 'Visa' : 'Genomför') : 'Öppna'}{' '}
                      <Icon name="external" size={14} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Dokument */}
        <Card title="Dokument" count={documentAssignments.length}>
          {documentAssignments.length === 0 ? (
            <Empty>Inga tilldelade dokument än.</Empty>
          ) : (
            <ul className="space-y-3">
              {documentAssignments.map((assignment) => {
                const doc = assignment.expand?.document;
                const fileUrl = doc ? pbFileUrl('education_documents', doc.id, doc.file) : null;
                const completed = assignment.status === 'completed';
                return (
                  <li key={assignment.id} className="rounded-2xl border border-default p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span
                          className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${
                            completed
                              ? 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
                              : 'bg-canvas-muted text-foreground-subtle'
                          }`}
                        >
                          <Icon name={completed ? 'check' : 'doc'} size={completed ? 24 : 20} />
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-heading text-sm font-semibold text-foreground">
                              {doc?.title ?? 'Dokument'}
                            </h3>
                            {doc ? (
                              <span className="inline-flex items-center rounded-full border border-default bg-canvas-subtle px-2 py-0.5 text-[11px] font-medium text-foreground-muted">
                                {educationDocumentKindLabels[doc.doc_kind] ?? doc.doc_kind}
                              </span>
                            ) : null}
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                completed
                                  ? 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron'
                                  : 'bg-canvas-muted text-foreground-muted'
                              }`}
                            >
                              {completed ? 'Slutförd' : 'Tilldelad'}
                            </span>
                          </div>
                          {assignment.instructions ? (
                            <p className="mt-1 text-xs text-foreground-muted">{assignment.instructions}</p>
                          ) : null}
                          {fileUrl ? (
                            <a
                              href={fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-link hover:underline"
                            >
                              <Icon name="download" size={13} /> Ladda ner
                            </a>
                          ) : null}
                        </div>
                      </div>
                      {canCompleteDocs ? (
                        <DocumentCompleteButton
                          assignmentId={assignment.id}
                          completed={completed}
                          canReopen={canManageDocs}
                        />
                      ) : completed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-movexum-morkgron dark:text-movexum-gron">
                          Slutförd
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Verktyg */}
        <Card title="Verktyg" count={tools.length}>
          {tools.length === 0 ? (
            <Empty>Inga verktyg är tillgängliga för bolaget än.</Empty>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {tools.map((tool) => (
                <li key={tool.id} className="rounded-2xl border border-default bg-canvas-subtle p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="font-heading text-sm font-semibold text-foreground">{tool.name}</h3>
                    <ToolCategoryBadge category={tool.category} />
                  </div>
                  {stripHtml(tool.description) ? (
                    <p className="mb-3 line-clamp-2 text-xs text-foreground-muted">
                      {stripHtml(tool.description)}
                    </p>
                  ) : null}
                  <Link
                    href={`/toolbox/${tool.id}?startup=${targetId}`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-link hover:underline"
                  >
                    {canRunActivities ? 'Öppna & genomför' : 'Öppna verktyg'}{' '}
                    <Icon name="external" size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
