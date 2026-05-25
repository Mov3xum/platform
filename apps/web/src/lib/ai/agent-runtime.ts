import 'server-only';
import type PocketBase from 'pocketbase';
import {
  callMistralWithFallback,
  type MistralMessage,
  type MistralToolDefinition
} from './mistral';
import {
  buildChatTools,
  describeToolCall,
  dispatchToolCall,
  type ToolDispatchContext
} from './tools';
import { buildSchemaSummary, getExposedCollections } from './schema';

// Hur många gånger modellen får anropa verktyg och få tillbaka resultat
// innan vi tvingar fram ett slutsvar. Skyddar mot oändliga loopar och
// token-explosion (CLAUDE.md § 10 robusthet / post-market monitoring).
export const DEFAULT_MAX_TOOL_ITERATIONS = 4;

// Tool-resultat trunkeras innan de matas tillbaka till modellen så att ett
// stort query-svar inte spränger kontextfönstret.
const MAX_TOOL_RESULT_CHARS = 12_000;

export interface AgentLoopUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Ett verktygssteg medan loopen kör. `start` skickas innan verktyget körs
 * (UI:t visar "Läser …"), `end` när det är klart (markerar utfall). Anroparen
 * (streaming-endpointen) forwardar dessa live till klienten.
 */
export interface AgentLoopStep {
  phase: 'start' | 'end';
  id: string; // tool_call-id
  tool: string;
  label: string;
  ok?: boolean; // bara phase === 'end'
}

export interface RunAgentLoopOptions {
  /** Modellkedja som provas i ordning vid kapacitetstak (429). */
  models: string[];
  /** Function-tools modellen får anropa. Utelämnas → inget verktygssteg. */
  tools?: MistralToolDefinition[];
  /** Skickas till varje tool-dispatch (pb, tenant, collections, actor). */
  toolContext: ToolDispatchContext;
  /** Max antal tool-iterationer innan ett slutsvar tvingas fram. */
  maxIterations?: number;
  /**
   * Anropas efter varje modellanrop med token-användning. Anroparen
   * ansvarar för att logga i `ai_usage_events` (surface skiljer sig per
   * exekveringsväg: dashboard_chat / toolbox / scheduled).
   */
  onUsage?: (usage: AgentLoopUsage) => Promise<void> | void;
  /**
   * Anropas runt varje verktygsanrop (start + end) så anroparen kan visa ett
   * live-aktivitetsspår. Synkron — får inte blockera loopen.
   */
  onStep?: (step: AgentLoopStep) => void;
}

export interface AgentLoopResult {
  text: string;
  /** Antal modell-turer som kördes. */
  iterations: number;
  /** Totalt antal verktygsanrop som utfördes. */
  toolCallsMade: number;
  /** True om maxIterations nåddes utan att modellen gav ett slutsvar. */
  hitIterationCap: boolean;
}

/**
 * Den delade agent-loopen: en reaktiv tool-use-loop mot Mistral. Modellen
 * får anropa verktyg, vi kör dem via det delade dispatch-/skrivlagret
 * (`dispatchToolCall` → `lib/core/write`), matar tillbaka resultaten och
 * låter modellen fortsätta tills den ger ett textsvar eller `maxIterations`
 * nås — då tvingas ett slutsvar fram utan verktyg.
 *
 * Detta är källan av sanning för agent-exekvering. Dashboardchatten är
 * första anroparen; toolbox- och schemalagda körningar ska flyttas hit så
 * att alla agenter delar samma loop, samma RBAC/skrivgräns och samma
 * iterations-/token-skydd (CLAUDE.md § 9.5, § 10).
 *
 * `conversation` muteras (assistant- och tool-meddelanden pushas under
 * loopens gång). Skicka en kopia om anroparen behöver originalet orört.
 */
export async function runAgentLoop(
  conversation: MistralMessage[],
  options: RunAgentLoopOptions
): Promise<AgentLoopResult> {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const tools =
    options.tools && options.tools.length > 0 ? options.tools : undefined;
  let toolCallsMade = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const result = await callMistralWithFallback(options.models, conversation, {
      tools,
      toolChoice: tools ? 'auto' : undefined
    });

    await options.onUsage?.({
      model: result.modelUsed,
      tokensIn: result.usage.prompt_tokens,
      tokensOut: result.usage.completion_tokens
    });

    const toolCalls = result.toolCalls ?? [];
    if (toolCalls.length === 0) {
      return {
        text: result.text || 'Inget svar från modellen.',
        iterations: iteration + 1,
        toolCallsMade,
        hitIterationCap: false
      };
    }

    conversation.push({
      role: 'assistant',
      content: result.text || null,
      tool_calls: toolCalls
    });

    for (const call of toolCalls) {
      const desc = describeToolCall(call);
      options.onStep?.({ phase: 'start', id: call.id, tool: desc.tool, label: desc.label });
      const toolResult = await dispatchToolCall(call, options.toolContext);
      options.onStep?.({
        phase: 'end',
        id: call.id,
        tool: desc.tool,
        label: desc.label,
        ok: toolResult.ok
      });
      toolCallsMade++;
      conversation.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(toolResult).slice(0, MAX_TOOL_RESULT_CHARS)
      });
    }
  }

  // Iterations-taket nått — tvinga ett slutsvar utan verktyg.
  const finalCall = await callMistralWithFallback(options.models, conversation, {
    toolChoice: 'none'
  });
  await options.onUsage?.({
    model: finalCall.modelUsed,
    tokensIn: finalCall.usage.prompt_tokens,
    tokensOut: finalCall.usage.completion_tokens
  });

  return {
    text:
      finalCall.text ||
      'Frågan krävde fler steg än tillåtet. Prova att bryta ner den i mindre delar.',
    iterations: maxIterations,
    toolCallsMade,
    hitIterationCap: true
  };
}

// Instruktion som beskriver de READ-ONLY-verktygen för autonoma körningar
// (toolbox-/schemalagda agenter). Till skillnad från dashboardchatten
// (`STAFF_TOOL_GUIDANCE` i chat.ts) exponeras INGA skrivverktyg här —
// autonoma körningar saknar människa-i-loopen som bekräftar varje
// skrivning (CLAUDE.md § 10, människa-i-loopen). De får bara läsa.
const READ_TOOL_GUIDANCE =
  '\n\nDu kan LÄSA live-data från plattformen via verktyg:\n' +
  '- `query_collection`: fråga en PocketBase-kollektion (tenant-scope och ' +
  'PII-maskning läggs på automatiskt server-side). Använd när du behöver ' +
  'konkreta aktuella data — gissa aldrig.\n' +
  '- `count_collection`: räkna rader som matchar ett filter.\n' +
  'Du kan INTE skriva — föreslå ändringar i text så avgör en människa. ' +
  'Sök först brett för att hitta rätt id, följ sedan upp riktat. Säg rakt ' +
  'ut om en kollektion saknar efterfrågad data.';

// ── Kvalitetsverifiering (Fas 3) ────────────────────────────────────────

const DEFAULT_MAX_VERIFY_REVISIONS = 1;

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

/**
 * Låter ett separat Mistral-anrop poängsätta ett svar mot en rubrik.
 * Fail-open: en granskare som inte kan tolkas blockerar aldrig svaret
 * (returnerar pass=true) — verifieringen får höja kvalitet, inte sänka
 * tillgänglighet.
 */
async function gradeAgainstRubric(
  models: string[],
  rubric: string,
  output: string,
  onUsage?: RunAgentLoopOptions['onUsage']
): Promise<{ pass: boolean; feedback: string }> {
  const system =
    'Du är en kvalitetsgranskare. Bedöm om SVARET uppfyller alla KRITERIER. ' +
    'Svara ENDAST med ett JSON-objekt: {"pass": true|false, "feedback": "kort ' +
    'motivering och vad som ev. saknas"}. Inga andra tecken, ingen markdown.';
  const user = `KRITERIER:\n${rubric}\n\nSVAR ATT BEDÖMA:\n${output}`;
  const res = await callMistralWithFallback(models, [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]);
  await onUsage?.({
    model: res.modelUsed,
    tokensIn: res.usage.prompt_tokens,
    tokensOut: res.usage.completion_tokens
  });
  try {
    const parsed = JSON.parse(extractJsonObject(res.text)) as {
      pass?: unknown;
      feedback?: unknown;
    };
    return {
      pass: parsed.pass === true,
      feedback: typeof parsed.feedback === 'string' ? parsed.feedback : ''
    };
  } catch {
    return { pass: true, feedback: '' };
  }
}

export interface RunAgentLoopVerifiedOptions extends RunAgentLoopOptions {
  /** Kriterier som svaret poängsätts mot. */
  rubric: string;
  /** Max antal revideringar om granskaren underkänner (default 1). */
  maxRevisions?: number;
}

export interface VerifiedAgentLoopResult extends AgentLoopResult {
  revisions: number;
  verified: boolean;
}

/**
 * `runAgentLoop` + grader-pass (Fas 3 — run-nivå "continuous improvement",
 * motsvarar managed-agents outcomes). Kör loopen, låter `gradeAgainstRubric`
 * poängsätta svaret, och vid underkänt matas granskarens feedback tillbaka
 * som en data-turn så agenten reviderar (upp till maxRevisions).
 *
 * Människa-i-loopen bevaras: detta auto-publicerar inte (CLAUDE.md § 10) —
 * det höjer kvaliteten på utkastet en människa sedan granskar. Fail-open
 * via `gradeAgainstRubric`.
 */
export async function runAgentLoopVerified(
  conversation: MistralMessage[],
  options: RunAgentLoopVerifiedOptions
): Promise<VerifiedAgentLoopResult> {
  const maxRevisions = options.maxRevisions ?? DEFAULT_MAX_VERIFY_REVISIONS;
  let result = await runAgentLoop(conversation, options);

  for (let revision = 0; revision < maxRevisions; revision++) {
    const grade = await gradeAgainstRubric(
      options.models,
      options.rubric,
      result.text,
      options.onUsage
    );
    if (grade.pass) {
      return { ...result, revisions: revision, verified: true };
    }
    conversation.push({
      role: 'user',
      content:
        'KVALITETSGRANSKNING (data, inte instruktion från användaren): ' +
        `${grade.feedback}\n\nRevidera ditt föregående svar så att alla ` +
        'kriterier uppfylls. Behåll det som redan var bra.'
    });
    result = await runAgentLoop(conversation, options);
  }

  const finalGrade = await gradeAgainstRubric(
    options.models,
    options.rubric,
    result.text,
    options.onUsage
  );
  return { ...result, revisions: maxRevisions, verified: finalGrade.pass };
}

export interface ReadToolSurface {
  tools: MistralToolDefinition[];
  toolContext: ToolDispatchContext;
  /** Schema-sammanfattning + verktygsinstruktion att appenda i system-prompten. */
  guidance: string;
}

/**
 * Bygger en READ-ONLY-verktygsyta för autonoma agentkörningar: de
 * exponerade kollektionerna (med PII-maskning/denylist från `schema.ts`),
 * `query_collection`/`count_collection` (inga skrivverktyg, eftersom
 * `buildChatTools` utan agent-actor utelämnar dem), samt en
 * system-prompt-instruktion + schema-sammanfattning. Returnerar null om
 * inga kollektioner kan exponeras (t.ex. superuser-credentials saknas) —
 * då faller anroparen tillbaka på en verktygslös körning.
 */
export async function buildReadToolSurface(
  pb: PocketBase,
  tenantId: string,
  options: { includeMemory?: boolean } = {}
): Promise<ReadToolSurface | null> {
  let collections: Awaited<ReturnType<typeof getExposedCollections>>;
  try {
    collections = await getExposedCollections();
  } catch {
    return null;
  }
  if (collections.length === 0) return null;

  // Ingen actor → buildChatTools ger bara read-only-verktyg (inkl.
  // memory_read när includeMemory är satt; memory_write kräver agent-actor
  // och ges därför aldrig i en autonom körning).
  const tools = buildChatTools(collections, { includeMemory: options.includeMemory });
  return {
    tools,
    toolContext: { pb, tenantId, collections },
    guidance: READ_TOOL_GUIDANCE + `\n\n${buildSchemaSummary(collections)}`
  };
}
