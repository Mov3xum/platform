import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listFeedbackItems } from '@/lib/feedback/data';
import { feedbackAreasForUser } from '@/lib/feedback/areas';
import { listStaffUsers } from '@/lib/contacts/data';
import { canCreateFeedback, canRespondToFeedback, countFeedbackByStatus } from '@platform/shared';
import { FeedbackBoard } from './FeedbackBoard';

export const dynamic = 'force-dynamic';

/**
 * Önskemål & buggar (CLAUDE.md § 49) — intern backlog. Läser med
 * användarens token (RLS § 21: staff/observer-only). Roll-flaggorna är
 * UI-kurering; gränsen ligger i server-actionerna. Dropdownen över sidor
 * visar bara sidor som är aktiverade på den inloggades profil (§ 36.3).
 * Testar-väljaren (bara ledningen) får Movexum-personalen i tenanten som
 * id + visningsnamn — aldrig e-post.
 */
export default async function OnskemalPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'onskemal', user.enabledModules)) redirect('/hem');
  const pb = await getServerPb();
  const canRespond = canRespondToFeedback(user.roles);
  const [result, staff] = await Promise.all([
    listFeedbackItems(pb, user.tenant),
    canRespond ? listStaffUsers(pb, user.tenant).catch(() => []) : Promise.resolve([])
  ]);
  const counts = countFeedbackByStatus(result.items);
  const openCount = counts.open + counts.in_progress + counts.awaiting_feedback;

  return (
    <PageShell
      title="Önskemål & buggar"
      meta={
        <span className="text-sm text-foreground-muted">
          {openCount} pågående · {counts.done} klara
        </span>
      }
    >
      <FeedbackBoard
        items={result.items}
        meId={user.id}
        canCreate={canCreateFeedback(user.roles)}
        canRespond={canRespond}
        areaOptions={feedbackAreasForUser(user)}
        testerOptions={staff.map((u) => ({ id: u.id, name: u.name }))}
        readError={result.error ?? null}
        truncated={result.truncated}
      />
    </PageShell>
  );
}
