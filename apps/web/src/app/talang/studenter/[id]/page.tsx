import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { STUDENT_LEVEL_LABELS, TALENT_NEED_KIND_LABELS, TALENT_WORK_MODE_LABELS, rankNeedsForStudent } from '@platform/shared';
import { getStudent, listInterests, listNeeds } from '@/lib/talent/data';
import { ProposeStudentButton } from '@/components/talent/ProposeStudentButton';
import { StudentStatusControls } from '@/components/talent/StudentStatusControls';
import { InterestStatusChip, Notice, Panel, StudentStatusChip, TagChips, fmtDate } from '@/components/talent/ui';
import { requireTalentStaff, talentTabs } from '../../_shared';

export const dynamic = 'force-dynamic';

/** En studentprofil (§ 54): uppgifter, intressen, passande behov att föreslå, status/radering. */
export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, pb, canManage, isLead } = await requireTalentStaff();
  const student = await getStudent(pb, user.tenant, id);
  if (!student) notFound();
  const [interests, needs] = await Promise.all([listInterests(pb, user.tenant, { student: student.id }), listNeeds(pb, user.tenant, { statuses: ['published'] })]);
  const needById = new Map(needs.items.map((n) => [n.id, n]));
  const taken = new Set(interests.items.map((i) => i.need));
  const suggestions = rankNeedsForStudent(student, needs.items.filter((n) => !taken.has(n.id)));
  const allNeedTitles = new Map<string, string>();
  for (const i of interests.items) if (!needById.has(i.need)) allNeedTitles.set(i.need, 'Behov (ej publicerat)');

  return (
    <PageShell
      title={`${student.first_name} ${student.last_name}`}
      tabs={talentTabs()}
      meta={
        <span className="flex items-center gap-2">
          <StudentStatusChip status={student.status} />
          <span className="text-xs text-foreground-subtle">{student.searchable ? 'sökbar för bolag' : 'inte sökbar'}</span>
        </span>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <Panel title="Profil">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-foreground-muted">E-post</dt>
                <dd>
                  <a href={`mailto:${student.email}`} className="text-link hover:underline">
                    {student.email}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-foreground-muted">Utbildning</dt>
                <dd>{[student.program, student.university, STUDENT_LEVEL_LABELS[student.level], student.graduation_year ? `examen ${student.graduation_year}` : null].filter(Boolean).join(' · ')}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-foreground-muted">Söker</dt>
                <dd>{student.seeking.map((k) => TALENT_NEED_KIND_LABELS[k]).join(', ') || '–'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-foreground-muted">Tillgänglig</dt>
                <dd>
                  {student.available_from ? `från ${fmtDate(student.available_from)}` : 'ej angivet'} · {student.location || 'ort ej angiven'}
                  {student.remote_ok ? ' · kan jobba på distans' : ''}
                </dd>
              </div>
              {student.linkedin_url ? (
                <div>
                  <dt className="text-xs font-semibold text-foreground-muted">LinkedIn</dt>
                  <dd>
                    <a href={student.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
                      {student.linkedin_url}
                    </a>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs font-semibold text-foreground-muted">Samtycke</dt>
                <dd>
                  {fmtDate(student.consent_at)} · gallras {fmtDate(student.expires_at)}
                  {student.verified_at ? ` · e-post bekräftad ${fmtDate(student.verified_at)}` : ' · e-post ej bekräftad'}
                </dd>
              </div>
            </dl>
            <div className="mt-4">
              <TagChips tags={student.tags.map((t) => `${t.tag}`)} />
            </div>
            {student.summary ? <p className="mt-4 whitespace-pre-wrap text-sm text-foreground">{student.summary}</p> : null}
          </Panel>

          <Panel title="Intressen" meta={<span className="text-xs text-foreground-subtle mx-tnum">{interests.items.length}</span>}>
            {interests.items.length === 0 ? (
              <p className="text-sm text-foreground-muted">Inga intressen än.</p>
            ) : (
              <ul className="divide-y divide-default">
                {interests.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <InterestStatusChip status={i.status} />
                      <Link href={`/talang/behov/${i.need}`} className="font-medium text-foreground hover:underline">
                        {needById.get(i.need)?.title ?? allNeedTitles.get(i.need) ?? 'Behov'}
                      </Link>
                      <span className="text-xs text-foreground-subtle">{needById.get(i.need)?.startupName ?? ''}</span>
                    </div>
                    <span className="text-xs text-foreground-subtle">{fmtDate(i.status_changed_at ?? i.created)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          {canManage ? (
            <Panel title="Hantera profilen">
              <StudentStatusControls studentId={student.id} status={student.status} canDelete={isLead} />
              <p className="mt-2 text-[11px] text-foreground-subtle">Pausa om studenten bett om det per mejl; ta bort helt på begäran (GDPR art. 17). Studenten kan själv göra båda på sin sida.</p>
            </Panel>
          ) : null}
          <Panel title="Passande publicerade behov">
            {needs.error ? <Notice kind="error">{needs.error}</Notice> : null}
            {suggestions.length === 0 ? (
              <p className="text-sm text-foreground-muted">Inga publicerade behov matchar just nu.</p>
            ) : (
              <ul className="space-y-3">
                {suggestions.map((m) => {
                  const n = needById.get(m.item.id)!;
                  return (
                    <li key={n.id} className="rounded-2xl border border-default p-3 text-sm">
                      <Link href={`/talang/behov/${n.id}`} className="font-medium text-foreground hover:underline">
                        {n.title}
                      </Link>
                      <p className="text-xs text-foreground-muted">
                        {n.startupName ?? 'Bolag'} · {TALENT_NEED_KIND_LABELS[n.kind]} · {TALENT_WORK_MODE_LABELS[n.work_mode]}
                      </p>
                      <p className="mt-1 text-xs text-foreground-subtle">{m.reasons.join(' · ')}</p>
                      {canManage && student.status === 'active' && student.searchable ? (
                        <div className="mt-2">
                          <ProposeStudentButton needId={n.id} studentId={student.id} compact />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
