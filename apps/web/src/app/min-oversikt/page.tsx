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
  PhaseBadge,
  StatusBadge,
  ToolCategoryBadge
} from '@/components/Badges';
import type { StartupStatus } from '@/lib/labels';
import { canManageStartupDeMinimis } from '@/lib/de-minimis/data';
import { DeMinimisSection } from '@/app/startups/[id]/DeMinimisSection';
import { DocumentCompleteButton } from '@/app/education/documents/DocumentCompleteButton';
import {
  educationDocumentKindLabels,
  isPureStartupMember,
  type EducationDocumentAssignment,
  type StartupPhase,
  type Tool
} from '@platform/shared';

export const dynamic = 'force-dynamic';

interface StartupRecord {
  id: string;
  tenant: string;
  name: string;
  phase: StartupPhase;
  status: StartupStatus;
  irl_level?: number;
  next_step?: string;
}

type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Öppen',
  in_progress: 'Pågår',
  blocked: 'Blockerad',
  done: 'Klar',
  cancelled: 'Avbruten'
};

interface TaskRecord {
  id: string;
  kind: string;
  description: string;
  starts_at?: string;
  due_at?: string;
  status: TaskStatus;
}

function stripHtml(value?: string): string {
  return (value || '').replace(/<[^>]+>/g, '').trim();
}

function Card({
  title,
  action,
  children
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-default bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
        {action}
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

export default async function MinOversiktPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'min_oversikt', user.disabledModules)) {
    redirect('/chatt');
  }

  const isStaff = hasRole(user.roles, [
    'admin',
    'incubator_lead',
    'coach',
    'mentor',
    'observer'
  ]);
  // Ren bolagsmedlem får en program-fokuserad "Min översikt"; staff behåller
  // den bredare "Mitt bolag"-vyn med tilldelade verktyg/dokument inline.
  const isPureMember = isPureStartupMember(user.roles);
  const pageTitle = isPureMember ? 'Min översikt' : 'Mitt bolag';
  const linkedId = user.linkedStartups[0];

  if (!linkedId) {
    if (isStaff) redirect('/startups');
    return (
      <PageShell title={pageTitle}>
        <div className="py-6">
          <Empty>
            Ditt konto är inte kopplat till något bolag än — kontakta Movexum.
          </Empty>
        </div>
      </PageShell>
    );
  }

  const pb = await getServerPb();

  let startup: StartupRecord | null = null;
  try {
    startup = await pb.collection('startups').getOne<StartupRecord>(linkedId);
    if (String(startup.tenant) !== user.tenant) startup = null;
  } catch {
    startup = null;
  }

  if (!startup) {
    return (
      <PageShell title={pageTitle}>
        <div className="py-6">
          <div className="rounded-3xl border border-default bg-surface p-6 text-sm text-foreground-muted">
            Kunde inte ladda ditt bolag just nu. Försök igen eller kontakta Movexum.
          </div>
        </div>
      </PageShell>
    );
  }

  const canManageDeMinimis = canManageStartupDeMinimis(user, linkedId);
  const canManageDocs = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const isLinkedMember =
    hasRole(user.roles, ['startup_member']) && user.linkedStartups.includes(linkedId);
  const canCompleteDocs = canManageDocs || isLinkedMember;

  // Tilldelade verktyg + dokument visas inline för staff ("Mitt bolag"); för
  // bolagsmedlemmar bor de under "Aktiviteter" → hämta dem inte här.
  let tools: Tool[] = [];
  let documentAssignments: EducationDocumentAssignment[] = [];
  if (!isPureMember) {
    try {
      const res = await pb.collection('tools').getList<Tool>(1, 200, {
        filter: `tenant = "${escFilter(user.tenant)}" && active = true`,
        sort: 'category,name'
      });
      tools = res.items.filter((tool) =>
        canRunTool(user.roles, tool, { isLinkedStartup: true })
      );
    } catch (error) {
      console.error('[min-oversikt] failed to load tools', { startupId: linkedId, error });
    }

    try {
      const res = await pb
        .collection(PB_COLLECTIONS.educationDocumentAssignments)
        .getList<EducationDocumentAssignment>(1, 100, {
          filter: `tenant = "${escFilter(user.tenant)}" && startup = "${escFilter(linkedId)}"`,
          sort: '-created',
          expand: 'document'
        });
      documentAssignments = res.items;
    } catch (error) {
      console.error('[min-oversikt] failed to load document assignments', {
        startupId: linkedId,
        error
      });
    }
  }

  // Egna + bolagets öppna uppgifter (ej klara/avbrutna).
  let tasks: TaskRecord[] = [];
  try {
    const res = await pb.collection('tasks').getList<TaskRecord>(1, 50, {
      filter:
        `tenant = "${escFilter(user.tenant)}" && ` +
        `(owner = "${escFilter(user.id)}" || startup = "${escFilter(linkedId)}") && ` +
        `status != "done" && status != "cancelled"`,
      sort: '-starts_at'
    });
    tasks = res.items;
  } catch (error) {
    console.error('[min-oversikt] failed to load tasks', { startupId: linkedId, error });
  }

  return (
    <PageShell title={pageTitle}>
      <div className="space-y-6 py-6">
        {/* Bolagsheader */}
        <section className="rounded-3xl border border-default bg-surface p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-heading text-2xl font-semibold text-foreground">{startup.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <PhaseBadge phase={startup.phase} />
                <StatusBadge status={startup.status} />
                {typeof startup.irl_level === 'number' ? (
                  <span className="inline-flex items-center rounded-full border border-default bg-canvas-subtle px-2.5 py-1 text-xs font-medium text-foreground-muted">
                    IRL {startup.irl_level}
                  </span>
                ) : null}
              </div>
              {startup.next_step ? (
                <p className="mt-3 text-sm text-foreground-muted">
                  <span className="font-semibold text-foreground">Nästa steg:</span>{' '}
                  {startup.next_step}
                </p>
              ) : null}
            </div>
            <Link
              href={`/startups/${linkedId}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              Öppna bolagskortet <Icon name="external" size={14} />
            </Link>
          </div>
        </section>

        {/* Om inkubatorprogrammet — bara för bolagsmedlemmar. */}
        {isPureMember ? (
          <section className="rounded-3xl border border-default bg-gradient-to-br from-movexum-pastell-bla/50 to-surface p-6 dark:from-brand/10">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground">
                <Icon name="cap" size={22} />
              </span>
              <div className="space-y-3">
                <div>
                  <h2 className="font-heading text-lg font-semibold text-foreground">
                    Välkommen till Movexums inkubatorprogram
                  </h2>
                  <p className="mt-1 text-sm text-foreground-muted">
                    Movexum är Gävleborgs företagsinkubator. Under inkubatorstiden får ni
                    coachning, workshops, utbildningar och tillgång till nätverk, kapital och
                    expertis — allt samlat här på plattformen. Den här sidan är er hemvy för
                    allt som rör ert bolag under resan.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Link
                    href="/mina-aktiviteter"
                    className="flex items-center gap-2 rounded-2xl border border-default bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-canvas-subtle"
                  >
                    <Icon name="flow" size={16} /> Aktiviteter
                  </Link>
                  <Link
                    href="/de-minimis"
                    className="flex items-center gap-2 rounded-2xl border border-default bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-canvas-subtle"
                  >
                    <Icon name="shield" size={16} /> De minimis
                  </Link>
                  <Link
                    href="/filer"
                    className="flex items-center gap-2 rounded-2xl border border-default bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-canvas-subtle"
                  >
                    <Icon name="doc" size={16} /> Filer & avtal
                  </Link>
                </div>
                <p className="text-xs text-foreground-subtle">
                  Frågor om programmet? Hör av dig till din Movexum-coach.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {/* De minimis */}
        <Card
          title="De minimis-status"
          action={
            <Link
              href={`/startups/${linkedId}#de-minimis`}
              className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
            >
              På bolagskortet <Icon name="external" size={14} />
            </Link>
          }
        >
          <DeMinimisSection
            startupId={linkedId}
            startupName={startup.name}
            canManage={canManageDeMinimis}
          />
        </Card>

        {/* Tilldelade verktyg — för bolagsmedlemmar samlat under "Aktiviteter". */}
        {!isPureMember ? (
        <Card title="Tilldelade verktyg">
          {tools.length === 0 ? (
            <Empty>Inga verktyg är tillgängliga för ditt bolag än.</Empty>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {tools.map((tool) => (
                <li
                  key={tool.id}
                  className="rounded-2xl border border-default bg-canvas-subtle p-4"
                >
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
                    href={`/toolbox/${tool.id}?startup=${linkedId}`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-link hover:underline"
                  >
                    Öppna verktyg <Icon name="external" size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        ) : null}

        {/* Tilldelade utbildningsdokument — för medlemmar samlat under "Aktiviteter". */}
        {!isPureMember ? (
        <Card title="Tilldelade utbildningsdokument">
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
                        {completed ? (
                          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                            <Icon name="check" size={26} stroke={2.4} />
                          </span>
                        ) : (
                          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-canvas-muted text-foreground-subtle">
                            <Icon name="doc" size={20} />
                          </span>
                        )}
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
        ) : null}

        {/* Mina uppgifter */}
        <Card title="Mina uppgifter">
          {tasks.length === 0 ? (
            <Empty>Inga öppna uppgifter just nu.</Empty>
          ) : (
            <ul className="divide-y divide-default">
              {tasks.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">{task.description}</p>
                    <p className="text-xs text-foreground-subtle">
                      {task.kind}
                      {task.due_at ? ` · Förfaller ${new Date(task.due_at).toLocaleDateString('sv-SE')}` : ''}
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full border border-default bg-canvas-subtle px-2.5 py-1 text-xs font-medium text-foreground-muted">
                    {TASK_STATUS_LABELS[task.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
