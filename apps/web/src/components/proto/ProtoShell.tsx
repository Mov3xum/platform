import type { SessionUser } from '@/lib/auth.server';
import { ProtoRail } from './ProtoRail';
import { ProtoTopBar } from './ProtoTopBar';

interface Props {
  user: SessionUser;
  children: React.ReactNode;
  counts?: Record<string, number>;
}

function tenantShort(name?: string): string {
  if (!name) return 'MX';
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ProtoShell({ user, children, counts }: Props) {
  return (
    <div className="mx-app">
      <ProtoRail
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          roles: user.roles
        }}
        tenant={{
          short: tenantShort(user.tenantName || user.tenantSlug),
          name: user.tenantName || user.tenantSlug || 'Movexum',
          region: user.tenantName ? 'Region Gävleborg' : undefined
        }}
        counts={counts}
      />
      <div className="mx-main-col">
        <ProtoTopBar user={{ name: user.name, roles: user.roles }} />
        <main className="mx-view">{children}</main>
      </div>
    </div>
  );
}
