/**
 * Startupkompassen som ENKÄTMOTOR — ren, IO-fri logik (CLAUDE.md § 43).
 *
 * Samma modul-/frågemotor som intaget bär kundnöjdhet, NPS, partnerenkät och
 * medarbetarindex. Här finns vokabulären (syfte, subjekt), färdiga mallar
 * och aggregeringen med k-anonymitet — så att UI, routar, skrivlager och
 * målstyrning (§ 42) räknar på exakt samma sätt.
 *
 * Ingen PII i den här modulen: aggregat, etiketter, mallar.
 */

import { sharePct, AGGREGATE_MIN_GROUP } from './metrics';
import type { CompassInputType } from './compass-authoring';

// ─── Vokabulär ──────────────────────────────────────────────────────────────

export const COMPASS_PURPOSES = ['intake', 'survey'] as const;
export type CompassPurpose = (typeof COMPASS_PURPOSES)[number];
export const COMPASS_PURPOSE_LABELS: Record<CompassPurpose, string> = {
  intake: 'Intag (skapar lead)',
  survey: 'Enkät (samlar svar, inget lead)'
};

/** Saknat/okänt värde ⇒ `intake` — en oapplicerad migration ändrar aldrig beteendet (§ 24.4). */
export function normalizeCompassPurpose(v: unknown): CompassPurpose {
  return v === 'survey' ? 'survey' : 'intake';
}

export function isSurveyModule(module: { purpose?: string | null } | null | undefined): boolean {
  return normalizeCompassPurpose(module?.purpose) === 'survey';
}

export const SURVEY_SUBJECT_KINDS = ['none', 'startup', 'event', 'partner', 'staff'] as const;
export type SurveySubjectKind = (typeof SURVEY_SUBJECT_KINDS)[number];
export const SURVEY_SUBJECT_KIND_LABELS: Record<SurveySubjectKind, string> = {
  none: 'Inget särskilt (allmän enkät)',
  startup: 'Ett bolag (kundnöjdhet)',
  event: 'Ett event (NPS efter event)',
  partner: 'En partner (partnerenkät)',
  staff: 'Personalen (medarbetarindex)'
};

export function normalizeSurveySubjectKind(v: unknown): SurveySubjectKind {
  return (SURVEY_SUBJECT_KINDS as readonly string[]).includes(String(v)) ? (v as SurveySubjectKind) : 'none';
}

/** Subjekt-id i URL/body: PocketBase-id eller vår egen nyckel — aldrig fritext. */
export function isValidSurveySubjectId(v: unknown): v is string {
  return typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
}

/** Query-parametern den publika länken bär subjektet i: `/m/<slug>?om=<id>`. */
export const SURVEY_SUBJECT_PARAM = 'om';

/** Startupkompassens skalfråga är 1–10 (QuestionInput `ScaleInput`). */
export const SURVEY_SCALE_MIN = 1;
export const SURVEY_SCALE_MAX = 10;
/** Fritextsvar cappas (dataminimering; fritext aggregeras aldrig). */
export const SURVEY_TEXT_MAX = 2000;

/**
 * Validerar och normaliserar ETT publikt enkätsvar mot frågan innan lagring
 * (§ 10.5 p. 7): skalfrågor måste vara heltal inom 1–10, val måste finnas
 * bland alternativen, fritext cappas. Ogiltigt ⇒ null (svaret lagras inte).
 */
export function validateSurveyAnswer(
  question: { input_type: string; choices?: { value: string }[] },
  raw: unknown
): string | null {
  const values = Array.isArray(raw) ? raw : [raw];
  const strings = values.map((v) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')).filter(Boolean);
  if (strings.length === 0) return null;
  switch (question.input_type) {
    case 'scale': {
      const n = Number(strings[0].replace(',', '.'));
      if (!Number.isInteger(n) || n < SURVEY_SCALE_MIN || n > SURVEY_SCALE_MAX) return null;
      return String(n);
    }
    case 'choice': {
      const allowed = new Set((question.choices ?? []).map((c) => c.value));
      return allowed.has(strings[0]) ? strings[0] : null;
    }
    case 'multi_choice': {
      const allowed = new Set((question.choices ?? []).map((c) => c.value));
      const picked = [...new Set(strings.filter((v) => allowed.has(v)))];
      return picked.length > 0 ? picked.join(', ') : null;
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strings[0]) ? strings[0].slice(0, 254) : null;
    case 'phone':
      return /^[+\d][\d\s()-]{4,30}$/.test(strings[0]) ? strings[0].slice(0, 50) : null;
    case 'short_text':
      return strings.join(', ').slice(0, 500);
    default:
      return strings.join('\n').slice(0, SURVEY_TEXT_MAX);
  }
}

// ─── Mallar ─────────────────────────────────────────────────────────────────

export interface SurveyTemplateQuestion {
  key: string;
  prompt: string;
  input_type: CompassInputType;
  required?: boolean;
  help_text?: string;
  /** Skala 0–10 (NPS) i stället för standard 1–5. */
  nps?: boolean;
}

export interface SurveyTemplate {
  key: string;
  name: string;
  description: string;
  subject_kind: SurveySubjectKind;
  anonymous: boolean;
  intro_message: string;
  success_message: string;
  consent_note: string;
  questions: SurveyTemplateQuestion[];
}

export const SURVEY_TEMPLATES: readonly SurveyTemplate[] = [
  {
    key: 'kundnojdhet',
    name: 'Kundnöjdhet — bolag',
    description: 'Kvartalsvis nöjdhet per bolag (skala 1–10). VP-målet 4 av 5 motsvarar 8 av 10.',
    subject_kind: 'startup',
    anonymous: false,
    intro_message: 'Tre snabba frågor om hur ni upplever stödet från Movexum det här kvartalet.',
    success_message: 'Tack! Era svar hjälper oss att bli bättre.',
    consent_note:
      'Svaren kopplas till ert bolag och används internt av Movexum för att förbättra stödet. Inga personuppgifter behöver anges.',
    questions: [
      { key: 'nojdhet_helhet', prompt: 'Hur nöjda är ni med stödet från Movexum som helhet?', input_type: 'scale', required: true },
      { key: 'nojdhet_coach', prompt: 'Hur väl matchar coachningen era behov just nu?', input_type: 'scale', required: true },
      { key: 'nojdhet_progress', prompt: 'Hur mycket har Movexum bidragit till er progress det här kvartalet?', input_type: 'scale', required: true },
      { key: 'kommentar', prompt: 'Vad kan vi göra bättre?', input_type: 'long_text', help_text: 'Skriv inga personnamn.' }
    ]
  },
  {
    key: 'nps_event',
    name: 'NPS efter event',
    description: '"Skulle du rekommendera Movexum till en vän/kollega?" (0–10). Mål i VP: 70 %.',
    subject_kind: 'event',
    anonymous: true,
    intro_message: 'Tack för att du var med! Två frågor om eventet.',
    success_message: 'Tack för din feedback!',
    consent_note: 'Svaren är anonyma och används bara för att förbättra Movexums event.',
    questions: [
      { key: 'nps', prompt: 'Hur troligt är det att du skulle rekommendera Movexum till en vän eller kollega?', input_type: 'scale', required: true, nps: true },
      { key: 'basta', prompt: 'Vad var mest värdefullt?', input_type: 'long_text' }
    ]
  },
  {
    key: 'partnerenkat',
    name: 'Partnerenkät',
    description: 'Årlig nöjdhet hos befintliga partners (skala 1–10). Mål i VP: ≥ 80 % nöjda (≥ 7 av 10).',
    subject_kind: 'partner',
    anonymous: false,
    intro_message: 'Som partner till Movexum vill vi veta hur samarbetet fungerar.',
    success_message: 'Tack! Vi återkommer med hur vi tar hand om era synpunkter.',
    consent_note: 'Svaren kopplas till er organisation och används internt av Movexum. Inga personuppgifter behöver anges.',
    questions: [
      { key: 'nojdhet', prompt: 'Hur nöjda är ni med partnerskapet som helhet?', input_type: 'scale', required: true },
      { key: 'varde', prompt: 'Vilket värde ger partnerskapet er idag?', input_type: 'long_text' },
      { key: 'onskemal', prompt: 'Vad skulle göra partnerskapet mer värdefullt?', input_type: 'long_text' }
    ]
  },
  {
    key: 'medarbetarindex',
    name: 'Medarbetarindex',
    description: 'Anonym pulsmätning av arbetsmiljö och samarbete (skala 1–10). Visas först vid minst 5 svar.',
    subject_kind: 'staff',
    anonymous: true,
    intro_message: 'Fem frågor om hur det är att jobba på Movexum just nu. Enkäten är anonym.',
    success_message: 'Tack! Resultatet visas bara som aggregat när minst fem har svarat.',
    consent_note:
      'Enkäten är anonym: inga identifierare, ingen IP-adress och inget konto sparas. Resultatet visas bara sammanslaget för minst fem svar.',
    questions: [
      { key: 'trivsel', prompt: 'Jag trivs med mitt arbete.', input_type: 'scale', required: true },
      { key: 'samarbete', prompt: 'Samarbetet över team fungerar bra.', input_type: 'scale', required: true },
      { key: 'tydlighet', prompt: 'Jag vet vad som förväntas av mig.', input_type: 'scale', required: true },
      { key: 'belastning', prompt: 'Min arbetsbelastning är hållbar.', input_type: 'scale', required: true },
      { key: 'utveckling', prompt: 'Jag får utvecklas i min roll.', input_type: 'scale', required: true },
      { key: 'kommentar', prompt: 'Något du vill lyfta? (skriv inga namn)', input_type: 'long_text' }
    ]
  }
];

export function findSurveyTemplate(key: unknown): SurveyTemplate | null {
  return SURVEY_TEMPLATES.find((t) => t.key === key) ?? null;
}

// ─── Aggregering ────────────────────────────────────────────────────────────

export interface SurveyAnswerRow {
  /** Konversations-/inskicks-id — en respondent. */
  response_id: string;
  question_key: string;
  value: string | null | undefined;
}

export interface SurveyQuestionLike {
  key: string;
  prompt: string;
  input_type: string;
  choices?: { value: string; label: string }[];
}

export interface SurveyQuestionAggregate {
  key: string;
  prompt: string;
  input_type: string;
  /** Antal som svarade på frågan. */
  count: number;
  /** Medel för skalfrågor (en decimal), annars null. */
  mean: number | null;
  /** Fördelning för val-/skalfrågor (värde → antal). */
  distribution: Record<string, number>;
  /** NPS (−100…100) när frågan är 0–10 och gruppen ≥ k. */
  nps: number | null;
}

export interface SurveyAggregate {
  /** Antal respondenter (unika inskick). */
  respondents: number;
  /** false när gruppen är mindre än k — inga värden visas då. */
  visible: boolean;
  minGroup: number;
  questions: SurveyQuestionAggregate[];
  /** Samlat medel över skalfrågorna (1–5), null under tröskeln eller utan skalfrågor. */
  score: number | null;
  /** Första NPS-frågans värde, om någon. */
  nps: number | null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Aggregerar enkätsvar med k-anonymitet: under `k` respondenter returneras
 * inga värden alls (bara antalet). Skalfrågor ger medel; 0–10-frågor ger
 * dessutom NPS. Fritext aggregeras aldrig (bara räknas).
 */
export function aggregateSurvey(
  rows: readonly SurveyAnswerRow[],
  questions: readonly SurveyQuestionLike[],
  opts: { k?: number; npsKeys?: readonly string[] } = {}
): SurveyAggregate {
  const k = opts.k ?? AGGREGATE_MIN_GROUP;
  const respondents = new Set(rows.map((r) => r.response_id)).size;
  const visible = respondents >= k;
  const npsKeys = new Set(opts.npsKeys ?? []);

  const byKey = new Map<string, SurveyAnswerRow[]>();
  for (const r of rows) {
    const list = byKey.get(r.question_key) ?? [];
    list.push(r);
    byKey.set(r.question_key, list);
  }

  const qAgg: SurveyQuestionAggregate[] = questions.map((q) => {
    const answers = byKey.get(q.key) ?? [];
    const count = new Set(answers.map((a) => a.response_id)).size;
    const distribution: Record<string, number> = {};
    let sum = 0;
    let numeric = 0;
    let promoters = 0;
    let detractors = 0;
    if (visible) {
      for (const a of answers) {
        const raw = a.value;
        if (raw === null || raw === undefined || raw === '') continue;
        if (q.input_type === 'scale' || q.input_type === 'choice') {
          for (const v of String(raw).split(',').map((s) => s.trim()).filter(Boolean)) {
            distribution[v] = (distribution[v] ?? 0) + 1;
          }
        }
        if (q.input_type === 'scale') {
          const n = toNumber(raw);
          // Extra skydd utöver valideringen vid lagring: värden utanför skalan räknas inte.
          if (n !== null && n >= SURVEY_SCALE_MIN && n <= SURVEY_SCALE_MAX) {
            sum += n;
            numeric++;
            if (n >= 9) promoters++;
            else if (n <= 6) detractors++;
          }
        }
      }
    }
    const isNps = npsKeys.has(q.key);
    const mean = visible && numeric > 0 && q.input_type === 'scale' ? Math.round((sum / numeric) * 10) / 10 : null;
    const nps =
      visible && isNps && numeric >= k
        ? Math.round(((promoters - detractors) / numeric) * 100)
        : null;
    return { key: q.key, prompt: q.prompt, input_type: q.input_type, count, mean, distribution, nps };
  });

  const scaleMeans = qAgg.filter((q) => q.input_type === 'scale' && !npsKeys.has(q.key) && q.mean !== null).map((q) => q.mean as number);
  const score = visible && scaleMeans.length > 0 ? Math.round((scaleMeans.reduce((a, b) => a + b, 0) / scaleMeans.length) * 10) / 10 : null;
  const npsQ = qAgg.find((q) => q.nps !== null);

  return { respondents, visible, minGroup: k, questions: qAgg, score, nps: npsQ ? npsQ.nps : null };
}

/**
 * Andel "nöjda" (svar ≥ `threshold` på skalan 1–10) med respondenttröskel —
 * det mått partnermålet "≥ 80 % nöjda" använder.
 */
export function satisfiedShare(
  rows: readonly SurveyAnswerRow[],
  questionKey: string,
  threshold = 7,
  k: number = AGGREGATE_MIN_GROUP
): number | null {
  const answers = rows.filter((r) => r.question_key === questionKey);
  const values = answers.map((a) => toNumber(a.value)).filter((n): n is number => n !== null);
  // Nöjdhet är ingen särskild kategori: tröskeln gäller antalet respondenter,
  // inte båda grupperna (det strikta två-sidiga skyddet är för art. 9, § 41.2).
  if (values.length < k) return null;
  return sharePct(values.filter((n) => n >= threshold).length, values.length);
}
