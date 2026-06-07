import type { PageTab } from '@/components/PageShell';

/**
 * Horisontell sektionsmeny för Startupkompassen (`/inflode`). Speglar de fyra
 * vyerna från movexum-token-usage: **Dashboard**, **Analys**, **Leads** och
 * **Moduler**. Leads-fliken kan visa en badge med antal leads kvar i tratten.
 */
export function buildInflodeTabs(opts: { leadsBadge?: number } = {}): PageTab[] {
  return [
    { id: 'dashboard', label: 'Dashboard', href: '/inflode' },
    { id: 'analys', label: 'Analys', href: '/inflode/analysis' },
    { id: 'leads', label: 'Leads', href: '/inflode/leads', badge: opts.leadsBadge },
    { id: 'moduler', label: 'Moduler', href: '/inflode/admin/modules' }
  ];
}
