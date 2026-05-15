'use server';

import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';

export type SaveModuleTogglesState = {
  error?: string;
  success?: boolean;
};

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
    disabledModules = raw ? (JSON.parse(String(raw)) as string[]) : [];
    if (!Array.isArray(disabledModules)) disabledModules = [];
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

  revalidatePath('/installningar');
  revalidatePath('/idag');

  return { success: true };
}
