import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listAssignableResourcesForTenant } from '@/lib/assignments/collaboration';
import { getFundingProject } from '@/lib/funding/data';
import type { Role } from '@platform/shared';
import { ProjectForm } from '../../ProjectForm';
import { BackLink } from '@/app/checkar/ui';

export const dynamic = 'force-dynamic';

const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

export default async function RedigeraProjektPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'projekt', user.enabledModules)) redirect('/hem');
  if (!hasRole(user.roles, LEAD_ROLES)) redirect(`/projekt/${id}`);
  const pb = await getServerPb();
  const project = await getFundingProject(pb, user.tenant, id);
  if (!project) notFound();
  const people = (await listAssignableResourcesForTenant(pb, user.tenant)).map((r) => ({ id: r.id, label: r.name }));
  return (
    <PageShell title={`Redigera: ${project.title}`} meta={<BackLink href={`/projekt/${project.id}`} label="Projektet" />}>
      <div className="mx-auto w-full max-w-3xl">
        <ProjectForm
          mode="edit"
          projectId={project.id}
          people={people}
          initial={{
            title: project.title,
            kind: project.kind,
            status: project.status,
            funder: project.funder ?? '',
            diarienummer: project.diarienummer ?? '',
            description: project.description ?? '',
            budget_sek: project.budget_sek ? String(project.budget_sek) : '',
            starts_at: project.starts_at ?? '',
            ends_at: project.ends_at ?? '',
            default_state_aid_basis: project.default_state_aid_basis ?? 'de_minimis',
            default_stodgivare: project.default_stodgivare ?? '',
            responsible: project.responsible ?? ''
          }}
        />
      </div>
    </PageShell>
  );
}
