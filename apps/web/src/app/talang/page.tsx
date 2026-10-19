import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { TALENT_NEED_STATUSES, TALENT_NEED_STATUS_LABELS, isTalentNeedStatus, needPeriodLabel } from '@platform/shared';
import { listInterests, listNeeds } from '@/lib/talent/data';
import { KindChip, NeedStatusChip, Notice, TagChips, btnGhost, btnPrimary, fmtDate } from '@/components/talent/ui';
import { TALENT_INTRO, requireTalentStaff, talentTabs } from './_shared';

export const dynamic = 'force-dynamic';

/** Behoven i tenanten (§ 54): granskningskö först, filter per status. */
export default async function TalentNeedsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { user, pb, canManage } = await requireTalentStaff();
  const { status } = await searchParams;
  const [needs, interests] = await Promise.all([listNeeds(pb, user.tenant), listInterests(pb, user.tenant)]);
  const counts = Object.fromEntries(TALENT_NEED_STATUSES.map((s) => [s, needs.items.filter((n) => n.status === s).length])) as Record<string, number>;
  const filter = isTalentNeedStatus(status) ? status : null;
  const shown = (filter ? needs.items.filter((n) => n.status === filter) : needs.items).sort((a, b) => {
    const order = (s: string) => (s === 'pending_review' ? 0 : s === 'published' ? 1 : s === 'draft' ? 2 : s === 'paused' ? 3 : 4);
    return order(a.status) - order(b.status) || b.updated.localeCompare(a.updated);
  });
  const interestCount = new Map<string, number>();
  for (const i of interests.items) if (i.status !== 'declined' && i.status !== 'withdrawn') interestCount.set(i.need, (interestCount.get(i.need) ?? 0) + 1);

  return (
    <PageShell
      title="Studenter & talang"
      tabs={talentTabs({ review: counts.pending_review || undefined })}
      meta={<span className="text-sm text-foreground-subtle mx-tnum">{needs.items.length} behov</span>}
      actions={
        canManage ? (
          <Link href="/talang/behov/ny" className={btnPrimary}>
            <Icon name="plus" size={14} /> Nytt behov
          </Link>
        ) : null
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-foreground-muted">{TALENT_INTRO}</p>
        {needs.missing ? <Notice kind="warning">Studenter &amp; talang saknas i databasen — kör migration 1700000201 (eller workflowen &quot;Sync PocketBase&quot;).</Notice> : null}
        {needs.error ? <Notice kind="error">{needs.error}</Notice> : null}
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/talang" className={`${btnGhost} ${!filter ? 'border-strong text-foreground' : ''}`}>
            Alla <span className="mx-tnum text-foreground-subtle">{needs.items.length}</span>
          </Link>
          {TALENT_NEED_STATUSES.map((s) => (
            <Link key={s} href={`/talang?status=${s}`} className={`${btnGhost} ${filter === s ? 'border-strong text-foreground' : ''}`}>
              {TALENT_NEED_STATUS_LABELS[s]} <span className="mx-tnum text-foreground-subtle">{counts[s]}</span>
            </Link>
          ))}
        </div>
        {shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">
            Inga behov {filter ? `med status "${TALENT_NEED_STATUS_LABELS[filter]}"` : 'än'}. Bolagen lägger upp sina på Mitt bolag → Studenter &amp; talang, eller så skapar ni ett åt dem.
          </div>
        ) : (
          <ul className="divide-y divide-default rounded-3xl border border-default bg-surface">
            {shown.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <NeedStatusChip status={n.status} />
                    <KindChip kind={n.kind} />
                    <span className="text-xs text-foreground-subtle">{n.startupName ?? 'Bolag'}</span>
                  </div>
                  <Link href={`/talang/behov/${n.id}`} className="block font-heading text-base font-semibold text-foreground hover:underline">
                    {n.title}
                  </Link>
                  <div className="flex flex-wrap gap-3 text-xs text-foreground-subtle">
                    <span>{needPeriodLabel(n)}</span>
                    {n.deadline ? <span>sök senast {fmtDate(n.deadline)}</span> : null}
                    <span className="mx-tnum">{interestCount.get(n.id) ?? 0} intressen</span>
                  </div>
                  <TagChips tags={n.tags} />
                </div>
                <Link href={`/talang/behov/${n.id}`} className={btnGhost}>
                  Öppna
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
