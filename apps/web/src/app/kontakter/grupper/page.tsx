import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { countPendingRequestsForOwner, listContactGroups, listContacts } from '@/lib/contacts/data';
import { CONTACT_BOOK_ROLES } from '@platform/shared';
import { Notice } from '../ui';
import { GroupsManager } from './GroupsManager';

export const dynamic = 'force-dynamic';

/** Egna grupper i kontaktboken (CLAUDE.md § 45.8): skapa, döp om, ta bort. */
export default async function KontaktGrupperPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'kontakter', user.enabledModules)) redirect('/hem');
  const canEdit = hasRole(user.roles, [...CONTACT_BOOK_ROLES]);
  const pb = await getServerPb();

  const [groupRes, contacts, myPending] = await Promise.all([
    listContactGroups(pb, user.tenant),
    listContacts(pb, user.tenant),
    countPendingRequestsForOwner(pb, user.tenant, user.id)
  ]);

  const counts = new Map<string, number>();
  for (const c of contacts) for (const g of c.groups) counts.set(g, (counts.get(g) ?? 0) + 1);

  return (
    <PageShell
      title="Kontaktbok"
      meta={<span className="text-sm text-foreground-subtle mx-tnum">{groupRes.groups.length} grupper</span>}
      tabs={[
        { id: 'alla', label: 'Kontakter', href: '/kontakter' },
        { id: 'grupper', label: 'Grupper', href: '/kontakter/grupper' },
        { id: 'forfragningar', label: 'Förfrågningar', href: '/kontakter/forfragningar', badge: myPending },
        ...(canEdit ? [{ id: 'import', label: 'Importera', href: '/kontakter/import' }] : [])
      ]}
    >
      <div className="space-y-4">
        <p className="text-sm text-foreground-muted">
          Samla kontakter i egna grupper — t.ex. &quot;Frukostgänget&quot; eller &quot;Investerare Gävleborg&quot;. En
          kontakt kan ligga i flera grupper. Grupperna går att välja direkt när du bjuder in till ett event. Lägg till
          kontakter genom att bocka i dem i kontaktlistan eller på kontaktkortet.
        </p>
        {groupRes.missing ? (
          <Notice kind="warning">
            Grupper saknas i databasen än — kör migration 1700000199 (eller workflowen &quot;Sync PocketBase&quot;).
          </Notice>
        ) : groupRes.error ? (
          <Notice kind="error">{groupRes.error}</Notice>
        ) : (
          <GroupsManager
            groups={groupRes.groups.map((g) => ({
              id: g.id,
              name: g.name,
              description: g.description,
              count: counts.get(g.id) ?? 0
            }))}
            canEdit={canEdit}
          />
        )}
      </div>
    </PageShell>
  );
}
