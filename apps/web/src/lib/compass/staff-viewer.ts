import 'server-only';
import type { Role } from '@platform/shared';
import { getCurrentUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';

// Roller som bygger/förhandsgranskar Startupkompassens moduler (samma krets
// som MANAGE_ROLES i lib/actions/compass.ts, § 23.1).
const COMPASS_STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach'];

/**
 * Är den inloggade (om någon) Startupkompass-personal i `tenantId`?
 * Används av de publika routarna för att låta editorns förhandsgranskning se
 * en OPUBLICERAD modul — anonyma besökare ser bara aktiva + publika moduler.
 * Fail-closed: varje fel ger false.
 */
export async function isCompassStaffInTenant(tenantId: string | undefined | null): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const user = await getCurrentUser();
    return Boolean(user && user.tenant === tenantId && hasRole(user.roles, COMPASS_STAFF_ROLES));
  } catch {
    return false;
  }
}

/** Tenant för inloggad Startupkompass-personal, annars null. */
export async function getCompassStaffTenant(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant || !hasRole(user.roles, COMPASS_STAFF_ROLES)) return null;
    return user.tenant;
  } catch {
    return null;
  }
}
