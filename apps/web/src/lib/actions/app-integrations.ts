'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { getAppProvider } from '@/lib/app-integrations/registry';
import { buildAuthorizeUrl } from '@/lib/app-integrations/oauth';
import {
  findIntegrationRow,
  disconnectIntegration
} from '@/lib/app-integrations/storage';

/**
 * Server actions för per-user OAuth-integrationer. Provider-agnostiska
 * — den specifika providern slås upp via `getAppProvider(slug)`.
 */

function publicAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

function callbackUrl(slug: string): string {
  return `${publicAppUrl()}/api/app-integrations/${slug}/callback`;
}

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
    redirectUri: callbackUrl(input.provider)
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

  revalidatePath('/integrationer');
  revalidatePath(`/integrationer/${input.provider.replace(/_/g, '-')}`);
  revalidatePath('/chatt');
  return {};
}

export async function disconnectAppIntegrationFormAction(formData: FormData): Promise<void> {
  'use server';
  const provider = String(formData.get('provider') || '').trim();
  if (!provider) return;
  const result = await disconnectAppIntegrationAction({ provider });
  if (result.error) {
    redirect('/integrationer?error=' + encodeURIComponent(result.error));
  }
  redirect('/integrationer');
}
