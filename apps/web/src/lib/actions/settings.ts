'use server';

import PocketBase from 'pocketbase';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { coreModules } from '@platform/shared';
import { revalidatePath } from 'next/cache';
import { MAX_TENANT_LOGO_BYTES } from '@/lib/settings-constants';

export type SaveModuleTogglesState = {
  error?: string;
  success?: boolean;
};

export type UploadTenantLogoState = {
  error?: string;
  success?: boolean;
};

const HIDDEN_MODULE_IDS = ['dashboard', 'toolbox', 'onboarding', 'activity_feed', 'partners'];

const ALLOWED_MODULE_IDS = new Set(
  coreModules.filter((m) => !HIDDEN_MODULE_IDS.includes(m.id)).map((m) => m.id)
);

const PB_URL =
  process.env.POCKETBASE_URL ||
  (process.env.NODE_ENV === 'production' ? 'http://pocketbase:8080' : 'http://localhost:8080');

const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

function buildTenantLogoUploadData(fieldName: 'logo_light' | 'logo_dark', logoFile: File): FormData {
  const uploadData = new FormData();
  uploadData.append(fieldName, logoFile);
  return uploadData;
}

async function getSuperuserPb(): Promise<PocketBase | null> {
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
  if (!email || !password) {
    console.error('[settings] superuser credentials missing', {
      hasPocketbaseSuperuserEmail: Boolean(process.env.POCKETBASE_SUPERUSER_EMAIL),
      hasPocketbaseSuperuserPassword: Boolean(process.env.POCKETBASE_SUPERUSER_PASSWORD),
      hasPbSuEmail: Boolean(process.env.PB_SU_EMAIL),
      hasPbSuPassword: Boolean(process.env.PB_SU_PASSWORD)
    });
    return null;
  }

  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);

  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    return pb;
  } catch (err) {
    console.error('[settings] superuser auth failed', {
      email,
      pbUrl: PB_URL
    });
    return null;
  }
}

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
    disabledModules = parsed
      .filter((v): v is string => typeof v === 'string')
      .filter((id) => ALLOWED_MODULE_IDS.has(id));
  } catch (err) {
    console.error('[settings] saveModuleToggles parse failed', {
      tenantId: user.tenant,
      error: err
    });
    return { error: 'Ogiltigt format på moduldata.' };
  }

  const pb = await getServerPb();
  try {
    await pb.collection('tenants').update(user.tenant, {
      disabled_modules: disabledModules
    });
  } catch (err) {
    if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
      console.error('[settings] saveModuleToggles failed', { tenantId: user.tenant });
      return { error: 'Kunde inte spara inställningar. Försök igen.' };
    }

    const superuserPb = await getSuperuserPb();
    if (!superuserPb) {
      console.error('[settings] saveModuleToggles failed', { tenantId: user.tenant });
      return { error: 'Kunde inte spara inställningar. Försök igen.' };
    }

    try {
      await superuserPb.collection('tenants').update(user.tenant, {
        disabled_modules: disabledModules
      });
    } catch {
      console.error('[settings] saveModuleToggles failed (fallback)', { tenantId: user.tenant });
      return { error: 'Kunde inte spara inställningar. Försök igen.' };
    }
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
  } catch (err) {
    console.error('[settings] saveUserModuleToggles parse failed', { userId, error: err });
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

/**
 * Laddar upp en logotyp (light eller dark mode) för inloggad användares tenant.
 * Kräver admin- eller incubator_lead-roll.
 */
export async function uploadTenantLogoAction(
  _prev: UploadTenantLogoState,
  formData: FormData
): Promise<UploadTenantLogoState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Åtkomst nekad.' };
  }

  const mode = String(formData.get('mode') || '');
  if (mode !== 'light' && mode !== 'dark') {
    return { error: 'Ogiltigt läge. Välj light eller dark.' };
  }

  const logoFile = formData.get('logo') as File | null;
  if (!logoFile || logoFile.size === 0) {
    return { error: 'Ingen fil vald.' };
  }
  if (logoFile.size > MAX_TENANT_LOGO_BYTES) {
    return { error: 'Logotypfilen får inte vara större än 2 MB.' };
  }
  if (!ALLOWED_LOGO_TYPES.includes(logoFile.type)) {
    return { error: 'Endast PNG, JPG, WEBP och SVG stöds.' };
  }

  const pb = await getServerPb();
  const fieldName = mode === 'light' ? 'logo_light' : 'logo_dark';
  const uploadData = buildTenantLogoUploadData(fieldName, logoFile);

  try {
    await pb.collection('tenants').update(user.tenant, uploadData);
  } catch (err) {
    const superuserPb = await getSuperuserPb();
    if (!superuserPb) {
      console.error('[settings] uploadTenantLogo failed', { tenantId: user.tenant, mode, err });
      return { error: 'Kunde inte spara logotypen. Försök igen.' };
    }

    try {
      await superuserPb
        .collection('tenants')
        .update(user.tenant, buildTenantLogoUploadData(fieldName, logoFile));
    } catch (fallbackErr) {
      console.error('[settings] uploadTenantLogo failed (fallback)', {
        tenantId: user.tenant,
        mode,
        err,
        fallbackErr
      });
      return { error: 'Kunde inte spara logotypen. Försök igen.' };
    }
  }

  revalidatePath('/', 'layout');
  revalidatePath('/installningar');

  return { success: true };
}

/**
 * Tar bort logotyp (light eller dark mode) för inloggad användares tenant.
 * Kräver admin- eller incubator_lead-roll.
 */
export async function deleteTenantLogoAction(
  _prev: UploadTenantLogoState,
  formData: FormData
): Promise<UploadTenantLogoState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Åtkomst nekad.' };
  }

  const mode = String(formData.get('mode') || '');
  if (mode !== 'light' && mode !== 'dark') {
    return { error: 'Ogiltigt läge.' };
  }

  const fieldName = mode === 'light' ? 'logo_light' : 'logo_dark';
  const pb = await getServerPb();

  try {
    await pb.collection('tenants').update(user.tenant, { [fieldName]: null });
  } catch (err) {
    const superuserPb = await getSuperuserPb();
    if (!superuserPb) {
      console.error('[settings] deleteTenantLogo failed', { tenantId: user.tenant, mode, err });
      return { error: 'Kunde inte ta bort logotypen. Försök igen.' };
    }

    try {
      await superuserPb.collection('tenants').update(user.tenant, { [fieldName]: null });
    } catch (fallbackErr) {
      console.error('[settings] deleteTenantLogo failed (fallback)', {
        tenantId: user.tenant,
        mode,
        err,
        fallbackErr
      });
      return { error: 'Kunde inte ta bort logotypen. Försök igen.' };
    }
  }

  revalidatePath('/', 'layout');
  revalidatePath('/installningar');

  return { success: true };
}
