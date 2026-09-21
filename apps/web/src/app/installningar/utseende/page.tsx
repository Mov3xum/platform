import { TenantLogoUpload } from '../TenantLogoUpload';
import { requireSettingsUser, SettingsSectionPage } from '../shared';

export const dynamic = 'force-dynamic';

export default async function UtseendePage() {
  const user = await requireSettingsUser();
  return (
    <SettingsSectionPage
      slug="utseende"
      roles={user.roles}
      intro="Ladda upp din organisations logotyp för light och dark mode. Saknas en egen logotyp visas Movexum-wordmarken."
    >
      <section className="max-w-3xl rounded-2xl border border-default bg-surface p-5">
        <TenantLogoUpload
          logoLightUrl={user.tenantLogoLightUrl}
          logoDarkUrl={user.tenantLogoDarkUrl}
        />
      </section>
    </SettingsSectionPage>
  );
}
