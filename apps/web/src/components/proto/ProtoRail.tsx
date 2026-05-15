import Link from 'next/link';
import { Icon } from './Icon';
import { coreModules, RAIL_GROUPS, type Role } from '@platform/shared';
import { canAccessModule } from '@/lib/rbac';
import { ModuleNavItem } from './ModuleNavItem';
import { Logo } from '@/components/Logo';

const moduleIcons: Record<string, string> = {
  idag: 'home',
  uppdrag: 'flow',
  kompassen: 'compass',
  startups: 'people',
  investerare: 'graph',
  events: 'spark',
  community: 'people',
  education: 'cap',
  rapporter: 'doc',
  agenter: 'bolt',
  integrationer: 'link',
  installningar: 'gear'
};

interface ProtoRailProps {
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
    roles: Role[];
  };
  counts?: Record<string, number>;
}

export function ProtoRail({ user, counts = {} }: ProtoRailProps) {
  const initial =
    (user.name || user.email)
      .split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '??';

  return (
    <aside className="mx-rail">
      <div className="mx-rail-head">
        <Logo
          href="/idag"
          variant="dark"
          width={168}
          height={40}
          className="mx-rail-brand"
        />
      </div>

      <nav className="mx-rail-nav">
        {RAIL_GROUPS.map((group) => {
          const groupModules = group.modules
            .map((id) => coreModules.find((m) => m.id === id))
            .filter((m) => m !== undefined && canAccessModule(user.roles, m.id));

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
