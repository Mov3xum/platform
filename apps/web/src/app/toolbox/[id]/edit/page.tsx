import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { ToolForm } from '../../ToolForm';
import type { Tool } from '@platform/shared';

export default async function EditToolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) redirect('/toolbox');

  const pb = await getServerPb();
  let tool: Tool;
  try {
    tool = await pb.collection('tools').getOne<Tool>(id);
  } catch {
    notFound();
  }

  if (tool.tenant !== user.tenant) notFound();

  const canEditPrompt = hasRole(user.roles, ['admin']);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <a href={`/toolbox/${id}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← {tool.name}
        </a>
      </div>
      <h1 className="mb-8 text-3xl font-semibold tracking-tight text-foreground">
        Redigera verktyg
      </h1>
      {!canEditPrompt && (
        <div className="mb-6 rounded-2xl border border-default bg-movexum-pastell-lila p-4 text-sm text-movexum-morklila dark:bg-movexum-morklila/20 dark:text-movexum-ljuslila">
          <strong>OBS:</strong> Systemprompt och modellval styrs av admin och är låsta för
          incubator-lead-/coach-roller. Du kan ändra namn, beskrivning, kategori, roller och
          aktiveringsstatus.
        </div>
      )}
      <ToolForm mode="edit" tool={tool} canEditPrompt={canEditPrompt} />
    </main>
  );
}
