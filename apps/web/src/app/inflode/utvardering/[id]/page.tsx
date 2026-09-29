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
import { buildInflodeTabs } from '../../_tabs';

export const dynamic = 'force-dynamic';

export default async function SurveyDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vy?: string }>;
}) {
  const { id } = await params;
  const { vy } = await searchParams;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) redirect('/inflode');
  const pb = await getServerPb();
  const survey = await getSurvey(pb, user.tenant, id);
  if (!survey) notFound();

  const showResults = vy === 'resultat';
  const results = showResults ? await getSurveyResults(pb, survey) : null;

  return (
    <PageShell
      title="Marknadsverktyg"
      tabs={buildInflodeTabs()}
      meta={<span className="text-[12px] text-foreground-subtle">Utvärdering / {survey.name}</span>}
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
      {results ? (
        <SurveyResults summary={results.summary} total={results.total} incomplete={results.incomplete} />
      ) : (
        <>
          <SurveyBuilder survey={survey} />
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
