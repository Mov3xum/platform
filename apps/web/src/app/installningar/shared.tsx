import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireUser, type SessionUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell, type PageTab } from '@/components/PageShell';
import { Icon } from '@/components/proto/Icon';
import {
  findSettingsSection,
  settingsSectionsFor,
  type SettingsSection
} from '@/lib/settings-sections';

/** RBAC-grind för alla sidor under /installningar (admin/incubator_lead). */
export async function requireSettingsUser(): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/chatt');
  }
  return user;
}

export function settingsTabsFor(roles: readonly string[] | undefined): PageTab[] {
  return [
    { id: 'oversikt', label: 'Översikt', href: '/installningar' },
    ...settingsSectionsFor(roles).map((s) => ({ id: s.id, label: s.title, href: s.href }))
  ];
}

/**
 * Gemensamt skal för en undersida i Inställningar: sidtitel, flikar till
 * alla sektioner användaren får se och en tillbakalänk till översikten.
 */
export function SettingsSectionPage({
  slug,
  roles,
  intro,
  actions,
  rightPanel,
  children
}: {
  slug: string;
  roles: readonly string[] | undefined;
  intro?: ReactNode;
  actions?: ReactNode;
  rightPanel?: ReactNode;
  children: ReactNode;
}) {
  const section = findSettingsSection(slug);
  const title = section?.title ?? 'Inställningar';
  return (
    <PageShell
      title={title}
      tabs={settingsTabsFor(roles)}
      actions={actions}
      rightPanel={rightPanel}
    >
      <div className="space-y-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            {intro && (
              <p className="text-[13.5px] leading-relaxed text-foreground-muted">{intro}</p>
            )}
          </div>
          <Link
            href="/installningar"
            className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-[12px] font-medium text-foreground-muted transition hover:bg-canvas-muted hover:text-foreground"
          >
            <Icon name="back" size={12} />
            Alla inställningar
          </Link>
        </div>
        {children}
      </div>
    </PageShell>
  );
}

/** Kort på hub-sidan som leder in i en sektion. */
export function SettingsCard({
  section,
  stat,
  hint,
  status
}: {
  section: SettingsSection;
  /** Huvudsiffra/-värde, t.ex. "12 användare". */
  stat?: ReactNode;
  /** Sekundär rad under siffran. */
  hint?: ReactNode;
  /** Litet statuselement uppe till höger (chip). */
  status?: ReactNode;
}) {
  return (
    <Link
      href={section.href}
      className="group flex flex-col rounded-2xl border border-default bg-surface p-5 transition hover:border-strong hover:shadow-lg hover:shadow-movexum-svart/5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-movexum-pastell-bla text-brand dark:bg-[#001825] dark:text-[#4fc4ea]">
          <Icon name={section.icon} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-heading text-[15px] font-semibold text-foreground">
              {section.title}
            </h3>
            {status}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-foreground-muted">
            {section.description}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between gap-3 border-t border-default pt-3">
        <div className="min-w-0">
          {stat && (
            <div className="truncate text-[13px] font-semibold text-foreground mx-tnum">{stat}</div>
          )}
          {hint && <div className="truncate text-[11.5px] text-foreground-subtle">{hint}</div>}
        </div>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-canvas-muted text-foreground-subtle transition group-hover:bg-brand group-hover:text-brand-foreground">
          <Icon name="arrow" size={12} />
        </span>
      </div>
    </Link>
  );
}
