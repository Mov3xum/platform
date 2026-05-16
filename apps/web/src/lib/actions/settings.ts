'use server';

import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { coreModules } from '@platform/shared';
import { revalidatePath } from 'next/cache';

export type SaveModuleTogglesState = {
  error?: string;
  success?: boolean;
};

const HIDDEN_MODULE_IDS = ['dashboard', 'toolbox', 'onboarding', 'activity_feed', 'partners'];

const ALLOWED_MODULE_IDS = new Set(
  coreModules.filter((m) => !HIDDEN_MODULE_IDS.includes(m.id)).map((m) => m.id)
);

/**
 * Sparar listan av avaktiverade moduler för inloggad användares tenant.
 * Kräver admin- eller incubator_lead-roll.
 */
export async function saveModuleTogglesAction(
  _prev: SaveModuleTogglesState,
  formData: FormData
): Promise<SaveModuleTogglesState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Åtkomst nekad.' };
  }

  const raw = formData.get('disabled_modules');
  let disabledModules: string[] = [];
  try {
    const parsed = raw ? (JSON.parse(String(raw)) as unknown) : [];
    if (!Array.isArray(parsed)) {
      return { error: 'Ogiltigt format på moduldata.' };
    }
    disabledModules = parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return { error: 'Ogiltigt format på moduldata.' };
  }

  const pb = await getServerPb();
  try {
    await pb.collection('tenants').update(user.tenant, {
      disabled_modules: disabledModules
    });
  } catch (err) {
    console.error('[settings] saveModuleToggles failed', { tenantId: user.tenant, err });
    return { error: 'Kunde inte spara inställningar. Försök igen.' };
  }

  revalidatePath('/', 'layout');

  return { success: true };
}

export async function saveUserModuleTogglesAction(
  _prev: SaveModuleTogglesState,
  formData: FormData
): Promise<SaveModuleTogglesState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin'])) {
    return { error: 'Endast admin kan uppdatera användarspecifika moduler.' };
  }

  const userId = String(formData.get('user_id') || '').trim();
  if (!userId) return { error: 'Saknar användar-ID.' };

  const raw = formData.get('disabled_modules');
  let disabledModules: string[] = [];
  try {
    const parsed = raw ? (JSON.parse(String(raw)) as unknown) : [];
    if (!Array.isArray(parsed)) {
      return { error: 'Ogiltigt format på moduldata.' };
    }
    disabledModules = parsed
      .filter((v): v is string => typeof v === 'string')
      .filter((id) => ALLOWED_MODULE_IDS.has(id));
  } catch {
    return { error: 'Ogiltigt format på moduldata.' };
  }

  const pb = await getServerPb();
  try {
    const target = await pb.collection('users').getOne<{ tenant?: string }>(userId, {
      fields: 'id,tenant'
    });
    if (!target.tenant || target.tenant !== user.tenant) {
      return { error: 'Kan bara uppdatera användare i din tenant.' };
    }
    await pb.collection('users').update(userId, {
      disabled_modules: disabledModules
    });
  } catch (err) {
    console.error('[settings] saveUserModuleToggles failed', { userId, tenantId: user.tenant, err });
    return { error: 'Kunde inte spara användarinställningar. Försök igen.' };
  }

  revalidatePath('/', 'layout');
  revalidatePath('/installningar');

  return { success: true };
}
