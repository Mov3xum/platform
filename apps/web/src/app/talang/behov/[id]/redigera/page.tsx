import { notFound, redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { NeedForm } from '@/components/talent/NeedForm';
import { Panel } from '@/components/talent/ui';
import { getNeedWithFallback } from '@/lib/talent/data';
import { loadCompetenceTagVocabulary } from '@/lib/team/competence-tags.server';
import { requireTalentStaff, talentTabs } from '../../../_shared';

export const dynamic = 'force-dynamic';

export default async function EditNeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, pb, canManage } = await requireTalentStaff();
  if (!canManage) redirect(`/talang/behov/${id}`);
  const need = await getNeedWithFallback(pb, user.tenant, id);
  if (!need) notFound();
  const vocabulary = await loadCompetenceTagVocabulary(pb, user.tenant);
  return (
    <PageShell title={`Redigera: ${need.title}`} tabs={talentTabs()}>
      <Panel title="Annonsen">
        <NeedForm vocabulary={vocabulary} initial={need} afterPath={`/talang/behov/${need.id}`} />
      </Panel>
    </PageShell>
  );
}
