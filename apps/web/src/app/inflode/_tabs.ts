import type { PageTab } from '@/components/PageShell';

/**
 * Horisontell sektionsmeny för Marknadsverktyg (`/inflode`). Speglar de
 * vyerna från movexum-token-usage: **Dashboard**, **Analys**, **Leads** och
 * **Startupkompassen** samt **Utvärderingar**. Leads-fliken kan visa en badge
 * med antal leads kvar i tratten.
 */
export function buildInflodeTabs(opts: { leadsBadge?: number } = {}): PageTab[] {
  return [
    { id: 'dashboard', label: 'Dashboard', href: '/inflode' },
    { id: 'analys', label: 'Analys', href: '/inflode/analysis' },
    { id: 'leads', label: 'Leads', href: '/inflode/leads', badge: opts.leadsBadge },
    { id: 'startupkompassen', label: 'Startupkompassen', href: '/inflode/admin/modules' },
    { id: 'evalueringar', label: 'Utvärderingar', href: '/inflode/evalueringar' }
  ];
}
