import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageShell } from '@/components/PageShell';
import { pbFileUrl } from '@/lib/pb-file';
import { EDUCATION_TABS } from '../tabs';
import { AreaManager, type AreaWithCount } from './AreaManager';
import type { Workshop, WorkshopArea } from '@platform/shared';

export default async function EducationAreasPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'education', user.disabledModules)) redirect('/chatt');
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) redirect('/education');
  const pb = await getServerPb();

  let areas: WorkshopArea[] = [];
  try {
    areas = (
      await pb.collection(PB_COLLECTIONS.workshopAreas).getList<WorkshopArea>(1, 200, {
        filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
        sort: 'name'
      })
    ).items;
  } catch (error) {
    console.error('[education/areas] failed to load areas', { tenant: user.tenant, error });
  }

  let workshops: Pick<Workshop, 'id' | 'area'>[] = [];
  try {
    workshops = (
      await pb.collection(PB_COLLECTIONS.workshops).getList<Pick<Workshop, 'id' | 'area'>>(1, 500, {
        filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
        fields: 'id,area'
      })
    ).items;
  } catch (error) {
    console.error('[education/areas] failed to load workshop counts', { tenant: user.tenant, error });
  }

  const counts = new Map<string, number>();
  for (const w of workshops) {
    const areaId = typeof w.area === 'string' ? w.area : '';
    if (areaId) counts.set(areaId, (counts.get(areaId) ?? 0) + 1);
  }

  const areasWithCount: AreaWithCount[] = areas.map((a) => ({
    id: a.id,
    name: a.name,
    workshopCount: counts.get(a.id) ?? 0,
    imageUrl: pbFileUrl('workshop_areas', a.id, a.image, '400x300')
  }));

  return (
    <PageShell title="Utbildning" tabs={EDUCATION_TABS}>
      <div className="mx-auto w-full max-w-2xl py-6">
        <AreaManager areas={areasWithCount} />
      </div>
    </PageShell>
  );
}
