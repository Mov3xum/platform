import { TenantLogoUpload } from '../TenantLogoUpload';
import { LoginBrandingEditor } from '../LoginBrandingEditor';
import { requireSettingsUser, SettingsSectionPage } from '../shared';
import { getServerPb } from '@/lib/auth.server';
import { isLoginBrandingTenant, loadTenantLoginBranding } from '@/lib/login-branding.server';
import { DEFAULT_LOGIN_BRANDING } from '@platform/shared';
import { toLoginBrandingView } from '@/lib/login-branding';

export const dynamic = 'force-dynamic';

export default async function UtseendePage() {
  const user = await requireSettingsUser();
  const pb = await getServerPb();
  const [loginBranding, isLoginTenant] = await Promise.all([
    loadTenantLoginBranding(pb, user.tenant),
    isLoginBrandingTenant(user.tenant)
  ]);
  const view = loginBranding?.view ?? toLoginBrandingView(user.tenant, DEFAULT_LOGIN_BRANDING);

  return (
    <SettingsSectionPage
      slug="utseende"
      roles={user.roles}
      intro="Logotyp för light och dark mode samt inloggningssidans utseende. Ändringarna gäller alla användare i systemet."
    >
      <div className="grid max-w-4xl gap-6">
        <section className="rounded-2xl border border-default bg-surface p-5">
          <h2 className="mb-1 font-heading text-base font-semibold text-foreground">Logotyp</h2>
          <p className="mb-4 text-xs text-foreground-subtle">
            Saknas en egen logotyp visas Movexum-wordmarken.
          </p>
          <TenantLogoUpload
            logoLightUrl={user.tenantLogoLightUrl}
            logoDarkUrl={user.tenantLogoDarkUrl}
          />
        </section>

        <section className="rounded-2xl border border-default bg-surface p-5">
          <h2 className="mb-1 font-heading text-base font-semibold text-foreground">
            Inloggningssidan
          </h2>
          <p className="mb-4 text-xs text-foreground-subtle">
            Välj mall, färg, texter och bild eller video för landningssidan där alla loggar in.
          </p>
          <LoginBrandingEditor
            initial={view}
            schemaMissing={loginBranding?.schemaMissing ?? []}
            isLoginTenant={isLoginTenant}
          />
        </section>
      </div>
    </SettingsSectionPage>
  );
}
