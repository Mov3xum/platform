import { type Role } from '@platform/shared';
import type { SessionUser } from '@/lib/auth.server';
import { getServerPb } from '@/lib/auth.server';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { unstable_cache } from 'next/cache';
import { ThemeToggle } from './ThemeProvider';
import { Logo } from './Logo';
import { DesktopNavigation, MobileNavigation } from './AppNavigation';
import Image from 'next/image';
import Link from 'next/link';
import { Settings } from 'lucide-react';

type AppShellProps = {
  user: SessionUser;
  children: React.ReactNode;
};

const getAssignedWorkshopCount = unstable_cache(
  async (tenant: string, linkedStartupsKey: string) => {
    if (!linkedStartupsKey) return 0;
    const linkedStartups = linkedStartupsKey.split(',').filter(Boolean);
    if (linkedStartups.length === 0) return 0;

    const pb = await getServerPb();
    const linkedFilter = linkedStartups.map((id) => `startup = "${id}"`).join(' || ');
    const result = await pb.collection(PB_COLLECTIONS.workshopAssignments).getList(1, 1, {
      filter: `tenant = "${tenant}" && status != "done" && (${linkedFilter})`
    });
    return result.totalItems;
  },
  ['assigned-workshop-count'],
  { revalidate: 300 }
);

export async function AppShell({ user, children }: AppShellProps) {
  const roles = user.roles as Role[];
  let assignedWorkshopCount = 0;

  if (roles.includes('startup_member') && user.linkedStartups.length > 0) {
    try {
      assignedWorkshopCount = await getAssignedWorkshopCount(
        user.tenant,
        user.linkedStartups.join(',')
      );
    } catch {
      assignedWorkshopCount = 0;
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="sticky top-0 hidden h-screen w-64 flex-col border-r border-default bg-surface lg:flex">
          <div className="border-b border-default px-6 py-5">
            <Logo href="/dashboard" />
          </div>

          <div className="flex-1 px-4 py-5">
            <DesktopNavigation roles={roles} assignedWorkshopCount={assignedWorkshopCount} />
          </div>

          <div className="border-t border-default px-4 py-4">
            <Link
              href="/konto"
              className="group flex items-center gap-3 rounded-2xl px-2 py-2 transition hover:bg-canvas-subtle"
              title="Mitt konto"
            >
              {user.avatarUrl ? (
                <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded-full border border-default">
                  <Image src={user.avatarUrl} alt="Avatar" fill className="object-cover" sizes="32px" />
                </div>
              ) : (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-movexum-pastell-lila text-xs font-semibold text-movexum-lila">
                  {(user.name || user.email).slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{user.name || user.email}</p>
                <p className="truncate text-xs text-foreground-subtle">
                  {user.tenantName || user.tenantSlug || 'Movexum'}
                </p>
              </div>
              <Settings className="h-4 w-4 flex-shrink-0 text-foreground-subtle opacity-0 transition group-hover:opacity-100" />
            </Link>
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-default bg-surface/85 px-4 py-3 backdrop-blur-xl sm:px-6 lg:hidden">
            <div className="flex items-center gap-3">
              <MobileNavigation roles={roles} assignedWorkshopCount={assignedWorkshopCount} />
              <div className="lg:hidden">
                <Logo href="/dashboard" />
              </div>
              <div className="ml-auto flex items-center gap-2">
                <ThemeToggle />
                <Link
                  href="/konto"
                  className="inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-default bg-surface transition hover:border-brand"
                  aria-label="Mitt konto"
                >
                  {user.avatarUrl ? (
                    <Image src={user.avatarUrl} alt="Avatar" width={36} height={36} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs font-semibold text-foreground-muted">
                      {(user.name || user.email).slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </Link>
              </div>
            </div>
          </header>

          <div className="flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
