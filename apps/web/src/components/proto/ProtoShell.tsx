import type { SessionUser } from '@/lib/auth.server';
import { ProtoRail } from './ProtoRail';
import { ProtoTopBar } from './ProtoTopBar';
import { MobileRailProvider, MobileRailBackdrop } from './MobileRail';

interface Props {
  user: SessionUser;
  children: React.ReactNode;
  counts?: Record<string, number>;
}

export function ProtoShell({ user, children, counts }: Props) {
  return (
    <MobileRailProvider>
      <ProtoRail
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          roles: user.roles,
          disabledModules: user.disabledModules
        }}
        counts={counts}
      />
      <MobileRailBackdrop />
      <div className="mx-main-col">
        <ProtoTopBar />
        <main className="mx-view">{children}</main>
      </div>
    </MobileRailProvider>
  );
}
