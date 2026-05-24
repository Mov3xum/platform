import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { escFilter } from '@/lib/pb-filter';
import { ToolForm } from '../../ToolForm';
import { deleteToolFormAction } from '@/lib/actions/tools';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { KnowledgeManager, type KnowledgeItem } from './KnowledgeManager';
import type { Tool, ToolKnowledge } from '@platform/shared';

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

  // Agentens kunskapsbas (tool_knowledge). Fail-soft om collectionen saknas
  // på äldre deploys.
  let knowledgeItems: KnowledgeItem[] = [];
  try {
    const kb = await pb.collection('tool_knowledge').getFullList<ToolKnowledge>({
      filter: `tool = "${escFilter(id)}" && tenant = "${escFilter(user.tenant)}"`,
      sort: 'sort_order,created'
    });
    knowledgeItems = kb.map((k) => ({
      id: k.id,
      title: k.title,
      filename: k.filename,
      mime: k.mime,
      size_bytes: k.size_bytes,
      char_count: k.char_count,
      redacted: k.redacted
    }));
  } catch {
    /* fail-soft */
  }

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

      <KnowledgeManager toolId={id} items={knowledgeItems} />

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
