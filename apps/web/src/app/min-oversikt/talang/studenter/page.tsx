import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { STUDENT_LEVEL_LABELS, TALENT_NEED_KIND_LABELS, isTalentNeedKind, scoreTalentPair } from '@platform/shared';
import { listInterestsForStartup, listNeeds, listSearchableStudentsForStartup } from '@/lib/talent/data';
import { ProposeToNeedPicker } from '@/components/talent/ProposeToNeedPicker';
import { Notice, TagChips, btnGhost, fmtDate } from '@/components/talent/ui';
import { requireMemberStartup } from '../_shared';

export const dynamic = 'force-dynamic';

/** Sökbara studenter — ANONYMT — för bolaget (§ 54). Namn/kontakt först när studenten tackat ja. */
export default async function MemberStudentsPage({ searchParams }: { searchParams: Promise<{ typ?: string; behov?: string }> }) {
  const { user, pb, startupId, startupName } = await requireMemberStartup();
  const { typ, behov } = await searchParams;
  const [students, needs, interests] = await Promise.all([
    listSearchableStudentsForStartup(user.tenant),
    listNeeds(pb, user.tenant, { startup: startupId, statuses: ['published'] }),
    listInterestsForStartup(user.tenant, startupId)
  ]);
  const takenByStudent = new Map<string, Set<string>>();
  for (const { interest } of interests.items) {
    const set = takenByStudent.get(interest.student) ?? new Set<string>();
    set.add(interest.need);
    takenByStudent.set(interest.student, set);
  }
  const kind = isTalentNeedKind(typ) ? typ : null;
  const focusNeed = behov ? needs.items.find((n) => n.id === behov) ?? null : null;
  let shown = kind ? students.items.filter((s) => s.seeking.includes(kind)) : students.items;
  const scored = focusNeed ? shown.map((s) => ({ s, m: scoreTalentPair(focusNeed, s) })).sort((a, b) => b.m.score - a.m.score) : shown.map((s) => ({ s, m: null }));
  shown = scored.map((x) => x.s);
  const needOptions = needs.items.map((n) => ({ id: n.id, title: n.title }));

  return (
    <PageShell title="Sökbara studenter" meta={<span className="text-sm text-foreground-subtle">{startupName}</span>}>
      <div className="space-y-4">
        <p className="text-sm text-foreground-muted">
          Studenter som valt att vara sökbara för bolagen i inkubatorn. Ni ser dem <strong>anonymt</strong> — utbildning, hashtags, vad de söker och när de kan börja. Föreslå ett av
          era publicerade behov så får studenten ett mejl och avgör själv; då först ser ni namn och kontaktuppgifter.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link href="/min-oversikt/talang/studenter" className={`${btnGhost} ${!kind && !focusNeed ? 'border-strong text-foreground' : ''}`}>
            Alla
          </Link>
          {(Object.keys(TALENT_NEED_KIND_LABELS) as Array<keyof typeof TALENT_NEED_KIND_LABELS>).map((k) => (
            <Link key={k} href={`/min-oversikt/talang/studenter?typ=${k}`} className={`${btnGhost} ${kind === k ? 'border-strong text-foreground' : ''}`}>
              söker {TALENT_NEED_KIND_LABELS[k].toLowerCase()}
            </Link>
          ))}
          {needs.items.length > 0 ? <span className="text-foreground-subtle">· ranka mot:</span> : null}
          {needs.items.map((n) => (
            <Link key={n.id} href={`/min-oversikt/talang/studenter?behov=${n.id}`} className={`${btnGhost} ${focusNeed?.id === n.id ? 'border-strong text-foreground' : ''}`}>
              {n.title}
            </Link>
          ))}
          <span className="flex-1" />
          <Link href="/min-oversikt/talang" className={btnGhost}>
            Våra behov
          </Link>
        </div>
        {students.error ? <Notice kind="error">{students.error}</Notice> : null}
        {shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default bg-canvas-subtle p-6 text-sm text-foreground-muted">Inga sökbara studenter {kind ? 'för den typen' : 'just nu'}.</div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {scored.map(({ s, m }) => (
              <li key={s.id} className="rounded-3xl border border-default bg-surface p-4 text-sm">
                <p className="font-heading font-semibold text-foreground">{s.headline || STUDENT_LEVEL_LABELS[s.level]}</p>
                <p className="text-xs text-foreground-muted">
                  {STUDENT_LEVEL_LABELS[s.level]}
                  {s.graduation_year ? ` · examen ${s.graduation_year}` : ''}
                  {s.available_from ? ` · från ${fmtDate(s.available_from)}` : ''}
                  {s.location ? ` · ${s.location}` : ''}
                  {s.remote_ok ? ' · distans ok' : ''}
                </p>
                <p className="mt-1 text-xs text-foreground-subtle">Söker: {s.seeking.map((k) => TALENT_NEED_KIND_LABELS[k]).join(', ')}</p>
                <div className="mt-2">
                  <TagChips tags={s.tags.map((t) => t.tag)} highlight={m ? new Set(m.matchedTags) : undefined} />
                </div>
                {m ? <p className="mt-1 text-xs text-foreground-subtle">{m.reasons.join(' · ')}</p> : null}
                {s.summary ? <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-foreground-muted">{s.summary}</p> : null}
                <div className="mt-3">
                  <ProposeToNeedPicker studentId={s.id} needs={needOptions} taken={takenByStudent.get(s.id) ?? new Set()} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
