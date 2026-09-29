import type { PageTab } from '@/components/PageShell';

/**
 * Horisontell sektionsmeny för Marknadsverktyg (`/inflode`): **Dashboard**,
 * **Analys**, **Leads**, **Startupkompassen** (intag-moduler: formulär, quiz och
 * AI-chattar för startups och inflöde) och **Utvärdering** (digitala enkäter,
 * § 39). Leads-fliken kan visa en badge med antal leads kvar i tratten.
 */
export function buildInflodeTabs(opts: { leadsBadge?: number } = {}): PageTab[] {
  return [
    { id: 'dashboard', label: 'Dashboard', href: '/inflode' },
    { id: 'analys', label: 'Analys', href: '/inflode/analysis' },
    { id: 'leads', label: 'Leads', href: '/inflode/leads', badge: opts.leadsBadge },
    { id: 'startupkompassen', label: 'Startupkompassen', href: '/inflode/admin/modules' },
    { id: 'utvardering', label: 'Utvärdering', href: '/inflode/utvardering' }
  ];
}
