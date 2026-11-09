import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { TALENT_BOARD_COLUMNS, TALENT_NEED_KIND_LABELS, countInterestsByStatus } from '@platform/shared';
import { listInterests, listNeeds, listStudents } from '@/lib/talent/data';
import { InterestStatusChip, Notice, fmtDate } from '@/components/talent/ui';
import { requireTalentStaff, talentTabs } from '../_shared';

export const dynamic = 'force-dynamic';

/** Alla matchningar i tenanten som tavla (§ 54) — var står varje kontakt? */
export default async function MatchesBoardPage() {
  const { user, pb } = await requireTalentStaff();
  const [interests, needs, students] = await Promise.all([listInterests(pb, user.tenant), listNeeds(pb, user.tenant), listStudents(pb, user.tenant)]);
  const needById = new Map(needs.items.map((n) => [n.id, n]));
  const studentById = new Map(students.items.map((s) => [s.id, s]));
  const counts = countInterestsByStatus(interests.items);
  const matchedThisYear = interests.items.filter((i) => i.status === 'matched' && (i.status_changed_at ?? '').startsWith(String(new Date().getFullYear()))).length;

  return (
    <PageShell
      title="Studenter & talang"
      tabs={talentTabs()}
      meta={
        <span className="text-sm text-foreground-subtle mx-tnum">
          {counts.matched} matchade · {matchedThisYear} i år
        </span>
      }
    >
      {interests.error ? <Notice kind="error">{interests.error}</Notice> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {TALENT_BOARD_COLUMNS.map((col) => {
          const items = interests.items.filter((i) => col.statuses.includes(i.status));
          return (
            <section key={col.id} className="rounded-3xl border border-default bg-surface p-3">
              <h2 className="mb-2 flex items-center justify-between text-sm font-semibold text-foreground">
                {col.label}
                <span className="text-xs text-foreground-subtle mx-tnum">{items.length}</span>
              </h2>
              {items.length === 0 ? (
                <p className="text-xs text-foreground-subtle">–</p>
              ) : (
                <ul className="space-y-2">
                  {items.map((i) => {
                    const n = needById.get(i.need);
                    const s = studentById.get(i.student);
                    return (
                      <li key={i.id} className="rounded-2xl border border-default bg-canvas-subtle/60 p-3 text-xs">
                        <Link href={`/talang/behov/${i.need}`} className="block text-sm font-medium text-foreground hover:underline">
                          {n?.title ?? 'Behov'}
                        </Link>
                        <p className="text-foreground-muted">
                          {n?.startupName ?? 'Bolag'}
                          {n ? ` · ${TALENT_NEED_KIND_LABELS[n.kind]}` : ''}
                        </p>
                        <p className="mt-1">
                          {s ? (
                            <Link href={`/talang/studenter/${s.id}`} className="text-link hover:underline">
                              {s.first_name} {s.last_name}
                            </Link>
                          ) : (
                            'Student borttagen'
                          )}
                        </p>
                        <p className="mt-1 flex items-center justify-between gap-2 text-foreground-subtle">
                          <InterestStatusChip status={i.status} />
                          <span>{fmtDate(i.status_changed_at ?? i.created)}</span>
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </PageShell>
  );
}
