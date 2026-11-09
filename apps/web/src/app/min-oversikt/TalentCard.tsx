import Link from 'next/link';
import { Icon } from '@/components/proto';
import { listInterestsForStartup, listNeeds } from '@/lib/talent/data';
import { NeedStatusChip } from '@/components/talent/ui';

/** "Studenter & talang" på Mitt bolag (§ 54): bolagets behov + nya intressen. */
export async function TalentCard({ pb, tenantId, startupId }: { pb: import('pocketbase').default; tenantId: string; startupId: string }) {
  const [needs, interests] = await Promise.all([listNeeds(pb, tenantId, { startup: startupId }), listInterestsForStartup(tenantId, startupId)]);
  if (needs.missing) return null;
  const fresh = interests.items.filter(({ interest }) => interest.status === 'new').length;
  const active = needs.items.filter((n) => n.status !== 'closed').slice(0, 4);
  return (
    <section className="rounded-3xl border border-default bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold text-foreground">Studenter &amp; talang</h2>
        <Link href="/min-oversikt/talang" className="inline-flex items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1 text-sm font-medium text-foreground-muted transition hover:bg-canvas-subtle">
          Öppna <Icon name="external" size={14} />
        </Link>
      </div>
      {fresh > 0 ? (
        <p className="mb-3 rounded-xl bg-movexum-pastell-gron px-3 py-2 text-sm text-movexum-morkgron dark:bg-movexum-morkgron/30 dark:text-movexum-pastell-gron">
          {fresh} ny{fresh === 1 ? '' : 'a'} intresseanmälning{fresh === 1 ? '' : 'ar'} från studenter.
        </p>
      ) : null}
      {active.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          Behöver ni en student för exjobb, praktik eller jobb?{' '}
          <Link href="/min-oversikt/talang/ny" className="text-link hover:underline">
            Lägg upp ett behov
          </Link>{' '}
          eller{' '}
          <Link href="/min-oversikt/talang/studenter" className="text-link hover:underline">
            bläddra bland sökbara studenter
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-default text-sm">
          {active.map((n) => (
            <li key={n.id} className="flex items-center justify-between gap-3 py-2">
              <Link href={`/min-oversikt/talang/${n.id}`} className="font-medium text-foreground hover:underline">
                {n.title}
              </Link>
              <NeedStatusChip status={n.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
