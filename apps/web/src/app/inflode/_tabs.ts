import type { PageTab } from '@/components/PageShell';

/**
 * Horisontell sektionsmeny för Marknadsverktyg (`/inflode`): **Dashboard**,
 * **Analys**, **Leads**, **Startupkompassen** (intag-moduler: formulär, quiz och
 * AI-chattar för startups och inflöde), **Events** (eventflöde, deltagare och
 * tratt, § 53), **Inbjudningar** (inbjudningar till event med svar, § 53.5),
 * **Kampanjer** (e-postutskick med mallar, spärrlista och statistik, § 54),
 * **Utvärdering** (digitala enkäter, § 47) och **Community** (alumni och
 * nätverk). Leads-fliken kan visa en badge med antal leads kvar i tratten.
 *
 * Varje flik hör till en modul (`inflode`, `events`, `community`) som har egen
 * behörighet. Skicka `canAccess` från sidor som fler roller än marknadsverktyget
 * når (Events/Community — t.ex. observer), så visas bara flikar användaren
 * faktiskt får öppna. Flikarna är UI-kurering; varje sida gatar själv.
 */
export function buildInflodeTabs(
  opts: { leadsBadge?: number; canAccess?: (moduleId: string) => boolean } = {}
): PageTab[] {
  const tabs: (PageTab & { module: string })[] = [
    { id: 'dashboard', label: 'Dashboard', href: '/inflode', module: 'inflode' },
    { id: 'analys', label: 'Analys', href: '/inflode/analysis', module: 'inflode' },
    { id: 'leads', label: 'Leads', href: '/inflode/leads', badge: opts.leadsBadge, module: 'inflode' },
    { id: 'startupkompassen', label: 'Startupkompassen', href: '/inflode/admin/modules', module: 'inflode' },
    { id: 'events', label: 'Events', href: '/inflode/events', module: 'events' },
    { id: 'inbjudningar', label: 'Inbjudningar', href: '/inflode/inbjudningar', module: 'inflode' },
    { id: 'kampanjer', label: 'Kampanjer', href: '/inflode/kampanjer', module: 'inflode' },
    { id: 'utvardering', label: 'Utvärdering', href: '/inflode/utvardering', module: 'inflode' },
    { id: 'community', label: 'Community', href: '/inflode/community', module: 'community' }
  ];
  const canAccess = opts.canAccess ?? (() => true);
  return tabs
    .filter((t) => canAccess(t.module))
    .map((t) => ({ id: t.id, label: t.label, href: t.href, badge: t.badge }));
}
