'use server';

import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';

export type IntegrationPilotState = {
  error?: string;
  success?: boolean;
};

interface ExistingTenantIntegration {
  id: string;
  tenant: string;
  provider: string;
  status: string;
}

// Records (or refreshes) a tenant's intent to pilot a specific
// integration provider. Until OAuth flows are built, this is the
// hand-off mechanism — Movexum staff sees the request in tenant_integrations
// and reaches out manually.
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

  // Validate provider exists and is not a long-archived stub.
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
      // Don't downgrade an already-connected tenant.
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
