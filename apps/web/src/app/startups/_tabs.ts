import type { PageTab } from '@/components/PageShell';

/**
 * Horisontell sektionsmeny för Startups. "Inflöde" visas bara för staff
 * (leaddata är staff-only). Badge = antal leads kvar i tratten.
 */
export function buildStartupTabs(opts: { isStaff: boolean; inflowBadge?: number }): PageTab[] {
  const tabs: PageTab[] = [
    { id: 'oversikt', label: 'Översikt', href: '/startups' },
    { id: 'inkubator', label: 'Inkubator', href: '/startups/inkubator' }
  ];
  if (opts.isStaff) {
    tabs.push({
      id: 'inflode',
      label: 'Inflöde',
      href: '/startups/inflode',
      badge: opts.inflowBadge
    });
  }
  return tabs;
}
