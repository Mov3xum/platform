import Link from 'next/link';
import { canAccessModule } from '@/lib/rbac';
import type { SessionUser } from '@/lib/auth.server';
import { LogoutButton } from './LogoutButton';
import { coreModules } from '@platform/shared';

export function Navbar({ user }: { user: SessionUser | null }) {
  const visibleModules = user
    ? coreModules.filter((m) => canAccessModule(user.roles, m.id))
    : [];

  return (
    <nav className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4 lg:px-8">
        <Link
          href={user ? '/dashboard' : '/'}
          className="flex shrink-0 items-center gap-3 text-lg font-semibold tracking-tight text-slate-950"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-cyan-600 text-white">
            M
          </span>
          movexum
        </Link>

        {user ? (
          <div className="hidden items-center gap-1 md:flex">
            {visibleModules.map((m) => (
              <Link
                key={m.id}
                href={m.route}
                className="rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
              >
                {m.title}
              </Link>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          {user ? (
            <>
              <div className="hidden text-right md:block">
                <p className="text-sm font-medium text-slate-950">{user.name}</p>
                <p className="text-xs text-slate-500">
                  {user.tenantName || user.tenantSlug || ''} · {user.roles.join(', ')}
                </p>
              </div>
              <LogoutButton />
            </>
          ) : (
            <Link
              href="/login"
              className="inline-flex rounded-full bg-slate-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Logga in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
