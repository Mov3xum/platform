import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { getApplication, getCheckType } from '@/lib/support-checks/data';
import { EDITABLE_SUPPORT_CHECK_STATUSES, type Role } from '@platform/shared';
import { ApplicationForm } from '../../ApplicationForm';
import { BackLink, Notice } from '../../ui';

export const dynamic = 'force-dynamic';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export default async function RedigeraAnsokanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const pb = await getServerPb();
  const app = await getApplication(pb, user.tenant, id);
  if (!app) notFound();
  if (!hasRole(user.roles, STAFF_ROLES) && !user.linkedStartups.includes(app.startup)) redirect('/checkar');
  const type = await getCheckType(pb, user.tenant, app.check_type);

  return (
    <PageShell title={`Redigera: ${app.title || type?.title || 'Ansökan'}`} meta={<BackLink href={`/checkar/${app.id}`} label="Tillbaka till ärendet" />}>
      <div className="mx-auto w-full max-w-4xl space-y-4">
        {!EDITABLE_SUPPORT_CHECK_STATUSES.includes(app.status) ? (
          <Notice kind="warning">Ansökan kan bara redigeras som utkast eller när komplettering begärts.</Notice>
        ) : (
          <>
            {app.status === 'changes_requested' && app.changes_request_note && (
              <Notice kind="warning">
                <span className="font-semibold">Begärd komplettering:</span> {app.changes_request_note}
                {app.changes_due_at && <span className="text-xs"> (svar senast {app.changes_due_at})</span>}
              </Notice>
            )}
            <ApplicationForm
              mode="edit"
              applicationId={app.id}
              types={[{ id: app.check_type, label: type?.title ?? 'Stödcheck', description: type?.description, maxAmountSek: type?.max_amount_sek }]}
              startups={[{ id: app.startup, label: app.startup_name ?? 'Bolag' }]}
              initial={{
                checkTypeId: app.check_type,
                startupId: app.startup,
                title: app.title ?? '',
                activities: app.activities,
                requested_amount_sek: app.requested_amount_sek !== null && app.requested_amount_sek !== undefined ? String(app.requested_amount_sek) : '',
                activity_end_date: app.activity_end_date ?? '',
                applicant_note: app.applicant_note ?? ''
              }}
              lockStartup
            />
          </>
        )}
      </div>
    </PageShell>
  );
}
