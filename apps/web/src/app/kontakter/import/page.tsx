import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listStaffUsers } from '@/lib/contacts/data';
import { CONTACT_BOOK_ROLES } from '@platform/shared';
import { ContactImportForm } from './ContactImportForm';
import { GdprBanner } from '../ui';

export const dynamic = 'force-dynamic';

export default async function ImporteraKontakterPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'kontakter', user.enabledModules)) redirect('/hem');
  if (!hasRole(user.roles, [...CONTACT_BOOK_ROLES])) redirect('/kontakter');
  const pb = await getServerPb();
  const staff = await listStaffUsers(pb, user.tenant);

  return (
    <PageShell
      title="Importera kontakter"
      tabs={[
        { id: 'alla', label: 'Kontakter', href: '/kontakter' },
        { id: 'forfragningar', label: 'Förfrågningar', href: '/kontakter/forfragningar' },
        { id: 'import', label: 'Importera', href: '/kontakter/import' }
      ]}
    >
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <p className="text-sm text-foreground-muted">
          Ladda upp befintliga kontakter från Excel, CSV eller en export från Outlook/Google Kontakter. Kontakter som
          redan finns (samma e-post, annars samma namn + organisation) uppdateras i stället för att dubbleras.
        </p>
        <ContactImportForm owners={staff.map((s) => ({ id: s.id, name: s.name }))} meId={user.id} />
        <GdprBanner />
      </div>
    </PageShell>
  );
}
