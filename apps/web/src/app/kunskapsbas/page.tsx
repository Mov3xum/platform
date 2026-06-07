import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { listOrgKnowledgeAction } from '@/lib/actions/org-knowledge';
import KnowledgeManager from './KnowledgeManager';

export const dynamic = 'force-dynamic';

export default async function KunskapsbasPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'kunskapsbas', user.disabledModules)) {
    redirect('/chatt');
  }
  const files = await listOrgKnowledgeAction();

  return (
    <PageShell title="Kunskapsbas">
      <div className="space-y-6">
        <p className="max-w-2xl text-sm text-foreground-muted">
          Ladda upp material om Movexum, era projekt och verksamheten — processer, mallar,
          policys, rapporter och exporterade presentationer. AI-chatten kan sedan svara på
          frågor om innehållet och koppla det mot databasen i samma svar.
        </p>
        <KnowledgeManager initialFiles={files} />
      </div>
    </PageShell>
  );
}
