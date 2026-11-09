import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { STUDENT_LEVEL_LABELS, STUDENT_PROFILE_STATUSES, STUDENT_PROFILE_STATUS_LABELS, TALENT_NEED_KIND_LABELS, isStudentProfileStatus } from '@platform/shared';
import { listStudents } from '@/lib/talent/data';
import { pruneExpiredStudents } from '@/lib/talent/maintenance';
import { Notice, StudentStatusChip, TagChips, btnGhost, fmtDate } from '@/components/talent/ui';
import { requireTalentStaff, talentTabs } from '../_shared';

export const dynamic = 'force-dynamic';

/** Registrerade studenter (§ 54). Gallring av utgångna/obekräftade profiler körs lazy här. */
export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const { user, pb } = await requireTalentStaff();
  const { status, q } = await searchParams;
  await pruneExpiredStudents(user.tenant);
  const res = await listStudents(pb, user.tenant);
  const filter = isStudentProfileStatus(status) ? status : null;
  const query = (q ?? '').trim().toLowerCase();
  const shown = res.items.filter(
    (s) =>
      (!filter || s.status === filter) &&
      (!query ||
        [s.first_name, s.last_name, s.university, s.program, ...s.tags.map((t) => t.tag)].some((v) => v.toLowerCase().includes(query)))
  );
  const counts = Object.fromEntries(STUDENT_PROFILE_STATUSES.map((s) => [s, res.items.filter((x) => x.status === s).length])) as Record<string, number>;

  return (
    <PageShell title="Studenter & talang" tabs={talentTabs()} meta={<span className="text-sm text-foreground-subtle mx-tnum">{res.items.length} studenter</span>}>
      <div className="space-y-4">
        {res.missing ? <Notice kind="warning">Studenter &amp; talang saknas i databasen — kör migration 1700000201.</Notice> : null}
        {res.error ? <Notice kind="error">{res.error}</Notice> : null}
        <form className="flex flex-wrap items-center gap-2 text-xs">
          <input name="q" defaultValue={q ?? ''} placeholder="Sök namn, lärosäte, program, hashtag…" className="w-full max-w-sm rounded-xl border border-default bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-strong" />
          {filter ? <input type="hidden" name="status" value={filter} /> : null}
          <button type="submit" className={btnGhost}>
            Sök
          </button>
          <span className="flex-1" />
          <Link href="/talang/studenter" className={`${btnGhost} ${!filter ? 'border-strong text-foreground' : ''}`}>
            Alla
          </Link>
          {STUDENT_PROFILE_STATUSES.map((s) => (
            <Link key={s} href={`/talang/studenter?status=${s}`} className={`${btnGhost} ${filter === s ? 'border-strong text-foreground' : ''}`}>
              {STUDENT_PROFILE_STATUS_LABELS[s]} <span className="mx-tnum text-foreground-subtle">{counts[s]}</span>
            </Link>
          ))}
        </form>
        {shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">
            Inga studenter {query ? 'matchar sökningen' : 'registrerade än'}. Dela studentsidan (fliken Studentsidan) med lärosätena.
          </div>
        ) : (
          <ul className="divide-y divide-default rounded-3xl border border-default bg-surface">
            {shown.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StudentStatusChip status={s.status} />
                    {s.searchable ? <span className="text-xs text-foreground-subtle">sökbar</span> : <span className="text-xs text-foreground-subtle">ej sökbar</span>}
                    <span className="text-xs text-foreground-subtle">registrerad {fmtDate(s.created)} · gallras {fmtDate(s.expires_at)}</span>
                  </div>
                  <Link href={`/talang/studenter/${s.id}`} className="block font-heading text-base font-semibold text-foreground hover:underline">
                    {s.first_name} {s.last_name}
                  </Link>
                  <p className="text-xs text-foreground-muted">
                    {[s.program, s.university, STUDENT_LEVEL_LABELS[s.level], s.graduation_year ? `examen ${s.graduation_year}` : null].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-xs text-foreground-subtle">Söker: {s.seeking.map((k) => TALENT_NEED_KIND_LABELS[k]).join(', ') || '–'}</p>
                  <TagChips tags={s.tags.map((t) => t.tag)} />
                </div>
                <Link href={`/talang/studenter/${s.id}`} className={btnGhost}>
                  Öppna
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-foreground-subtle">
          Studenterna är privatpersoner som registrerat sig själva med samtycke (gallras efter ett år). Bolagen ser dem anonymt; namn och e-post visas för ett bolag först när studenten sökt eller tackat ja.
        </p>
      </div>
    </PageShell>
  );
}
