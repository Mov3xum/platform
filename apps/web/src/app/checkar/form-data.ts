import 'server-only';
import type PocketBase from 'pocketbase';
import type { SessionUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { listFundingProjects, listWorkPackages } from '@/lib/funding/data';
import { workPackageLabel } from '@platform/shared';

export interface FormOption {
  id: string;
  label: string;
}

/** Bolag användaren får ansöka för: staff → hela tenanten, medlem → sina länkade. */
export async function loadStartupOptions(pb: PocketBase, user: SessionUser): Promise<FormOption[]> {
  const isStaff = hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);
  try {
    const res = await pb.collection('startups').getList<{ id: string; name: string }>(1, 300, {
      filter: isStaff ? pb.filter('tenant = {:t}', { t: user.tenant }) : pb.filter('tenant = {:t} && (' + user.linkedStartups.map((_, i) => `id = {:s${i}}`).join(' || ') + ')', Object.fromEntries([['t', user.tenant], ...user.linkedStartups.map((s, i) => [`s${i}`, s])])),
      sort: 'name',
      fields: 'id,name'
    });
    return res.items.map((s) => ({ id: s.id, label: s.name }));
  } catch {
    return [];
  }
}

export async function loadWorkshopOptions(pb: PocketBase, tenantId: string): Promise<FormOption[]> {
  try {
    const res = await pb.collection('workshops').getList<{ id: string; title?: string }>(1, 200, {
      filter: pb.filter('tenant = {:t}', { t: tenantId }),
      sort: 'title',
      fields: 'id,title'
    });
    return res.items.map((w) => ({ id: w.id, label: w.title || 'Workshop' }));
  } catch {
    return [];
  }
}

export interface FundingOptions {
  projects: FormOption[];
  workPackages: Array<FormOption & { project: string }>;
}

export async function loadFundingOptions(pb: PocketBase, tenantId: string): Promise<FundingOptions> {
  const [projects, wps] = await Promise.all([listFundingProjects(pb, tenantId), listWorkPackages(pb, tenantId)]);
  return {
    projects: projects.filter((p) => p.status !== 'cancelled').map((p) => ({ id: p.id, label: `${p.title}${p.status === 'ended' ? ' (avslutat)' : ''}` })),
    workPackages: wps.map((w) => ({ id: w.id, project: w.project, label: workPackageLabel(w) }))
  };
}
