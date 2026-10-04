import type { Role } from '@platform/shared';
import type { SessionUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';

// Var integrationskatalogen bor per roll (CLAUDE.md § 36.1):
//   admin/incubator_lead → Inställningar → Integrationer
//   coach/startup_member → /integrationer (personliga integrationer)
// Detaljsidorna `/integrationer/<slug>` delas av båda. UI-kurering — den
// hårda gränsen ligger i varje sidas `requireUser` + roll-/tenant-kontroll
// och i server-actions.

export const INTEGRATIONS_SETTINGS_ROLES: Role[] = ['admin', 'incubator_lead'];

export function isIntegrationsSettingsUser(roles: Role[] | undefined): boolean {
  return hasRole(roles, INTEGRATIONS_SETTINGS_ROLES);
}

/** Får användaren öppna integrationssidorna alls (katalog + detaljsidor)? */
export function canOpenIntegrations(
  user: Pick<SessionUser, 'roles' | 'enabledModules'>
): boolean {
  return (
    isIntegrationsSettingsUser(user.roles) ||
    canAccessModuleForUser(user.roles, 'integrationer', user.enabledModules)
  );
}

/** Adressen till katalogen för den här användaren (tillbaka-länkar, redirects). */
export function integrationsCatalogHref(roles: Role[] | undefined): string {
  return isIntegrationsSettingsUser(roles) ? '/installningar/integrationer' : '/integrationer';
}
