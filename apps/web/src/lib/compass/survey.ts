import 'server-only';
import type PocketBase from 'pocketbase';
import {
  aggregateSurvey,
  isSurveyModule,
  isValidSurveySubjectId,
  normalizeSurveySubjectKind,
  type SurveyAggregate,
  type SurveyAnswerRow
} from '@platform/shared';
import { writeWithFallback } from '@/lib/core/write/helpers';
import { listQuestionsForModule } from './store';
import type { CompassModule, CompassQuestion } from './types';

/**
 * Enkätlagret i Startupkompassen (CLAUDE.md § 43) — IO-sidan av
 * `@platform/shared/compass-survey.ts`.
 *
 * Svaren lagras per fråga i den befintliga `compass_responses` via en
 * `compass_conversations`-rad som bär SUBJEKTET (bolag/event/partner) —
 * inget lead, ingen session_token, ingen ip-hash. För `anonymous`-moduler
 * finns därmed inte något alls som pekar på en person. Aggregat går alltid
 * genom `aggregateSurvey` (k-anonymitet) — inga råsvar lämnar den här
 * modulen förutom till staff-UI:t som redan ser dem via RLS.
 */

const CONVERSATIONS = 'compass_conversations';
const RESPONSES = 'compass_responses';
/** Hårt tak för aggregat-läsningen (robusthet § 10) — räcker för tusentals svar. */
const MAX_RESPONSE_ROWS = 20_000;

export interface StoreSurveyResponseInput {
  module: CompassModule;
  questions: CompassQuestion[];
  answers: Record<string, string | string[]>;
  /** Subjekt ur `?om=<id>`; valideras, aldrig fritext. */
  subjectId?: unknown;
}

/**
 * Lagrar ett enkätinskick. Anropas av de publika routarna med den
 * superuser-klient `resolvePublicModule` gav (tenant härleds ALLTID från
 * modulen). Returnerar konversations-id eller null vid fel.
 */
export async function storeSurveyResponse(
  pb: PocketBase,
  tenant: string,
  input: StoreSurveyResponseInput
): Promise<{ id: string } | null> {
  if (!isSurveyModule(input.module)) return null;
  const subjectKind = normalizeSurveySubjectKind(input.module.subject_kind);
  const subjectId = subjectKind !== 'none' && isValidSurveySubjectId(input.subjectId) ? input.subjectId : '';

  let conversation: { id: string };
  try {
    conversation = await writeWithFallback(pb, (c) =>
      c.collection(CONVERSATIONS).create<{ id: string }>({
        tenant,
        module_slug: input.module.slug,
        status: 'completed',
        subject_kind: subjectKind,
        subject_id: subjectId
      })
    );
  } catch (err) {
    console.error('[compass:survey] kunde inte skapa inskick', {
      module: input.module.slug,
      status: (err as { status?: number }).status
    });
    return null;
  }

  const byKey = new Map(input.questions.map((q) => [q.key, q]));
  for (const [key, raw] of Object.entries(input.answers)) {
    const q = byKey.get(key);
    if (!q) continue; // okänd nyckel — släpps (whitelist = modulens frågor)
    const value = (Array.isArray(raw) ? raw.join(', ') : String(raw ?? '')).trim().slice(0, 8000);
    if (!value) continue;
    try {
      await writeWithFallback(pb, (c) =>
        c.collection(RESPONSES).create({ conversation: conversation.id, question: q.id, value })
      );
    } catch (err) {
      console.warn('[compass:survey] svar kunde inte lagras', {
        module: input.module.slug,
        question: q.key,
        status: (err as { status?: number }).status
      });
    }
  }
  return conversation;
}

interface ConversationRow {
  id: string;
  subject_id?: string;
  created?: string;
}
interface ResponseRow {
  conversation: string;
  question: string;
  value?: string | null;
}

export interface SurveyAggregateOptions {
  /** Begränsa till ett subjekt (t.ex. ett bolag). */
  subjectId?: string;
  /** ISO-datum, `from` inkl., `to` exkl. (conversation.created). */
  period?: { from: string; to: string };
}

/**
 * Läser och aggregerar en enkätmoduls svar med den INKOMMANDE klienten
 * (användarens token → RLS via conversation.tenant, § 21.7). Fail-soft:
 * läsfel ⇒ tomt aggregat (0 respondenter, inte synligt).
 */
export async function loadSurveyAggregate(
  pb: PocketBase,
  tenant: string,
  module: Pick<CompassModule, 'id' | 'slug'>,
  opts: SurveyAggregateOptions = {}
): Promise<SurveyAggregate> {
  const questions = await listQuestionsForModule(pb, module.id);
  const npsKeys = questions.filter((q) => /(^|_)nps($|_)/.test(q.key)).map((q) => q.key);
  const empty = aggregateSurvey([], questions, { npsKeys });

  let conversations: ConversationRow[] = [];
  try {
    const filters = ['tenant = {:t}', 'module_slug = {:m}'];
    const params: Record<string, unknown> = { t: tenant, m: module.slug };
    if (opts.subjectId && isValidSurveySubjectId(opts.subjectId)) {
      filters.push('subject_id = {:s}');
      params.s = opts.subjectId;
    }
    if (opts.period) {
      filters.push('created >= {:from} && created < {:to}');
      params.from = `${opts.period.from} 00:00:00.000Z`;
      params.to = `${opts.period.to} 00:00:00.000Z`;
    }
    conversations = await pb.collection(CONVERSATIONS).getFullList<ConversationRow>({
      filter: pb.filter(filters.join(' && '), params),
      fields: 'id,subject_id,created',
      batch: 500
    });
  } catch (err) {
    console.warn('[compass:survey] kunde inte läsa inskick', {
      module: module.slug,
      error: err instanceof Error ? err.message : err
    });
    return empty;
  }
  if (conversations.length === 0) return empty;

  const rows: SurveyAnswerRow[] = [];
  const questionKeyById = new Map(questions.map((q) => [q.id, q.key]));
  try {
    // Läs svaren i batchar om konversations-id (PB-filter har längdtak).
    for (let i = 0; i < conversations.length && rows.length < MAX_RESPONSE_ROWS; i += 50) {
      const slice = conversations.slice(i, i + 50);
      const params: Record<string, unknown> = {};
      const expr = slice.map((c, idx) => {
        params[`c${idx}`] = c.id;
        return `conversation = {:c${idx}}`;
      });
      const res = await pb.collection(RESPONSES).getFullList<ResponseRow>({
        filter: pb.filter(expr.join(' || '), params),
        fields: 'conversation,question,value',
        batch: 500
      });
      for (const r of res) {
        const key = questionKeyById.get(r.question);
        if (!key) continue;
        rows.push({ response_id: r.conversation, question_key: key, value: r.value ?? null });
      }
    }
  } catch (err) {
    console.warn('[compass:survey] kunde inte läsa svar', {
      module: module.slug,
      error: err instanceof Error ? err.message : err
    });
    return empty;
  }
  return aggregateSurvey(rows, questions, { npsKeys });
}

/** Enkätmoduler i tenanten (för indikator-väljaren i /mal). */
export async function listSurveyModules(pb: PocketBase, tenant: string): Promise<CompassModule[]> {
  try {
    const res = await pb.collection('compass_modules').getList<CompassModule>(1, 100, {
      filter: pb.filter('tenant = {:t} && purpose = "survey"', { t: tenant }),
      sort: 'name'
    });
    return res.items;
  } catch {
    return [];
  }
}
