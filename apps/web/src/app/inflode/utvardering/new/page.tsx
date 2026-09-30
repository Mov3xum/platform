import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Card, Icon } from '@/components/proto';
import { createSurveyAction } from '@/lib/actions/surveys';
import { resolveSurveyLink } from '@/lib/surveys/link';
import {
  SURVEY_KINDS,
  SURVEY_LINK_DEFAULT_KIND,
  SURVEY_LINK_KIND_LABEL,
  SURVEY_TEMPLATES,
  surveyLinkHref,
  surveyLinkRefParam
} from '@platform/shared';
import { buildInflodeTabs } from '../../_tabs';

export const dynamic = 'force-dynamic';

// Felkoder från `createSurveyAction` (`CreateSurveyErrorCode`). Orsaken (PB:s
// fältdetaljer, PII-fri) följer med i `?detail=` och visas under texten så
// felet går att felsöka — i stället för produktionens anonyma "Något gick fel".
const ERROR_TEXT: Record<string, string> = {
  link_missing:
    'Det som enkäten skulle följa upp hittades inte (raderat eller fel länk). Öppna källan igen och klicka "Skapa uppföljning", eller skapa enkäten utan koppling.',
  collection_missing:
    'Enkäter kan inte skapas ännu: kollektionen "surveys" saknas i PocketBase på den här instansen.',
  create_failed: 'Kunde inte skapa enkäten.'
};

export default async function NewSurveyPage({
  searchParams
}: {
  searchParams: Promise<{ for?: string; error?: string; detail?: string }>;
}) {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) redirect('/inflode');
  const { for: forRaw, error: errorKey, detail: detailRaw } = await searchParams;
  const errorText = errorKey ? ERROR_TEXT[errorKey] || ERROR_TEXT.create_failed : null;
  const errorDetail = errorText ? (detailRaw || '').slice(0, 400) : '';

  // "Skapa uppföljning" från en aktivitet/event/workshop/… (§ 47.4). Källan
  // tenant-verifieras här OCH i server-actionen; en okänd referens visas
  // som varning i stället för att tyst bli en fristående enkät.
  const pb = await getServerPb();
  const link = forRaw ? await resolveSurveyLink(pb, user, forRaw) : null;
  const linkMissing = Boolean(forRaw) && !link;
  const defaultKind = link ? SURVEY_LINK_DEFAULT_KIND[link.kind] : SURVEY_KINDS[0];

  return (
    <PageShell title="Marknadsverktyg" tabs={buildInflodeTabs()}>
      <form action={createSurveyAction} style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
        <div>
          <div className="mx-disp mx-fw-6" style={{ fontSize: 20 }}>
            {link ? 'Ny uppföljning' : 'Ny enkät'}
          </div>
          <div className="mx-muted mx-t-13" style={{ marginTop: 4 }}>
            Välj en mall som utgångspunkt — allt går att ändra i byggaren.
          </div>
        </div>

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
            placeholder="t.ex. Workshop Pitch, oktober"
          />
        </label>
        <div style={{ display: 'grid', gap: 10 }}>
          {SURVEY_KINDS.map((kind) => {
            const t = SURVEY_TEMPLATES[kind];
            return (
              <label key={kind} style={{ cursor: 'pointer' }}>
                <Card style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <input
                    type="radio"
                    name="kind"
                    value={kind}
                    defaultChecked={kind === defaultKind}
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
            {link ? 'Skapa uppföljning' : 'Skapa enkät'}
          </button>
        </div>
      </form>
    </PageShell>
  );
}
