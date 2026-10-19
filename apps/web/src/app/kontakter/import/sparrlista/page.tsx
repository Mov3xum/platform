import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { SuppressionImportForm } from './SuppressionImportForm';

export const dynamic = 'force-dynamic';

/**
 * Import av spärrlista (§ 54.2) — Mailchimps "unsubscribed"/"cleaned"-export
 * (eller valfri CSV/Excel med en e-postkolumn). Adresserna hashas och
 * spärras; motsvarande kontakter får e-poststatus och opt-out. Den som
 * avregistrerat sig i det gamla verktyget får aldrig ett mejl från det nya.
 */
export default async function ImportSuppressionsPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'kontakter', user.enabledModules)) redirect('/hem');
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) redirect('/kontakter');
  return (
    <PageShell
      title="Importera spärrlista"
      tabs={[
        { id: 'alla', label: 'Kontakter', href: '/kontakter' },
        { id: 'grupper', label: 'Grupper', href: '/kontakter/grupper' },
        { id: 'forfragningar', label: 'Förfrågningar', href: '/kontakter/forfragningar' },
        { id: 'import', label: 'Importera', href: '/kontakter/import' }
      ]}
      activeTabId="import"
    >
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <p className="text-sm text-foreground-muted">
          Exportera <strong>Unsubscribed</strong> och <strong>Cleaned</strong> (studsade) ur Mailchimp (Audience → Export) och ladda upp filerna här — en i taget eller alla kontakter med statuskolumnen. Vi läser kolumnen med e-post (och MEMBER_RATING/status om den finns), sparar bara en hash och spärrar adressen för alla framtida utskick.{' '}
          <Link href="/installningar/e-post" className="text-link">
            Spärrlistan
          </Link>
        </p>
        <SuppressionImportForm />
      </div>
    </PageShell>
  );
}
