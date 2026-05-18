import { ALL_ROLES, coreModules, type Role } from '@platform/shared';
import type { Tool } from '@platform/shared';

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

export const canAccessModuleForUser = (
  userRoles: Role[] | undefined,
  moduleId: string,
  disabledModules: string[] | undefined
): boolean => {
  if (Array.isArray(disabledModules) && disabledModules.includes(moduleId)) {
    return false;
  }
  return canAccessModule(userRoles, moduleId);
};

export const requireRole = (userRoles: Role[] | undefined, allowed: Role[]): void => {
  if (!hasRole(userRoles, allowed)) {
    throw new Error('Forbidden: missing required role');
  }
};

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead'];

/**
 * Determines if a user can run a specific tool.
 *
 * - Staff (admin/incubator_lead) can always run any active tool.
 * - Other roles must appear in tool.roles_allowed.
 * - startup_member + requires_startup: must be linked to the startup.
 */
export const canRunTool = (
  userRoles: Role[] | undefined,
  tool: Pick<Tool, 'active' | 'roles_allowed' | 'requires_startup'>,
  options: { isLinkedStartup?: boolean } = {}
): boolean => {
  if (!tool.active) return false;
  if (!userRoles || userRoles.length === 0) return false;

  // Staff always allowed
  if (hasRole(userRoles, STAFF_ROLES)) return true;

  // Must have an overlapping role
  if (!hasRole(userRoles, tool.roles_allowed as Role[])) return false;

  // startup_member + requires_startup: must be linked to the specific startup
  if (hasRole(userRoles, ['startup_member']) && tool.requires_startup) {
    return options.isLinkedStartup === true;
  }

  return true;
};

/**
 * Avgör om en användare får aktivera en Mistral-connector (built-in eller MCP).
 *
 * - `observer` är alltid spärrad (read-only) — CLAUDE.md § 9.5.
 * - Connectorn måste vara i tenantens allowlist
 *   (`tenants.allowed_mistral_connectors`); MCP-connectors antas alltid
 *   tillåtna eftersom de redan är aktiverade på workspace-nivå hos Mistral.
 *
 * Kostnadskontroll och tenant-isolation görs i `activateConnectorAction`.
 */
export const canActivateConnector = (
  userRoles: Role[] | undefined,
  connector: {
    kind: 'builtin' | 'mcp';
    id: string;
  },
  tenantAllowlist: string[] | null | undefined
): boolean => {
  if (!userRoles || userRoles.length === 0) return false;
  if (userRoles.includes('observer') && userRoles.length === 1) return false;

  if (connector.kind === 'mcp') return true;

  // Staff (admin/incubator_lead) får testa alla built-ins utan att
  // först sätta upp tenant-allowlistan — speglar `canRunTool`-mönstret.
  if (hasRole(userRoles, STAFF_ROLES)) return true;

  if (Array.isArray(tenantAllowlist) && tenantAllowlist.length > 0) {
    return tenantAllowlist.includes(connector.id);
  }
  // Default: bara web_search tillåten utan explicit allowlist.
  return connector.id === 'web_search';
};
