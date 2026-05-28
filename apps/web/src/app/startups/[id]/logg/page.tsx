import { notFound } from 'next/navigation';
import { getOneForTenant } from '@/lib/pb.server';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModule } from '@/lib/rbac';
import { markdownToHtml } from '@/lib/safe-html';
import { LogTab, type LogEntry, type LogFileRef } from '@/components/intric/LogTab';
import type { ToolRunMessage } from '@platform/shared';

interface StartupRow {
  id: string;
  tenant: string;
  name: string;
}

interface ActivityRow {
  id: string;
  startup?: string;
  kind?: string;
  title?: string;
  description?: string;
  type?: string;
  tool?: string;
  tool_run?: string;
  owner?: string;
  created: string;
  expand?: {
    owner?: { id: string; display_name?: string; email: string };
    tool?: { id: string; name?: string };
    tool_run?: { id: string; output_md?: string; messages?: ToolRunMessage[] };
  };
}

function displayName(u?: { display_name?: string; email: string }): string {
  return u?.display_name || u?.email || 'system';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

type ToolRunExpand = NonNullable<ActivityRow['expand']>['tool_run'];

// Senaste assistant-svaret som ren text (markdown) → fallback till output_md.
function resultText(tr?: ToolRunExpand): string | undefined {
  if (!tr) return undefined;
  const lastAssistant = [...(tr.messages || [])]
    .reverse()
    .find((m) => m.role === 'assistant' && m.content?.trim());
  if (lastAssistant?.content) return lastAssistant.content;
  if (tr.output_md) return stripHtml(tr.output_md);
  return undefined;
}

function collectFiles(tr?: ToolRunExpand): LogFileRef[] {
  if (!tr?.messages) return [];
  const files: LogFileRef[] = [];
  for (const m of tr.messages) {
    for (const a of m.attachments || []) {
      files.push({ filename: a.filename, mime: a.mime, sizeBytes: a.size_bytes });
    }
    for (const g of m.generated_files || []) {
      files.push({ filename: g.filename, mime: g.mime, sizeBytes: g.size_bytes, generated: true });
    }
  }
  return files;
}

export default async function StartupLogPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!canAccessModule(user.roles, 'startups')) notFound();

  let startup: StartupRow;
  try {
    startup = await getOneForTenant<StartupRow>('startups', id);
  } catch {
    notFound();
  }

  const pb = await getServerPb();

  let activities: ActivityRow[] = [];
  try {
    const res = await pb.collection('activities').getList<ActivityRow>(1, 100, {
      filter: `startup = "${id}"`,
      sort: '-created',
      expand: 'owner,tool,tool_run'
    });
    activities = res.items;
  } catch {
    activities = [];
  }

  const entries: LogEntry[] = activities.map((a) => {
    const tr = a.expand?.tool_run;
    const noteText = a.description ? stripHtml(a.description) : '';
    const result = resultText(tr);
    return {
      id: a.id,
      kind: a.kind || a.type || 'manual',
      actor: displayName(a.expand?.owner),
      title: a.title || 'Aktivitet',
      meta: noteText || undefined,
      toolRunId: a.tool_run,
      startupId: a.startup,
      created: a.created,
      toolName: a.expand?.tool?.name,
      bodyHtml: noteText ? markdownToHtml(noteText) : undefined,
      resultHtml: result ? markdownToHtml(result) : undefined,
      files: collectFiles(tr)
    };
  });

  return <LogTab entries={entries} startupName={startup.name} />;
}
