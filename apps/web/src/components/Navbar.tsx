import Link from 'next/link';
import { canAccessModule } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth.server';
import { LogoutButton } from './LogoutButton';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeProvider';
import { coreModules } from '@platform/shared';

export function Navbar({ user }: { user: SessionUser | null }) {
  const visibleModules = user
    ? coreModules.filter((m) => canAccessModule(user.roles, m.id))
    : [];

  return (
    <nav className="sticky top-0 z-30 border-b border-default bg-surface/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4 lg:px-8">
        <Logo href={user ? '/dashboard' : '/'} />

        {user ? (
          <div className="hidden items-center gap-1 md:flex">
            {visibleModules.map((m) => (
              <Link
                key={m.id}
                href={m.route}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground"
              >
                {m.title}
              </Link>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <ThemeToggle />
          {user ? (
            <>
              <div className="hidden text-right md:block">
                <p className="text-sm font-medium text-foreground">{user.name}</p>
                <p className="text-xs text-foreground-subtle">
                  {user.tenantName || user.tenantSlug || ''} · {user.roles.join(', ')}
                </p>
              </div>
              <LogoutButton />
            </>
          ) : (
            <Link
              href="/login"
              className="inline-flex rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
            >
              Logga in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
