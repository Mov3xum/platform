import Link from 'next/link';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto/Icon';
import { listFilesAction } from '@/lib/actions/files';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { escFilter } from '@/lib/pb-filter';
import { pbFileUrl } from '@/lib/pb-file';
import {
  AGREEMENT_STATUS_LABELS,
  educationDocumentKindLabels,
  isPureStartupMember,
  type Agreement,
  type AgreementStatus,
  type EducationDocumentAssignment
} from '@platform/shared';
import FilesList from './FilesList';

export const dynamic = 'force-dynamic';

interface MemberAgreement {
  id: string;
  title: string;
  status: AgreementStatus;
  hasFile: boolean;
}

interface MemberDocument {
  id: string;
  title: string;
  kindLabel: string;
  url: string | null;
  completed: boolean;
}

async function loadMemberFiles(
  tenant: string,
  linkedStartups: string[]
): Promise<{ agreements: MemberAgreement[]; documents: MemberDocument[] }> {
  if (linkedStartups.length === 0) return { agreements: [], documents: [] };
  const pb = await getServerPb();
  const startupFilter = linkedStartups
    .map((id) => `startup = "${escFilter(id)}"`)
    .join(' || ');

  let agreements: MemberAgreement[] = [];
  try {
    const res = await pb.collection(PB_COLLECTIONS.agreements).getList<Agreement>(1, 100, {
      filter: `tenant = "${escFilter(tenant)}" && (${startupFilter})`,
      sort: '-created'
    });
    agreements = res.items.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      hasFile: Boolean(a.file)
    }));
  } catch (error) {
    console.error('[filer] failed to load agreements', { error });
  }

  let documents: MemberDocument[] = [];
  try {
    const res = await pb
      .collection(PB_COLLECTIONS.educationDocumentAssignments)
      .getList<EducationDocumentAssignment>(1, 100, {
        filter: `tenant = "${escFilter(tenant)}" && (${startupFilter})`,
        sort: '-created',
        expand: 'document'
      });
    documents = res.items
      .map((assignment) => {
        const doc = assignment.expand?.document;
        if (!doc) return null;
        return {
          id: assignment.id,
          title: doc.title,
          kindLabel: educationDocumentKindLabels[doc.doc_kind] ?? doc.doc_kind,
          url: pbFileUrl('education_documents', doc.id, doc.file),
          completed: assignment.status === 'completed'
        } satisfies MemberDocument;
      })
      .filter((d): d is MemberDocument => d !== null);
  } catch (error) {
    console.error('[filer] failed to load education documents', { error });
  }

  return { agreements, documents };
}

function FileRow({
  title,
  badge,
  href,
  external
}: {
  title: string;
  badge?: string;
  href: string | null;
  external?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-default p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-canvas-muted text-foreground-subtle">
          <Icon name="doc" size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          {badge ? <p className="text-xs text-foreground-subtle">{badge}</p> : null}
        </div>
      </div>
      {href ? (
        external ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-link hover:underline"
          >
            <Icon name="download" size={14} /> Öppna
          </a>
        ) : (
          <Link
            href={href}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-link hover:underline"
          >
            <Icon name="external" size={14} /> Öppna
          </Link>
        )
      ) : (
        <span className="text-xs text-foreground-subtle">Ingen fil</span>
      )}
    </li>
  );
}

export default async function FilerPage() {
  const user = await requireUser();
  const files = await listFilesAction();
  const isMember = isPureStartupMember(user.roles);

  const member = isMember
    ? await loadMemberFiles(user.tenant, user.linkedStartups)
    : { agreements: [], documents: [] };

  return (
    <PageShell title="Filer">
      <div className="space-y-6">
        {isMember ? (
          <>
            <section className="rounded-3xl border border-default bg-surface p-6">
              <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">Avtal</h2>
              {member.agreements.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">
                  Inga avtal kopplade till ditt bolag än.
                </div>
              ) : (
                <ul className="space-y-3">
                  {member.agreements.map((a) => (
                    <FileRow
                      key={a.id}
                      title={a.title}
                      badge={AGREEMENT_STATUS_LABELS[a.status]}
                      href={a.hasFile ? `/api/agreements/${a.id}/file` : null}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-3xl border border-default bg-surface p-6">
              <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
                Dokument från aktiviteter
              </h2>
              {member.documents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">
                  Inga dokument från workshops eller utbildningar än.
                </div>
              ) : (
                <ul className="space-y-3">
                  {member.documents.map((d) => (
                    <FileRow
                      key={d.id}
                      title={d.title}
                      badge={`${d.kindLabel}${d.completed ? ' · Slutförd' : ''}`}
                      href={d.url}
                      external
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-3xl border border-default bg-surface p-6">
              <h2 className="mb-4 font-heading text-lg font-semibold text-foreground">
                Dina filer
              </h2>
              <FilesList initialFiles={files} />
            </section>
          </>
        ) : (
          <FilesList initialFiles={files} />
        )}
      </div>
    </PageShell>
  );
}
