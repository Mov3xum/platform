import type { SessionUser } from '@/lib/auth.server';
import { ProtoRail } from './ProtoRail';
import { ProtoTopBar } from './ProtoTopBar';
import { MobileRailProvider, MobileRailBackdrop } from './MobileRail';
import type { SwitchableStartup } from './StartupSwitcher';
import { MobileBottomNav } from './MobileBottomNav';
import { SessionGuard } from './SessionGuard';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { buildMobileNav } from '@/lib/mobile-nav';
import { canAccessModuleForUser } from '@/lib/rbac';
import { isPureStartupMember } from '@platform/shared';

interface Props {
  user: SessionUser;
  children: React.ReactNode;
  counts?: Record<string, number>;
  switchableStartups?: SwitchableStartup[];
}

export function ProtoShell({ user, children, counts, switchableStartups }: Props) {
  // Bottom-menyn (§ 35) — samma RBAC-filter som railen, beräknad server-side.
  const mobileNav = buildMobileNav(user.roles, user.enabledModules, counts ?? {}, canAccessModuleForUser);
  // Klockan (§ 50): "Visa alla" leder till Mina uppgifter när personen har den
  // sidan; en ren bolagsmedlem har den inte i sin meny (§ 22).
  const notificationsHref =
    !isPureStartupMember(user.roles) && canAccessModuleForUser(user.roles, 'inkorg', user.enabledModules)
      ? '/inkorg#notiser'
      : null;

  return (
    <MobileRailProvider>
      <SessionGuard />
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
        <ProtoTopBar unseenNotifications={counts?.notiser ?? 0} notificationsHref={notificationsHref} />
        <main className="mx-view">{children}</main>
      </div>
      <InstallPrompt />
      {mobileNav && <MobileBottomNav nav={mobileNav} />}
    </MobileRailProvider>
  );
}
