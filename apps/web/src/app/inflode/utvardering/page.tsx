import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Card, Chip, Icon } from '@/components/proto';
import { listSurveys } from '@/lib/surveys/store';
import { EVENT_TYPE_LABEL, SURVEY_KIND_LABEL } from '@platform/shared';
import { SurveyLinkChip } from '@/components/surveys/SurveyLinkChip';
import { buildInflodeTabs } from '../_tabs';

export const dynamic = 'force-dynamic';

export default async function SurveysPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) redirect('/inflode');
  const pb = await getServerPb();
  const all = await listSurveys(pb, user.tenant);
  const counts = all.counts;
  // Mallar (§ 53.3) listas för sig — de tar aldrig emot svar.
  const templates = all.surveys.filter((s) => s.is_template);
  const surveys = all.surveys.filter((s) => !s.is_template);

  return (
    <PageShell
      title="Marknadsverktyg"
      tabs={buildInflodeTabs()}
      meta={
        <span className="text-[12px] text-foreground-subtle">
          Utvärdering · digitala enkäter för uppföljning
        </span>
      }
      actions={
        <>
          <Link href="/inflode/utvardering/new?mall=1" className="mx-btn">
            <Icon name="plus" size={13} /> Ny mall
          </Link>
          <Link href="/inflode/utvardering/new" className="mx-btn mx-primary">
            <Icon name="plus" size={13} /> Ny enkät
          </Link>
        </>
      }
    >
      <Card style={{ padding: 12, marginBottom: 16, background: 'var(--mx-paper-2)' }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-t-12 mx-muted" style={{ flexWrap: 'wrap' }}>
          <Icon name="shield" size={13} />
          <span>
            Enkäter besvaras anonymt på <code className="mx-mono">/u/[länk]</code> med egen QR-kod.
            Inga namn, e-postadresser eller IP-adresser sparas — bara svaren. En uppföljning kan
            också skapas direkt från en aktivitet i årshjulet, ett event, en workshop, ett uppdrag
            eller ett bolagskort.
          </span>
        </div>
      </Card>

      {templates.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="mx-t-12 mx-muted mx-fw-6" style={{ marginBottom: 8 }}>
            Mallar · utvärdering skapas som utkast när ett event av vald typ skapas
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {templates.map((t) => (
              <Card key={t.id} style={{ padding: 12 }}>
                <div className="mx-flex mx-items-c mx-gap-2">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mx-flex mx-items-c mx-gap-2">
                      <span className="mx-disp mx-fw-6 mx-t-13 mx-truncate">{t.name}</span>
                      <Chip mono>MALL</Chip>
                    </div>
                    <div className="mx-t-12 mx-muted mx-truncate" style={{ marginTop: 4 }}>
                      {t.template_for.length > 0
                        ? `Standard för ${t.template_for.map((x) => EVENT_TYPE_LABEL[x].toLowerCase()).join(', ')}`
                        : 'Ingen eventtyp vald — används bara när den väljs uttryckligen'}{' '}
                      · {t.questions.length} frågor
                    </div>
                  </div>
                  <Link href={`/inflode/utvardering/${t.id}`} className="mx-btn mx-sm mx-primary">
                    <Icon name="gear" size={12} /> Redigera
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {surveys.length === 0 ? (
        <Card style={{ padding: 32, textAlign: 'center' }}>
          <div className="mx-disp mx-fw-6" style={{ fontSize: 18, marginBottom: 8 }}>
            Inga enkäter ännu
          </div>
          <div className="mx-muted mx-t-13" style={{ marginBottom: 16 }}>
            Starta från en mall — workshop-utvärdering, event, inkubatorprogram eller alumni-uppföljning.
          </div>
          <Link href="/inflode/utvardering/new" className="mx-btn mx-primary">
            <Icon name="plus" size={13} /> Skapa din första enkät
          </Link>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {surveys.map((s) => (
            <Card key={s.id} style={{ padding: 14 }}>
              <div className="mx-flex mx-items-c mx-gap-2">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mx-flex mx-items-c mx-gap-2">
                    <span className="mx-disp mx-fw-6 mx-t-13 mx-truncate">{s.name}</span>
                    <Chip mono>{SURVEY_KIND_LABEL[s.kind].toUpperCase()}</Chip>
                    {s.is_active ? (
                      <Chip variant="active" mono>
                        ÖPPEN
                      </Chip>
                    ) : (
                      <Chip variant="draft" mono>
                        STÄNGD
                      </Chip>
                    )}
                  </div>
                  <div className="mx-t-12 mx-muted mx-truncate" style={{ marginTop: 4 }}>
                    <code className="mx-mono">/u/{s.public_slug}</code> · {s.questions.length} frågor
                    {s.description ? ` · ${s.description}` : ''}
                  </div>
                  {s.link_kind && (
                    <div style={{ marginTop: 6 }}>
                      <SurveyLinkChip kind={s.link_kind} id={s.link_id} label={s.link_label} />
                    </div>
                  )}
                </div>
                <div className="mx-mono mx-t-xs" style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="mx-fw-6 mx-ink-soft">{counts.get(s.id) ?? 0} svar</div>
                </div>
                <div className="mx-flex mx-gap-2" style={{ flexShrink: 0 }}>
                  <Link href={`/inflode/utvardering/${s.id}?vy=resultat`} className="mx-btn mx-sm">
                    Resultat
                  </Link>
                  <Link href={`/inflode/utvardering/${s.id}`} className="mx-btn mx-sm mx-primary">
                    <Icon name="gear" size={12} /> Redigera
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
