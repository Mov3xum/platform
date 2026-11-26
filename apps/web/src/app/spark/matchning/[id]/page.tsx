import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { CrumbLabels } from '@/components/proto/CrumbLabels';
import { SPARK_SHARING_LABELS, SPARK_TESTBED_KIND_LABELS, effectiveSparkTrl, sparkShareableName } from '@platform/shared';
import { loadSparkRegistry, sparkUserNames, type SparkActorRow } from '@/lib/spark/data';
import { Chip, Panel } from '@/components/talent/ui';
import { MatchForm } from '@/components/spark/controls';
import { AreaChips, MatchStatusChip, requireSparkStaff, sparkTabs } from '../../_shared';

export const dynamic = 'force-dynamic';

function Party({ role, actor, title, text, extra }: { role: string; actor: SparkActorRow | undefined; title: string; text: string; extra?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-default p-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">{role}</span>
      <h3 className="mt-1 font-heading text-base font-semibold text-foreground">{title}</h3>
      {actor ? (
        <Link href={`/spark/aktorer/${actor.id}`} className="text-sm font-medium text-link hover:underline">
          {actor.name}
        </Link>
      ) : null}
      <p className="mt-2 line-clamp-6 whitespace-pre-line text-sm text-foreground-muted">{text}</p>
      {extra ? <div className="mt-2 flex flex-wrap items-center gap-2">{extra}</div> : null}
      {actor ? (
        <p className="mt-3 rounded-xl bg-canvas-subtle p-3 text-xs text-foreground-muted">
          <span className="font-semibold text-foreground">Så får parten presenteras för motparten:</span> {sparkShareableName(actor)}
          <span className="block text-foreground-subtle">Delning: {SPARK_SHARING_LABELS[actor.sharing] ?? 'inte angiven — fråga först'}</span>
        </p>
      ) : null}
    </div>
  );
}

/** En matchning (§ 61): parterna, skälen och uppföljningen. */
export default async function SparkMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, pb, canManage, isLead } = await requireSparkStaff();
  const reg = await loadSparkRegistry(pb, user.tenant);
  const match = reg.matches.find((m) => m.id === id);
  if (!match) notFound();
  const need = reg.needs.find((n) => n.id === match.need);
  const solution = reg.solutions.find((s) => s.id === match.solution);
  const testbed = reg.testbeds.find((t) => t.id === match.testbed);
  const names = await sparkUserNames(pb, user.tenant, [match.owner]);
  const title = `${need?.title ?? (testbed ? SPARK_TESTBED_KIND_LABELS[testbed.kind] : 'Behov')} ↔ ${solution?.name ?? 'Testmiljö'}`;
  const trl = solution ? effectiveSparkTrl(solution) : null;

  return (
    <PageShell
      title={title}
      tabs={sparkTabs(true)}
      meta={
        <span className="flex flex-wrap items-center gap-2 text-xs text-foreground-subtle">
          <MatchStatusChip status={match.status} />
          {match.owner && names.get(match.owner) ? <span>Ansvarig: {names.get(match.owner)}</span> : null}
          {match.score ? <span className="mx-tnum">{match.score} p</span> : null}
        </span>
      }
    >
      <CrumbLabels labels={{ [`/spark/matchning/${match.id}`]: title }} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {need ? <Party role="Behov" actor={reg.actorById.get(need.actor)} title={need.title} text={need.description} extra={<AreaChips areas={need.areas} />} /> : null}
          {solution ? (
            <Party
              role="Lösning"
              actor={reg.actorById.get(solution.actor)}
              title={solution.name}
              text={solution.description}
              extra={
                <>
                  <AreaChips areas={solution.areas} />
                  {trl ? <Chip tone="accent">TRL {trl}</Chip> : null}
                </>
              }
            />
          ) : null}
          {testbed ? (
            <Party role={SPARK_TESTBED_KIND_LABELS[testbed.kind]} actor={reg.actorById.get(testbed.actor)} title={SPARK_TESTBED_KIND_LABELS[testbed.kind]} text={testbed.description} extra={<AreaChips areas={testbed.areas} />} />
          ) : null}
          {match.reasons.length > 0 ? (
            <Panel title="Därför föreslogs matchningen">
              <ul className="space-y-1 text-sm text-foreground-muted">
                {match.reasons.map((r) => (
                  <li key={r}>+ {r}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
        <Panel title="Uppföljning">
          {canManage ? (
            <MatchForm
              matchId={match.id}
              hasNeedSide={Boolean(match.need || match.testbed)}
              hasSolution={Boolean(match.solution)}
              canDelete={isLead}
              initial={{
                status: match.status,
                need_consent: match.need_consent,
                solution_consent: match.solution_consent,
                next_step: match.next_step,
                next_step_due: match.next_step_due ?? '',
                notes: match.notes,
                outcome: match.outcome,
                support_kind: match.support_kind,
                support_confirmed: match.support_confirmed,
                support_note: match.support_note,
                work_package: match.work_package
              }}
            />
          ) : (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs font-semibold text-foreground-subtle">Nästa steg</dt>
                <dd className="text-foreground">{match.next_step || '–'}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-foreground-subtle">Anteckningar</dt>
                <dd className="whitespace-pre-line text-foreground">{match.notes || '–'}</dd>
              </div>
            </dl>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}
