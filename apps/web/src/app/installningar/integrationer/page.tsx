import { loadIntegrationsCatalog } from '@/components/integrations/IntegrationsCatalog';
import { requireSettingsUser, SettingsSectionPage } from '../shared';

export const dynamic = 'force-dynamic';

/**
 * Inställningar → Integrationer: organisationens externa tjänster
 * (bolagsregister som Roaring/Bolagsverket, Brevo, Howspace …), Mistral-
 * connectors och personliga OAuth-kopplingar. Samma katalog som
 * `/integrationer` (delad komponent) — bara skalet skiljer.
 */
export default async function InstallningarIntegrationerPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const user = await requireSettingsUser();
  const catalog = await loadIntegrationsCatalog(user, { errorMessage: params.error });
  return (
    <SettingsSectionPage
      slug="integrationer"
      roles={user.roles}
      rightPanel={catalog.rail}
      intro="Anslut externa tjänster för hela organisationen — bolagsregister, marknadsföring, lärandeplattformar och AI-connectors. Inloggningsuppgifter krypteras (AES-256-GCM) och lagras per tenant; alla leverantörer är EU-hostade."
    >
      {catalog.content}
    </SettingsSectionPage>
  );
}
