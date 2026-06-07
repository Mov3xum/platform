'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import {
  BarChart3,
  Building2,
  Compass,
  FolderKanban,
  GraduationCap,
  Home,
  Menu,
  Plug2,
  ShieldCheck,
  Sparkles,
  X
} from 'lucide-react';
import { coreModules, type Role } from '@platform/shared';
import { canAccessModuleForUser } from '@/lib/rbac';
import { Logo } from './Logo';

type NavProps = {
  roles: Role[];
  disabledModules?: string[];
  assignedWorkshopCount?: number;
};

const iconByModule: Record<string, ComponentType<{ className?: string }>> = {
  dashboard: Home,
  startups: Building2,
  de_minimis: ShieldCheck,
  partners: FolderKanban,
  onboarding: Compass,
  education: GraduationCap,
  agenter: Sparkles,
  toolbox: Sparkles,
  activity_feed: Compass,
  insights: BarChart3,
  integrationer: Plug2,
};

function isRouteActive(currentPath: string, route: string) {
  if (route === '/dashboard') return currentPath === '/dashboard';
  return currentPath === route || currentPath.startsWith(route + '/');
}

function NavLinks({
  roles,
  disabledModules,
  assignedWorkshopCount = 0,
  closeOnNavigate = false
}: NavProps & { closeOnNavigate?: boolean }) {
  const pathname = usePathname();
  const modules = coreModules.filter((module) =>
    canAccessModuleForUser(roles, module.id, disabledModules)
  );

  return (
    <ul className="space-y-1">
      {modules.map((module) => {
        const Icon = iconByModule[module.id] || Compass;
        const active = isRouteActive(pathname, module.route);

        return (
          <li key={module.id}>
            {closeOnNavigate ? (
              <Dialog.Close asChild>
                <Link
                  href={module.route}
                  className={
                    'group flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium transition ' +
                    (active
                      ? 'bg-brand text-brand-foreground shadow-sm shadow-movexum-lila/25'
                      : 'text-foreground-muted hover:bg-canvas-subtle hover:text-foreground')
                  }
                >
                  <Icon className={active ? 'h-4 w-4' : 'h-4 w-4 text-foreground-subtle group-hover:text-foreground'} />
                  <span>{module.title}</span>
                  {module.id === 'education' && assignedWorkshopCount > 0 ? (
                    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-movexum-orange px-1.5 py-0.5 text-[10px] font-semibold text-brand-foreground">
                      {assignedWorkshopCount}
                    </span>
                  ) : null}
                </Link>
              </Dialog.Close>
            ) : (
              <Link
                href={module.route}
                className={
                  'group flex items-center gap-3 rounded-2xl px-3 py-2 text-sm font-medium transition ' +
                  (active
                    ? 'bg-brand text-brand-foreground shadow-sm shadow-movexum-lila/25'
                    : 'text-foreground-muted hover:bg-canvas-subtle hover:text-foreground')
                }
              >
                <Icon className={active ? 'h-4 w-4' : 'h-4 w-4 text-foreground-subtle group-hover:text-foreground'} />
                <span>{module.title}</span>
                {module.id === 'education' && assignedWorkshopCount > 0 ? (
                  <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-movexum-orange px-1.5 py-0.5 text-[10px] font-semibold text-brand-foreground">
                    {assignedWorkshopCount}
                  </span>
                ) : null}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function DesktopNavigation({ roles, disabledModules, assignedWorkshopCount = 0 }: NavProps) {
  return (
    <NavLinks roles={roles} disabledModules={disabledModules} assignedWorkshopCount={assignedWorkshopCount} />
  );
}

export function MobileNavigation({ roles, disabledModules, assignedWorkshopCount = 0 }: NavProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-default bg-surface text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground lg:hidden"
          aria-label="Öppna meny"
        >
          <Menu className="h-5 w-5" />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-movexum-svart/45 backdrop-blur-[2px]" />
        <Dialog.Content asChild>
          <motion.aside
            initial={{ x: -28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -24, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="fixed inset-y-0 left-0 z-50 w-[86vw] max-w-[340px] border-r border-default bg-surface p-5 shadow-2xl shadow-movexum-svart/20"
          >
            <div className="flex h-full flex-col">
              <div className="mb-6 flex items-center justify-between">
                <Logo href="/dashboard" />
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-default text-foreground-muted transition hover:bg-canvas-subtle hover:text-foreground"
                    aria-label="Stäng meny"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </Dialog.Close>
              </div>

              <nav className="flex-1">
                <NavLinks
                  roles={roles}
                  disabledModules={disabledModules}
                  assignedWorkshopCount={assignedWorkshopCount}
                  closeOnNavigate
                />
              </nav>
            </div>
          </motion.aside>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
