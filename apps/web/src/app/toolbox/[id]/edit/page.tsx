import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { ToolForm } from '../../ToolForm';
import { deleteToolFormAction } from '@/lib/actions/tools';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
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

  const canEditPrompt = hasRole(user.roles, ['admin', 'incubator_lead']);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <a href={`/toolbox/${id}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← {tool.name}
        </a>
      </div>
      <h1 className="mb-8 text-3xl font-semibold tracking-tight text-foreground">
        Redigera AI-agent
      </h1>
      <ToolForm mode="edit" tool={tool} canEditPrompt={canEditPrompt} />

      <div className="mt-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        <h2 className="text-base font-semibold text-foreground">Farozon</h2>
        <p className="mt-1 text-sm text-foreground-muted">
          Raderar agenten permanent inkl. alla körningar. Detta kan inte ångras.
        </p>
        <div className="mt-4">
          <ConfirmDeleteButton
            action={deleteToolFormAction}
            hiddenField={{ name: 'tool_id', value: id }}
            label="Radera agent"
            description={`Du raderar "${tool.name}" och alla körningar.`}
          />
        </div>
      </div>
    </main>
  );
}
