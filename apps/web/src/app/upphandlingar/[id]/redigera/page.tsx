import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { criteriaOf, getProcurement, templateOf } from '@/lib/procurements/data';
import type { Role } from '@platform/shared';
import { ProcurementForm } from '../../ProcurementForm';
import { loadFormOptions } from '../../form-data';
import { BackLink } from '../../ui';

export const dynamic = 'force-dynamic';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
const RULE_ROLES: Role[] = ['admin', 'incubator_lead'];

export default async function RedigeraUpphandlingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'upphandlingar', user.enabledModules)) redirect('/hem');
  if (!hasRole(user.roles, STAFF_ROLES)) redirect(`/upphandlingar/${id}`);
  const pb = await getServerPb();
  const p = await getProcurement(pb, user.tenant, id);
  if (!p) notFound();
  const options = await loadFormOptions(pb, user.tenant);
  const num = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

  return (
    <PageShell title={`Redigera: ${p.title}`} meta={<BackLink href={`/upphandlingar/${p.id}`} label="Tillbaka" />}>
      <div className="mx-auto w-full max-w-4xl">
        <ProcurementForm
          mode="edit"
          procurementId={p.id}
          initial={{
            title: p.title,
            supplier: p.supplier ?? '',
            procedure: p.procedure ?? '',
            diarienummer: p.diarienummer ?? '',
            description: p.description ?? '',
            status: String(p.status),
            tender_deadline: p.tender_deadline ?? '',
            contract_start: p.contract_start ?? '',
            contract_end: p.contract_end ?? '',
            extension_option_months: num(p.extension_option_months),
            estimated_value_sek: num(p.estimated_value_sek),
            estimated_calloffs: num(p.estimated_calloffs),
            is_excellence_activity: Boolean(p.is_excellence_activity),
            notes: p.notes ?? '',
            responsible: p.responsible ?? '',
            agreement: p.agreement ?? '',
            evaluation_criteria: criteriaOf(p),
            calloff_template: templateOf(p)
          }}
          people={options.people}
          agreements={options.agreements}
          canManageRules={hasRole(user.roles, RULE_ROLES)}
        />
      </div>
    </PageShell>
  );
}
