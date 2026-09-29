import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Card } from '@/components/proto';
import { createSurveyAction } from '@/lib/actions/surveys';
import { SURVEY_KINDS, SURVEY_TEMPLATES } from '@platform/shared';
import { buildInflodeTabs } from '../../_tabs';

export const dynamic = 'force-dynamic';

export default async function NewSurveyPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) redirect('/inflode');

  return (
    <PageShell title="Marknadsverktyg" tabs={buildInflodeTabs()}>
      <form action={createSurveyAction} style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
        <div>
          <div className="mx-disp mx-fw-6" style={{ fontSize: 20 }}>
            Ny enkät
          </div>
          <div className="mx-muted mx-t-13" style={{ marginTop: 4 }}>
            Välj en mall som utgångspunkt — allt går att ändra i byggaren.
          </div>
        </div>
        <label className="mx-t-12 mx-muted">
          Namn (internt)
          <input className="mx-input" name="name" maxLength={160} placeholder="t.ex. Workshop Pitch, oktober" />
        </label>
        <div style={{ display: 'grid', gap: 10 }}>
          {SURVEY_KINDS.map((kind, i) => {
            const t = SURVEY_TEMPLATES[kind];
            return (
              <label key={kind} style={{ cursor: 'pointer' }}>
                <Card style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <input
                    type="radio"
                    name="kind"
                    value={kind}
                    defaultChecked={i === 0}
                    style={{ accentColor: 'var(--movexum-morkbla)', marginTop: 4 }}
                  />
                  <div>
                    <div className="mx-disp mx-fw-6 mx-t-13">{t.label}</div>
                    <div className="mx-t-12 mx-muted" style={{ lineHeight: 1.4 }}>
                      {t.description} · {t.questions.length} frågor
                    </div>
                  </div>
                </Card>
              </label>
            );
          })}
        </div>
        <div>
          <button type="submit" className="mx-btn mx-primary">
            Skapa enkät
          </button>
        </div>
      </form>
    </PageShell>
  );
}
