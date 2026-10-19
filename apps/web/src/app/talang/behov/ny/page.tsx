import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { NeedForm } from '@/components/talent/NeedForm';
import { loadCompetenceTagVocabulary } from '@/lib/team/competence-tags.server';
import { Panel } from '@/components/talent/ui';
import { requireTalentStaff, talentTabs } from '../../_shared';

export const dynamic = 'force-dynamic';

/** Movexum lägger upp ett behov åt ett bolag (t.ex. efter ett coachmöte). */
export default async function NewNeedPage({ searchParams }: { searchParams: Promise<{ startup?: string }> }) {
  const { user, pb, canManage } = await requireTalentStaff();
  if (!canManage) redirect('/talang');
  const { startup } = await searchParams;
  const [startups, vocabulary] = await Promise.all([
    pb
      .collection('startups')
      .getList<{ id: string; name: string }>(1, 200, { filter: pb.filter('tenant = {:t} && status = "active"', { t: user.tenant }), sort: 'name', fields: 'id,name' })
      .then((r) => r.items, () => [] as Array<{ id: string; name: string }>),
    loadCompetenceTagVocabulary(pb, user.tenant)
  ]);
  const ordered = startup ? [...startups].sort((a, b) => (a.id === startup ? -1 : b.id === startup ? 1 : 0)) : startups;
  return (
    <PageShell title="Nytt behov" tabs={talentTabs()}>
      <Panel title="Behov mot studenter">
        <NeedForm vocabulary={vocabulary} startups={ordered} initial={startup ? { startup } : undefined} />
      </Panel>
    </PageShell>
  );
}
