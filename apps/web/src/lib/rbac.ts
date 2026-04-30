import type { Role } from './types';

export const availableRoles: Role[] = ['admin', 'incubator_lead', 'mentor', 'startup', 'observer'];

export interface RoleAccess {
  role: Role;
  modules: string[];
}

export const roleAccessMap: RoleAccess[] = [
  { role: 'admin', modules: ['dashboard', 'startups', 'onboarding', 'education'] },
  { role: 'incubator_lead', modules: ['dashboard', 'startups', 'onboarding', 'education'] },
  { role: 'mentor', modules: ['dashboard', 'startups', 'education'] },
  { role: 'startup', modules: ['dashboard', 'startups', 'onboarding', 'education'] },
  { role: 'observer', modules: ['dashboard', 'startups'] }
];

export const canAccessModule = (role: Role, moduleId: string) => {
  const record = roleAccessMap.find((item) => item.role === role);
  return record?.modules.includes(moduleId) ?? false;
};
