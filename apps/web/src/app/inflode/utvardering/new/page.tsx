import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Card, Icon } from '@/components/proto';
import { createSurveyAction } from '@/lib/actions/surveys';
import { resolveSurveyLink } from '@/lib/surveys/link';
import { listSurveyTemplates } from '@/lib/surveys/store';
import { getRecordInTenant } from '@/lib/core/write/helpers';
import {
  EVENT_TYPES,
  EVENT_TYPE_LABEL,
  SURVEY_KINDS,
  SURVEY_LINK_DEFAULT_KIND,
  SURVEY_LINK_KIND_LABEL,
  SURVEY_TEMPLATES,
  pickSurveyTemplateForEventType,
  surveyLinkHref,
  surveyLinkRefParam,
  type Role
} from '@platform/shared';
import { buildInflodeTabs } from '../../_tabs';

export const dynamic = 'force-dynamic';

// Felkoder från `createSurveyAction` (`CreateSurveyErrorCode`). Orsaken (PB:s
// fältdetaljer, PII-fri) följer med i `?detail=` och visas under texten så
// felet går att felsöka — i stället för produktionens anonyma "Något gick fel".
const ERROR_TEXT: Record<string, string> = {
  link_missing:
    'Det som enkäten skulle följa upp hittades inte (raderat eller fel länk). Öppna källan igen och klicka "Skapa uppföljning", eller skapa enkäten utan koppling.',
  template_missing: 'Mallen kunde inte användas.',
  collection_missing:
    'Enkäter kan inte skapas ännu: kollektionen "surveys" saknas i PocketBase på den här instansen.',
  create_failed: 'Kunde inte skapa enkäten.'
};

export default async function NewSurveyPage({
  searchParams
}: {
  searchParams: Promise<{ for?: string; error?: string; detail?: string; mall?: string }>;
}) {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) redirect('/inflode');
  const { for: forRaw, error: errorKey, detail: detailRaw, mall } = await searchParams;
  // `?mall=1` (§ 53.3): skapa en egen mall i stället för en enkät.
  const asTemplate = mall === '1';
  const errorText = errorKey ? ERROR_TEXT[errorKey] || ERROR_TEXT.create_failed : null;
  const errorDetail = errorText ? (detailRaw || '').slice(0, 400) : '';

  // "Skapa uppföljning" från en aktivitet/event/workshop/… (§ 47.4). Källan
  // tenant-verifieras här OCH i server-actionen; en okänd referens visas
  // som varning i stället för att tyst bli en fristående enkät.
  const pb = await getServerPb();
  const link = !asTemplate && forRaw ? await resolveSurveyLink(pb, user, forRaw) : null;
  const linkMissing = !asTemplate && Boolean(forRaw) && !link;
  const templates = await listSurveyTemplates(pb, user.tenant);

  // Förval: tenantens mall för eventets typ (§ 53.3), annars den inbyggda
  // mallen för källans typ.
  let preferredTemplate: string | null = null;
  if (link?.kind === 'event') {
    const ev = await getRecordInTenant<{ id: string; tenant?: string; type?: string }>(
      pb,
      { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
      'incubator_events',
      link.id,
      'id,tenant,type'
    );
    preferredTemplate = pickSurveyTemplateForEventType(templates, ev?.type);
  }
  const defaultKind = link ? SURVEY_LINK_DEFAULT_KIND[link.kind] : SURVEY_KINDS[0];
  const defaultChoice = preferredTemplate ? `template:${preferredTemplate}` : `kind:${defaultKind}`;

  return (
    <PageShell title="Marknadsverktyg" tabs={buildInflodeTabs()}>
      <form action={createSurveyAction} style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
        <div>
          <div className="mx-disp mx-fw-6" style={{ fontSize: 20 }}>
            {asTemplate ? 'Ny mall' : link ? 'Ny uppföljning' : 'Ny enkät'}
          </div>
          <div className="mx-muted mx-t-13" style={{ marginTop: 4 }}>
            {asTemplate
              ? 'En mall är utgångspunkten för utvärderingen av en typ av aktivitet. Den publiceras aldrig själv.'
              : 'Välj en mall som utgångspunkt — allt går att ändra i byggaren.'}
          </div>
        </div>
        {asTemplate && <input type="hidden" name="as_template" value="1" />}

        {errorText && (
          <div
            role="alert"
            className="mx-t-13"
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--movexum-pastell-orange)',
              color: 'var(--movexum-morkorange)'
            }}
          >
            <div>{errorText}</div>
            {errorDetail && (
              <div className="mx-t-12" style={{ marginTop: 4, opacity: 0.9 }}>
                Orsak: {errorDetail}
              </div>
            )}
          </div>
        )}

        {link && (
          <>
            <input type="hidden" name="for" value={surveyLinkRefParam(link)} />
            <Card style={{ padding: 12, background: 'var(--mx-paper-2)' }}>
              <div className="mx-flex mx-items-c mx-gap-2 mx-t-13" style={{ flexWrap: 'wrap' }}>
                <Icon name="link" size={13} />
                <span>
                  Följer upp <strong>{SURVEY_LINK_KIND_LABEL[link.kind].toLowerCase()}</strong>:{' '}
                  <Link href={surveyLinkHref(link, link.slug)} className="text-link hover:underline">
                    {link.label}
                  </Link>
                </span>
                <span style={{ flex: 1 }} />
                <Link href="/inflode/utvardering/new" className="mx-t-12 text-link hover:underline">
                  Skapa utan koppling
                </Link>
              </div>
            </Card>
          </>
        )}
        {linkMissing && errorKey !== 'link_missing' && (
          <div
            role="alert"
            className="mx-t-13"
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--movexum-pastell-orange)',
              color: 'var(--movexum-morkorange)'
            }}
          >
            Det som enkäten skulle följa upp hittades inte (raderat eller fel länk). Enkäten
            skapas utan koppling.
          </div>
        )}

        <label className="mx-t-12 mx-muted">
          Namn (internt)
          <input
            className="mx-input"
            name="name"
            maxLength={160}
            defaultValue={link ? `Uppföljning: ${link.label}` : ''}
            placeholder={asTemplate ? 't.ex. Frukostträff' : 't.ex. Workshop Pitch, oktober'}
          />
        </label>
        {asTemplate && (
          <fieldset style={{ display: 'grid', gap: 8 }}>
            <legend className="mx-t-12 mx-muted">Standardmall för eventtyper</legend>
            <div className="mx-flex mx-gap-3 mx-wrap">
              {EVENT_TYPES.map((t) => (
                <label key={t} className="mx-t-13 mx-flex mx-items-c mx-gap-2">
                  <input
                    type="checkbox"
                    name="template_for"
                    value={t}
                    style={{ accentColor: 'var(--movexum-morkbla)' }}
                  />
                  {EVENT_TYPE_LABEL[t]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div style={{ display: 'grid', gap: 10 }}>
          {templates.map((t) => (
            <label key={t.id} style={{ cursor: 'pointer' }}>
              <Card style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <input
                  type="radio"
                  name="template"
                  value={`template:${t.id}`}
                  defaultChecked={defaultChoice === `template:${t.id}`}
                  style={{ accentColor: 'var(--movexum-morkbla)', marginTop: 4 }}
                />
                <div>
                  <div className="mx-disp mx-fw-6 mx-t-13">
                    {t.name} <span className="mx-muted mx-t-12">· egen mall</span>
                  </div>
                  <div className="mx-t-12 mx-muted" style={{ lineHeight: 1.4 }}>
                    {t.template_for.length > 0
                      ? `För ${t.template_for.map((x) => EVENT_TYPE_LABEL[x].toLowerCase()).join(', ')} · `
                      : ''}
                    {t.questions.length} frågor
                  </div>
                </div>
              </Card>
            </label>
          ))}
          {SURVEY_KINDS.map((kind) => {
            const t = SURVEY_TEMPLATES[kind];
            return (
              <label key={kind} style={{ cursor: 'pointer' }}>
                <Card style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <input
                    type="radio"
                    name="template"
                    value={`kind:${kind}`}
                    defaultChecked={defaultChoice === `kind:${kind}`}
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
            {asTemplate ? 'Skapa mall' : link ? 'Skapa uppföljning' : 'Skapa enkät'}
          </button>
        </div>
      </form>
    </PageShell>
  );
}
