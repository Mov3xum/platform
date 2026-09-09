import type { SessionUser } from '@/lib/auth.server';
import { ProtoRail } from './ProtoRail';
import { ProtoTopBar } from './ProtoTopBar';
import { MobileRailProvider, MobileRailBackdrop } from './MobileRail';
import type { SwitchableStartup } from './StartupSwitcher';
import { MobileBottomNav } from './MobileBottomNav';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { buildMobileNav } from '@/lib/mobile-nav';
import { canAccessModuleForUser } from '@/lib/rbac';

interface Props {
  user: SessionUser;
  children: React.ReactNode;
  counts?: Record<string, number>;
  switchableStartups?: SwitchableStartup[];
}

export function ProtoShell({ user, children, counts, switchableStartups }: Props) {
  // Bottom-menyn (§ 35) — samma RBAC-filter som railen, beräknad server-side.
  const mobileNav = buildMobileNav(user.roles, user.enabledModules, counts ?? {}, canAccessModuleForUser);

  return (
    <MobileRailProvider>
      <ProtoRail
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          tenantLogoLightUrl: user.tenantLogoLightUrl,
          tenantLogoDarkUrl: user.tenantLogoDarkUrl,
          roles: user.roles,
          enabledModules: user.enabledModules
        }}
        counts={counts}
        switchableStartups={switchableStartups}
      />
      <MobileRailBackdrop />
      <div className="mx-main-col">
        <ProtoTopBar />
        <main className="mx-view">{children}</main>
      </div>
      <InstallPrompt />
      {mobileNav && <MobileBottomNav nav={mobileNav} />}
    </MobileRailProvider>
  );
}
