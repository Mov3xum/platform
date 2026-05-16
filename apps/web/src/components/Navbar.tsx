import Link from 'next/link';
import { canAccessModuleForUser } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth.server';
import { LogoutButton } from './LogoutButton';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeProvider';
import { NavbarMobileMenu } from './NavbarMobileMenu';
import { coreModules } from '@platform/shared';

export function Navbar({ user }: { user: SessionUser | null }) {
  const visibleModules = user
    ? coreModules.filter((m) => canAccessModuleForUser(user.roles, m.id, user.disabledModules))
    : [];

  return (
    <nav className="sticky top-0 z-30 border-b border-default bg-surface/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:gap-6 sm:px-6 sm:py-4 lg:px-8">
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

        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          {user ? (
            <>
              <div className="hidden text-right md:block">
                <p className="text-sm font-medium text-foreground">{user.name}</p>
                <p className="text-xs text-foreground-subtle">
                  {user.tenantName || user.tenantSlug || ''} · {user.roles.join(', ')}
                </p>
              </div>
              <div className="hidden md:block">
                <LogoutButton />
              </div>
              <NavbarMobileMenu
                user={{ name: user.name, email: user.email, tenantName: user.tenantName, tenantSlug: user.tenantSlug, roles: user.roles }}
                modules={visibleModules.map((m) => ({ id: m.id, title: m.title, route: m.route }))}
              />
            </>
          ) : (
            <Link
              href="/login"
              className="inline-flex rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover sm:px-5"
            >
              Logga in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
