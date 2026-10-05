'use server';

import { redirect } from 'next/navigation';
import { integrationsCatalogHref } from '@/lib/integrations/access';
import { revalidatePath } from 'next/cache';
import { invalidateOutlookCache } from '@/lib/overview/aggregate';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { getAppProvider } from '@/lib/app-integrations/registry';
import { buildAuthorizeUrl } from '@/lib/app-integrations/oauth';
import { appIntegrationCallbackUrl } from '@/lib/app-integrations/app-url';
import {
  findIntegrationRow,
  disconnectIntegration
} from '@/lib/app-integrations/storage';

/**
 * Server actions för per-user OAuth-integrationer. Provider-agnostiska
 * — den specifika providern slås upp via `getAppProvider(slug)`.
 */

/**
 * Bygger authorize-URL:en och redirectar användaren till providerns
 * consent-skärm. Skapar en `oauth_pending`-rad så UI:t kan visa
 * "Väntar på godkännande" om användaren kommer tillbaka utan
 * callback (t.ex. om de avbryter mid-flöde).
 */
export async function connectAppIntegrationAction(input: {
  provider: string;
}): Promise<{ error?: string; redirectTo?: string }> {
  const user = await requireUser();
  const provider = getAppProvider(input.provider);
  if (!provider) return { error: `Okänd provider: ${input.provider}.` };

  try {
    // Verifiera att env-config finns FÖRE vi börjar redirecta.
    provider.getClientId();
    provider.getClientSecret();
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Provider-konfiguration saknas.'
    };
  }

  const pb = await getServerPb();
  const existing = await findIntegrationRow(pb, user.id, input.provider);
  const payload = {
    user: user.id,
    tenant: user.tenant,
    provider: input.provider,
    status: 'oauth_pending' as const,
    last_error: ''
  };
  if (existing) {
    await pb.collection('user_app_integrations').update(existing.id, payload);
  } else {
    await pb.collection('user_app_integrations').create(payload);
  }

  const url = buildAuthorizeUrl({
    provider,
    userId: user.id,
    tenantId: user.tenant,
    redirectUri: appIntegrationCallbackUrl(input.provider)
  });
  return { redirectTo: url };
}

/**
 * Form-action-wrapper för `<form action={…}>` i UI.
 */
export async function connectAppIntegrationFormAction(formData: FormData): Promise<void> {
  'use server';
  const provider = String(formData.get('provider') || '').trim();
  if (!provider) {
    redirect('/integrationer?error=' + encodeURIComponent('Ogiltig provider.'));
  }
  const result = await connectAppIntegrationAction({ provider });
  if (result.error) {
    redirect('/integrationer?error=' + encodeURIComponent(result.error));
  }
  if (result.redirectTo) {
    redirect(result.redirectTo);
  }
}

export async function disconnectAppIntegrationAction(input: {
  provider: string;
}): Promise<{ error?: string }> {
  const user = await requireUser();
  const pb = await getServerPb();
  const row = await findIntegrationRow(pb, user.id, input.provider);
  if (!row) return { error: 'Ingen koppling hittades.' };

  await disconnectIntegration(pb, row.id);
  // Agenda-cachen på "Mina uppgifter" (§ 40) får inte visa möten efter
  // återkallat samtycke (GDPR art. 7.3).
  if (input.provider === 'outlook_calendar') invalidateOutlookCache(user.id);

  revalidatePath('/integrationer');
  revalidatePath('/installningar/integrationer');
  revalidatePath(`/integrationer/${input.provider.replace(/_/g, '-')}`);
  revalidatePath('/chatt');
  return {};
}

export async function disconnectAppIntegrationFormAction(formData: FormData): Promise<void> {
  'use server';
  const provider = String(formData.get('provider') || '').trim();
  if (!provider) return;
  const result = await disconnectAppIntegrationAction({ provider });
  const user = await requireUser();
  const back = integrationsCatalogHref(user.roles);
  if (result.error) {
    redirect(back + '?error=' + encodeURIComponent(result.error));
  }
  redirect(back);
}
