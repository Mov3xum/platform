import { allowedFeedbackAreas, type FeedbackArea } from '@platform/shared';
import { canAccessModuleForUser } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth.server';

/**
 * Områden (sidor) en användare får lägga kort på i Önskemål & buggar
 * (CLAUDE.md § 49): bara sidor som är AKTIVERADE på hens egen profil
 * (§ 36.3, samma `canAccessModuleForUser` som sidmenyn) plus de tvärgående
 * modul-lösa områdena. Delas av sidan (dropdownen) och server-actionerna
 * (valideringen) — klienten är aldrig gränsen.
 */
export function feedbackAreasForUser(user: Pick<SessionUser, 'roles' | 'enabledModules'>): FeedbackArea[] {
  return allowedFeedbackAreas((moduleId) => canAccessModuleForUser(user.roles, moduleId, user.enabledModules));
}
