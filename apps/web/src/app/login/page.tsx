import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth.server';
import { getPublicPbUrl } from '@/lib/pb-url';
import { loadPublicLoginBranding, resolveLoginBrandingTenant } from '@/lib/login-branding.server';
import { LoginLanding } from '@/components/login/LoginLanding';

export const metadata = {
  title: 'Logga in — Movexum'
};

// Alltid färsk: utseendet (CLAUDE.md § 48) läses per request så att en
// admins sparade mall/bild syns direkt för alla som loggar in.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; forhandsgranska?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const next = params.next || '/dashboard';
  // Admin förhandsgranskar från Inställningar → Logotyp & varumärke: en
  // inloggad användare skulle annars redirectas bort från /login.
  const preview = Boolean(user) && params.forhandsgranska === '1';

  if (user && !preview) {
    redirect(next);
  }

  // Inloggningssidan är oinloggad — utseendet kommer från den tenant
  // deployen resolvar (§ 48), inte från någon session. Fail-soft: standard
  // vid saknad superuser eller läsfel.
  const [branding, tenantRow] = await Promise.all([
    loadPublicLoginBranding(),
    resolveLoginBrandingTenant()
  ]);
  const pbUrl = getPublicPbUrl();
  const logoLightUrl =
    tenantRow && typeof tenantRow.logo_light === 'string' && tenantRow.logo_light
      ? `${pbUrl}/api/files/tenants/${tenantRow.id}/${tenantRow.logo_light}`
      : undefined;
  const logoDarkUrl =
    tenantRow && typeof tenantRow.logo_dark === 'string' && tenantRow.logo_dark
      ? `${pbUrl}/api/files/tenants/${tenantRow.id}/${tenantRow.logo_dark}`
      : undefined;

  return (
    <LoginLanding
      view={branding.view}
      next={next}
      logoLightUrl={logoLightUrl}
      logoDarkUrl={logoDarkUrl}
      preview={preview}
    />
  );
}
