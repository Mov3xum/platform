import { type Role } from '@platform/shared';
import type { SessionUser } from '@/lib/auth.server';
import { getServerPb } from '@/lib/auth.server';
import { ThemeToggle } from './ThemeProvider';
import { Logo } from './Logo';
import { LogoutButton } from './LogoutButton';
import { DesktopNavigation, MobileNavigation } from './AppNavigation';

type AppShellProps = {
  user: SessionUser;
  children: React.ReactNode;
};

export async function AppShell({ user, children }: AppShellProps) {
  const roles = user.roles as Role[];
  let assignedWorkshopCount = 0;

  if (roles.includes('startup_member') && user.linkedStartups.length > 0) {
    try {
      const pb = await getServerPb();
      const linkedFilter = user.linkedStartups.map((id) => `startup = "${id}"`).join(' || ');
      const result = await pb.collection('workshop_assignments').getList(1, 1, {
        filter: `tenant = "${user.tenant}" && status != "done" && (${linkedFilter})`
      });
      assignedWorkshopCount = result.totalItems;
    } catch {
      assignedWorkshopCount = 0;
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="sticky top-0 hidden h-screen w-72 flex-col border-r border-default bg-surface lg:flex">
          <div className="border-b border-default px-6 py-5">
            <Logo href="/dashboard" />
          </div>

          <div className="flex-1 px-4 py-5">
            <DesktopNavigation roles={roles} assignedWorkshopCount={assignedWorkshopCount} />
          </div>

          <div className="border-t border-default px-6 py-5">
            <p className="truncate text-sm font-medium text-foreground">{user.name || user.email}</p>
            <p className="mt-1 truncate text-xs text-foreground-subtle">
              {user.tenantName || user.tenantSlug || 'Movexum'}
            </p>
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-default bg-surface/85 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <MobileNavigation roles={roles} assignedWorkshopCount={assignedWorkshopCount} />
              <div className="lg:hidden">
                <Logo href="/dashboard" />
              </div>
              <div className="ml-auto flex items-center gap-2">
                <ThemeToggle />
                <LogoutButton />
              </div>
            </div>
          </header>

          <div className="flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
