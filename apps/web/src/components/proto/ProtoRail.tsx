import {
  coreModules,
  RAIL_GROUPS,
  MEMBER_RAIL,
  isPureStartupMember,
  marketingToolsEntry,
  MARKETING_TOOLS_PATH,
  type Role
} from '@platform/shared';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { ModuleNavItem } from './ModuleNavItem';
import { RailToggleButton } from './MobileRail';
import { Logo } from '@/components/Logo';
import { StartupSwitcher, type SwitchableStartup } from './StartupSwitcher';
import { RailAccountMenu } from './RailAccountMenu';
import { MODULE_ICONS } from '@/lib/module-icons';

const moduleIcons = MODULE_ICONS;

interface ProtoRailProps {
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
    tenantLogoLightUrl?: string;
    tenantLogoDarkUrl?: string;
    roles: Role[];
    enabledModules?: string[];
  };
  counts?: Record<string, number>;
  switchableStartups?: SwitchableStartup[];
}

export function ProtoRail({ user, counts = {}, switchableStartups = [] }: ProtoRailProps) {
  const initial =
    (user.name || user.email)
      .split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '??';

  // Ren bolagsmedlem har "Min översikt" som hemvy (staff → Dashboard, § 37).
  const homeHref = isPureStartupMember(user.roles) ? '/min-oversikt' : '/hem';
  // Events och Community är flikar under Marknadsverktyg — posten visas för den
  // som når någon av dem och leder till den första den når.
  const marketingEntry = marketingToolsEntry((id) =>
    canAccessModuleForUser(user.roles, id, user.enabledModules)
  );

  return (
    <aside id="mx-rail" className="mx-rail" aria-label="Huvudnavigation">
      <div className="mx-rail-head">
        {/* `auto` följer temat: svart wordmark/ljus-logotyp på den ljusa
            railen, vit på den mörka. `variant="dark"` tvingade fram den vita
            wordmarken även i ljust läge → osynlig logotyp (§ 2.1). */}
        <Logo
          href={homeHref}
          variant="auto"
          width={120}
          height={28}
          className="mx-rail-brand"
          logoLightUrl={user.tenantLogoLightUrl}
          logoDarkUrl={user.tenantLogoDarkUrl}
        />
        <RailToggleButton />
      </div>

      {switchableStartups.length > 0 && (
        <StartupSwitcher startups={switchableStartups} />
      )}

      <nav className="mx-rail-nav">
        {isPureStartupMember(user.roles) ? (
          // Ren bolagsmedlem → dedikerad, kortare rail (CLAUDE.md § 22).
          <div>
            {MEMBER_RAIL.filter((item) =>
              canAccessModuleForUser(user.roles, item.id, user.enabledModules)
            ).map((item) => (
              <ModuleNavItem
                key={item.id}
                href={coreModules.find((m) => m.id === item.id)?.route ?? '/min-oversikt'}
                label={item.label}
                icon={moduleIcons[item.id] || 'dot'}
                count={counts[item.id]}
              />
            ))}
          </div>
        ) : (
          RAIL_GROUPS.map((group) => {
          const groupModules = group.modules
            .map((id) => coreModules.find((m) => m.id === id))
              .filter(
                (m) =>
                  m !== undefined &&
                  (m.id === 'inflode'
                    ? marketingEntry !== null
                    : canAccessModuleForUser(user.roles, m.id, user.enabledModules))
              );

          if (groupModules.length === 0) return null;

          return (
            <div key={group.label}>
              <div className="mx-rail-group-label">{group.label}</div>
              {groupModules.map((mod) => (
                <ModuleNavItem
                  key={mod!.id}
                  href={mod!.id === 'inflode' && marketingEntry ? marketingEntry.href : mod!.route}
                  activePrefix={mod!.id === 'inflode' ? MARKETING_TOOLS_PATH : undefined}
                  label={mod!.title}
                  icon={moduleIcons[mod!.id] || 'dot'}
                  count={counts[mod!.id]}
                />
              ))}
            </div>
          );
          })
        )}
      </nav>

      <div className="mx-rail-foot">
        <RailAccountMenu
          name={user.name}
          email={user.email}
          role={user.roles[0]?.replace('_', ' ') || ''}
          initial={initial}
          showProfile={
            hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']) ||
            canAccessModuleForUser(user.roles, 'min_profil', user.enabledModules)
          }
        />
      </div>
    </aside>
  );
}
