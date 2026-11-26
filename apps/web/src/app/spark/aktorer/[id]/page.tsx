import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { CrumbLabels } from '@/components/proto/CrumbLabels';
import {
  SPARK_ACTOR_TYPE_LABELS,
  SPARK_ANSWER_LABELS,
  SPARK_HORIZON_LABELS,
  SPARK_KOMMUN_LABELS,
  SPARK_MATURITY_LABELS,
  SPARK_NEED_STATUSES,
  SPARK_NEED_STATUS_LABELS,
  SPARK_PRIORITY_LABELS,
  SPARK_SECTOR_LABELS,
  SPARK_SHARING_LABELS,
  SPARK_SIZE_LABELS,
  SPARK_SOLUTION_STATUSES,
  SPARK_SOLUTION_STATUS_LABELS,
  SPARK_SUPPORT_NEED_LABELS,
  SPARK_TESTBED_KIND_LABELS,
  SPARK_TESTBED_STATUSES,
  SPARK_TESTBED_STATUS_LABELS,
  effectiveSparkTrl,
  sparkAnonymousActorLabel
} from '@platform/shared';
import { loadSparkRegistry } from '@/lib/spark/data';
import { Chip, Panel, btnGhost } from '@/components/talent/ui';
import { ActorAdminForm, RecordStatusSelect } from '@/components/spark/controls';
import { AreaChips, MatchStatusChip, RoleChips, requireSparkStaff, sparkTabs } from '../../_shared';

export const dynamic = 'force-dynamic';

function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-semibold text-foreground-subtle">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

/** Aktörskortet (§ 61): allt som är registrerat på en organisation och vilka matchningar den är med i. */
export default async function SparkActorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, pb, canManage } = await requireSparkStaff();
  const reg = await loadSparkRegistry(pb, user.tenant);
  const actor = reg.actorById.get(id);
  if (!actor) notFound();
  const needs = reg.needs.filter((n) => n.actor === actor.id);
  const solutions = reg.solutions.filter((s) => s.actor === actor.id);
  const testbeds = reg.testbeds.filter((t) => t.actor === actor.id);
  const ownIds = new Set([...needs, ...solutions, ...testbeds].map((x) => x.id));
  const matches = reg.matches.filter((m) => [m.need, m.solution, m.testbed].some((x) => x && ownIds.has(x)));
  const startups = canManage
    ? await pb
        .collection('startups')
        .getList<{ id: string; name: string }>(1, 500, { filter: pb.filter('tenant = {:t}', { t: user.tenant }), fields: 'id,name', sort: 'name' })
        .then((r) => r.items)
        .catch(() => [])
    : [];
  const yn = (v: string) => SPARK_ANSWER_LABELS[v] ?? '';
  const opts = (list: readonly string[], map: Record<string, string>) => list.map((id2) => ({ id: id2, label: map[id2] }));

  return (
    <PageShell
      title={actor.name}
      tabs={sparkTabs(true)}
      meta={
        <span className="flex flex-wrap items-center gap-2">
          <RoleChips roles={actor.roles} />
          {actor.status === 'archived' ? <Chip tone="danger">Arkiverad</Chip> : null}
        </span>
      }
      actions={
        actor.startup ? (
          <Link href={`/startups/${actor.startup}`} className={btnGhost}>
            Bolagskortet
          </Link>
        ) : null
      }
    >
      <CrumbLabels labels={{ [`/spark/aktorer/${actor.id}`]: actor.name }} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="Behov" meta={<span className="text-xs text-foreground-subtle mx-tnum">{needs.length}</span>}>
            {needs.length === 0 ? (
              <p className="text-sm text-foreground-muted">Inga behov registrerade.</p>
            ) : (
              <ul className="space-y-4">
                {needs.map((n) => (
                  <li key={n.id} className="rounded-2xl border border-default p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-semibold text-foreground">{n.title}</h3>
                      {canManage ? <RecordStatusSelect kind="need" id={n.id} value={n.status} options={opts(SPARK_NEED_STATUSES, SPARK_NEED_STATUS_LABELS)} /> : <Chip>{SPARK_NEED_STATUS_LABELS[n.status]}</Chip>}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-foreground-muted">{n.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground-subtle">
                      <AreaChips areas={n.areas} />
                      {n.priority ? <span>Prioritet: {SPARK_PRIORITY_LABELS[n.priority]}</span> : null}
                      {n.horizon ? <span>{SPARK_HORIZON_LABELS[n.horizon]}</span> : null}
                      {n.unmet === 'yes' ? <span>Saknar lösning på marknaden</span> : null}
                    </div>
                    <Link href={`/spark/matchning?behov=${n.id}`} className="mt-3 inline-block text-sm font-medium text-link hover:underline">
                      Visa förslag på lösningar
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Lösningar" meta={<span className="text-xs text-foreground-subtle mx-tnum">{solutions.length}</span>}>
            {solutions.length === 0 ? (
              <p className="text-sm text-foreground-muted">Inga lösningar registrerade.</p>
            ) : (
              <ul className="space-y-4">
                {solutions.map((s) => {
                  const trl = effectiveSparkTrl(s);
                  return (
                    <li key={s.id} className="rounded-2xl border border-default p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="font-semibold text-foreground">{s.name}</h3>
                        {canManage ? <RecordStatusSelect kind="solution" id={s.id} value={s.status} options={opts(SPARK_SOLUTION_STATUSES, SPARK_SOLUTION_STATUS_LABELS)} /> : <Chip>{SPARK_SOLUTION_STATUS_LABELS[s.status]}</Chip>}
                      </div>
                      <p className="mt-1 whitespace-pre-line text-sm text-foreground-muted">{s.description}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-foreground-subtle">
                        <AreaChips areas={s.areas} />
                        {trl ? <Chip tone="accent">TRL {trl}</Chip> : null}
                        {s.maturity ? <span>{SPARK_MATURITY_LABELS[String(s.maturity)]}</span> : null}
                      </div>
                      <Link href={`/spark/matchning?losning=${s.id}`} className="mt-3 inline-block text-sm font-medium text-link hover:underline">
                        Visa förslag på behov och testmiljöer
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Testmiljöer och pilotkund" meta={<span className="text-xs text-foreground-subtle mx-tnum">{testbeds.length}</span>}>
            {testbeds.length === 0 ? (
              <p className="text-sm text-foreground-muted">Inget registrerat.</p>
            ) : (
              <ul className="space-y-3">
                {testbeds.map((t) => (
                  <li key={t.id} className="rounded-2xl border border-default p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-semibold text-foreground">{SPARK_TESTBED_KIND_LABELS[t.kind]}</h3>
                      {canManage ? <RecordStatusSelect kind="testbed" id={t.id} value={t.status} options={opts(SPARK_TESTBED_STATUSES, SPARK_TESTBED_STATUS_LABELS)} /> : <Chip>{SPARK_TESTBED_STATUS_LABELS[t.status]}</Chip>}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-foreground-muted">{t.description}</p>
                    {t.conditions ? <p className="mt-1 text-xs text-foreground-subtle">Förutsättningar: {t.conditions}</p> : null}
                    <div className="mt-2">
                      <AreaChips areas={t.areas} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Matchningar" meta={<span className="text-xs text-foreground-subtle mx-tnum">{matches.length}</span>}>
            {matches.length === 0 ? (
              <p className="text-sm text-foreground-muted">Aktören är inte med i någon matchning än.</p>
            ) : (
              <ul className="divide-y divide-default">
                {matches.map((m) => {
                  const need = reg.needs.find((n) => n.id === m.need);
                  const solution = reg.solutions.find((s) => s.id === m.solution);
                  return (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <Link href={`/spark/matchning/${m.id}`} className="text-sm font-medium text-foreground hover:underline">
                        {need?.title ?? 'Testmiljö'} ↔ {solution?.name ?? 'Testmiljö'}
                      </Link>
                      <MatchStatusChip status={m.status} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="space-y-5">
          <Panel title="Om aktören">
            <dl className="space-y-3">
              <Fact label="Typ" value={SPARK_ACTOR_TYPE_LABELS[actor.actor_type] ?? ''} />
              <Fact label="Organisationsnummer" value={actor.org_nr} />
              <Fact label="Bransch" value={SPARK_SECTOR_LABELS[actor.sector] ?? ''} />
              <Fact label="Verksamhet" value={actor.business} />
              <Fact label="Kommun" value={SPARK_KOMMUN_LABELS[actor.kommun] ?? ''} />
              <Fact label="Storlek" value={SPARK_SIZE_LABELS[actor.size] ?? ''} />
              <Fact label="Utvecklingsområden" value={actor.development_areas} />
              <Fact label="Vill vara pilotkund" value={yn(actor.pilot_interest)} />
              <Fact label="Intresse av akademisamverkan" value={yn(actor.academia_interest)} />
              <Fact label="Intresse av acceleratorprogram" value={yn(actor.program_interest)} />
              <Fact label="Stödbehov" value={actor.support_needs.map((s) => SPARK_SUPPORT_NEED_LABELS[s]).join(', ')} />
            </dl>
          </Panel>
          <Panel title="Kontakt och delning">
            <dl className="space-y-3">
              <Fact label="Får kontaktas" value={actor.contact_ok ? 'Ja' : 'Nej eller inte tillfrågad'} />
              {actor.contact_ok ? (
                <>
                  <Fact label="Kontaktperson" value={[actor.contact_name, actor.contact_role].filter(Boolean).join(', ')} />
                  <Fact label="E-post" value={actor.contact_email} />
                  <Fact label="Telefon" value={actor.contact_phone} />
                </>
              ) : null}
              <Fact label="Vad som får delas" value={SPARK_SHARING_LABELS[actor.sharing] ?? 'Inte angivet — fråga först'} />
              <Fact label="Vill matchas (behov)" value={yn(actor.need_matching)} />
              <Fact label="Vill matchas (lösningar)" value={yn(actor.solution_matching)} />
              <Fact label="Anonym beskrivning" value={sparkAnonymousActorLabel(actor)} />
            </dl>
          </Panel>
          {canManage ? (
            <Panel title="Movexums uppgifter">
              <ActorAdminForm actorId={actor.id} notes={actor.notes} website={actor.website} startup={actor.startup ?? ''} status={actor.status} startups={startups} />
            </Panel>
          ) : null}
        </aside>
      </div>
    </PageShell>
  );
}
