import Link from 'next/link';
import type PocketBase from 'pocketbase';
import { Icon } from '@/components/proto';
import { listContactRequests, listContactsForStartup, listStaffUsers, staffNameMap } from '@/lib/contacts/data';
import { contactDisplayName, contactSubtitle } from '@platform/shared';

/**
 * Bolagskortets vy över kontakter kopplade till bolaget (§ 45.4): vilka
 * externa kontakter (via kontaktboken) som delats med bolaget, deras roll,
 * ägare och senaste godkända syfte. Läses med användarens token →
 * staff/observer-RLS på `contacts`/`contact_requests`; en ren bolagsmedlem
 * får tom lista och sektionen visas inte (medlemmen ser sina delade
 * kontakter på Mitt bolag i stället).
 */
export async function StartupContactsSection({
  pb,
  tenantId,
  startupId
}: {
  pb: PocketBase;
  tenantId: string;
  startupId: string;
}) {
  const [links, approved, staff] = await Promise.all([
    listContactsForStartup(pb, startupId),
    listContactRequests(pb, tenantId, { startupId, status: 'approved', limit: 100 }),
    listStaffUsers(pb, tenantId)
  ]);
  if (links.length === 0) return null;
  const names = staffNameMap(staff);
  const purposeByContact = new Map<string, string>();
  for (const r of approved) if (!purposeByContact.has(r.contact)) purposeByContact.set(r.contact, r.purpose);

  return (
    <section id="kontakter" className="scroll-mt-24 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">Kontakter</h2>
        <Link
          href="/kontakter"
          className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle"
        >
          Kontaktboken <Icon name="external" size={14} />
        </Link>
      </div>
      <ul className="divide-y divide-default">
        {links.map((l) => {
          const c = l.expand?.contact;
          if (!c) return null;
          const name = contactDisplayName({ first_name: c.first_name ?? '', last_name: c.last_name ?? '' });
          const sub = contactSubtitle({ organization: c.organization ?? null, primary_role: c.primary_role ?? null });
          const owners = Array.isArray(c.owners) ? (c.owners as string[]) : [];
          const purpose = purposeByContact.get(c.id);
          return (
            <li key={l.id} className="flex flex-wrap items-start gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/kontakter/${c.id}`} className="font-medium text-foreground hover:underline">
                  {name}
                </Link>
                {l.role && <span className="text-foreground-muted"> — {l.role}</span>}
                <div className="mt-0.5 text-xs text-foreground-subtle">
                  {sub}
                  {owners.length > 0 ? `${sub ? ' · ' : ''}ägare: ${owners.map((id) => names.get(id) ?? 'kollega').join(', ')}` : ''}
                </div>
                {purpose && <p className="mt-1 text-xs text-foreground-muted">Syfte: {purpose}</p>}
              </div>
              {c.email && (
                <a href={`mailto:${c.email}`} className="text-xs text-link hover:underline">
                  {c.email}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
