import 'server-only';
import type PocketBase from 'pocketbase';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { newPublicSlug } from '@/lib/surveys/store';
import { canCreateRecord } from './writable-fields';
import { logAgentAction } from './audit';
import { getRecordInTenant, writeWithFallback } from './helpers';
import { validateNonEmptyText, validateOptionalText } from './validators';
import type { Actor, WriteResult } from './types';
import { fail, ok } from './types';
import {
  SURVEY_KINDS,
  SURVEY_LINK_KINDS,
  SURVEY_TEMPLATES,
  isSurveyKind,
  isSurveyLinkKind,
  normalizeSurveyQuestions,
  type SurveyKind,
  type SurveyLinkKind,
  type SurveyQuestion
} from '@platform/shared';

/**
 * Delat skrivlager för Marknadsverktyget → Utvärdering (CLAUDE.md § 47):
 * digitala enkäter i kollektionen `surveys`. Låter chatt-agenten skapa en
 * enkät med SAMMA regler som UI:t (`lib/actions/surveys.ts`): rollpolicy
 * (admin/incubator_lead/coach), validering, tenant-stämpel från actorn och
 * audit i `agent_actions`.
 *
 * Människa-i-loopen (EU AI Act art. 14): en agent-skapad enkät landar ALLTID
 * som `is_active: false`. Att publicera den (så att /u/<slug> börjar ta emot
 * svar) och skicka ut den till deltagare gör en människa i byggaren.
 *
 * PII: enkätkonfiguration är verksamhetsmaterial; all fritext personnummer-
 * saneras på skrivvägen (§ 15.6). Svaren (`survey_responses`) rörs aldrig
 * härifrån och är denylistade för AI (§ 47.3).
 */

const COLLECTION = 'surveys';

/**
 * Källa → PB-kollektion + namnfält för `link_kind` (§ 47.4). Delas av
 * UI-actionen och agenten så att ingen av dem kan koppla en enkät till en
 * post i en annan tenant: uppslaget går alltid tenant-verifierat via
 * `getRecordInTenant`, och etiketten härleds server-side.
 */
export const SURVEY_LINK_SOURCE: Record<SurveyLinkKind, { collection: string; nameField: string }> = {
  annual_wheel: { collection: 'annual_wheel_items', nameField: 'title' },
  event: { collection: 'incubator_events', nameField: 'name' },
  workshop: { collection: 'workshops', nameField: 'title' },
  mission: { collection: 'missions', nameField: 'title' },
  startup: { collection: 'startups', nameField: 'name' },
  compass_module: { collection: 'compass_modules', nameField: 'name' }
};

export interface CreateSurveyParams {
  name: string;
  /** Mall/typ (`course` | `event` | `program` | `followup` | `custom`). Default custom. */
  kind?: string;
  description?: string;
  welcomeTitle?: string;
  welcomeBody?: string;
  thankYouMessage?: string;
  /** Egna frågor. Utelämnad → mallens frågor för `kind`. */
  questions?: unknown;
  /** Valfri källa enkäten följer upp (§ 47.4). */
  linkKind?: string;
  linkId?: string;
}

export interface CreatedSurveyResult {
  surveyId: string;
  name: string;
  kind: SurveyKind;
  questionCount: number;
  /** Byggaren + resultatvyn — hit skickas personalen för att granska och publicera. */
  adminPath: string;
  /** Den publika länken. Tar emot svar först när enkäten publicerats. */
  publicPath: string;
  linkKind: SurveyLinkKind | null;
  linkLabel: string;
}

function sanitizeQuestions(questions: SurveyQuestion[]): SurveyQuestion[] {
  return questions.map((q) => ({
    ...q,
    prompt: sanitizePersonnummer(q.prompt),
    ...(q.choices ? { choices: q.choices.map((c) => sanitizePersonnummer(c)) } : {})
  }));
}

export function surveyPath(id: string): string {
  return `/inflode/utvardering/${id}`;
}

/**
 * Skapar en opublicerad enkät under Utvärdering. Returnerar id + adminlänk så
 * chatten kan skicka användaren vidare för att granska frågorna och publicera.
 */
export async function createSurvey(
  pb: PocketBase,
  actor: Actor,
  params: CreateSurveyParams
): Promise<WriteResult<CreatedSurveyResult>> {
  const policy = canCreateRecord(actor, COLLECTION);
  if (!policy.ok) {
    return fail(
      actor.kind === 'agent' ? 'FIELD_NOT_WRITABLE' : 'FORBIDDEN',
      policy.reason ?? 'Skapande nekat.'
    );
  }

  const name = validateNonEmptyText(params.name, 'name', 160);
  if (!name.ok) return fail('INVALID_VALUE', name.error);

  const kindRaw = String(params.kind ?? '').trim() || 'custom';
  if (!isSurveyKind(kindRaw)) {
    return fail(
      'INVALID_VALUE',
      `Ogiltig enkättyp "${kindRaw}". Giltiga: ${SURVEY_KINDS.join(', ')}.`
    );
  }
  const kind: SurveyKind = kindRaw;
  const tpl = SURVEY_TEMPLATES[kind];

  const description = validateOptionalText(params.description, 'description', 500);
  if (!description.ok) return fail('INVALID_VALUE', description.error);
  const welcomeTitle = validateOptionalText(params.welcomeTitle, 'welcome_title', 160);
  if (!welcomeTitle.ok) return fail('INVALID_VALUE', welcomeTitle.error);
  const welcomeBody = validateOptionalText(params.welcomeBody, 'welcome_body', 2000);
  if (!welcomeBody.ok) return fail('INVALID_VALUE', welcomeBody.error);
  const thankYou = validateOptionalText(params.thankYouMessage, 'thank_you_message', 500);
  if (!thankYou.ok) return fail('INVALID_VALUE', thankYou.error);

  // Frågor: egna om de angetts, annars mallens. Angivna men helt ogiltiga
  // frågor är ett fel — aldrig en tyst mall-ersättning (§ 33.4).
  let questions: SurveyQuestion[];
  if (Array.isArray(params.questions) && params.questions.length > 0) {
    questions = normalizeSurveyQuestions(params.questions);
    if (questions.length === 0) {
      return fail(
        'INVALID_VALUE',
        'Ingen av frågorna kunde tolkas. Varje fråga behöver `type` (rating, nps, yes_no, choice, multi_choice, short_text, long_text) och `prompt`; choice/multi_choice behöver minst två `choices`.'
      );
    }
  } else {
    questions = tpl.questions;
  }
  questions = sanitizeQuestions(questions);

  // Valfri källa (§ 47.4) — tenant-verifierad; en referens som inte hittas
  // avvisas i stället för att tyst ge en fristående enkät.
  let linkKind: SurveyLinkKind | null = null;
  let linkId = '';
  let linkLabel = '';
  const linkKindRaw = String(params.linkKind ?? '').trim();
  const linkIdRaw = String(params.linkId ?? '').trim();
  if (linkKindRaw || linkIdRaw) {
    if (!isSurveyLinkKind(linkKindRaw)) {
      return fail(
        'INVALID_VALUE',
        `Ogiltig link_kind "${linkKindRaw}". Giltiga: ${SURVEY_LINK_KINDS.join(', ')}.`
      );
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(linkIdRaw)) {
      return fail('INVALID_VALUE', 'link_id måste vara ett post-id (slå upp det med search_records/query_collection).');
    }
    const src = SURVEY_LINK_SOURCE[linkKindRaw];
    const row = await getRecordInTenant<{ id: string; tenant?: string } & Record<string, unknown>>(
      pb,
      actor,
      src.collection,
      linkIdRaw,
      `id,tenant,${src.nameField}`
    );
    if (!row) {
      return fail('NOT_FOUND', `Det enkäten skulle följa upp (${linkKindRaw} ${linkIdRaw}) hittades inte i er organisation.`);
    }
    linkKind = linkKindRaw;
    linkId = row.id;
    linkLabel = sanitizePersonnummer(String(row[src.nameField] ?? '').trim().slice(0, 200)) || `${linkKindRaw} ${row.id}`;
  }

  const basePayload = {
    tenant: actor.tenant,
    name: sanitizePersonnummer(name.value),
    kind,
    description: sanitizePersonnummer(description.value || tpl.description),
    welcome_title: sanitizePersonnummer(welcomeTitle.value || tpl.welcome_title),
    welcome_body: sanitizePersonnummer(welcomeBody.value || tpl.welcome_body),
    thank_you_message: sanitizePersonnummer(thankYou.value || tpl.thank_you_message),
    questions,
    // Alltid opublicerad: publicering är ett mänskligt beslut (art. 14).
    is_active: false,
    created_by: actor.id,
    link_kind: linkKind ?? '',
    link_id: linkId,
    link_label: linkLabel
  };

  // Den slumpade sluggen kolliderar i praktiken aldrig; ett unikt-index-fel
  // ger ett nytt försök i stället för ett hårt fel (samma som UI-actionen).
  let record: { id: string } | null = null;
  let slug = '';
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3 && !record; attempt++) {
    slug = newPublicSlug();
    try {
      record = await writeWithFallback(pb, (client) =>
        client.collection(COLLECTION).create<{ id: string }>({ ...basePayload, public_slug: slug })
      );
    } catch (err) {
      lastErr = err;
    }
  }
  if (!record) {
    console.error('[write:surveys] kunde inte skapa enkät', {
      tenant: actor.tenant,
      status: (lastErr as { status?: number })?.status,
      error: lastErr instanceof Error ? lastErr.message : 'okänt'
    });
    return fail('DB_ERROR', 'Kunde inte skapa enkäten. Har migration 1700000149 körts?');
  }

  await logAgentAction(pb, {
    actor,
    action_type: 'create',
    collection: COLLECTION,
    record_id: String(record.id),
    after_value: {
      name: basePayload.name,
      kind,
      questions: questions.length,
      is_active: false,
      link_kind: linkKind ?? undefined,
      link_label: linkLabel || undefined
    }
  });

  return ok({
    surveyId: String(record.id),
    name: basePayload.name,
    kind,
    questionCount: questions.length,
    adminPath: surveyPath(String(record.id)),
    publicPath: `/u/${slug}`,
    linkKind,
    linkLabel
  });
}
