import { notFound } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { NeedForm } from '@/components/talent/NeedForm';
import { Notice, Panel } from '@/components/talent/ui';
import { getNeedWithFallback } from '@/lib/talent/data';
import { loadPublicTagVocabularyForTenant } from '@/lib/talent/vocabulary.server';
import { requireMemberStartup } from '../../_shared';

export const dynamic = 'force-dynamic';

export default async function MemberEditNeedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, pb, startupId } = await requireMemberStartup();
  const need = await getNeedWithFallback(pb, user.tenant, id);
  if (!need || need.startup !== startupId) notFound();
  const vocabulary = await loadPublicTagVocabularyForTenant(user.tenant);
  return (
    <PageShell title={`Redigera: ${need.title}`}>
      <Panel title="Annonsen">
        {need.status === 'published' ? <Notice kind="notice">Behovet är publicerat. Sparar ni ändringar granskas texten av Movexum igen innan den syns för studenter.</Notice> : null}
        <div className="mt-3">
          <NeedForm vocabulary={vocabulary} initial={need} afterPath={`/min-oversikt/talang/${need.id}`} />
        </div>
      </Panel>
    </PageShell>
  );
}
