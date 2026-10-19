import { PageShell } from '@/components/PageShell';
import { NeedForm } from '@/components/talent/NeedForm';
import { Panel } from '@/components/talent/ui';
import { loadPublicTagVocabularyForTenant } from '@/lib/talent/vocabulary.server';
import { requireMemberStartup } from '../_shared';

export const dynamic = 'force-dynamic';

export default async function MemberNewNeedPage() {
  const { user, startupName } = await requireMemberStartup();
  const vocabulary = await loadPublicTagVocabularyForTenant(user.tenant);
  return (
    <PageShell title="Nytt behov" meta={<span className="text-sm text-foreground-subtle">{startupName}</span>}>
      <Panel title="Vad söker ni?">
        <NeedForm vocabulary={vocabulary} afterPath="/min-oversikt/talang" />
      </Panel>
    </PageShell>
  );
}
