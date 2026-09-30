import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listFeedbackItems } from '@/lib/feedback/data';
import { canCreateFeedback, canRespondToFeedback, countFeedbackByStatus } from '@platform/shared';
import { FeedbackBoard } from './FeedbackBoard';

export const dynamic = 'force-dynamic';

/**
 * Önskemål & buggar (CLAUDE.md § 49) — intern backlog. Läser med
 * användarens token (RLS § 21: staff/observer-only). Roll-flaggorna är
 * UI-kurering; gränsen ligger i server-actionerna.
 */
export default async function OnskemalPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'onskemal', user.enabledModules)) redirect('/hem');
  const pb = await getServerPb();
  const result = await listFeedbackItems(pb, user.tenant);
  const counts = countFeedbackByStatus(result.items);

  return (
    <PageShell
      title="Önskemål & buggar"
      meta={
        <span className="text-sm text-foreground-muted">
          {counts.open} öppna · {counts.answered} besvarade · {counts.done} klara
        </span>
      }
    >
      <FeedbackBoard
        items={result.items}
        meId={user.id}
        canCreate={canCreateFeedback(user.roles)}
        canRespond={canRespondToFeedback(user.roles)}
        readError={result.error ?? null}
        truncated={result.truncated}
      />
    </PageShell>
  );
}
