import 'server-only';
import type PocketBase from 'pocketbase';
import {
  aggregateCompassSurvey,
  isSurveyModule,
  isValidSurveySubjectId,
  normalizeSurveySubjectKind,
  parseDateTimeInput,
  toPocketBaseDateTime,
  validateSurveyAnswer,
  type SurveyAggregate,
  type SurveyAnswerRow,
  type SurveySubjectKind
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
 * lagras inte heller subjektet (ett `?om=<id>` på en anonym personalenkät
 * hade annars kunnat binda svaren till en namngiven anställd). Varje svar
 * valideras mot sin fråga (`validateSurveyAnswer`) innan det lagras — ett
 * enskilt publikt inskick kan inte styra ett VP-mål med ett påhittat tal.
 * Aggregat går alltid genom `aggregateSurvey` (k-anonymitet).
 *
 * `compass_responses` är denylistad för chattens `query_collection`
 * (`lib/ai/redaction.ts`): råsvar når aldrig modellen; målstyrningen får
 * bara aggregatet.
 */

const CONVERSATIONS = 'compass_conversations';
const RESPONSES = 'compass_responses';
/** Hårt tak för aggregat-läsningen (robusthet § 10) — räcker för tusentals svar. */
const MAX_RESPONSE_ROWS = 20_000;

/** Kollektion per subjekttyp — subjektet måste FINNAS i modulens tenant. */
const SUBJECT_COLLECTIONS: Partial<Record<SurveySubjectKind, string>> = {
  startup: 'startups',
  event: 'incubator_events',
  partner: 'partners'
};

export interface StoreSurveyResponseInput {
  module: CompassModule;
  questions: CompassQuestion[];
  answers: Record<string, string | string[]>;
  /** Subjekt ur `?om=<id>`; valideras (format + existens i tenant), aldrig fritext. */
  subjectId?: unknown;
}

export interface StoredSurveyResponse {
  id: string;
  /** Antal svar som lagrades (giltiga svar på modulens frågor). */
  stored: number;
  /** Antal svar som föll på validering (räknas inte som fel — de lagras bara inte). */
  rejected: number;
}

async function subjectExists(pb: PocketBase, tenant: string, kind: SurveySubjectKind, id: string): Promise<boolean> {
  const collection = SUBJECT_COLLECTIONS[kind];
  if (!collection) return false; // none/staff har inget subjekt att peka på
  try {
    const row = await pb.collection(collection).getOne<{ tenant?: string }>(id, { fields: 'id,tenant' });
    return String(row.tenant ?? '') === tenant;
  } catch {
    return false;
  }
}

/**
 * Lagrar ett enkätinskick. Anropas av de publika routarna med den
 * superuser-klient `resolvePublicModule` gav (tenant härleds ALLTID från
 * modulen). Returnerar null när inskicket inte kunde lagras HELT — anroparen
 * ska då fela högt (samma garanti som lead-garantin § 23.6).
 */
export async function storeSurveyResponse(
  pb: PocketBase,
  tenant: string,
  input: StoreSurveyResponseInput
): Promise<StoredSurveyResponse | null> {
  if (!isSurveyModule(input.module)) return null;
  const subjectKind = normalizeSurveySubjectKind(input.module.subject_kind);
  const anonymous = input.module.anonymous === true;
  let subjectId = '';
  if (!anonymous && subjectKind !== 'none' && subjectKind !== 'staff' && isValidSurveySubjectId(input.subjectId)) {
    subjectId = (await subjectExists(pb, tenant, subjectKind, input.subjectId)) ? input.subjectId : '';
  }

  // Validera FÖRST — ett inskick utan ett enda giltigt svar lagras inte alls.
  const byKey = new Map(input.questions.map((q) => [q.key, q]));
  const valid: Array<{ question: CompassQuestion; value: string }> = [];
  let rejected = 0;
  for (const [key, raw] of Object.entries(input.answers)) {
    const q = byKey.get(key);
    if (!q) continue; // okänd nyckel — släpps (whitelist = modulens frågor)
    const value = validateSurveyAnswer(q, raw);
    if (value === null) {
      rejected++;
      continue;
    }
    valid.push({ question: q, value });
  }
  if (valid.length === 0) return null;

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

  let stored = 0;
  let failed = 0;
  for (const { question, value } of valid) {
    try {
      await writeWithFallback(pb, (c) =>
        c.collection(RESPONSES).create({ conversation: conversation.id, question: question.id, value })
      );
      stored++;
    } catch (err) {
      failed++;
      console.warn('[compass:survey] svar kunde inte lagras', {
        module: input.module.slug,
        question: question.key,
        status: (err as { status?: number }).status
      });
    }
  }
  // Partiellt inskick är ett fel (§ 10.4 processing integrity): rulla tillbaka
  // konversationen så halva svar aldrig räknas, och låt routen fela högt.
  if (failed > 0) {
    try {
      await writeWithFallback(pb, (c) => c.collection(CONVERSATIONS).delete(conversation.id));
    } catch {
      /* best-effort */
    }
    return null;
  }
  return { id: conversation.id, stored, rejected };
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
  /** ISO-datum, `from` inkl., `to` exkl. (conversation.created, svensk dygnsgräns § 38). */
  period?: { from: string; to: string };
}

/** PB-datetime för svensk midnatt på ett ISO-datum (§ 38 — servern kör UTC). */
function pbDay(day: string): string {
  const at = parseDateTimeInput(`${day}T00:00`);
  return toPocketBaseDateTime(at ?? new Date(`${day}T00:00:00Z`));
}

/**
 * Läser och aggregerar en enkätmoduls svar med den INKOMMANDE klienten
 * (användarens token → RLS via conversation.tenant, § 21.7). Fail-soft:
 * läsfel ⇒ tomt aggregat (0 respondenter, inte synligt).
 *
 * Enkätkonversationer identifieras på `module_slug` + satt `subject_kind`
 * (intag-konversationer saknar subjekt), så gamla intag-chattar på samma
 * slug räknas aldrig in. Känd begränsning: byts modulens interna slug tappas
 * historiken ur aggregatet.
 */
export async function loadSurveyAggregate(
  pb: PocketBase,
  tenant: string,
  module: Pick<CompassModule, 'id' | 'slug'>,
  opts: SurveyAggregateOptions = {}
): Promise<SurveyAggregate> {
  const questions = await listQuestionsForModule(pb, module.id);
  const npsKeys = questions.filter((q) => /(^|_)nps($|_)/.test(q.key)).map((q) => q.key);
  const empty = aggregateCompassSurvey([], questions, { npsKeys });

  let conversations: ConversationRow[] = [];
  try {
    const filters = ['tenant = {:t}', 'module_slug = {:m}', 'subject_kind != ""'];
    const params: Record<string, unknown> = { t: tenant, m: module.slug };
    if (opts.subjectId && isValidSurveySubjectId(opts.subjectId)) {
      filters.push('subject_id = {:s}');
      params.s = opts.subjectId;
    }
    if (opts.period) {
      filters.push('created >= {:from} && created < {:to}');
      params.from = pbDay(opts.period.from);
      params.to = pbDay(opts.period.to);
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
  return aggregateCompassSurvey(rows, questions, { npsKeys });
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
