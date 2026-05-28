import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { estimateCostUsd, type MistralMessage } from '@/lib/ai/mistral';
import {
  runAgentLoop,
  buildReadToolSurface,
  type AgentLoopUsage
} from '@/lib/ai/agent-runtime';
import { buildChatTools } from '@/lib/ai/tools';
import { getExposedCollections, buildSchemaSummary } from '@/lib/ai/schema';
import { buildAgentSystemPrompt } from '@/lib/ai/agent-prompt';
import { logAiUsage } from '@/lib/ai/usage';
import { planDeepJob } from './planner';
import type { Actor } from '@/lib/core/write';
import type {
  ChatThread,
  DeepJob,
  DeepJobSubtask,
  GeneratedFileRef,
  Role,
  ToolRunMessage
} from '@platform/shared';

// Bakgrundsexekvering av ett djupt jobb. Mirror av scheduling/runner.ts-
// mönstret (superuser-pb, RBAC-revalidering, allt loggat i tool_runs +
// ai_usage_events). Read-only sub-körningar (människa-i-loopen § 16.3);
// bara aggregeringssteget får generera dokument (artefakt, ingen
// domänmutation). Hårda tak (EU AI Act art. 15 / § 10).

const MODELS = ['mistral-large-latest', 'mistral-medium-latest'];
const SUBTASK_MAX_ITER = 6;
const AGG_MAX_ITER = 6;
const TOTAL_TOKEN_BUDGET = 300_000;
const WALL_CLOCK_MS = 5 * 60 * 1000;
const STAFF: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export interface DeepJobResult {
  ok: boolean;
  error?: string;
}

async function fail(pb: PocketBase, jobId: string, message: string): Promise<DeepJobResult> {
  try {
    await pb.collection('deep_jobs').update(jobId, {
      status: 'failed',
      error: message.slice(0, 1000),
      completed_at: new Date().toISOString()
    });
  } catch {
    /* ignore */
  }
  return { ok: false, error: message };
}

export async function runDeepJob(deepJobId: string): Promise<DeepJobResult> {
  const su = await getSuperuserPb();
  if (!su.ok) return { ok: false, error: `Superuser-klient saknas: ${su.reason}` };
  const pb = su.pb;

  let job: DeepJob;
  try {
    job = (await pb.collection('deep_jobs').getOne(deepJobId)) as unknown as DeepJob;
  } catch {
    return { ok: false, error: 'Jobbet hittades inte.' };
  }
  if (job.status !== 'queued') {
    return { ok: false, error: `Jobbet är inte i kö (status: ${job.status}).` };
  }

  // Ladda tråd + ägare och revalidera RBAC (rollnedgradering blockerar).
  let thread: ChatThread;
  try {
    thread = (await pb.collection('chat_threads').getOne(job.thread)) as unknown as ChatThread;
  } catch {
    return await fail(pb, deepJobId, 'Tråden hittades inte.');
  }
  if (thread.tenant !== job.tenant || thread.owner !== job.owner) {
    return await fail(pb, deepJobId, 'Tråd/ägare matchar inte jobbet.');
  }

  let roles: Role[] = [];
  try {
    const u = (await pb.collection('users').getOne(job.owner)) as unknown as {
      roles?: Role[];
      tenant?: string;
    };
    if (u.tenant !== job.tenant) return await fail(pb, deepJobId, 'Ägaren tillhör inte tenanten.');
    roles = u.roles || [];
  } catch {
    return await fail(pb, deepJobId, 'Ägaren hittades inte.');
  }
  if (!roles.some((r) => STAFF.includes(r))) {
    return await fail(pb, deepJobId, 'Ägaren saknar behörighet för djupa jobb.');
  }

  const startMs = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;
  const onUsage = (u: AgentLoopUsage) => {
    tokensIn += u.tokensIn;
    tokensOut += u.tokensOut;
    return logAiUsage(pb, {
      tenant: job.tenant,
      userId: job.owner,
      surface: 'deep_chat',
      model: u.model,
      tokensIn: u.tokensIn,
      tokensOut: u.tokensOut
    });
  };
  const overBudget = () =>
    tokensIn + tokensOut > TOTAL_TOKEN_BUDGET || Date.now() - startMs > WALL_CLOCK_MS;

  try {
    await pb.collection('deep_jobs').update(deepJobId, {
      status: 'planning',
      started_at: new Date().toISOString(),
      progress: 5
    });

    const collections = await getExposedCollections().catch(() => []);
    const schemaSummary = collections.length > 0 ? buildSchemaSummary(collections) : '';

    // ── Planering ──────────────────────────────────────────────────────
    const plan: DeepJobSubtask[] = await planDeepJob(MODELS, job.instruction, schemaSummary, onUsage);
    await pb.collection('deep_jobs').update(deepJobId, {
      plan,
      status: 'running',
      progress: 15
    });

    // ── Read-only sub-körningar (fan-out) ────────────────────────────────
    const findings: Array<{ goal: string; text: string }> = [];
    const subtaskRunIds: string[] = [];
    for (let i = 0; i < plan.length; i++) {
      if (overBudget()) break;
      // Avbrytnings-checkpoint (cancelDeepJobAction sätter status cancelled).
      try {
        const cur = (await pb.collection('deep_jobs').getOne(deepJobId)) as unknown as DeepJob;
        if (cur.status === 'cancelled') return { ok: false, error: 'Avbrutet av användaren.' };
      } catch {
        /* ignore */
      }
      const st = plan[i];
      let runId: string | undefined;
      try {
        const run = await pb.collection('tool_runs').create({
          tenant: job.tenant,
          startup: null,
          triggered_by: job.owner,
          status: 'running',
          input: { mode: 'deep_subtask', deep_job: deepJobId, goal: st.goal, kind: st.kind },
          started_at: new Date().toISOString()
        });
        runId = run.id as string;
        subtaskRunIds.push(runId);
      } catch {
        /* audit-raden är best-effort */
      }

      const surface = await buildReadToolSurface(pb, job.tenant, { includeMemory: true });
      const sysContent =
        buildAgentSystemPrompt(
          'Du är en analytiker som löser ETT avgränsat delsteg i ett större jobb. ' +
            'Använd verktygen för att LÄSA relevant plattformsdata och sammanfatta dina fynd ' +
            'kort och faktabaserat. Hitta aldrig på siffror.'
        ) + (surface ? `\n\n${surface.guidance}` : '');
      const conv: MistralMessage[] = [
        { role: 'system', content: sysContent },
        {
          role: 'user',
          content: `ÖVERGRIPANDE UPPGIFT (kontext): ${job.instruction}\n\nDITT DELSTEG: ${st.goal}`
        }
      ];

      let subText = '';
      try {
        const loop = await runAgentLoop(conv, {
          models: MODELS,
          tools: surface?.tools,
          toolContext: surface?.toolContext ?? { pb, tenantId: job.tenant, collections: [] },
          maxIterations: SUBTASK_MAX_ITER,
          onUsage
        });
        subText = loop.text;
      } catch (err) {
        subText = `(delsteget misslyckades: ${err instanceof Error ? err.message : 'fel'})`;
      }
      findings.push({ goal: st.goal, text: subText });

      if (runId) {
        await pb.collection('tool_runs').update(runId, {
          status: 'succeeded',
          output_md: subText,
          completed_at: new Date().toISOString()
        }).catch(() => {});
      }

      await pb.collection('deep_jobs').update(deepJobId, {
        progress: 15 + Math.round(((i + 1) / plan.length) * 70),
        subtask_runs: subtaskRunIds
      }).catch(() => {});
    }

    // ── Aggregering (får generera dokument, INGA domänskrivningar) ───────
    await pb.collection('deep_jobs').update(deepJobId, { status: 'aggregating', progress: 90 });

    const actor: Actor = { kind: 'agent', id: job.owner, tenant: job.tenant, roles };
    const aggTools = buildChatTools(collections, {
      actor,
      includeMemory: true,
      includeWrites: false,
      includeDocuments: true
    });
    const findingsBlock = findings
      .map((f, i) => `### Delsteg ${i + 1}: ${f.goal}\n${f.text}`)
      .join('\n\n');
    const aggSys =
      buildAgentSystemPrompt(
        'Du sammanställer ett UTKAST utifrån underlaget från delstegen. Skriv ett tydligt, ' +
          'faktabaserat svar på svenska. Om uppgiften efterfrågar ett dokument (rapport, ' +
          'presentation, kalkylark) — använd verktyget generate_document och basera ALLA ' +
          'siffror på underlaget. Detta är ett utkast som en människa granskar; publicera inte.'
      );
    const aggConv: MistralMessage[] = [
      { role: 'system', content: aggSys },
      {
        role: 'user',
        content: `UPPGIFT: ${job.instruction}\n\nUNDERLAG FRÅN DELSTEGEN:\n${findingsBlock}`
      }
    ];
    const generatedFiles: GeneratedFileRef[] = [];
    let draft = '';
    try {
      const loop = await runAgentLoop(aggConv, {
        models: MODELS,
        tools: aggTools,
        toolContext: {
          pb,
          tenantId: job.tenant,
          collections,
          actor,
          ownerUserId: job.owner,
          chatThreadId: job.thread,
          generatedFiles
        },
        maxIterations: AGG_MAX_ITER,
        onUsage
      });
      draft = loop.text;
    } catch (err) {
      return await fail(pb, deepJobId, `Sammanställningen misslyckades: ${err instanceof Error ? err.message : 'fel'}`);
    }

    // ── Persistera utkastet i tråden ─────────────────────────────────────
    const fresh = (await pb.collection('chat_threads').getOne(job.thread)) as unknown as ChatThread;
    const existing: ToolRunMessage[] = Array.isArray(fresh.messages) ? fresh.messages : [];
    const costUsd = estimateCostUsd('mistral-large-latest', tokensIn, tokensOut);
    const assistantMsg: ToolRunMessage = {
      role: 'assistant',
      content: draft || 'Det djupa jobbet gav inget svar.',
      model: 'mistral-large-latest',
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: costUsd,
      generated_files: generatedFiles.length > 0 ? generatedFiles : undefined,
      at: new Date().toISOString()
    };
    await pb.collection('chat_threads').update(job.thread, {
      messages: [...existing, assistantMsg],
      last_message_at: new Date().toISOString(),
      tokens_in: (fresh.tokens_in || 0) + tokensIn,
      tokens_out: (fresh.tokens_out || 0) + tokensOut,
      cost_estimate_usd: (fresh.cost_estimate_usd || 0) + costUsd
    });

    await pb.collection('deep_jobs').update(deepJobId, {
      status: 'succeeded',
      progress: 100,
      subtask_runs: subtaskRunIds,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_estimate_usd: costUsd,
      completed_at: new Date().toISOString()
    });

    return { ok: true };
  } catch (err) {
    return await fail(pb, deepJobId, err instanceof Error ? err.message : 'Okänt fel i djupt jobb.');
  }
}
