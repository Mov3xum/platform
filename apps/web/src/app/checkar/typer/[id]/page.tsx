import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { criteriaOfType, getCheckType } from '@/lib/support-checks/data';
import type { Role } from '@platform/shared';
import { CheckTypeForm } from '../CheckTypeForm';
import { loadFundingOptions, loadWorkshopOptions } from '../../form-data';
import { BackLink } from '../../ui';

export const dynamic = 'force-dynamic';

const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

export default async function RedigeraCheckTypPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'checkar', user.enabledModules)) redirect('/hem');
  if (!hasRole(user.roles, LEAD_ROLES)) redirect('/checkar/typer');
  const pb = await getServerPb();
  const type = await getCheckType(pb, user.tenant, id);
  if (!type) notFound();
  const [workshops, funding] = await Promise.all([loadWorkshopOptions(pb, user.tenant), loadFundingOptions(pb, user.tenant)]);
  return (
    <PageShell title={`Redigera: ${type.title}`} meta={<BackLink href="/checkar/typer" label="Checktyper" />}>
      <div className="mx-auto w-full max-w-4xl">
        <CheckTypeForm
          mode="edit"
          typeId={type.id}
          workshops={workshops}
          funding={funding}
          initial={{
            title: type.title,
            kind: type.kind,
            description: type.description ?? '',
            active: type.active !== false,
            max_amount_sek: type.max_amount_sek ? String(type.max_amount_sek) : '',
            funding_project: type.funding_project ?? '',
            default_work_package: type.default_work_package ?? '',
            default_state_aid_basis: type.default_state_aid_basis ?? 'de_minimis',
            requires_workshop: type.requires_workshop ?? '',
            min_irl_level: type.min_irl_level ? String(type.min_irl_level) : '',
            requires_final_report: type.requires_final_report !== false,
            report_due_days: type.report_due_days ? String(type.report_due_days) : '30',
            changes_due_days: type.changes_due_days ? String(type.changes_due_days) : '14',
            is_excellence_activity: Boolean(type.is_excellence_activity),
            criteria: criteriaOfType(type),
            opens_at: type.opens_at ?? '',
            closes_at: type.closes_at ?? ''
          }}
        />
      </div>
    </PageShell>
  );
}
