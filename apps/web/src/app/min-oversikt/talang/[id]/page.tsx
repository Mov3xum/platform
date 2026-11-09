import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { TALENT_COMPENSATION_LABELS, TALENT_NEED_KIND_LABELS, TALENT_WORK_MODE_LABELS, needPeriodLabel } from '@platform/shared';
import { getNeedWithFallback, listInterestsForStartup } from '@/lib/talent/data';
import { NeedStatusButtons } from '@/components/talent/NeedStatusButtons';
import { InterestControls } from '@/components/talent/InterestControls';
import { InterestStatusChip, KindChip, NeedStatusChip, Notice, Panel, TagChips, btnGhost, fmtDate } from '@/components/talent/ui';
import { requireMemberStartup } from '../_shared';

export const dynamic = 'force-dynamic';

/** Bolagets behov: status, intressen (studenten synlig först efter ja), dialog/match. */
export default async function MemberNeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, pb, startupId } = await requireMemberStartup();
  const need = await getNeedWithFallback(pb, user.tenant, id);
  if (!need || need.startup !== startupId) notFound();
  const interests = await listInterestsForStartup(user.tenant, startupId, { need: need.id });
  const STATUS_HELP: Record<string, string> = {
    draft: 'Utkast — skicka till Movexum när texten är klar.',
    pending_review: 'Movexum granskar texten och publicerar den för studenterna.',
    published: 'Publicerat — studenter kan söka. Ändrar ni texten granskas den igen.',
    paused: 'Pausat — syns inte för studenter. Publicera igen när ni vill.',
    closed: 'Avslutat.'
  };

  return (
    <PageShell
      title={need.title}
      meta={
        <span className="flex flex-wrap items-center gap-2">
          <NeedStatusChip status={need.status} />
          <KindChip kind={need.kind} />
        </span>
      }
      actions={
        <span className="flex gap-2">
          <Link href={`/min-oversikt/talang/${need.id}/redigera`} className={btnGhost}>
            Redigera
          </Link>
          <Link href="/min-oversikt/talang" className={btnGhost}>
            Alla behov
          </Link>
        </span>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <Panel title="Intressen" meta={<span className="text-xs text-foreground-subtle mx-tnum">{interests.items.length}</span>}>
            {interests.error ? <Notice kind="error">{interests.error}</Notice> : null}
            {interests.items.length === 0 ? (
              <p className="text-sm text-foreground-muted">Inga intressen än. {need.status === 'published' ? 'Studenter som söker dyker upp här — ni får en notis.' : 'Publicera behovet så kan studenter söka.'}</p>
            ) : (
              <ul className="space-y-4">
                {interests.items.map(({ interest, student }) => (
                  <li key={interest.id} className="rounded-2xl border border-default p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <InterestStatusChip status={interest.status} />
                      <span className="text-xs text-foreground-subtle">
                        {interest.initiated_by === 'student' ? 'sökte själv' : 'föreslagen'} · {fmtDate(interest.status_changed_at ?? interest.created)}
                      </span>
                    </div>
                    {student ? (
                      <div className="mt-2 text-sm">
                        <p className="font-medium text-foreground">
                          {student.revealed ? student.name : 'Student — namn och kontakt visas när hen tackat ja'}
                          <span className="ml-2 font-normal text-foreground-muted">{student.headline}</span>
                        </p>
                        {student.revealed && student.email ? (
                          <a href={`mailto:${student.email}`} className="text-link hover:underline">
                            {student.email}
                          </a>
                        ) : null}
                        {student.revealed && student.linkedin_url ? (
                          <a href={student.linkedin_url} target="_blank" rel="noopener noreferrer" className="ml-3 text-link hover:underline">
                            LinkedIn
                          </a>
                        ) : null}
                        <p className="mt-1 text-xs text-foreground-subtle">
                          Söker: {student.seeking.map((k) => TALENT_NEED_KIND_LABELS[k]).join(', ')}
                          {student.available_from ? ` · tillgänglig från ${fmtDate(student.available_from)}` : ''}
                          {student.location ? ` · ${student.location}` : ''}
                        </p>
                        <div className="mt-2">
                          <TagChips tags={student.tags.map((t) => t.tag)} highlight={new Set(need.tags)} />
                        </div>
                        {student.summary ? <p className="mt-2 whitespace-pre-wrap text-foreground-muted">{student.summary}</p> : null}
                        {interest.message ? (
                          <p className="mt-2 whitespace-pre-wrap text-foreground">
                            <span className="font-medium">Hälsning:</span> {interest.message}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-foreground-muted">Studenten har tagit bort sin profil.</p>
                    )}
                    <div className="mt-3">
                      <InterestControls interestId={interest.id} status={interest.status} party="company" outcome={interest.outcome} companyNote={interest.company_note} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-foreground-subtle">
              Behandla studenternas uppgifter varsamt: de har delat dem med just ert bolag för det här uppdraget. Sprid inte vidare, och markera avböjt när ni går vidare med
              någon annan så att studenten får besked.
            </p>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Status">
            <p className="mb-3 text-sm text-foreground-muted">{STATUS_HELP[need.status]}</p>
            {need.review_note ? <p className="mb-3 rounded-xl bg-canvas-subtle p-3 text-sm text-foreground-muted">Meddelande från Movexum: {need.review_note}</p> : null}
            <NeedStatusButtons needId={need.id} status={need.status} party="company" afterDelete="/min-oversikt/talang" />
          </Panel>
          <Panel title="Annonsen">
            <p className="whitespace-pre-wrap text-sm text-foreground">{need.description}</p>
            <dl className="mt-4 grid gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-foreground-muted">Period</dt>
                <dd>{needPeriodLabel(need)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-foreground-muted">Plats</dt>
                <dd>
                  {need.location || '–'} · {TALENT_WORK_MODE_LABELS[need.work_mode]}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-foreground-muted">Ersättning</dt>
                <dd>{TALENT_COMPENSATION_LABELS[need.compensation]}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-foreground-muted">Sök senast</dt>
                <dd>{fmtDate(need.deadline)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-foreground-muted">Bolagsnamn</dt>
                <dd>{need.anonymous ? 'Dolt för studenter' : 'Visas'}</dd>
              </div>
            </dl>
            <div className="mt-3">
              <TagChips tags={need.tags} />
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
