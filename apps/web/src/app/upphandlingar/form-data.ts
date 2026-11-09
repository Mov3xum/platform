import 'server-only';
import type PocketBase from 'pocketbase';
import { listAssignableResourcesForTenant } from '@/lib/assignments/collaboration';
import type { FormOption } from './ProcurementForm';

/** Valalternativ till formulären (id + visningsnamn — aldrig e-post). */
export async function loadFormOptions(
  pb: PocketBase,
  tenantId: string
): Promise<{ people: FormOption[]; agreements: FormOption[]; startups: FormOption[] }> {
  const [resources, agreements, startups] = await Promise.all([
    listAssignableResourcesForTenant(pb, tenantId),
    pb
      .collection('agreements')
      .getList<{ id: string; title?: string; status?: string }>(1, 200, {
        filter: pb.filter('tenant = {:t}', { t: tenantId }),
        sort: '-created',
        fields: 'id,title,status'
      })
      .then((r) => r.items)
      .catch(() => [] as Array<{ id: string; title?: string; status?: string }>),
    pb
      .collection('startups')
      .getList<{ id: string; name: string }>(1, 300, {
        filter: pb.filter('tenant = {:t}', { t: tenantId }),
        sort: 'name',
        fields: 'id,name'
      })
      .then((r) => r.items)
      .catch(() => [] as Array<{ id: string; name: string }>)
  ]);
  return {
    people: resources.map((r) => ({ id: r.id, label: r.name })),
    agreements: agreements.map((a) => ({ id: a.id, label: `${a.title || 'Avtal'}${a.status ? ` (${a.status})` : ''}` })),
    startups: startups.map((s) => ({ id: s.id, label: s.name }))
  };
}
