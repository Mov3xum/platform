import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { SPARK_INTERVIEW_SOURCE_LABELS, SPARK_INTERVIEW_STATUSES, SPARK_INTERVIEW_STATUS_LABELS } from '@platform/shared';
import { SPARK_MIGRATION_HINT, listSparkInterviews, sparkUserNames } from '@/lib/spark/data';
import { Notice, btnGhost, btnPrimary, fmtDate } from '@/components/talent/ui';
import { ApplyInterviewButton } from '@/components/spark/controls';
import { Empty, InterviewStatusChip, RoleChips, SPARK_TITLE, requireSpark, sparkTabs } from '../_shared';

export const dynamic = 'force-dynamic';

/** Intervjuer och anmälningar (§ 61). Movexum ser alla, en partner ser sina egna. */
export default async function SparkInterviewsPage({ searchParams }: { searchParams: Promise<{ status?: string; sparad?: string }> }) {
  const { user, pb, canManage, staff } = await requireSpark();
  const { status, sparad } = await searchParams;
  const list = await listSparkInterviews(pb, user.tenant);
  const filter = (SPARK_INTERVIEW_STATUSES as readonly string[]).includes(status ?? '') ? status : null;
  const counts = Object.fromEntries(SPARK_INTERVIEW_STATUSES.map((s) => [s, list.items.filter((i) => i.status === s).length])) as Record<string, number>;
  const shown = filter ? list.items.filter((i) => i.status === filter) : list.items;
  const names = staff ? await sparkUserNames(pb, user.tenant, shown.map((i) => i.created_by)) : new Map<string, string>();

  return (
    <PageShell
      title={SPARK_TITLE}
      tabs={sparkTabs(staff, { submitted: staff ? counts.submitted || undefined : undefined })}
      actions={
        canManage || !staff ? (
          <Link href="/spark/intervjuer/ny" className={btnPrimary}>
            <Icon name="plus" size={14} /> Ny intervju
          </Link>
        ) : null
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-foreground-muted">
          {staff
            ? 'Alla intervjuer och anmälningar. Det som partner och företag skickar in för ni in i registret härifrån — då blir behoven och lösningarna matchningsbara.'
            : 'Dina intervjuer. Spara som utkast medan du arbetar och skicka in när intervjun är klar. Movexum för in svaren i registret och sköter matchningen.'}
        </p>
        {list.missing ? <Notice kind="warning">{SPARK_MIGRATION_HINT}</Notice> : null}
        {list.error ? <Notice kind="error">{list.error}</Notice> : null}
        {sparad ? <Notice kind="notice">Intervjun är sparad.</Notice> : null}
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/spark/intervjuer" className={`${btnGhost} ${!filter ? 'border-strong text-foreground' : ''}`}>
            Alla <span className="mx-tnum text-foreground-subtle">{list.items.length}</span>
          </Link>
          {SPARK_INTERVIEW_STATUSES.map((s) => (
            <Link key={s} href={`/spark/intervjuer?status=${s}`} className={`${btnGhost} ${filter === s ? 'border-strong text-foreground' : ''}`}>
              {SPARK_INTERVIEW_STATUS_LABELS[s]} <span className="mx-tnum text-foreground-subtle">{counts[s]}</span>
            </Link>
          ))}
        </div>
        {shown.length === 0 ? (
          <Empty>Inga intervjuer {filter ? `med status "${SPARK_INTERVIEW_STATUS_LABELS[filter as keyof typeof SPARK_INTERVIEW_STATUS_LABELS]}"` : 'än'}. Börja med Ny intervju eller ladda upp en fil under Import.</Empty>
        ) : (
          <ul className="divide-y divide-default rounded-3xl border border-default bg-surface">
            {shown.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <InterviewStatusChip status={i.status} />
                    <RoleChips roles={i.roles} />
                  </div>
                  <Link href={`/spark/intervjuer/${i.id}`} className="block font-heading text-base font-semibold text-foreground hover:underline">
                    {i.company_name || 'Namnlös intervju'}
                  </Link>
                  <div className="flex flex-wrap gap-3 text-xs text-foreground-subtle">
                    <span>{SPARK_INTERVIEW_SOURCE_LABELS[i.source]}</span>
                    {i.interviewer_org ? <span>{i.interviewer_org}</span> : null}
                    {staff && i.created_by && names.get(i.created_by) ? <span>av {names.get(i.created_by)}</span> : null}
                    <span>uppdaterad {fmtDate(i.updated)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && i.status === 'submitted' ? <ApplyInterviewButton interviewId={i.id} /> : null}
                  {i.status === 'applied' && i.actor && staff ? (
                    <Link href={`/spark/aktorer/${i.actor}`} className={btnGhost}>
                      Aktörskortet
                    </Link>
                  ) : null}
                  <Link href={`/spark/intervjuer/${i.id}`} className={btnGhost}>
                    Öppna
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
