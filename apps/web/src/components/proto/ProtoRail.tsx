import Link from 'next/link';
import { Icon } from './Icon';
import { coreModules, RAIL_GROUPS, type Role } from '@platform/shared';
import { canAccessModuleForUser } from '@/lib/rbac';
import { ModuleNavItem } from './ModuleNavItem';
import { Logo } from '@/components/Logo';
import { StartupSwitcher, type SwitchableStartup } from './StartupSwitcher';

const moduleIcons: Record<string, string> = {
  idag: 'message',
  min_oversikt: 'home',
  inkorg: 'home',
  pagaende: 'spark',
  uppdrag: 'flow',
  inflode: 'spark',
  startups: 'people',
  de_minimis: 'shield',
  investerare: 'graph',
  events: 'spark',
  community: 'people',
  education: 'cap',
  rapporter: 'doc',
  agenter: 'bolt',
  insights: 'graph',
  integrationer: 'link',
  installningar: 'gear'
};

interface ProtoRailProps {
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
    tenantLogoLightUrl?: string;
    tenantLogoDarkUrl?: string;
    roles: Role[];
    disabledModules?: string[];
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

  return (
    <aside id="mx-rail" className="mx-rail" aria-label="Huvudnavigation">
      <div className="mx-rail-head">
        <Logo
          href="/chatt"
          variant="dark"
          width={120}
          height={28}
          className="mx-rail-brand"
          logoLightUrl={user.tenantLogoLightUrl}
          logoDarkUrl={user.tenantLogoDarkUrl}
        />
      </div>

      {switchableStartups.length > 0 && (
        <StartupSwitcher startups={switchableStartups} />
      )}

      <nav className="mx-rail-nav">
        {RAIL_GROUPS.map((group) => {
          const groupModules = group.modules
            .map((id) => coreModules.find((m) => m.id === id))
              .filter(
                (m) =>
                  m !== undefined &&
                  canAccessModuleForUser(user.roles, m.id, user.disabledModules)
              );

          if (groupModules.length === 0) return null;

          return (
            <div key={group.label}>
              <div className="mx-rail-group-label">{group.label}</div>
              {groupModules.map((mod) => (
                <ModuleNavItem
                  key={mod!.id}
                  href={mod!.route}
                  label={mod!.title}
                  icon={moduleIcons[mod!.id] || 'dot'}
                  count={counts[mod!.id]}
                />
              ))}
            </div>
          );
        })}
      </nav>

      <div className="mx-rail-foot">
        <div className="mx-rail-user-av">{initial}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mx-rail-user-name">{user.name || user.email}</div>
          <div className="mx-rail-user-role">{user.roles[0]?.replace('_', ' ') || ''}</div>
        </div>
        <Link
          href="/konto"
          className="mx-icon-btn"
          style={{ color: 'rgba(255,255,255,.5)' }}
          aria-label="Mitt konto"
        >
          <Icon name="gear" size={14} />
        </Link>
      </div>
    </aside>
  );
}
