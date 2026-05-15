import Link from 'next/link';
import { Icon } from './Icon';
import { coreModules, RAIL_GROUPS, type Role } from '@platform/shared';
import { canAccessModule } from '@/lib/rbac';
import { ModuleNavItem } from './ModuleNavItem';

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
  tenant: {
    short: string;
    name: string;
    region?: string;
  };
  counts?: Record<string, number>;
}

export function ProtoRail({ user, tenant, counts = {} }: ProtoRailProps) {
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
        <div className="mx-rail-logo">M</div>
        <div className="mx-rail-wordmark">
          movexum
          <small>OS · v0.4</small>
        </div>
      </div>

      <div className="mx-rail-tenant" title="Tenant">
        <div className="mx-ten-av">{tenant.short}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className="mx-ten-name">{tenant.name}</span>
          {tenant.region && <span className="mx-ten-sub">{tenant.region}</span>}
        </div>
        <Icon name="chevdown" size={12} style={{ marginLeft: 'auto', opacity: 0.4 }} />
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
