import { ALL_ROLES, coreModules, type Role } from '@platform/shared';

export { ALL_ROLES };

export const hasRole = (userRoles: Role[] | undefined, allowed: Role[]): boolean => {
  if (!userRoles || userRoles.length === 0) return false;
  return userRoles.some((r) => allowed.includes(r));
};

export const canAccessModule = (userRoles: Role[] | undefined, moduleId: string): boolean => {
  const mod = coreModules.find((m) => m.id === moduleId);
  if (!mod) return false;
  return hasRole(userRoles, mod.rolesAllowed);
};

export const requireRole = (userRoles: Role[] | undefined, allowed: Role[]): void => {
  if (!hasRole(userRoles, allowed)) {
    throw new Error('Forbidden: missing required role');
  }
};
