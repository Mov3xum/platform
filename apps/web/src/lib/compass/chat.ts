import 'server-only';
import { callMistral, type MistralMessage } from '@/lib/ai/mistral';
import {
  EXTRACTION_SYSTEM_PROMPT,
  INTAKE_SYSTEM_PROMPT,
  SCORING_SYSTEM_PROMPT
} from './prompts';

export type CompassChatMessage = { role: 'user' | 'assistant'; content: string };

export interface ExtractedLeadData {
  name: string | null;
  email: string | null;
  phone: string | null;
  organization: string | null;
  idea_summary: string | null;
  idea_category: string | null;
}

const DEFAULT_MODEL = 'mistral-large-latest';
const SCORING_MODEL = 'mistral-small-latest';

/** Det publika intake-samtalet — assistent-svar via Mistral. */
export async function intakeReply(
  history: CompassChatMessage[],
  options: { model?: string; systemPrompt?: string } = {}
): Promise<{ text: string; tokensIn: number; tokensOut: number; model: string }> {
  const model = options.model || DEFAULT_MODEL;
  const messages: MistralMessage[] = [
    { role: 'system', content: options.systemPrompt || INTAKE_SYSTEM_PROMPT },
    ...history.map<MistralMessage>((m) => ({ role: m.role, content: m.content }))
  ];

  const res = await callMistral(model, messages);
  return {
    text: res.text,
    tokensIn: res.usage.prompt_tokens,
    tokensOut: res.usage.completion_tokens,
    model
  };
}

/** Extraherar lead-data från en konversation. Returnerar null på fel. */
export async function extractLead(
  history: CompassChatMessage[]
): Promise<ExtractedLeadData | null> {
  const transcript = history
    .map((m) => `${m.role === 'user' ? 'Användare' : 'Assistent'}: ${m.content}`)
    .join('\n\n');

  try {
    const res = await callMistral(SCORING_MODEL, [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: transcript }
    ]);
    const match = res.text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Partial<ExtractedLeadData>;
    return {
      name: stringOrNull(parsed.name),
      email: stringOrNull(parsed.email),
      phone: stringOrNull(parsed.phone),
      organization: stringOrNull(parsed.organization),
      idea_summary: stringOrNull(parsed.idea_summary)?.slice(0, 200) ?? null,
      idea_category: stringOrNull(parsed.idea_category)?.slice(0, 100) ?? null
    };
  } catch {
    return null;
  }
}

/** Bedömer ett extraherat lead. Default 50p vid fel — människan bestämmer alltid. */
export async function scoreLead(
  data: ExtractedLeadData
): Promise<{ score: number; reasoning: string }> {
  try {
    const res = await callMistral(SCORING_MODEL, [
      { role: 'system', content: SCORING_SYSTEM_PROMPT },
      { role: 'user', content: `Lead-data:\n${JSON.stringify(data, null, 2)}` }
    ]);
    const match = res.text.match(/\{[\s\S]*\}/);
    if (!match) return { score: 50, reasoning: 'Kunde inte bedöma.' };
    const parsed = JSON.parse(match[0]) as { score?: number; reasoning?: string };
    return {
      score: clampScore(parsed.score ?? 50),
      reasoning: (parsed.reasoning ?? 'Ingen motivering.').slice(0, 1000)
    };
  } catch {
    return { score: 50, reasoning: 'Bedömning kunde inte genomföras.' };
  }
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}
