import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listStaffUsers } from '@/lib/contacts/data';
import { CONTACT_BOOK_ROLES } from '@platform/shared';
import { ContactForm } from '../ContactForm';
import { BackLink } from '../ui';

export const dynamic = 'force-dynamic';

export default async function NyKontaktPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'kontakter', user.enabledModules)) redirect('/hem');
  if (!hasRole(user.roles, [...CONTACT_BOOK_ROLES])) redirect('/kontakter');
  const pb = await getServerPb();
  const staff = await listStaffUsers(pb, user.tenant);

  return (
    <PageShell title="Ny kontakt" meta={<BackLink href="/kontakter" label="Kontaktboken" />}>
      <div className="mx-auto w-full max-w-3xl">
        <ContactForm
          mode="create"
          owners={staff.map((s) => ({ id: s.id, name: s.name }))}
          meId={user.id}
          canSetGender={hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])}
        />
      </div>
    </PageShell>
  );
}
