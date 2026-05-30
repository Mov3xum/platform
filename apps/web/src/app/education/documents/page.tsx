import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { pbFileUrl } from '@/lib/pb-file';
import { Icon, Chip } from '@/components/proto';
import { PageShell } from '@/components/PageShell';
import { EDUCATION_TABS } from '../tabs';
import { DocumentUploadForm } from './DocumentUploadForm';
import { DocumentAssignForm } from './DocumentAssignForm';
import { DocumentCompleteButton } from './DocumentCompleteButton';
import { DocumentDeleteButton } from './DocumentDeleteButton';
import { listAssignableResourcesForTenant, type AssignableResource } from '@/lib/assignments/collaboration';
import { educationDocumentKindLabels } from '@platform/shared';
import type { EducationDocument, EducationDocumentAssignment } from '@platform/shared';

export default async function EducationDocumentsPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'education', user.disabledModules)) redirect('/chatt');
  const pb = await getServerPb();
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  const isStartupMember = hasRole(user.roles, ['startup_member']);

  let documents: EducationDocument[] = [];
  let assignments: EducationDocumentAssignment[] = [];
  let startups: Array<{ id: string; name: string }> = [];
  let resources: AssignableResource[] = [];

  try {
    documents = (
      await pb.collection(PB_COLLECTIONS.educationDocuments).getList<EducationDocument>(1, 200, {
        filter: `tenant = "${user.tenant}"`,
        sort: '-created'
      })
    ).items;
  } catch (error) {
    console.error('[education/documents] failed to load documents', { tenant: user.tenant, error });
  }

  try {
    const linkedFilter =
      isStartupMember && !isStaff && user.linkedStartups.length > 0
        ? ` && (${user.linkedStartups.map((id) => `startup = "${id}"`).join(' || ')})`
        : '';
    assignments = (
      await pb
        .collection(PB_COLLECTIONS.educationDocumentAssignments)
        .getList<EducationDocumentAssignment>(1, 500, {
          filter: `tenant = "${user.tenant}"${linkedFilter}`,
          sort: '-created',
          expand: 'document,startup,completed_by'
        })
    ).items;
  } catch (error) {
    console.error('[education/documents] failed to load assignments', { tenant: user.tenant, error });
  }

  if (isStaff) {
    try {
      startups = (
        await pb.collection('startups').getList<{ id: string; name: string }>(1, 300, {
          filter: `tenant = "${user.tenant}"`,
          sort: 'name',
          fields: 'id,name'
        })
      ).items;
    } catch (error) {
      console.error('[education/documents] failed to load startups', { tenant: user.tenant, error });
    }
    resources = await listAssignableResourcesForTenant(pb, user.tenant);
  }

  const assignmentsByDocument = new Map<string, EducationDocumentAssignment[]>();
  for (const a of assignments) {
    const docId = String(a.document);
    if (!assignmentsByDocument.has(docId)) assignmentsByDocument.set(docId, []);
    assignmentsByDocument.get(docId)?.push(a);
  }

  // ── Member-vy: bara tilldelade dokument med slutför-knapp ──────────────────
  if (!isStaff) {
    return (
      <PageShell title="Utbildningsdokument">
        <div className="space-y-4 py-6">
          {assignments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-default p-12 text-center text-[13px] text-foreground-muted">
              Inga tilldelade dokument ännu.
            </div>
          ) : (
            assignments.map((a) => {
              const doc = a.expand?.document;
              const fileUrl = doc ? pbFileUrl('education_documents', doc.id, doc.file) : null;
              const completed = a.status === 'completed';
              return (
                <div
                  key={a.id}
                  className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      {completed ? (
                        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                          <Icon name="check" size={26} stroke={2.4} />
                        </span>
                      ) : (
                        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-canvas-muted text-foreground-subtle">
                          <Icon name="doc" size={22} />
                        </span>
                      )}
                      <div>
                        <h3 className="text-base font-semibold text-foreground">
                          {doc?.title || 'Dokument'}
                        </h3>
                        {doc ? (
                          <Chip mono>{educationDocumentKindLabels[doc.doc_kind] || 'Dokument'}</Chip>
                        ) : null}
                        {a.instructions ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground-muted">
                            {a.instructions}
                          </p>
                        ) : null}
                        {a.due_date ? (
                          <p className="mt-1 text-xs text-foreground-subtle">
                            Deadline: {new Date(a.due_date).toLocaleDateString('sv-SE')}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <DocumentCompleteButton assignmentId={a.id} completed={completed} />
                  </div>
                  {fileUrl ? (
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-sm font-medium text-link transition hover:bg-canvas-subtle"
                    >
                      <Icon name="download" size={14} /> Ladda ner
                    </a>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </PageShell>
    );
  }

  // ── Staff-vy: ladda upp, tilldela, hantera ─────────────────────────────────
  return (
    <PageShell title="Utbildning" tabs={EDUCATION_TABS}>
      <div className="grid gap-6 py-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <DocumentUploadForm />
        </div>

        <div className="space-y-4">
          {documents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-default p-12 text-center text-[13px] text-foreground-muted">
              Inga dokument uppladdade ännu.
            </div>
          ) : (
            documents.map((doc) => {
              const fileUrl = pbFileUrl('education_documents', doc.id, doc.file);
              const docAssignments = assignmentsByDocument.get(doc.id) || [];
              return (
                <div
                  key={doc.id}
                  className="rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-canvas-muted text-foreground-subtle">
                        <Icon name="doc" size={20} />
                      </span>
                      <div>
                        <h3 className="text-base font-semibold text-foreground">{doc.title}</h3>
                        <div className="mt-1 flex items-center gap-2">
                          <Chip mono>{educationDocumentKindLabels[doc.doc_kind] || 'Dokument'}</Chip>
                          {fileUrl ? (
                            <a
                              href={fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-medium text-link hover:underline"
                            >
                              <Icon name="download" size={12} /> Ladda ner
                            </a>
                          ) : null}
                        </div>
                        {doc.description ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground-muted">
                            {doc.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <DocumentDeleteButton
                      id={doc.id}
                      kind="document"
                      label="Ta bort dokument"
                      confirmText="Ta bort dokumentet och alla dess tilldelningar? Detta går inte att ångra."
                    />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                        Tilldelningar ({docAssignments.length})
                      </p>
                      {docAssignments.length === 0 ? (
                        <p className="text-sm text-foreground-subtle">Inte tilldelad något bolag än.</p>
                      ) : (
                        <ul className="space-y-2">
                          {docAssignments.map((a) => {
                            const completed = a.status === 'completed';
                            return (
                              <li
                                key={a.id}
                                className="rounded-xl border border-default p-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    {completed ? (
                                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                                        <Icon name="check" size={16} stroke={2.4} />
                                      </span>
                                    ) : (
                                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas-muted text-foreground-subtle">
                                        <Icon name="clock" size={14} />
                                      </span>
                                    )}
                                    <div>
                                      <p className="text-sm font-medium text-foreground">
                                        {a.expand?.startup?.name || 'Bolag'}
                                      </p>
                                      {a.due_date ? (
                                        <p className="text-xs text-foreground-subtle">
                                          Deadline:{' '}
                                          {new Date(a.due_date).toLocaleDateString('sv-SE')}
                                        </p>
                                      ) : null}
                                      {completed && a.completed_at ? (
                                        <p className="text-xs text-movexum-morkgron dark:text-movexum-gron">
                                          Slutförd{' '}
                                          {new Date(a.completed_at).toLocaleDateString('sv-SE')}
                                        </p>
                                      ) : null}
                                    </div>
                                  </div>
                                  <DocumentCompleteButton
                                    assignmentId={a.id}
                                    completed={completed}
                                    canReopen
                                  />
                                </div>
                                {a.instructions ? (
                                  <p className="mt-2 whitespace-pre-wrap text-xs text-foreground-muted">
                                    {a.instructions}
                                  </p>
                                ) : null}
                                <div className="mt-2">
                                  <DocumentDeleteButton id={a.id} kind="assignment" label="Ta bort tilldelning" />
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <DocumentAssignForm documentId={doc.id} startups={startups} resources={resources} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </PageShell>
  );
}
