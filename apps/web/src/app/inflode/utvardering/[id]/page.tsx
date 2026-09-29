import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { SurveyBuilder } from '@/components/surveys/SurveyBuilder';
import { ConfirmDeleteButton } from '@/components/surveys/ConfirmDeleteButton';
import { SurveyResults } from '@/components/surveys/SurveyResults';
import { deleteSurveyAction } from '@/lib/actions/surveys';
import { getSurvey, getSurveyResults } from '@/lib/surveys/store';
import { SurveyLinkChip } from '@/components/surveys/SurveyLinkChip';
import { SurveySendPanel } from '@/components/surveys/SurveySendPanel';
import { countSurveyRecipients } from '@/lib/surveys/recipients';
import { getRecordInTenant } from '@/lib/core/write/helpers';
import { defaultSurveySendAt, type Role } from '@platform/shared';
import { buildInflodeTabs } from '../../_tabs';

export const dynamic = 'force-dynamic';

export default async function SurveyDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vy?: string; varning?: string }>;
}) {
  const { id } = await params;
  const { vy, varning } = await searchParams;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) redirect('/inflode');
  const pb = await getServerPb();
  const survey = await getSurvey(pb, user.tenant, id);
  if (!survey) notFound();

  const showResults = vy === 'resultat';
  const results = showResults ? await getSurveyResults(pb, survey) : null;

  // Utskick (§ 39.5) — bara för event-kopplade enkäter. Antalet räknas
  // server-side; adresserna når aldrig klienten.
  let send: { recipientCount: number; defaultSendAt: string } | null = null;
  if (!showResults && survey.link_kind === 'event' && survey.link_id) {
    const ev = await getRecordInTenant<{ id: string; tenant?: string; starts_at?: string; ends_at?: string }>(
      pb,
      { kind: 'user', id: user.id, tenant: user.tenant, roles: user.roles as Role[] },
      'incubator_events',
      survey.link_id,
      'id,tenant,starts_at,ends_at'
    );
    if (ev) {
      send = {
        recipientCount: await countSurveyRecipients(pb, user.tenant, survey.link_id),
        defaultSendAt: defaultSurveySendAt(ev)?.toISOString() ?? ''
      };
    }
  }

  return (
    <PageShell
      title="Marknadsverktyg"
      tabs={buildInflodeTabs()}
      meta={
        <span className="mx-flex mx-items-c mx-gap-2 text-[12px] text-foreground-subtle">
          Utvärdering / {survey.name}
          <SurveyLinkChip kind={survey.link_kind} id={survey.link_id} label={survey.link_label} />
        </span>
      }
      actions={
        <>
          <Link
            href={`/inflode/utvardering/${survey.id}`}
            className={`mx-btn${showResults ? '' : ' mx-primary'}`}
          >
            Bygg
          </Link>
          <Link
            href={`/inflode/utvardering/${survey.id}?vy=resultat`}
            className={`mx-btn${showResults ? ' mx-primary' : ''}`}
          >
            Resultat
          </Link>
        </>
      }
    >
      {varning === 'koppling' && (
        <div
          role="alert"
          className="mx-t-13"
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            marginBottom: 12,
            maxWidth: 820,
            background: 'var(--movexum-pastell-gul)',
            color: 'var(--movexum-morkgul)'
          }}
        >
          Enkäten skapades, men kopplingen till källan kunde inte sparas — PocketBase saknar
          fälten från migration 1700000150. Kör migrationen och skapa uppföljningen igen.
        </div>
      )}
      {results ? (
        <SurveyResults summary={results.summary} total={results.total} incomplete={results.incomplete} />
      ) : (
        <>
          <SurveyBuilder survey={survey} />
          {send && (
            <div style={{ marginTop: 16, maxWidth: 820 }}>
              <SurveySendPanel
                surveyId={survey.id}
                isActive={survey.is_active}
                recipientCount={send.recipientCount}
                sendAt={survey.send_at}
                sentAt={survey.sent_at}
                sentCount={survey.sent_count}
                defaultSendAt={send.defaultSendAt}
              />
            </div>
          )}
          <form action={deleteSurveyAction} style={{ marginTop: 24, maxWidth: 820 }}>
            <input type="hidden" name="id" value={survey.id} />
            <ConfirmDeleteButton
              label="Radera enkät och alla svar"
              message="Radera enkäten och alla dess svar? Det går inte att ångra."
            />
          </form>
        </>
      )}
    </PageShell>
  );
}
