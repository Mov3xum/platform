import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { PageShell } from '@/components/PageShell';
import { loadIntegrationsCatalog } from '@/components/integrations/IntegrationsCatalog';
import { canOpenIntegrations, isIntegrationsSettingsUser } from '@/lib/integrations/access';

export const dynamic = 'force-dynamic';

/**
 * `/integrationer` — sedan 2026-09 bor organisationens integrationer under
 * Inställningar → Integrationer. Admin/incubator_lead skickas dit; coach och
 * bolagsmedlem (utan Inställningar) får katalogen här som förut för sina
 * personliga integrationer (Outlook, Mistral-connectors). Detaljsidorna
 * `/integrationer/<slug>` är oförändrade.
 */
export default async function IntegrationerPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const user = await requireUser();
  if (isIntegrationsSettingsUser(user.roles)) {
    redirect(
      params.error
        ? `/installningar/integrationer?error=${encodeURIComponent(params.error)}`
        : '/installningar/integrationer'
    );
  }
  if (!canOpenIntegrations(user)) redirect('/dashboard');

  const catalog = await loadIntegrationsCatalog(user, { errorMessage: params.error });
  return (
    <PageShell title="Integrationer" rightPanel={catalog.rail}>
      <div className="py-6">{catalog.content}</div>
    </PageShell>
  );
}
