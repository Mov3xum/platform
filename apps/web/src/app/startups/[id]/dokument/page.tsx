import { hasRole } from '@/lib/rbac';
import { Icon } from '@/components/proto';
import { AgreementsSection, type AgreementView } from '@/components/intric/AgreementsSection';
import { DocumentCompleteButton } from '@/app/education/documents/DocumentCompleteButton';
import { pbFileUrl } from '@/lib/pb-file';
import type { AgreementKind, AgreementStatus } from '@/lib/labels';
import { educationDocumentKindLabels, formatStockholmDateTime } from '@platform/shared';
import { loadStartupPage } from '../_shared/context';
import { loadStartupAssignments } from '../_shared/work';
import { Empty, PillLink, Section, SectionNav, SignedRow, TabPage, formatDate } from '../_shared/ui';

interface AgreementRecord {
  id: string;
  title: string;
  kind: AgreementKind;
  status: AgreementStatus;
  expires_at?: string;
  file?: string;
  requires_company_signature?: boolean;
  requires_movexum_signature?: boolean;
  company_signed_at?: string;
  movexum_signed_at?: string;
  created: string;
}

/**
 * Flik "Avtal & dokument": avtal med in-app-signering (§ 19), status för
 * avtal och godkännanden på bolagskortet och tilldelade utbildningsdokument.
 */
export default async function StartupDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, startup, pb, flags } = await loadStartupPage(id);
  const canManageDocs = flags.isStaff;
  const canCompleteDocs = canManageDocs || flags.isLinkedMember;
  const agreementSignParty: 'company' | 'movexum' | null = canManageDocs ? 'movexum' : flags.isLinkedMember ? 'company' : null;

  const [agreements, work] = await Promise.all([
    pb
      .collection('agreements')
      .getList<AgreementRecord>(1, 50, { filter: pb.filter('startup = {:startup}', { startup: id }), sort: '-created' })
      .then((r) => r.items, () => null),
    loadStartupAssignments(pb, user.tenant, id)
  ]);

  const agreementViews: AgreementView[] = (agreements ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    kind: a.kind,
    status: a.status,
    hasFile: Boolean(a.file),
    // Äldre (pre-signering) avtal saknar requires-flaggor → bara Movexum-parten
    // krävs, så de inte felaktigt visas som "väntar på bolaget".
    requiresCompany: a.requires_company_signature === true,
    requiresMovexum: a.requires_movexum_signature !== false,
    companySignedAt: a.company_signed_at,
    movexumSignedAt: a.movexum_signed_at,
    expiresAt: a.expires_at,
    createdAt: a.created
  }));
  const documents = work.documents;
  const completedDocs = documents.filter((d) => d.status === 'completed').length;

  return (
    <TabPage>
      <SectionNav
        items={[
          { href: '#agreements', label: 'Avtal', count: agreements?.length },
          { href: '#godkannanden', label: 'Avtal & godkännanden' },
          { href: '#utbildningsdokument', label: 'Utbildningsdokument', count: documents.length }
        ]}
      />

      <Section id="agreements" title="Avtal" description="Ladda upp, tilldela och signera avtal direkt i plattformen.">
        {agreements === null ? (
          <Empty>Avtalen kunde inte läsas just nu.</Empty>
        ) : (
          <AgreementsSection
            startupId={id}
            startupName={startup.name}
            agreements={agreementViews}
            canManage={canManageDocs}
            canDelete={hasRole(user.roles, ['admin', 'incubator_lead'])}
            signParty={agreementSignParty}
            defaultSignerName={user.name}
          />
        )}
      </Section>

      <Section
        id="godkannanden"
        title="Avtal & godkännanden"
        description="Status på bolagskortet. Datum registreras via Redigera."
        action={<PillLink href={`/startups/${id}/ekonomi#de-minimis`}>De minimis</PillLink>}
      >
        <ul className="grid gap-x-8 divide-y divide-default sm:grid-cols-2 sm:divide-y-0">
          <SignedRow label="Inkubatoravtal" signed={startup.signed_incubator_agreement} date={startup.signed_incubator_agreement_at} />
          <SignedRow label="Sekretessavtal (NDA)" signed={startup.signed_nda} date={startup.signed_nda_at} />
          <SignedRow label="Boost Chamber-avtal" signed={startup.signed_bc_agreement} date={startup.signed_bc_agreement_at} />
          <SignedRow label="Partneravtal" signed={startup.signed_partner_agreement} date={startup.signed_partner_agreement_at} />
          <SignedRow
            label="Vinnovas godkännande av inkubationsstöd"
            signed={startup.signed_vinnova_incubation_approval}
            date={startup.signed_vinnova_incubation_approval_at}
          />
          <SignedRow label="Godkänd för statsstöd art. 22" signed={startup.approved_state_aid_art22} />
          <SignedRow label="Godkänd för de minimis" signed={startup.approved_de_minimis} />
        </ul>
      </Section>

      <Section
        id="utbildningsdokument"
        title="Utbildningsdokument"
        description={
          documents.length > 0
            ? `${completedDocs} av ${documents.length} slutförda. Dokument (PDF, Excel, PowerPoint, Word) som bolaget ska gå igenom.`
            : 'Dokument (PDF, Excel, PowerPoint, Word) som bolaget ska gå igenom.'
        }
        action={canManageDocs ? <PillLink href="/education/documents">Hantera dokument</PillLink> : null}
      >
        {documents.length === 0 ? (
          <Empty>Inga tilldelade dokument än.</Empty>
        ) : (
          <ul className="space-y-3">
            {documents.map((assignment) => {
              const doc = assignment.expand?.document;
              const fileUrl = doc ? pbFileUrl('education_documents', doc.id, doc.file) : null;
              const completed = assignment.status === 'completed';
              return (
                <li key={assignment.id} className="rounded-2xl border border-default p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {completed ? (
                        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron">
                          <Icon name="check" size={22} stroke={2.4} />
                        </span>
                      ) : (
                        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-canvas-muted text-foreground-subtle">
                          <Icon name="doc" size={18} />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{doc?.title || 'Dokument'}</p>
                        <p className="text-xs text-foreground-subtle">
                          {doc ? educationDocumentKindLabels[doc.doc_kind] || 'Dokument' : 'Dokument'}
                          {completed && assignment.completed_at ? ` · slutförd ${formatDate(assignment.completed_at)}` : ''}
                          {!completed && assignment.due_date ? ` · deadline ${formatDate(assignment.due_date)}` : ''}
                        </p>
                        {assignment.instructions ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground-muted">{assignment.instructions}</p>
                        ) : null}
                        {(assignment.expand?.collaborators?.length ?? 0) > 0 ? (
                          <p className="mt-1 text-xs text-foreground-subtle">
                            Resurser: {assignment.expand?.collaborators?.map((c) => c.display_name || 'Kollega').join(', ')}
                          </p>
                        ) : null}
                        {assignment.expand?.meeting ? (
                          <p className="mt-1 text-xs text-foreground-subtle">
                            Möte: {assignment.expand.meeting.name} · {formatStockholmDateTime(assignment.expand.meeting.starts_at)}
                          </p>
                        ) : null}
                        {fileUrl ? (
                          <a
                            href={fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-link hover:underline"
                          >
                            <Icon name="download" size={14} /> Ladda ner
                          </a>
                        ) : null}
                      </div>
                    </div>
                    {canCompleteDocs ? (
                      <DocumentCompleteButton assignmentId={assignment.id} completed={completed} canReopen={canManageDocs} />
                    ) : completed ? (
                      <span className="text-xs font-medium text-movexum-morkgron dark:text-movexum-gron">Slutförd</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </TabPage>
  );
}
