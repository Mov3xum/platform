import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import {
  STARTUP_CONTACTS,
  countPendingRequestsForOwner,
  listContactRequests,
  listContacts,
  listStaffUsers
} from '@/lib/contacts/data';
import { CONTACT_BOOK_ROLES } from '@platform/shared';
import { ContactsBrowser, type BrowserContact } from './ContactsBrowser';
import { GdprBanner, btnGhost, btnPrimary } from './ui';

export const dynamic = 'force-dynamic';

export default async function KontakterPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'kontakter', user.enabledModules)) redirect('/hem');
  const canEdit = hasRole(user.roles, [...CONTACT_BOOK_ROLES]);
  const pb = await getServerPb();

  const [contacts, staff, pending, myPending, links] = await Promise.all([
    listContacts(pb, user.tenant),
    listStaffUsers(pb, user.tenant),
    listContactRequests(pb, user.tenant, { status: 'pending', limit: 500 }),
    countPendingRequestsForOwner(pb, user.tenant, user.id),
    pb
      .collection(STARTUP_CONTACTS)
      .getFullList<{ contact: string }>({
        filter: pb.filter('startup.tenant = {:tenant}', { tenant: user.tenant }),
        fields: 'contact',
        batch: 500
      })
      .catch(() => [] as { contact: string }[])
  ]);

  const linkCount = new Map<string, number>();
  for (const l of links) linkCount.set(l.contact, (linkCount.get(l.contact) ?? 0) + 1);
  const pendingCount = new Map<string, number>();
  for (const r of pending) pendingCount.set(r.contact, (pendingCount.get(r.contact) ?? 0) + 1);

  const rows: BrowserContact[] = contacts.map((c) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    organization: c.organization,
    primary_role: c.primary_role,
    category: c.category,
    kommun: c.kommun,
    skills: c.skills,
    owners: c.owners,
    linkedStartups: linkCount.get(c.id) ?? 0,
    pendingRequests: pendingCount.get(c.id) ?? 0,
    hasEmail: Boolean(c.email),
    hasPhone: Boolean(c.phone)
  }));

  return (
    <PageShell
      title="Kontaktbok"
      meta={
        <span className="text-sm text-foreground-subtle mx-tnum">
          {rows.length} kontakter · {new Set(rows.flatMap((r) => r.owners)).size} ägare
        </span>
      }
      tabs={[
        { id: 'alla', label: 'Kontakter', href: '/kontakter' },
        { id: 'forfragningar', label: 'Förfrågningar', href: '/kontakter/forfragningar', badge: myPending },
        ...(canEdit ? [{ id: 'import', label: 'Importera', href: '/kontakter/import' }] : [])
      ]}
      actions={
        canEdit ? (
          <>
            <Link href="/kontakter/import" className={btnGhost}>
              <Icon name="upload" size={13} /> Importera
            </Link>
            <Link href="/kontakter/ny" className={btnPrimary}>
              <Icon name="plus" size={13} /> Ny kontakt
            </Link>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-foreground-muted">
          Movexums gemensamma kontaktbok. Varje kontakt har en eller flera interna ägare — vill du använda en kollegas
          kontakt (t.ex. koppla ihop den med ett bolag) ber du ägaren om bekräftelse direkt på kontaktkortet, eller i
          chatten. Godkända förfrågningar delar kontakten med bolaget via systemet.
        </p>
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-sm text-foreground-muted">
            Kontaktboken är tom.{' '}
            {canEdit && (
              <>
                <Link href="/kontakter/ny" className="text-link hover:underline">
                  Lägg till den första
                </Link>{' '}
                eller{' '}
                <Link href="/kontakter/import" className="text-link hover:underline">
                  importera befintliga kontakter
                </Link>
                .
              </>
            )}
          </div>
        ) : (
          <ContactsBrowser contacts={rows} owners={staff.map((s) => ({ id: s.id, name: s.name }))} meId={user.id} />
        )}
        <GdprBanner />
      </div>
    </PageShell>
  );
}
