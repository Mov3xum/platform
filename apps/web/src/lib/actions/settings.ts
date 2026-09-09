'use server';

import PocketBase from 'pocketbase';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { getServerPbUrl } from '@/lib/pb-url';
import { hasRole } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import { MAX_TENANT_LOGO_BYTES } from '@/lib/settings-constants';

export type UploadTenantLogoState = {
  error?: string;
  success?: boolean;
};

export type SaveAiBudgetState = {
  error?: string;
  success?: boolean;
};

const MAX_AI_BUDGET_USD = 1000000;

const PB_URL = getServerPbUrl();

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
 * Sparar tenantens AI-kostnadstak (USD/månad). 0 = ärver env-defaulten
 * (MOVEXUM_MONTHLY_AI_BUDGET_USD). Kräver admin/incubator_lead. CLAUDE.md § 9.6.
 */
export async function saveAiBudgetAction(
  _prev: SaveAiBudgetState,
  formData: FormData
): Promise<SaveAiBudgetState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Åtkomst nekad.' };
  }

  const raw = String(formData.get('budget_usd') ?? '').trim().replace(',', '.');
  const value = raw === '' ? 0 : Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return { error: 'Ange ett belopp i USD (0 = ingen egen spärr).' };
  }
  if (value > MAX_AI_BUDGET_USD) {
    return { error: `Taket får inte överstiga $${MAX_AI_BUDGET_USD.toLocaleString('sv-SE')}.` };
  }
  const budget = Math.round(value * 100) / 100;

  const pb = await getServerPb();
  try {
    await pb.collection('tenants').update(user.tenant, { monthly_ai_budget_usd: budget });
  } catch {
    const superuserPb = await getSuperuserPb();
    if (!superuserPb) {
      console.error('[settings] saveAiBudget failed', { tenantId: user.tenant });
      return { error: 'Kunde inte spara budgeten. Försök igen.' };
    }
    try {
      await superuserPb.collection('tenants').update(user.tenant, { monthly_ai_budget_usd: budget });
    } catch {
      console.error('[settings] saveAiBudget failed (fallback)', { tenantId: user.tenant });
      return { error: 'Kunde inte spara budgeten. Försök igen.' };
    }
  }

  revalidatePath('/installningar');
  revalidatePath('/installningar/ai-kostnad');
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
  revalidatePath('/installningar/utseende');

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
  revalidatePath('/installningar/utseende');

  return { success: true };
}
