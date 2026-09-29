import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { listContactRequests, listStaffUsers, staffNameMap, type ContactRequestRow } from '@/lib/contacts/data';
import { CONTACT_BOOK_ROLES, contactDisplayName } from '@platform/shared';
import { RequestStatusChip, btnGhost, btnPrimary, fmtDateTime } from '../ui';

export const dynamic = 'force-dynamic';

function contactNameOf(r: ContactRequestRow): string {
  const c = r.expand?.contact;
  return c ? contactDisplayName({ first_name: c.first_name ?? '', last_name: c.last_name ?? '' }) : 'Kontakt';
}

export default async function ForfragningarPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'kontakter', user.enabledModules)) redirect('/hem');
  const canEdit = hasRole(user.roles, [...CONTACT_BOOK_ROLES]);
  const pb = await getServerPb();

  const [forMe, mine, staff] = await Promise.all([
    listContactRequests(pb, user.tenant, { ownerId: user.id, limit: 200 }),
    listContactRequests(pb, user.tenant, { requesterId: user.id, limit: 200 }),
    listStaffUsers(pb, user.tenant)
  ]);
  const names = staffNameMap(staff);
  const nameOf = (uid: string | null | undefined, fallback?: string) => (uid ? names.get(uid) : undefined) ?? fallback ?? 'Kollega';

  const waitingForMe = forMe.filter((r) => r.status === 'pending' && r.requester !== user.id);
  const decidedByMe = forMe.filter((r) => r.status !== 'pending' && r.requester !== user.id).slice(0, 30);
  const myPending = mine.filter((r) => r.status === 'pending');
  const myHistory = mine.filter((r) => r.status !== 'pending').slice(0, 30);

  const Row = ({ r, who }: { r: ContactRequestRow; who: 'requester' | 'owner' }) => (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/kontakter/${r.contact}?request=${r.id}`} className="font-medium text-foreground hover:underline">
            {contactNameOf(r)}
          </Link>
          <RequestStatusChip status={r.status} />
          <span className="text-xs text-foreground-subtle">{fmtDateTime(r.created)}</span>
        </div>
        <div className="mt-0.5 text-xs text-foreground-muted">
          {who === 'requester' ? `Frågar: ${nameOf(r.requester, r.expand?.requester?.display_name)}` : 'Din förfrågan'}
          {r.expand?.startup?.name ? ` · dela med ${r.expand.startup.name}` : ''}
          {r.status !== 'pending' && r.decided_by ? ` · avgjord av ${nameOf(r.decided_by, r.expand?.decided_by?.display_name)}` : ''}
        </div>
        <p className="mt-1 line-clamp-2 text-foreground-muted">{r.purpose}</p>
      </div>
      <Link href={`/kontakter/${r.contact}?request=${r.id}`} className={r.status === 'pending' && who === 'requester' ? btnPrimary : btnGhost}>
        {r.status === 'pending' && who === 'requester' ? 'Svara' : 'Öppna'} <Icon name="chevron" size={12} />
      </Link>
    </li>
  );

  const Section = ({ title, items, who, empty }: { title: string; items: ContactRequestRow[]; who: 'requester' | 'owner'; empty: string }) => (
    <section className="rounded-3xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5">
      <h2 className="mb-3 text-base font-semibold text-foreground">
        {title} <span className="text-sm font-normal text-foreground-subtle mx-tnum">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-foreground-subtle">{empty}</p>
      ) : (
        <ul className="divide-y divide-default rounded-2xl border border-default">
          {items.map((r) => (
            <Row key={r.id} r={r} who={who} />
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <PageShell
      title="Förfrågningar"
      tabs={[
        { id: 'alla', label: 'Kontakter', href: '/kontakter' },
        { id: 'forfragningar', label: 'Förfrågningar', href: '/kontakter/forfragningar', badge: waitingForMe.length },
        ...(canEdit ? [{ id: 'import', label: 'Importera', href: '/kontakter/import' }] : [])
      ]}
    >
      <div className="space-y-5">
        <p className="text-sm text-foreground-muted">
          Här ser du förfrågningar om att använda kontakter du äger, och dina egna förfrågningar till kollegor. En
          avgjord förfrågan är slutgiltig — vill någon använda kontakten igen skapas en ny.
        </p>
        <Section title="Väntar på ditt svar" items={waitingForMe} who="requester" empty="Inga förfrågningar väntar på dig." />
        <Section title="Mina förfrågningar" items={[...myPending, ...myHistory]} who="owner" empty="Du har inte skickat några förfrågningar." />
        <Section title="Tidigare avgjorda (dina kontakter)" items={decidedByMe} who="requester" empty="Inget avgjort ännu." />
      </div>
    </PageShell>
  );
}
