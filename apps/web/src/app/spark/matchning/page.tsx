import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import {
  SPARK_HORIZON_LABELS,
  SPARK_MATCH_STATUSES,
  SPARK_MATCH_STATUS_LABELS,
  SPARK_PRIORITY_LABELS,
  SPARK_TESTBED_KIND_LABELS,
  effectiveSparkTrl,
  rankNeedsForSolution,
  rankSolutionsForNeed,
  rankTestbedsForSolution,
  type SparkSuggestion
} from '@platform/shared';
import { SPARK_MIGRATION_HINT, loadSparkRegistry, type SparkRegistry } from '@/lib/spark/data';
import { Chip, Notice, btnGhost, fmtDate } from '@/components/talent/ui';
import { CreateMatchButton } from '@/components/spark/controls';
import { AreaChips, Empty, SPARK_TITLE, requireSparkStaff, sparkTabs } from '../_shared';

export const dynamic = 'force-dynamic';

type View = 'behov' | 'losningar' | 'tavla';

function Reasons({ s }: { s: SparkSuggestion<unknown> }) {
  return (
    <ul className="mt-1.5 space-y-0.5 text-xs">
      {s.reasons.map((r) => (
        <li key={r} className="text-foreground-muted">
          + {r}
        </li>
      ))}
      {s.cautions.map((c) => (
        <li key={c} className="text-movexum-morkgul dark:text-movexum-pastell-gul">
          ! {c}
        </li>
      ))}
    </ul>
  );
}

function actorName(reg: SparkRegistry, id: string): string {
  return reg.actorById.get(id)?.name ?? 'Okänd aktör';
}

/** Matchningen (§ 61): förslag med skäl i klartext, åt båda håll, och tavlan över pågående matchningar. */
export default async function SparkMatchingPage({ searchParams }: { searchParams: Promise<{ vy?: string; behov?: string; losning?: string }> }) {
  const { user, pb, canManage } = await requireSparkStaff();
  const sp = await searchParams;
  const view: View = sp.losning ? 'losningar' : sp.behov ? 'behov' : sp.vy === 'losningar' || sp.vy === 'tavla' ? sp.vy : 'behov';
  const reg = await loadSparkRegistry(pb, user.tenant);

  const matchedSolutions = new Map<string, Set<string>>();
  const matchedNeeds = new Map<string, Set<string>>();
  const matchedTestbeds = new Map<string, Set<string>>();
  for (const m of reg.matches) {
    if (m.need && m.solution) {
      (matchedSolutions.get(m.need) ?? matchedSolutions.set(m.need, new Set()).get(m.need)!).add(m.solution);
      (matchedNeeds.get(m.solution) ?? matchedNeeds.set(m.solution, new Set()).get(m.solution)!).add(m.need);
    }
    if (m.solution && m.testbed) (matchedTestbeds.get(m.solution) ?? matchedTestbeds.set(m.solution, new Set()).get(m.solution)!).add(m.testbed);
  }

  const needs = reg.needs.filter((n) => (n.status === 'open' || n.status === 'matched') && (!sp.behov || n.id === sp.behov));
  const solutions = reg.solutions.filter((s) => s.status === 'active' && (!sp.losning || s.id === sp.losning));
  const limit = sp.behov || sp.losning ? 8 : 3;
  const tab = (v: View, label: string, n: number) => (
    <Link href={`/spark/matchning?vy=${v}`} className={`${btnGhost} ${view === v && !sp.behov && !sp.losning ? 'border-strong text-foreground' : ''}`}>
      {label} <span className="mx-tnum text-foreground-subtle">{n}</span>
    </Link>
  );

  return (
    <PageShell title={SPARK_TITLE} tabs={sparkTabs(true)}>
      <div className="space-y-4">
        {reg.missing ? <Notice kind="warning">{SPARK_MIGRATION_HINT}</Notice> : null}
        {reg.error ? <Notice kind="error">{reg.error}</Notice> : null}
        <p className="text-sm text-foreground-muted">
          Förslagen räknas på energiområde, bransch, mognad, tidshorisont och intresse av pilot — skälen står vid varje förslag. Ni avgör, och båda parter
          tillfrågas innan de presenteras för varandra.
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          {tab('behov', 'Utgå från behov', reg.needs.filter((n) => n.status === 'open' || n.status === 'matched').length)}
          {tab('losningar', 'Utgå från lösningar', reg.solutions.filter((s) => s.status === 'active').length)}
          {tab('tavla', 'Pågående matchningar', reg.matches.length)}
          {sp.behov || sp.losning ? (
            <Link href={`/spark/matchning?vy=${view}`} className={btnGhost}>
              Visa alla
            </Link>
          ) : null}
        </div>

        {view === 'behov' ? (
          needs.length === 0 ? (
            <Empty>Inga öppna behov. Behov kommer in när intervjuer med behovsägare förs in i registret.</Empty>
          ) : (
            <ul className="space-y-4">
              {needs.map((n) => {
                const suggestions = rankSolutionsForNeed(n, reg.solutions, reg.actorById, { exclude: matchedSolutions.get(n.id), limit });
                return (
                  <li key={n.id} className="rounded-3xl border border-default bg-surface p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1.5">
                        <Link href={`/spark/aktorer/${n.actor}`} className="text-xs font-semibold text-foreground-subtle hover:underline">
                          {actorName(reg, n.actor)}
                        </Link>
                        <h3 className="font-heading text-base font-semibold text-foreground">{n.title}</h3>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-subtle">
                          <AreaChips areas={n.areas} />
                          {n.priority ? <span>Prioritet: {SPARK_PRIORITY_LABELS[n.priority]}</span> : null}
                          {n.horizon ? <span>{SPARK_HORIZON_LABELS[n.horizon]}</span> : null}
                          {(matchedSolutions.get(n.id)?.size ?? 0) > 0 ? <Chip tone="info">{matchedSolutions.get(n.id)!.size} i matchning</Chip> : null}
                        </div>
                      </div>
                      {!sp.behov ? (
                        <Link href={`/spark/matchning?behov=${n.id}`} className={btnGhost}>
                          Alla förslag
                        </Link>
                      ) : null}
                    </div>
                    {suggestions.length === 0 ? (
                      <p className="mt-3 rounded-xl bg-canvas-subtle p-3 text-sm text-foreground-muted">Ingen lösning i registret passar än — ett behov att söka lösningar för.</p>
                    ) : (
                      <ul className="mt-3 divide-y divide-default rounded-2xl border border-default">
                        {suggestions.map((s) => (
                          <li key={s.item.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                            <div className="min-w-0">
                              <Link href={`/spark/aktorer/${s.item.actor}`} className="text-sm font-semibold text-foreground hover:underline">
                                {reg.solutions.find((x) => x.id === s.item.id)?.name}
                              </Link>
                              <span className="ml-2 text-xs text-foreground-subtle">{actorName(reg, s.item.actor)}</span>
                              <Reasons s={s} />
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-semibold text-foreground-subtle mx-tnum" title="Matchningspoäng">
                                {s.score} p
                              </span>
                              {canManage ? <CreateMatchButton needId={n.id} solutionId={s.item.id} /> : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        {view === 'losningar' ? (
          solutions.length === 0 ? (
            <Empty>Inga aktiva lösningar. Lösningar kommer in när intervjuer med innovationsaktörer förs in i registret.</Empty>
          ) : (
            <ul className="space-y-4">
              {solutions.map((s) => {
                const needSuggestions = rankNeedsForSolution(s, reg.needs, reg.actorById, { exclude: matchedNeeds.get(s.id), limit });
                const bedSuggestions = rankTestbedsForSolution(s, reg.testbeds, reg.actorById, { exclude: matchedTestbeds.get(s.id), limit });
                const trl = effectiveSparkTrl(s);
                return (
                  <li key={s.id} className="rounded-3xl border border-default bg-surface p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1.5">
                        <Link href={`/spark/aktorer/${s.actor}`} className="text-xs font-semibold text-foreground-subtle hover:underline">
                          {actorName(reg, s.actor)}
                        </Link>
                        <h3 className="font-heading text-base font-semibold text-foreground">{s.name}</h3>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-subtle">
                          <AreaChips areas={s.areas} />
                          {trl ? <Chip tone="accent">TRL {trl}</Chip> : null}
                        </div>
                      </div>
                      {!sp.losning ? (
                        <Link href={`/spark/matchning?losning=${s.id}`} className={btnGhost}>
                          Alla förslag
                        </Link>
                      ) : null}
                    </div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <div>
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Behov som passar</h4>
                        {needSuggestions.length === 0 ? (
                          <p className="rounded-xl bg-canvas-subtle p-3 text-sm text-foreground-muted">Inget behov i registret passar än.</p>
                        ) : (
                          <ul className="divide-y divide-default rounded-2xl border border-default">
                            {needSuggestions.map((n) => (
                              <li key={n.item.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                                <div className="min-w-0">
                                  <span className="text-sm font-semibold text-foreground">{reg.needs.find((x) => x.id === n.item.id)?.title}</span>
                                  <span className="ml-2 text-xs text-foreground-subtle">{actorName(reg, n.item.actor)}</span>
                                  <Reasons s={n} />
                                </div>
                                {canManage ? <CreateMatchButton needId={n.item.id} solutionId={s.id} /> : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Testmiljöer och pilotkunder</h4>
                        {bedSuggestions.length === 0 ? (
                          <p className="rounded-xl bg-canvas-subtle p-3 text-sm text-foreground-muted">Ingen testmiljö eller pilotkund passar än.</p>
                        ) : (
                          <ul className="divide-y divide-default rounded-2xl border border-default">
                            {bedSuggestions.map((t) => (
                              <li key={t.item.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                                <div className="min-w-0">
                                  <span className="text-sm font-semibold text-foreground">{SPARK_TESTBED_KIND_LABELS[t.item.kind as keyof typeof SPARK_TESTBED_KIND_LABELS]}</span>
                                  <span className="ml-2 text-xs text-foreground-subtle">{actorName(reg, t.item.actor)}</span>
                                  <Reasons s={t} />
                                </div>
                                {canManage ? <CreateMatchButton solutionId={s.id} testbedId={t.item.id} /> : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        {view === 'tavla' ? (
          reg.matches.length === 0 ? (
            <Empty>Inga matchningar än. Skapa den första från ett förslag under Utgå från behov eller Utgå från lösningar.</Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {SPARK_MATCH_STATUSES.map((status) => {
                const rows = reg.matches.filter((m) => m.status === status);
                if (rows.length === 0 && (status === 'declined' || status === 'completed')) return null;
                return (
                  <section key={status} className="rounded-2xl border border-default bg-canvas-subtle p-3">
                    <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                      {SPARK_MATCH_STATUS_LABELS[status]} <span className="mx-tnum">{rows.length}</span>
                    </h3>
                    <ul className="space-y-2">
                      {rows.map((m) => {
                        const need = reg.needs.find((n) => n.id === m.need);
                        const solution = reg.solutions.find((s) => s.id === m.solution);
                        const testbed = reg.testbeds.find((t) => t.id === m.testbed);
                        return (
                          <li key={m.id}>
                            <Link href={`/spark/matchning/${m.id}`} className="block rounded-xl border border-default bg-surface p-3 transition hover:border-strong">
                              <span className="block text-sm font-semibold text-foreground">{need?.title ?? (testbed ? SPARK_TESTBED_KIND_LABELS[testbed.kind] : 'Behov')}</span>
                              <span className="block text-xs text-foreground-muted">↔ {solution?.name ?? (testbed ? SPARK_TESTBED_KIND_LABELS[testbed.kind] : 'Lösning')}</span>
                              {m.next_step ? (
                                <span className="mt-1.5 block text-xs text-foreground-subtle">
                                  Nästa: {m.next_step}
                                  {m.next_step_due ? ` (${fmtDate(m.next_step_due)})` : ''}
                                </span>
                              ) : null}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )
        ) : null}
      </div>
    </PageShell>
  );
}
