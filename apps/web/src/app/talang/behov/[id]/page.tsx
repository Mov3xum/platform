import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import {
  TALENT_COMPENSATION_LABELS,
  TALENT_NEED_KIND_LABELS,
  TALENT_WORK_MODE_LABELS,
  needPeriodLabel,
  rankStudentsForNeed,
  uncoveredNeedTags
} from '@platform/shared';
import { getNeedWithFallback, listInterestsForStartup, listStudents } from '@/lib/talent/data';
import { NeedStatusButtons } from '@/components/talent/NeedStatusButtons';
import { InterestControls } from '@/components/talent/InterestControls';
import { ProposeStudentButton } from '@/components/talent/ProposeStudentButton';
import { InterestStatusChip, KindChip, NeedStatusChip, Notice, Panel, TagChips, btnGhost, fmtDate } from '@/components/talent/ui';
import { requireTalentStaff, talentTabs } from '../../_shared';

export const dynamic = 'force-dynamic';

/** Ett behov (§ 54): granskning/publicering, intressen med status, deterministisk shortlist att föreslå. */
export default async function NeedDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, pb, canManage } = await requireTalentStaff();
  const need = await getNeedWithFallback(pb, user.tenant, id);
  if (!need) notFound();
  const [interests, students] = await Promise.all([listInterestsForStartup(user.tenant, need.startup, { need: need.id }), listStudents(pb, user.tenant, { statuses: ['active'] })]);
  const taken = new Set(interests.items.map((i) => i.interest.student));
  const shortlist = need.status === 'published' ? rankStudentsForNeed(need, students.items, { exclude: taken }) : [];
  const gaps = uncoveredNeedTags(need, students.items);
  const studentById = new Map(students.items.map((s) => [s.id, s]));

  return (
    <PageShell
      title={need.title}
      tabs={talentTabs()}
      meta={
        <span className="flex flex-wrap items-center gap-2">
          <NeedStatusChip status={need.status} />
          <KindChip kind={need.kind} />
          <Link href={`/startups/${need.startup}/natverk#studenter`} className="text-sm text-link hover:underline">
            {need.startupName ?? 'Bolag'}
          </Link>
        </span>
      }
      actions={
        canManage ? (
          <Link href={`/talang/behov/${need.id}/redigera`} className={btnGhost}>
            Redigera
          </Link>
        ) : null
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <Panel title="Annonsen" meta={<span className="text-xs text-foreground-subtle">så som studenter ser den{need.anonymous ? ' (bolaget anonymt)' : ''}</span>}>
            <p className="whitespace-pre-wrap text-sm text-foreground">{need.description}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-foreground-muted">Period</dt>
                <dd>{needPeriodLabel(need)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-foreground-muted">Omfattning</dt>
                <dd>{need.scope || '–'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-foreground-muted">Plats</dt>
                <dd>
                  {need.location || '–'} · {TALENT_WORK_MODE_LABELS[need.work_mode]}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-foreground-muted">Ersättning</dt>
                <dd>
                  {TALENT_COMPENSATION_LABELS[need.compensation]}
                  {need.compensation_note ? ` — ${need.compensation_note}` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-foreground-muted">Sista ansökningsdag</dt>
                <dd>{fmtDate(need.deadline)}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-foreground-muted">Handledare</dt>
                <dd>{need.supervisor ? 'Finns' : 'Ej angivet'}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <TagChips tags={need.tags} />
            </div>
          </Panel>

          <Panel title="Intressen" meta={<span className="text-xs text-foreground-subtle mx-tnum">{interests.items.length}</span>}>
            {interests.error ? <Notice kind="error">{interests.error}</Notice> : null}
            {interests.items.length === 0 ? (
              <p className="text-sm text-foreground-muted">Inga intressen än.</p>
            ) : (
              <ul className="space-y-4">
                {interests.items.map(({ interest, student }) => (
                  <li key={interest.id} className="rounded-2xl border border-default p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <InterestStatusChip status={interest.status} />
                      <span className="text-xs text-foreground-subtle">
                        {interest.initiated_by === 'student' ? 'sökte själv' : interest.initiated_by === 'company' ? 'föreslagen av bolaget' : 'föreslagen av Movexum'} · {fmtDate(interest.status_changed_at ?? interest.created)}
                      </span>
                    </div>
                    {student ? (
                      <div className="mt-2 text-sm">
                        <p className="font-medium text-foreground">
                          {student.revealed ? student.name : 'Student (anonym tills hen tackar ja)'}
                          <span className="ml-2 font-normal text-foreground-muted">{student.headline}</span>
                        </p>
                        {student.revealed && student.email ? (
                          <a href={`mailto:${student.email}`} className="text-link hover:underline">
                            {student.email}
                          </a>
                        ) : null}
                        <div className="mt-2">
                          <TagChips tags={student.tags.map((t) => t.tag)} highlight={new Set(need.tags)} />
                        </div>
                        {interest.message ? <p className="mt-2 whitespace-pre-wrap text-foreground-muted">{interest.message}</p> : null}
                        <Link href={`/talang/studenter/${student.id}`} className="mt-1 inline-block text-xs text-link hover:underline">
                          Öppna studentens profil
                        </Link>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-foreground-muted">Studentprofilen är borttagen.</p>
                    )}
                    {canManage ? (
                      <div className="mt-3">
                        <InterestControls interestId={interest.id} status={interest.status} party="staff" outcome={interest.outcome} companyNote={interest.company_note} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          {canManage ? (
            <Panel title="Granskning & status">
              {need.review_note ? <p className="mb-3 rounded-xl bg-canvas-subtle p-3 text-sm text-foreground-muted">Senaste meddelande till bolaget: {need.review_note}</p> : null}
              {need.status === 'pending_review' ? (
                <Notice kind="warning">Bolaget väntar på att ni publicerar. Läs igenom texten: inga personuppgifter, tydligt vad studenten ska göra, hashtags som studenter faktiskt använder.</Notice>
              ) : null}
              <div className="mt-3">
                <NeedStatusButtons needId={need.id} status={need.status} party="staff" afterDelete="/talang" />
              </div>
            </Panel>
          ) : null}

          <Panel title="Föreslå studenter" meta={<span className="text-xs text-foreground-subtle">deterministisk rankning</span>}>
            {need.status !== 'published' ? (
              <p className="text-sm text-foreground-muted">Publicera behovet först — förslag kan bara skickas för publicerade behov.</p>
            ) : shortlist.length === 0 ? (
              <p className="text-sm text-foreground-muted">Ingen sökbar student matchar hashtags eller typ av uppdrag än.</p>
            ) : (
              <ul className="space-y-3">
                {shortlist.map((m) => {
                  const s = studentById.get(m.item.id)!;
                  return (
                    <li key={s.id} className="rounded-2xl border border-default p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={`/talang/studenter/${s.id}`} className="font-medium text-foreground hover:underline">
                          {s.first_name} {s.last_name}
                        </Link>
                        <span className="text-xs text-foreground-subtle mx-tnum">{m.score.toFixed(1)} p</span>
                      </div>
                      <p className="text-xs text-foreground-muted">{[s.program, s.university].filter(Boolean).join(' · ')}</p>
                      <p className="mt-1 text-xs text-foreground-subtle">{m.reasons.join(' · ')}</p>
                      <div className="mt-2">
                        <TagChips tags={s.tags.map((t) => t.tag)} highlight={new Set(m.matchedTags)} />
                      </div>
                      {canManage ? (
                        <div className="mt-2">
                          <ProposeStudentButton needId={need.id} studentId={s.id} compact />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {gaps.length > 0 ? (
              <p className="mt-3 text-xs text-foreground-subtle">
                Ingen sökbar student har: {gaps.map((g) => `#${g}`).join(', ')} — värt att nämna för lärosätena.
              </p>
            ) : null}
            <p className="mt-3 text-[11px] text-foreground-subtle">
              Rankningen räknar hashtag-träff viktad med nivå, typ av uppdrag ({TALENT_NEED_KIND_LABELS[need.kind].toLowerCase()}), period och plats. Ingen AI — ni avgör vem som föreslås, studenten avgör om hen vill.
            </p>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
