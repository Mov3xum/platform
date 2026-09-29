import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Card, Chip, Icon } from '@/components/proto';
import { listSurveyModules, loadSurveyAggregate } from '@/lib/compass/survey';
import { FLOW_TYPE_LABEL } from '@/lib/compass/types';
import { normalizeSurveySubjectKind, SURVEY_SUBJECT_KIND_LABELS } from '@platform/shared';
import { buildInflodeTabs } from '../_tabs';

export const dynamic = 'force-dynamic';

export default async function EvaluationsPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    redirect('/inflode');
  }

  const pb = await getServerPb();
  const modules = await listSurveyModules(pb, user.tenant);
  const surveys = await Promise.all(
    modules.map(async (module) => ({
      module,
      aggregate: await loadSurveyAggregate(pb, user.tenant, module)
    }))
  );

  return (
    <PageShell
      title="Marknadsverktyg"
      tabs={buildInflodeTabs()}
      meta={<span className="text-[12px] text-foreground-subtle">Digital uppföljning och enkäter</span>}
      actions={
        <Link href="/inflode/admin/modules/new?purpose=survey" className="mx-btn mx-primary">
          <Icon name="plus" size={13} /> Skapa utvärdering
        </Link>
      }
    >
      <div className="space-y-5 py-6">
        <section className="rounded-2xl border border-default bg-canvas-subtle p-5">
          <h2 className="font-heading text-[16px] font-semibold text-foreground">
            Följ upp upplevelser över tid
          </h2>
          <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-foreground-muted">
            Skapa enkäter för startupbolag, event, partners eller personal. Svaren samlas
            in via en publik länk och resultaten visas som aggregat när minst fem personer
            har svarat. Dela länken vid återkommande uppföljningar för att följa utvecklingen.
          </p>
        </section>

        {surveys.length === 0 ? (
          <Card style={{ padding: 32, textAlign: 'center' }}>
            <div className="mx-disp mx-fw-6" style={{ fontSize: 18, marginBottom: 8 }}>
              Inga utvärderingar ännu
            </div>
            <p className="mx-muted mx-t-13" style={{ marginBottom: 16 }}>
              Börja med kundnöjdhet, NPS efter event, partneruppföljning eller en anonym
              medarbetarundersökning.
            </p>
            <Link href="/inflode/admin/modules/new?purpose=survey" className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Skapa första enkäten
            </Link>
          </Card>
        ) : (
          <div className="grid gap-3">
            {surveys.map(({ module, aggregate }) => {
              const subjectKind = normalizeSurveySubjectKind(module.subject_kind);
              const published = Boolean(module.is_active && module.public_url_enabled && module.public_slug);
              const previewHref = `/inflode/m/${module.slug}`;
              const publicHref = `/m/${module.public_slug}`;
              return (
                <Card key={module.id} style={{ padding: 16, minWidth: 0 }}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate font-heading text-[15px] font-semibold text-foreground">
                          {module.name}
                        </h2>
                        <Chip variant="default" mono>{FLOW_TYPE_LABEL[module.flow_type]}</Chip>
                        <Chip variant={published ? 'active' : 'draft'} mono>
                          {published ? 'PUBLICERAD' : 'UTKAST'}
                        </Chip>
                      </div>
                      <p className="mt-1 text-[12px] text-foreground-muted">
                        {SURVEY_SUBJECT_KIND_LABELS[subjectKind]}
                        {module.anonymous ? ' · anonym' : ' · svar kan kopplas till subjekt'}
                      </p>
                      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
                        <div>
                          <div className="font-heading text-[22px] font-semibold tabular-nums text-foreground">
                            {aggregate.respondents}
                          </div>
                          <div className="text-[11px] text-foreground-subtle">
                            svar
                          </div>
                        </div>
                        {aggregate.visible ? (
                          <>
                            {aggregate.score !== null && (
                              <div>
                                <div className="font-heading text-[22px] font-semibold tabular-nums text-foreground">
                                  {aggregate.score}<span className="text-[13px] font-normal text-foreground-muted">/10</span>
                                </div>
                                <div className="text-[11px] text-foreground-subtle">medel på skalfrågor</div>
                              </div>
                            )}
                            {aggregate.nps !== null && (
                              <div>
                                <div className="font-heading text-[22px] font-semibold tabular-nums text-foreground">
                                  {aggregate.nps}
                                </div>
                                <div className="text-[11px] text-foreground-subtle">NPS</div>
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="max-w-sm text-[12px] text-foreground-muted">
                            Resultat visas först när minst {aggregate.minGroup} svar har kommit in.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/inflode/admin/modules/${module.slug}`} className="mx-btn mx-sm mx-primary">
                        <Icon name="gear" size={12} /> Bygg vidare
                      </Link>
                      {published ? (
                        <a href={publicHref} target="_blank" rel="noopener noreferrer" className="mx-btn mx-sm">
                          <Icon name="globe" size={12} /> Öppna enkät
                        </a>
                      ) : (
                        <Link href={previewHref} className="mx-btn mx-sm">
                          Förhandsgranska
                        </Link>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
