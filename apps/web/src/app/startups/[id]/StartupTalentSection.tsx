import Link from 'next/link';
import type PocketBase from 'pocketbase';
import { TALENT_NEED_KIND_LABELS, countInterestsByStatus } from '@platform/shared';
import { listInterests, listNeeds } from '@/lib/talent/data';
import { NeedStatusChip } from '@/components/talent/ui';
import { Empty, PillLink, Section } from './_shared/ui';

/** Bolagskortet → Team & nätverk: bolagets behov mot studenter och matchningar (§ 54). Läses med användarens token (RLS). */
export async function StartupTalentSection({ pb, tenantId, startupId, isStaff }: { pb: PocketBase; tenantId: string; startupId: string; isStaff: boolean }) {
  const [needs, interests] = await Promise.all([listNeeds(pb, tenantId, { startup: startupId }), listInterests(pb, tenantId, { startup: startupId })]);
  if (needs.missing) return null;
  const counts = countInterestsByStatus(interests.items);
  return (
    <Section
      id="studenter"
      title="Studenter & talang"
      action={isStaff ? <PillLink href={`/talang/behov/ny?startup=${startupId}`}>Nytt behov</PillLink> : <PillLink href="/min-oversikt/talang">Öppna</PillLink>}
    >
      {needs.items.length === 0 ? (
        <Empty>Inga behov mot studenter upplagda.</Empty>
      ) : (
        <>
          <p className="mb-2 text-xs text-foreground-subtle mx-tnum">
            {counts.matched} matchade · {counts.new + counts.dialogue} pågående · {counts.proposed} förslag väntar
          </p>
          <ul className="divide-y divide-default">
            {needs.items.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={isStaff ? `/talang/behov/${n.id}` : `/min-oversikt/talang/${n.id}`} className="font-medium text-foreground hover:underline">
                    {n.title}
                  </Link>
                  <p className="text-xs text-foreground-subtle">{TALENT_NEED_KIND_LABELS[n.kind]}</p>
                </div>
                <NeedStatusChip status={n.status} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
