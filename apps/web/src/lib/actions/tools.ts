'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole, canRunTool, requireRole } from '@/lib/rbac';
import {
  callMistral,
  estimateCostUsd,
  type MistralMessage,
  type MistralContentPart
} from '@/lib/ai/mistral';
import {
  runAgentLoop,
  runAgentLoopVerified,
  buildReadToolSurface,
  type AgentLoopUsage
} from '@/lib/ai/agent-runtime';
import {
  buildStartupContext,
  buildPortfolioContext,
  renderPromptTemplate
} from '@/lib/ai/context';
import {
  buildAgentSystemPrompt,
  buildKnowledgeContext,
  type KnowledgeContext
} from '@/lib/ai/agent-prompt';
import { fetchWebContext, type WebFetchResult } from '@/lib/ai/web';
import {
  DEFAULT_MODEL,
  isAllowedModel,
  modelSupportsVision
} from '@/lib/ai/models';
import {
  prepareAttachmentsForModel,
  AttachmentError
} from '@/lib/ai/attachments';
import type {
  Tool,
  ToolRunThreadEntry,
  KnowledgeSourceRef,
  ToolModel,
  ToolRunMessage,
  WebSourceKey
} from '@platform/shared';
import { recordActivity } from './record-activity';
import { logAiUsage } from '@/lib/ai/usage';
import { escFilter } from '@/lib/pb-filter';

const MAX_CHAT_TURNS = 20; // max user-turns per tool_run

/**
 * Snapshot:ar en agents nuvarande konfiguration som en ny, oföränderlig
 * version i `tool_versions` (Fas 4 / EU AI Act art. 11 — versionerad
 * teknisk dokumentation per AI-verktyg, CLAUDE.md § 10.1). Best-effort:
 * ett versioneringsfel får aldrig blockera spara-flödet.
 */
async function snapshotToolVersion(
  pb: import('pocketbase').default,
  toolId: string,
  tenant: string,
  userId: string
): Promise<void> {
  try {
    let nextVersion = 1;
    const latest = await pb.collection('tool_versions').getList(1, 1, {
      filter: `tool = "${escFilter(toolId)}"`,
      sort: '-version',
      fields: 'version'
    });
    if (latest.items.length > 0) {
      nextVersion = ((latest.items[0].version as number) || 0) + 1;
    }
    const tool = await pb.collection('tools').getOne(toolId);
    await pb.collection('tool_versions').create({
      tenant,
      tool: toolId,
      version: nextVersion,
      snapshot: {
        name: tool.name,
        category: tool.category,
        model: tool.model ?? null,
        prompt_template: tool.prompt_template ?? '',
        verify_rubric: tool.verify_rubric ?? '',
        web_sources: tool.web_sources ?? [],
        requires_startup: !!tool.requires_startup,
        roles_allowed: tool.roles_allowed ?? [],
        output_format: tool.output_format ?? 'markdown'
      },
      created_by: userId
    });
  } catch (err) {
    console.error('[snapshotToolVersion] failed (swallowed)', { toolId, err });
  }
}

function resolveModel(
  override: string | undefined | null,
  toolDefault: string | undefined | null
): ToolModel {
  if (isAllowedModel(override)) return override;
  if (isAllowedModel(toolDefault)) return toolDefault;
  return DEFAULT_MODEL;
}

function extractFiles(formData: FormData): File[] {
  const out: File[] = [];
  for (const entry of formData.getAll('files')) {
    if (entry instanceof File && entry.size > 0) out.push(entry);
  }
  return out;
}

export type ToolActionState = {
  error?: string;
  runId?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Assignment-flöde — Intric-stil
// status: assigned → in_progress → ready_for_review → approved | rejected
// Varje state-skifte loggas via recordActivity().
// ─────────────────────────────────────────────────────────────────────────────

const STAFF_ROLES = ['admin', 'incubator_lead', 'coach', 'mentor'] as const;

function nowIso() {
  return new Date().toISOString();
}

/**
 * Bygger context för en AI-körning. Inkluderar startup-/portfölj-data och,
 * om verktyget definierar `web_sources`, hämtar live-data från whitelistade
 * EU-källor parallellt.
 *
 * Returnerar både det renderbara context-objektet (för prompten) och
 * själva web-resultaten (för loggning i `tool_runs.input` per AI Act art. 13).
 */
async function buildToolContext(
  pb: import('pocketbase').default,
  tool: Tool & Record<string, unknown>,
  tenantId: string,
  startupId: string | undefined
): Promise<{
  contextObj: Record<string, unknown>;
  webResults: WebFetchResult[];
  knowledge: KnowledgeContext;
}> {
  const webSources = Array.isArray(tool.web_sources)
    ? (tool.web_sources as WebSourceKey[])
    : [];

  const [baseContext, webMap, knowledge] = await Promise.all([
    tool.category === 'ai_per_startup' && startupId
      ? buildStartupContext(pb, startupId, tenantId).then(
          (ctx) => ctx as unknown as Record<string, unknown>
        )
      : buildPortfolioContext(pb, tenantId).then(
          (ctx) => ctx as unknown as Record<string, unknown>
        ),
    webSources.length > 0
      ? fetchWebContext(pb, webSources)
      : Promise.resolve({} as Record<string, WebFetchResult>),
    buildKnowledgeContext(pb, tool.id, tenantId)
  ]);

  // Flatten web-map till en prompt-vänlig form: {{web.<key>}} -> body
  const webForPrompt: Record<string, string> = {};
  const webResults: WebFetchResult[] = [];
  for (const key of Object.keys(webMap)) {
    const r = webMap[key];
    webForPrompt[key] = r.body || (r.ok ? '' : `(källan ${r.label} kunde inte hämtas)`);
    webResults.push(r);
  }

  return {
    contextObj: { ...baseContext, web: webForPrompt },
    webResults,
    knowledge
  };
}

async function getRunForMutation(
  pb: import('pocketbase').default,
  runId: string,
  tenantId: string
) {
  const run = (await pb.collection('tool_runs').getOne(runId, {
    expand: 'tool,startup'
  })) as Record<string, unknown> & { tenant?: string };
  if (run.tenant !== tenantId) throw new Error('Åtkomst nekad.');
  return run;
}

export async function assignToolAction(input: {
  toolId: string;
  startupId: string;
  assigneeId: string;
  deadline?: string; // ISO date YYYY-MM-DD
  instruction?: string;
  knowledgeSources?: KnowledgeSourceRef[];
}): Promise<ToolActionState> {
  const user = await requireUser();
  requireRole(user.roles, [...STAFF_ROLES]);
  const pb = await getServerPb();

  let tool: Tool & Record<string, unknown>;
  try {
    tool = await pb.collection('tools').getOne<Tool & Record<string, unknown>>(input.toolId);
  } catch {
    return { error: 'Agenten hittades inte.' };
  }
  if (tool.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    const record = await pb.collection('tool_runs').create({
      tenant: user.tenant,
      tool: input.toolId,
      startup: input.startupId,
      triggered_by: user.id,
      assigned_by: user.id,
      assigned_to: input.assigneeId,
      status: 'assigned',
      deadline: input.deadline || null,
      instruction: input.instruction || '',
      knowledge_sources: input.knowledgeSources || [],
      thread: [] as ToolRunThreadEntry[],
      version: 1,
      input: { mode: 'assignment' }
    });

    const runId = record.id as string;

    await recordActivity(pb, {
      tenant: user.tenant,
      startup: input.startupId,
      kind: 'assignment',
      actor: user.id,
      title: `Tilldelade ${tool.name}`,
      meta: input.deadline ? `deadline ${input.deadline}` : undefined,
      tool: input.toolId,
      tool_run: runId
    });

    revalidatePath(`/startups/${input.startupId}`);
    revalidatePath(`/startups/${input.startupId}/verktyg`);
    revalidatePath(`/startups/${input.startupId}/logg`);
    revalidatePath('/inkorg');
    return { runId };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Kunde inte tilldela verktyget.'
    };
  }
}

export async function startRunAction(runId: string): Promise<ToolActionState> {
  const user = await requireUser();
  const pb = await getServerPb();

  const run = await getRunForMutation(pb, runId, user.tenant);
  const toolId = run.tool as string;
  const startupId = run.startup as string | undefined;

  // Markera som running
  await pb.collection('tool_runs').update(runId, {
    status: 'running',
    started_at: nowIso()
  });

  // Kör befintliga runToolAction-logiken inline — vi använder den
  // existerande generatorn men skriver till samma run istället för att
  // skapa en ny.
  try {
    let tool: Tool & Record<string, unknown>;
    try {
      tool = await pb.collection('tools').getOne<Tool & Record<string, unknown>>(toolId);
    } catch {
      throw new Error('Verktyget hittades inte.');
    }

    let outputMd = '';
    let tokensIn = 0;
    let tokensOut = 0;
    const isAi = tool.category === 'ai_per_startup' || tool.category === 'ai_system_wide';

    let webResults: WebFetchResult[] = [];
    if (isAi && tool.prompt_template && tool.model) {
      const built = await buildToolContext(pb, tool, user.tenant, startupId);
      webResults = built.webResults;

      const userContent = renderPromptTemplate(
        tool.prompt_template as string,
        built.contextObj
      );
      const systemContent =
        buildAgentSystemPrompt(tool.system_prompt as string | undefined) +
        built.knowledge.block;
      const result = await callMistral(tool.model as string, [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent }
      ];
      const baseLoopOptions = {
        models: [tool.model as string],
        tools: surface?.tools,
        toolContext:
          surface?.toolContext ?? {
            pb,
            tenantId: user.tenant,
            collections: []
          },
        onUsage: (u: AgentLoopUsage) => {
          tokensIn += u.tokensIn;
          tokensOut += u.tokensOut;
        }
      };
      const verifyRubric =
        typeof tool.verify_rubric === 'string' ? tool.verify_rubric.trim() : '';
      const loop = verifyRubric
        ? await runAgentLoopVerified(conversation, {
            ...baseLoopOptions,
            rubric: verifyRubric
          })
        : await runAgentLoop(conversation, baseLoopOptions);
      outputMd = loop.text;

      if (webResults.length > 0 || built.knowledge.sources.length > 0) {
        const existingInput =
          (run.input as Record<string, unknown> | undefined) || {};
        await pb.collection('tool_runs').update(runId, {
          input: {
            ...existingInput,
            web_sources: webResults.map((r) => ({
              source: r.source,
              label: r.label,
              fetched_at: r.fetched_at,
              cached: r.cached,
              ok: r.ok,
              error: r.error
            })),
            knowledge_used: built.knowledge.sources
          }
        });
      }
    } else if (!isAi && tool.prompt_template) {
      outputMd = (tool.prompt_template as string)
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();
    }

    const completedAt = nowIso();
    const costUsd = isAi ? estimateCostUsd(tool.model as string, tokensIn, tokensOut) : 0;

    await pb.collection('tool_runs').update(runId, {
      status: 'in_progress',
      output_md: outputMd,
      model: tool.model || null,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_estimate_usd: costUsd,
      completed_at: completedAt
    });

    await recordActivity(pb, {
      tenant: user.tenant,
      startup: startupId,
      kind: 'tool_run',
      actor: user.id,
      title: `Körde ${tool.name}`,
      meta: isAi
        ? `${tool.model} · ${tokensIn + tokensOut} tokens · ~$${costUsd.toFixed(2)}`
        : undefined,
      tool: toolId,
      tool_run: runId
    });

    if (startupId) {
      revalidatePath(`/startups/${startupId}/verktyg`);
      revalidatePath(`/startups/${startupId}/verktyg/${runId}`);
      revalidatePath(`/startups/${startupId}/logg`);
    }
    revalidatePath('/inkorg');
    return { runId };
  } catch (err) {
    await pb.collection('tool_runs').update(runId, {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Okänt fel',
      completed_at: nowIso()
    });
    return { error: err instanceof Error ? err.message : 'Körningen misslyckades.' };
  }
}

export async function submitForReviewAction(runId: string): Promise<ToolActionState> {
  const user = await requireUser();
  const pb = await getServerPb();
  const run = await getRunForMutation(pb, runId, user.tenant);

  await pb.collection('tool_runs').update(runId, { status: 'ready_for_review' });

  const toolName = (run.expand as { tool?: { name: string } } | undefined)?.tool?.name || 'Verktyget';
  await recordActivity(pb, {
    tenant: user.tenant,
    startup: run.startup as string | undefined,
    kind: 'assignment',
    actor: user.id,
    title: `Skickade ${toolName} för granskning`,
    tool_run: runId,
    tool: run.tool as string
  });

  if (run.startup) {
    revalidatePath(`/startups/${run.startup}/verktyg`);
    revalidatePath(`/startups/${run.startup}/verktyg/${runId}`);
    revalidatePath(`/startups/${run.startup}/logg`);
  }
  revalidatePath('/inkorg');
  return { runId };
}

export async function approveRunAction(runId: string): Promise<ToolActionState> {
  const user = await requireUser();
  requireRole(user.roles, [...STAFF_ROLES]);
  const pb = await getServerPb();
  const run = await getRunForMutation(pb, runId, user.tenant);

  await pb.collection('tool_runs').update(runId, { status: 'approved' });

  const toolName = (run.expand as { tool?: { name: string } } | undefined)?.tool?.name || 'Verktyget';
  await recordActivity(pb, {
    tenant: user.tenant,
    startup: run.startup as string | undefined,
    kind: 'approval',
    actor: user.id,
    title: `Godkände ${toolName}`,
    meta: 'Sparat i bolagets kunskap',
    tool_run: runId,
    tool: run.tool as string
  });

  if (run.startup) {
    revalidatePath(`/startups/${run.startup}/verktyg`);
    revalidatePath(`/startups/${run.startup}/verktyg/${runId}`);
    revalidatePath(`/startups/${run.startup}/logg`);
  }
  return { runId };
}

export async function requestChangesAction(
  runId: string,
  comment: string
): Promise<ToolActionState> {
  const user = await requireUser();
  requireRole(user.roles, [...STAFF_ROLES]);
  const pb = await getServerPb();
  const run = await getRunForMutation(pb, runId, user.tenant);

  // Skapa en ny version (parent_run = current) i status assigned, ärver
  // assigneeId, deadline, instruction och knowledge_sources.
  const parentVersion = (run.version as number | undefined) || 1;
  const childRecord = await pb.collection('tool_runs').create({
    tenant: user.tenant,
    tool: run.tool,
    startup: run.startup,
    triggered_by: user.id,
    assigned_by: user.id,
    assigned_to: run.assigned_to,
    status: 'assigned',
    deadline: run.deadline || null,
    instruction: comment.trim() || (run.instruction as string | undefined) || '',
    knowledge_sources: run.knowledge_sources || [],
    thread: [
      ...(Array.isArray(run.thread) ? (run.thread as ToolRunThreadEntry[]) : []),
      {
        user: user.id,
        role: 'coach' as const,
        at: nowIso(),
        text: comment.trim() || 'Begär ändring.'
      }
    ],
    parent_run: runId,
    version: parentVersion + 1,
    input: { mode: 'assignment' }
  });

  // Markera tidigare runs som rejected — men behåll deras output_md historiskt.
  await pb.collection('tool_runs').update(runId, { status: 'rejected' });

  const toolName = (run.expand as { tool?: { name: string } } | undefined)?.tool?.name || 'Verktyget';
  await recordActivity(pb, {
    tenant: user.tenant,
    startup: run.startup as string | undefined,
    kind: 'note',
    actor: user.id,
    title: `Begärde ändringar på ${toolName}`,
    meta: `Ny version v${parentVersion + 1} skapad`,
    tool_run: childRecord.id as string,
    tool: run.tool as string
  });

  if (run.startup) {
    revalidatePath(`/startups/${run.startup}/verktyg`);
    revalidatePath(`/startups/${run.startup}/verktyg/${childRecord.id as string}`);
    revalidatePath(`/startups/${run.startup}/logg`);
  }
  revalidatePath('/inkorg');
  return { runId: childRecord.id as string };
}

export async function addThreadCommentAction(
  runId: string,
  text: string
): Promise<ToolActionState> {
  const user = await requireUser();
  const pb = await getServerPb();
  const run = await getRunForMutation(pb, runId, user.tenant);

  const trimmed = text.trim();
  if (!trimmed) return { error: 'Tom kommentar.' };

  const role: 'coach' | 'founder' = user.roles.some((r) =>
    (STAFF_ROLES as readonly string[]).includes(r)
  )
    ? 'coach'
    : 'founder';

  const thread = Array.isArray(run.thread) ? (run.thread as ToolRunThreadEntry[]) : [];
  thread.push({ user: user.id, role, at: nowIso(), text: trimmed });

  await pb.collection('tool_runs').update(runId, { thread });

  if (run.startup) {
    revalidatePath(`/startups/${run.startup}/verktyg/${runId}`);
  }
  return { runId };
}

/**
 * Runs a tool (förstaturn). FormData-baserad för att kunna ta emot
 * modellval (`modelOverride`) och bilagor (`files`). RBAC, context-
 * byggande, Mistral-anrop och persistens hanteras här.
 *
 * Lagrar hela samtalet i `tool_runs.messages` (system + user + assistant)
 * — `output_md`/`model`/tokens speglar senaste assistant-turn för
 * bakåtkompatibilitet med statistik-vyer.
 */
export async function runToolAction(formData: FormData): Promise<ToolActionState> {
  const user = await requireUser();
  const pb = await getServerPb();

  const toolId = String(formData.get('toolId') || '').trim();
  if (!toolId) return { error: 'Saknar toolId.' };
  const startupIdRaw = String(formData.get('startupId') || '').trim();
  const startupId = startupIdRaw || undefined;
  const modelOverride = String(formData.get('modelOverride') || '').trim() || undefined;
  const files = extractFiles(formData);

  // Load tool and verify tenant
  let tool: Tool & Record<string, unknown>;
  try {
    tool = await pb.collection('tools').getOne<Tool & Record<string, unknown>>(toolId);
  } catch {
    return { error: 'Agenten hittades inte.' };
  }

  if (tool.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  // RBAC check
  const isLinkedStartup = startupId ? user.linkedStartups.includes(startupId) : false;
  if (!canRunTool(user.roles, tool, { isLinkedStartup })) {
    return { error: 'Du har inte behörighet att köra denna agent.' };
  }

  if (tool.requires_startup && !startupId) {
    return { error: 'Denna agent kräver ett valt bolag.' };
  }

  const isAiTool =
    tool.category === 'ai_per_startup' || tool.category === 'ai_system_wide';

  // Modellen som faktiskt används denna körning (override > tool default > systemets default)
  const selectedModel = resolveModel(modelOverride, tool.model as string | undefined);
  const supportsVision = modelSupportsVision(selectedModel);

  // Create tool_run record with status=running
  const now = new Date().toISOString();
  let runRecord: Record<string, unknown>;
  try {
    runRecord = await pb.collection('tool_runs').create({
      tenant: user.tenant,
      tool: toolId,
      startup: startupId || null,
      triggered_by: user.id,
      status: 'running',
      input: { startupId },
      started_at: now
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte skapa körning.' };
  }

  const runId = runRecord.id as string;

  try {
    let outputMd = '';
    let tokensIn = 0;
    let tokensOut = 0;
    let webResults: WebFetchResult[] = [];
    const messages: ToolRunMessage[] = [];

    if (isAiTool && tool.prompt_template) {
      // Bilagor: validera, extrahera text, base64-encode bilder
      let prepared: Awaited<ReturnType<typeof prepareAttachmentsForModel>> = {
        uploadedRefs: [],
        pbFiles: [],
        imageBlocks: [],
        injectedText: ''
      };
      if (files.length > 0) {
        try {
          prepared = await prepareAttachmentsForModel(files, {
            allowVision: supportsVision
          });
        } catch (err) {
          if (err instanceof AttachmentError) {
            await pb.collection('tool_runs').update(runId, {
              status: 'failed',
              error: err.message,
              completed_at: new Date().toISOString()
            });
            return { error: err.message };
          }
          throw err;
        }
      }

      // Bygg context (startup/portfölj + ev. web-källor parallellt)
      const built = await buildToolContext(pb, tool, user.tenant, startupId);
      webResults = built.webResults;

      const renderedPrompt = renderPromptTemplate(
        tool.prompt_template as string,
        built.contextObj
      );
      const fullUserText = renderedPrompt + prepared.injectedText;

      const userContent: string | MistralContentPart[] =
        prepared.imageBlocks.length > 0
          ? [{ type: 'text', text: fullUserText }, ...prepared.imageBlocks]
          : fullUserText;

      const systemContent =
        buildAgentSystemPrompt(tool.system_prompt as string | undefined) +
        built.knowledge.block;

      const mistralMessages: MistralMessage[] = [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent }
      ];

      const baseLoopOptions = {
        models: [selectedModel],
        tools: surface?.tools,
        toolContext:
          surface?.toolContext ?? {
            pb,
            tenantId: user.tenant,
            collections: []
          },
        onUsage: (u: AgentLoopUsage) => {
          tokensIn += u.tokensIn;
          tokensOut += u.tokensOut;
        }
      };
      const verifyRubric =
        typeof tool.verify_rubric === 'string' ? tool.verify_rubric.trim() : '';
      const loop = verifyRubric
        ? await runAgentLoopVerified(conversation, {
            ...baseLoopOptions,
            rubric: verifyRubric
          })
        : await runAgentLoop(conversation, baseLoopOptions);

      outputMd = loop.text;
      const costUsd = estimateCostUsd(selectedModel, tokensIn, tokensOut);
      const turnIso = new Date().toISOString();

      messages.push(
        { role: 'system', content: systemContent, at: now },
        {
          role: 'user',
          content: renderedPrompt,
          attachments: prepared.uploadedRefs.length > 0 ? prepared.uploadedRefs : undefined,
          at: now
        },
        {
          role: 'assistant',
          content: outputMd,
          model: selectedModel,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd,
          at: turnIso
        }
      );

      // Logga web-källor + kunskapsbas-källor (AI Act art. 13)
      if (webResults.length > 0 || built.knowledge.sources.length > 0) {
        await pb.collection('tool_runs').update(runId, {
          input: {
            startupId,
            web_sources: webResults.map((r) => ({
              source: r.source,
              label: r.label,
              fetched_at: r.fetched_at,
              cached: r.cached,
              ok: r.ok,
              error: r.error
            })),
            knowledge_used: built.knowledge.sources
          }
        });
      }

      // Ladda upp bilagor till PB (FormData för file-fältet)
      if (prepared.pbFiles.length > 0) {
        const fd = new FormData();
        for (const f of prepared.pbFiles) {
          fd.append('attachments', f, f.name);
        }
        try {
          await pb.collection('tool_runs').update(runId, fd);
        } catch (err) {
          console.error('[runToolAction] attachment upload failed', { runId, err });
        }
      }
    } else if (!isAiTool && tool.prompt_template) {
      // Non-AI tool: use prompt_template as static output
      outputMd = (tool.prompt_template as string)
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();
    }

    const completedAt = new Date().toISOString();
    const costUsd = isAiTool ? estimateCostUsd(selectedModel, tokensIn, tokensOut) : 0;

    // Update tool_run with results
    await pb.collection('tool_runs').update(runId, {
      status: 'succeeded',
      output_md: outputMd,
      model: isAiTool ? selectedModel : null,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_estimate_usd: costUsd,
      completed_at: completedAt,
      messages: messages.length > 0 ? messages : null
    });

    // Spegla till ai_usage_events för unified /insights-aggregat
    if (isAiTool && (tokensIn > 0 || tokensOut > 0)) {
      await logAiUsage(pb, {
        tenant: user.tenant,
        userId: user.id,
        surface: 'toolbox',
        model: selectedModel,
        tokensIn,
        tokensOut,
        toolRunId: runId
      });
    }

    // Create activity if startup is linked
    let activityId: string | undefined;
    if (startupId) {
      const activityRecord = await pb.collection('activities').create({
        startup: startupId,
        type: 'task',
        title: `${tool.name} – agentkörning`,
        status: 'done',
        kind: 'tool_run',
        tool: toolId,
        tool_run: runId,
        owner: user.id,
        completed_at: completedAt,
        due_date: completedAt.slice(0, 10)
      });
      activityId = activityRecord.id as string;

      // Link activity back to tool_run
      await pb.collection('tool_runs').update(runId, { activity: activityId });
    }

    revalidatePath('/toolbox');
    revalidatePath('/aktivitet');
    if (startupId) revalidatePath(`/startups/${startupId}`);

    return { runId };
  } catch (err) {
    // Mark run as failed
    await pb.collection('tool_runs').update(runId, {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Okänt fel',
      completed_at: new Date().toISOString()
    });
    return { error: err instanceof Error ? err.message : 'Körningen misslyckades.' };
  }
}

/**
 * Fortsätter chatten på ett befintligt tool_run. Lägger till nytt
 * user-meddelande (med ev. bilagor) + assistant-svar i `messages`-arrayen
 * och uppdaterar aggregerade tokens/kostnad. Modellen kan bytas per turn.
 *
 * RBAC: triggered_by-användaren eller staff får fortsätta. canRunTool
 * kontrolleras mot parent tool för att hindra att åtkomst kringgås
 * efter en rollnedgradering.
 */
export async function continueToolChatAction(
  formData: FormData
): Promise<ToolActionState> {
  const user = await requireUser();
  const pb = await getServerPb();

  const runId = String(formData.get('runId') || '').trim();
  const userText = String(formData.get('userMessage') || '').trim();
  const modelOverride = String(formData.get('modelOverride') || '').trim() || undefined;
  const files = extractFiles(formData);

  if (!runId) return { error: 'Saknar runId.' };
  if (!userText && files.length === 0) {
    return { error: 'Skriv ett meddelande eller bifoga en fil.' };
  }

  let run: Record<string, unknown> & {
    tenant?: string;
    tool?: string;
    triggered_by?: string;
    startup?: string;
    messages?: ToolRunMessage[];
    output_md?: string;
    model?: string;
    tokens_in?: number;
    tokens_out?: number;
    cost_estimate_usd?: number;
    input?: Record<string, unknown>;
  };
  try {
    run = (await pb.collection('tool_runs').getOne(runId)) as typeof run;
  } catch {
    return { error: 'Körningen hittades inte.' };
  }

  if (run.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  // Bara den som startade chatten — eller staff — får fortsätta
  const isStaff = hasRole(user.roles, [...STAFF_ROLES]);
  if (run.triggered_by !== user.id && !isStaff) {
    return { error: 'Endast den som startade chatten kan fortsätta den.' };
  }

  // RBAC mot parent tool (skydd mot rollnedgradering mid-chat)
  let tool: Tool & Record<string, unknown>;
  try {
    tool = await pb
      .collection('tools')
      .getOne<Tool & Record<string, unknown>>(run.tool as string);
  } catch {
    return { error: 'Parent-agenten hittades inte.' };
  }
  const isLinkedStartup = run.startup
    ? user.linkedStartups.includes(run.startup as string)
    : false;
  if (!canRunTool(user.roles, tool, { isLinkedStartup })) {
    return { error: 'Du har inte längre behörighet att köra denna agent.' };
  }

  const existingMessages: ToolRunMessage[] = Array.isArray(run.messages)
    ? (run.messages as ToolRunMessage[])
    : [];

  // Räkna user-turns (inte system) mot taket
  const userTurns = existingMessages.filter((m) => m.role === 'user').length;
  if (userTurns >= MAX_CHAT_TURNS) {
    return {
      error: `Chatten har nått maxgränsen på ${MAX_CHAT_TURNS} meddelanden. Starta en ny körning.`
    };
  }

  const selectedModel = resolveModel(modelOverride, run.model);
  const supportsVision = modelSupportsVision(selectedModel);

  // Bearbeta bilagor
  let prepared: Awaited<ReturnType<typeof prepareAttachmentsForModel>> = {
    uploadedRefs: [],
    pbFiles: [],
    imageBlocks: [],
    injectedText: ''
  };
  if (files.length > 0) {
    try {
      prepared = await prepareAttachmentsForModel(files, {
        allowVision: supportsVision
      });
    } catch (err) {
      if (err instanceof AttachmentError) return { error: err.message };
      throw err;
    }
  }

  // Bygg Mistral-meddelandelistan
  // - Drop ev. lagrad system-roll och börja om med vår kanoniska prompt
  //   (skydd mot att den hamnar i historiken med modifierad text).
  // - Legacy-stöd: om `messages` saknas men `output_md` finns, syntetisera
  //   en första turn så användaren kan fortsätta på gamla körningar.
  // Kunskapsbasen ligger i system-rollen så att den grundar VARJE turn
  // (den lagras inte i messages[] och måste därför re-injiceras per turn).
  const knowledge = await buildKnowledgeContext(pb, tool.id, user.tenant);
  const systemContent =
    buildAgentSystemPrompt(tool.system_prompt as string | undefined) + knowledge.block;

  const mistralMessages: MistralMessage[] = [
    { role: 'system', content: systemContent }
  ];

  if (existingMessages.length === 0 && run.output_md) {
    const startupId = (run.input as { startupId?: string } | undefined)?.startupId;
    const firstUser =
      startupId && tool.requires_startup
        ? `(Första körningen av ${tool.name} för bolag ${startupId}.)`
        : `(Första körningen av ${tool.name}.)`;
    mistralMessages.push(
      { role: 'user', content: firstUser },
      { role: 'assistant', content: run.output_md }
    );
  } else {
    for (const m of existingMessages) {
      if (m.role === 'system') continue;
      mistralMessages.push({ role: m.role, content: m.content });
    }
  }

  const userContent: string | MistralContentPart[] =
    prepared.imageBlocks.length > 0
      ? [
          { type: 'text', text: userText + prepared.injectedText },
          ...prepared.imageBlocks
        ]
      : userText + prepared.injectedText;

  mistralMessages.push({ role: 'user', content: userContent });

  const turnStart = new Date().toISOString();
  let result;
  try {
    result = await callMistral(selectedModel, mistralMessages);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'AI-anropet misslyckades.' };
  }

  const tokensIn = result.usage.prompt_tokens;
  const tokensOut = result.usage.completion_tokens;
  const costUsd = estimateCostUsd(selectedModel, tokensIn, tokensOut);
  const turnEnd = new Date().toISOString();

  const updatedMessages: ToolRunMessage[] = [
    ...existingMessages,
    {
      role: 'user',
      content: userText,
      attachments: prepared.uploadedRefs.length > 0 ? prepared.uploadedRefs : undefined,
      at: turnStart
    },
    {
      role: 'assistant',
      content: result.text,
      model: selectedModel,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: costUsd,
      at: turnEnd
    }
  ];

  // Bakåtkompatibla aggregat
  const newTokensIn = (run.tokens_in ?? 0) + tokensIn;
  const newTokensOut = (run.tokens_out ?? 0) + tokensOut;
  const newCost = (run.cost_estimate_usd ?? 0) + costUsd;

  await pb.collection('tool_runs').update(runId, {
    messages: updatedMessages,
    output_md: result.text,
    model: selectedModel,
    tokens_in: newTokensIn,
    tokens_out: newTokensOut,
    cost_estimate_usd: newCost
  });

  // Spegla denna turn (bara delta) till ai_usage_events
  await logAiUsage(pb, {
    tenant: user.tenant,
    userId: user.id,
    surface: 'tool_chat',
    model: selectedModel,
    tokensIn,
    tokensOut,
    toolRunId: runId
  });

  // Appendera nya bilagor till PB-fältet (PB-syntax: fältnamn+ för append)
  if (prepared.pbFiles.length > 0) {
    const fd = new FormData();
    for (const f of prepared.pbFiles) {
      fd.append('attachments+', f, f.name);
    }
    try {
      await pb.collection('tool_runs').update(runId, fd);
    } catch (err) {
      console.error('[continueToolChatAction] attachment upload failed', { runId, err });
    }
  }

  revalidatePath(`/toolbox/runs/${runId}`);
  return { runId };
}

/**
 * Assigns a tool to a startup by creating a planned activity.
 */
export async function assignToolToStartupAction(
  toolId: string,
  startupId: string
): Promise<ToolActionState> {
  const user = await requireUser();
  requireRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor']);

  const pb = await getServerPb();

  let tool: Tool & Record<string, unknown>;
  try {
    tool = await pb.collection('tools').getOne<Tool & Record<string, unknown>>(toolId);
  } catch {
    return { error: 'Agenten hittades inte.' };
  }

  if (tool.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    await pb.collection('activities').create({
      startup: startupId,
      type: 'task',
      title: `${tool.name} – tilldelat`,
      status: 'planned',
      kind: 'tool_run',
      tool: toolId,
      owner: user.id,
      due_date: new Date().toISOString().slice(0, 10)
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte tilldela agenten.' };
  }

  revalidatePath(`/startups/${startupId}`);
  revalidatePath('/aktivitet');
  return {};
}

/**
 * Creates a new tool in the registry.
 *
 * Admin och incubator_lead kan sätta systemprompt (`prompt_template`) och modell (`model`).
 * Detta var tidigare admin-only; utökningen är säker eftersom vi fortfarande kräver staff-roll,
 * tenant-matchning och server-side filtrering av payloadfält.
 */
export async function createToolAction(
  _prev: ToolActionState,
  formData: FormData
): Promise<ToolActionState> {
  const user = await requireUser();
  requireRole(user.roles, ['admin', 'incubator_lead']);

  const canEditAgentConfig = hasRole(user.roles, ['admin', 'incubator_lead']);

  const pb = await getServerPb();

  const data: Record<string, unknown> = {
    tenant: user.tenant,
    key: String(formData.get('key') || '').trim(),
    name: String(formData.get('name') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    category: String(formData.get('category') || ''),
    icon: String(formData.get('icon') || '').trim(),
    requires_startup: formData.get('requires_startup') === 'on',
    roles_allowed: formData.getAll('roles_allowed').map(String),
    output_format: String(formData.get('output_format') || 'markdown'),
    active: formData.get('active') === 'on',
    created_by: user.id
  };

  if (canEditAgentConfig) {
    // Movexum staff (admin/incubator_lead) sätter agent-roll, datamall och modell.
    data.system_prompt = String(formData.get('system_prompt') || '').trim();
    data.prompt_template = String(formData.get('prompt_template') || '').trim();
    data.model = String(formData.get('model') || '') || null;
    // Valfri kvalitetsrubrik (Fas 3). Tom = ingen grader-pass.
    data.verify_rubric = String(formData.get('verify_rubric') || '').trim();
  } else {
    // Övriga: prompten lämnas tom.
    data.system_prompt = '';
    data.prompt_template = '';
  }

  if (!data.key || !data.name || !data.category) {
    return { error: 'Unikt ID, namn och kategori är obligatoriska.' };
  }

  try {
    const record = await pb.collection('tools').create(data);
    await snapshotToolVersion(pb, record.id as string, user.tenant, user.id);
    revalidatePath('/toolbox');
    return { runId: record.id as string };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte skapa agenten.' };
  }
}

/**
 * Updates an existing tool.
 *
 * - Admin/incubator_lead: kan ändra allt, inklusive systemprompt och modell.
 * - Övriga: får inte ändra agenter.
 */
export async function updateToolAction(
  toolId: string,
  _prev: ToolActionState,
  formData: FormData
): Promise<ToolActionState> {
  const user = await requireUser();
  requireRole(user.roles, ['admin', 'incubator_lead']);

  const canEditAgentConfig = hasRole(user.roles, ['admin', 'incubator_lead']);

  const pb = await getServerPb();

  let tool: Record<string, unknown>;
  try {
    tool = await pb.collection('tools').getOne(toolId);
  } catch {
    return { error: 'Agenten hittades inte.' };
  }

  if (tool.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  const data: Record<string, unknown> = {
    name: String(formData.get('name') || '').trim(),
    description: String(formData.get('description') || '').trim(),
    category: String(formData.get('category') || ''),
    icon: String(formData.get('icon') || '').trim(),
    requires_startup: formData.get('requires_startup') === 'on',
    roles_allowed: formData.getAll('roles_allowed').map(String),
    output_format: String(formData.get('output_format') || 'markdown'),
    active: formData.get('active') === 'on'
  };

  // Movexum staff (admin/incubator_lead) kan uppdatera agent-roll, datamall och modell.
  if (canEditAgentConfig) {
    if (formData.has('system_prompt')) {
      data.system_prompt = String(formData.get('system_prompt') || '').trim();
    }
    if (formData.has('prompt_template')) {
      data.prompt_template = String(formData.get('prompt_template') || '').trim();
    }
    if (formData.has('model')) {
      data.model = String(formData.get('model') || '') || null;
    }
    if (formData.has('verify_rubric')) {
      data.verify_rubric = String(formData.get('verify_rubric') || '').trim();
    }
  }
  // Övriga: ignorerar tysta eventuella inskickade prompt_template/model
  // i payload (defense-in-depth om någon spoofar formuläret).

  try {
    await pb.collection('tools').update(toolId, data);
    await snapshotToolVersion(pb, toolId, user.tenant, user.id);
    revalidatePath('/toolbox');
    revalidatePath(`/toolbox/${toolId}`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte uppdatera agenten.' };
  }
}

/**
 * Helper för UI: kan användaren redigera systemprompten?
 */
export async function canEditToolPrompt(): Promise<boolean> {
  const user = await requireUser();
  return hasRole(user.roles, ['admin', 'incubator_lead']);
}

/**
 * Deactivates a tool (staff only).
 */
export async function deactivateToolAction(toolId: string): Promise<ToolActionState> {
  const user = await requireUser();
  requireRole(user.roles, ['admin', 'incubator_lead']);

  const pb = await getServerPb();

  let tool: Record<string, unknown>;
  try {
    tool = await pb.collection('tools').getOne(toolId);
  } catch {
    return { error: 'Agenten hittades inte.' };
  }

  if (tool.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    await pb.collection('tools').update(toolId, { active: false });
    revalidatePath('/toolbox');
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte inaktivera agenten.' };
  }
}

/**
 * Permanently deletes a tool and all its runs (staff only).
 */
export async function deleteToolAction(toolId: string): Promise<ToolActionState> {
  const user = await requireUser();
  requireRole(user.roles, ['admin', 'incubator_lead']);

  const pb = await getServerPb();

  let tool: Record<string, unknown>;
  try {
    tool = await pb.collection('tools').getOne(toolId);
  } catch {
    return { error: 'Agenten hittades inte.' };
  }

  if (tool.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    const runs = await pb.collection('tool_runs').getFullList<{ id: string }>({
      filter: `tenant = "${user.tenant}" && tool = "${toolId}"`,
      fields: 'id'
    });
    for (const r of runs) {
      await pb.collection('tool_runs').delete(r.id);
    }
    await pb.collection('tools').delete(toolId);
    revalidatePath('/toolbox');
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte radera agenten.' };
  }
}

export async function deleteToolFormAction(formData: FormData): Promise<void> {
  'use server';
  const id = String(formData.get('tool_id') || '').trim();
  if (!id) return;
  const result = await deleteToolAction(id);
  if (!result.error) {
    const { redirect } = await import('next/navigation');
    redirect('/toolbox');
  }
}
