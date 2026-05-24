import 'server-only';
import {
  callMistralWithFallback,
  type MistralMessage,
  type MistralToolDefinition
} from './mistral';
import { dispatchToolCall, type ToolDispatchContext } from './tools';

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
      const toolResult = await dispatchToolCall(call, options.toolContext);
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
