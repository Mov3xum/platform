import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { getContact, listStaffUsers } from '@/lib/contacts/data';
import { CONTACT_BOOK_ROLES, contactDisplayName } from '@platform/shared';
import { ContactForm } from '../../ContactForm';
import { BackLink } from '../../ui';

export const dynamic = 'force-dynamic';

export default async function RedigeraKontaktPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'kontakter', user.enabledModules)) redirect('/hem');
  if (!hasRole(user.roles, [...CONTACT_BOOK_ROLES])) redirect(`/kontakter/${id}`);
  const pb = await getServerPb();
  const [contact, staff] = await Promise.all([getContact(pb, user.tenant, id), listStaffUsers(pb, user.tenant)]);
  if (!contact) notFound();
  const canSetGender = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);

  return (
    <PageShell title={`Redigera ${contactDisplayName(contact)}`} meta={<BackLink href={`/kontakter/${id}`} label="Kontaktkortet" />}>
      <div className="mx-auto w-full max-w-3xl">
        <ContactForm
          mode="edit"
          initial={{
            id: contact.id,
            first_name: contact.first_name,
            last_name: contact.last_name,
            email: contact.email ?? '',
            phone: contact.phone ?? '',
            organization: contact.organization ?? '',
            primary_role: contact.primary_role ?? '',
            category: contact.category ?? '',
            kommun: contact.kommun ?? '',
            skills: contact.skills ?? '',
            info: contact.info ?? '',
            owners: contact.owners,
            gender: canSetGender ? ((await pb.collection('contacts').getOne<{ gender?: string }>(id, { fields: 'gender' }).catch(() => ({ gender: '' }))).gender ?? '') : undefined
          }}
          owners={staff.map((s) => ({ id: s.id, name: s.name }))}
          meId={user.id}
          canSetGender={canSetGender}
        />
      </div>
    </PageShell>
  );
}
