'use server';

import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import {
  clearCredentials,
  getSuperuserPb,
  saveCredentials
} from '@/lib/integrations/credentials';
import { getHandler } from '@/lib/integrations/registry';
import { runSync, runRegistrySyncForStartup } from '@/lib/integrations/sync';
import { recordActivity } from './record-activity';

export type IntegrationPilotState = {
  error?: string;
  success?: boolean;
};

export type IntegrationConnectState = {
  error?: string;
  success?: boolean;
};

export type IntegrationSyncState = {
  error?: string;
  summary?: string;
  recordsCreated?: number;
  recordsUpdated?: number;
};

interface ExistingTenantIntegration {
  id: string;
  tenant: string;
  provider: string;
  status: string;
}

interface ProviderRow {
  id: string;
  slug: string;
  name: string;
}

// Records (or refreshes) a tenant's intent to pilot a specific
// integration provider. Used for providers without a handler yet —
// staff sees the request in tenant_integrations and reaches out
// manually.
export async function requestIntegrationPilotAction(
  _prev: IntegrationPilotState,
  formData: FormData
): Promise<IntegrationPilotState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Endast inkubatorledning kan begära integrationer.' };
  }

  const providerId = String(formData.get('provider_id') || '').trim();
  const message = String(formData.get('message') || '').trim().slice(0, 2000);

  if (!providerId) {
    return { error: 'Saknad leverantör.' };
  }

  const pb = await getServerPb();

  try {
    await pb.collection('integration_providers').getOne(providerId);
  } catch {
    return { error: 'Leverantören finns inte.' };
  }

  const filter = `tenant = "${user.tenant}" && provider = "${providerId}"`;

  let existing: ExistingTenantIntegration | null = null;
  try {
    existing = await pb
      .collection('tenant_integrations')
      .getFirstListItem<ExistingTenantIntegration>(filter);
  } catch {
    existing = null;
  }

  const payload = {
    tenant: user.tenant,
    provider: providerId,
    status: 'pilot_requested',
    requested_message: message,
    requested_at: new Date().toISOString(),
    requested_by: user.id
  };

  try {
    if (existing) {
      if (existing.status === 'connected') {
        return { success: true };
      }
      await pb.collection('tenant_integrations').update(existing.id, payload);
    } else {
      await pb.collection('tenant_integrations').create(payload);
    }
  } catch (error) {
    console.error('[integrations] failed to record pilot request', {
      tenant: user.tenant,
      providerId,
      error
    });
    return { error: 'Kunde inte registrera förfrågan. Försök igen.' };
  }

  revalidatePath('/integrationer');
  return { success: true };
}

// Connects an integration by testing + storing encrypted credentials
// for the current tenant. RBAC: admin + incubator_lead. Credentials
// arrive as form fields whose keys come from handler.credentialFields.
export async function connectIntegrationAction(
  _prev: IntegrationConnectState,
  formData: FormData
): Promise<IntegrationConnectState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Endast inkubatorledning kan ansluta integrationer.' };
  }

  const providerSlug = String(formData.get('provider_slug') || '').trim();
  if (!providerSlug) {
    return { error: 'Saknad leverantör.' };
  }

  const handler = getHandler(providerSlug);
  if (!handler) {
    return { error: 'Den här leverantören kan inte anslutas automatiskt än.' };
  }

  const creds: Record<string, string> = {};
  for (const field of handler.credentialFields) {
    const value = String(formData.get(field.key) || '').trim();
    if (field.required && !value) {
      return { error: `Fältet "${field.label}" är obligatoriskt.` };
    }
    if (value) creds[field.key] = value;
  }

  const test = await handler.testConnection(creds);
  if (!test.ok) {
    return { error: test.error || 'Anslutningen kunde inte verifieras.' };
  }

  const pb = await getServerPb();

  let provider: ProviderRow;
  try {
    provider = await pb
      .collection('integration_providers')
      .getFirstListItem<ProviderRow>(`slug = "${providerSlug}"`);
  } catch {
    return { error: 'Leverantören finns inte i katalogen.' };
  }

  const filter = `tenant = "${user.tenant}" && provider = "${provider.id}"`;
  let existing: ExistingTenantIntegration | null = null;
  try {
    existing = await pb
      .collection('tenant_integrations')
      .getFirstListItem<ExistingTenantIntegration>(filter);
  } catch {
    existing = null;
  }

  let tenantIntegrationId = existing?.id || '';
  try {
    if (existing) {
      await pb.collection('tenant_integrations').update(existing.id, {
        status: 'connected',
        connected_at: new Date().toISOString()
      });
    } else {
      const created = await pb.collection('tenant_integrations').create({
        tenant: user.tenant,
        provider: provider.id,
        status: 'connected',
        connected_at: new Date().toISOString(),
        requested_by: user.id
      });
      tenantIntegrationId = created.id as string;
    }
  } catch (error) {
    console.error('[integrations] failed to upsert tenant_integration', {
      tenant: user.tenant,
      providerSlug,
      error
    });
    return { error: 'Kunde inte aktivera integrationen. Försök igen.' };
  }

  const saved = await saveCredentials(tenantIntegrationId, creds);
  if (!saved) {
    return {
      error:
        'Krypterad lagring misslyckades — kontrollera MOVEXUM_INTEGRATION_KEY på servern.'
    };
  }

  await recordActivity(pb, {
    tenant: user.tenant,
    kind: 'integration_sync',
    actor: user.id,
    title: `${provider.name} ansluten`,
    meta: 'Integrationen aktiverad. Klicka "Synka nu" för att hämta data.'
  });

  revalidatePath('/integrationer');
  revalidatePath(`/integrationer/${providerSlug}`);
  return { success: true };
}

// Disconnects an integration: clears credentials and resets status.
// Records remain — they can be purged manually if needed (GDPR § 17).
export async function disconnectIntegrationAction(
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin'])) {
    return { error: 'Endast admin kan koppla bort integrationer.' };
  }

  const tenantIntegrationId = String(formData.get('tenant_integration_id') || '').trim();
  if (!tenantIntegrationId) return { error: 'Saknad integration.' };

  const adminResult = await getSuperuserPb();
  if (!adminResult.ok) return { error: 'Serverkonfiguration ofullständig.' };

  try {
    const row = await adminResult.pb
      .collection('tenant_integrations')
      .getOne<{ tenant: string }>(tenantIntegrationId);
    if (row.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

    await adminResult.pb.collection('tenant_integrations').update(tenantIntegrationId, {
      status: 'available',
      connected_at: null
    });
    await clearCredentials(tenantIntegrationId);
  } catch (error) {
    console.error('[integrations] disconnect failed', {
      tenantIntegrationId,
      error
    });
    return { error: 'Kunde inte koppla bort integrationen.' };
  }

  revalidatePath('/integrationer');
  return { success: true };
}

// Triggers a sync. RBAC: admin + incubator_lead. Wraps runSync()
// and surfaces the count summary back to the UI.
export async function syncIntegrationAction(
  _prev: IntegrationSyncState,
  formData: FormData
): Promise<IntegrationSyncState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Endast inkubatorledning kan köra synk.' };
  }

  const tenantIntegrationId = String(formData.get('tenant_integration_id') || '').trim();
  const providerSlug = String(formData.get('provider_slug') || '').trim();
  if (!tenantIntegrationId) return { error: 'Saknad integration.' };

  const adminResult = await getSuperuserPb();
  if (!adminResult.ok) return { error: 'Serverkonfiguration ofullständig.' };

  try {
    const row = await adminResult.pb
      .collection('tenant_integrations')
      .getOne<{ tenant: string; status: string }>(tenantIntegrationId);
    if (row.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };
    if (row.status !== 'connected') {
      return { error: 'Integrationen är inte ansluten.' };
    }
  } catch {
    return { error: 'Integrationen hittades inte.' };
  }

  const result = await runSync(tenantIntegrationId, user.id);

  const pb = await getServerPb();
  const summary =
    result.status === 'failed'
      ? `Synk misslyckades: ${result.errorMessage || 'okänt fel'}`
      : `Synk klar — ${result.recordsCreated} nya, ${result.recordsUpdated} uppdaterade.`;

  await recordActivity(pb, {
    tenant: user.tenant,
    kind: 'integration_sync',
    actor: user.id,
    title: `${providerSlug || 'Integration'} synkad`,
    meta: summary
  });

  revalidatePath('/integrationer');
  if (providerSlug) {
    revalidatePath(`/integrationer/${providerSlug}`);
    revalidatePath(`/integrationer/${providerSlug}/poster`);
  }
  revalidatePath('/aktivitet');

  if (result.status === 'failed') {
    return { error: summary };
  }
  return {
    summary,
    recordsCreated: result.recordsCreated,
    recordsUpdated: result.recordsUpdated
  };
}

// Per-startup Allabolag-sync. Triggas från bolagsdetaljvyn när org_nr
// är ifyllt. Tenant-isolation: verifierar att bolaget tillhör inloggad
// users tenant via tenant-bunden PB INNAN superuser-skrivningen i
// runRegistrySyncForStartup (CLAUDE.md § 10.5 punkt 5).
export async function syncStartupFromAllabolagAction(
  _prev: IntegrationSyncState,
  formData: FormData
): Promise<IntegrationSyncState> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    return { error: 'Endast inkubatorledning kan köra synk.' };
  }

  const startupId = String(formData.get('startup_id') || '').trim();
  if (!startupId) return { error: 'Saknad bolags-id.' };

  // Steg 1: tenant-bunden read som verifierar att startupId tillhör
  // user.tenant. Misslyckas detta får vi inte gå vidare till superuser.
  const pb = await getServerPb();
  try {
    const row = await pb
      .collection('startups')
      .getOne<{ tenant: string; org_nr?: string }>(startupId);
    if (row.tenant !== user.tenant) {
      return { error: 'Åtkomst nekad.' };
    }
    if (!row.org_nr || !row.org_nr.trim()) {
      return { error: 'Bolaget saknar org-nr. Fyll i innan synk.' };
    }
  } catch {
    return { error: 'Bolaget hittades inte.' };
  }

  // Steg 2: hitta tenant_integration för allabolag.
  const adminResult = await getSuperuserPb();
  if (!adminResult.ok) return { error: 'Serverkonfiguration ofullständig.' };

  let provider: ProviderRow;
  try {
    provider = await adminResult.pb
      .collection('integration_providers')
      .getFirstListItem<ProviderRow>('slug = "allabolag"');
  } catch {
    return { error: 'Allabolag-leverantören saknas i katalogen.' };
  }

  let tenantIntegration: { id: string; status: string };
  try {
    tenantIntegration = await adminResult.pb
      .collection('tenant_integrations')
      .getFirstListItem<{ id: string; status: string }>(
        `tenant = "${user.tenant}" && provider = "${provider.id}"`
      );
  } catch {
    return { error: 'Anslut Allabolag först på /integrationer/allabolag.' };
  }
  if (tenantIntegration.status !== 'connected') {
    return { error: 'Allabolag är inte ansluten för denna tenant.' };
  }

  const result = await runRegistrySyncForStartup(
    tenantIntegration.id,
    startupId,
    user.id
  );

  const summary =
    result.status === 'failed'
      ? `Synk misslyckades: ${result.errorMessage || 'okänt fel'}`
      : `Synk klar — ${result.recordsCreated} årsrader uppdaterade.`;

  await recordActivity(pb, {
    tenant: user.tenant,
    kind: 'integration_sync',
    actor: user.id,
    title: 'Allabolag synkad (per bolag)',
    meta: summary,
    startup: startupId
  });

  revalidatePath(`/startups/${startupId}`);
  revalidatePath('/integrationer/allabolag');
  revalidatePath('/aktivitet');

  if (result.status === 'failed') {
    return { error: summary };
  }
  return {
    summary,
    recordsCreated: result.recordsCreated,
    recordsUpdated: result.recordsUpdated
  };
}
