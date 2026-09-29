import { parseStockholmLocalDateTime, stockholmDateKey } from './event-time';

// Marknadsverktyg → Utvärdering — digitala enkäter (ren, server/React-fri logik).
//
// Enkäter byggs i webbläsaren (frågor som JSON på `surveys.questions`) och
// besvaras anonymt på /u/<public_slug>. All validering och aggregering körs
// server-side utifrån den här modulen, så klienten aldrig är säkerhetsgränsen
// och logiken kan enhetstestas utan PocketBase/Next (samma mönster som
// compass-quiz.ts och de-minimis.ts).

export type SurveyQuestionType =
  | 'rating'
  | 'nps'
  | 'yes_no'
  | 'choice'
  | 'multi_choice'
  | 'short_text'
  | 'long_text';

export const SURVEY_QUESTION_TYPES: SurveyQuestionType[] = [
  'rating',
  'nps',
  'yes_no',
  'choice',
  'multi_choice',
  'short_text',
  'long_text'
];

export const SURVEY_QUESTION_TYPE_LABEL: Record<SurveyQuestionType, string> = {
  rating: 'Betyg 1–5',
  nps: 'Rekommendation 0–10 (NPS)',
  yes_no: 'Ja / Nej',
  choice: 'Envalsfråga',
  multi_choice: 'Flervalsfråga',
  short_text: 'Kort text',
  long_text: 'Lång text'
};

export type SurveyKind = 'course' | 'event' | 'program' | 'followup' | 'custom';

export const SURVEY_KINDS: SurveyKind[] = ['course', 'event', 'program', 'followup', 'custom'];

export const SURVEY_KIND_LABEL: Record<SurveyKind, string> = {
  course: 'Utbildning / workshop',
  event: 'Event',
  program: 'Inkubatorprogram',
  followup: 'Uppföljning',
  custom: 'Egen enkät'
};

export interface SurveyQuestion {
  /** Stabil nyckel (slug) — svaren lagras under den. Ändras aldrig efter skapande. */
  id: string;
  type: SurveyQuestionType;
  prompt: string;
  required: boolean;
  /** Bara för choice/multi_choice. */
  choices?: string[];
}

export type SurveyAnswerValue = string | number | string[];
export type SurveyAnswers = Record<string, SurveyAnswerValue>;

export const SURVEY_MAX_QUESTIONS = 40;
export const SURVEY_MAX_CHOICES = 12;
export const SURVEY_MAX_PROMPT = 300;
export const SURVEY_MAX_CHOICE_LEN = 120;
export const SURVEY_MAX_TEXT_ANSWER = 2000;

const TYPE_SET = new Set<string>(SURVEY_QUESTION_TYPES);

export function isSurveyKind(v: unknown): v is SurveyKind {
  return typeof v === 'string' && (SURVEY_KINDS as string[]).includes(v);
}

export function slugifySurveyText(input: string, max = 40): string {
  return (input || '')
    .toLowerCase()
    .replace(/å|ä/g, 'a')
    .replace(/ö/g, 'o')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/**
 * Normaliserar en (opålitlig) frågelista från klienten/DB: okända typer och
 * tomma frågor släpps, id:n görs unika, val trimmas och cappas. Aldrig throw.
 */
export function normalizeSurveyQuestions(raw: unknown): SurveyQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: SurveyQuestion[] = [];
  const used = new Set<string>();
  for (const item of raw) {
    if (out.length >= SURVEY_MAX_QUESTIONS) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const type = typeof r.type === 'string' && TYPE_SET.has(r.type) ? (r.type as SurveyQuestionType) : null;
    const prompt = typeof r.prompt === 'string' ? r.prompt.trim().slice(0, SURVEY_MAX_PROMPT) : '';
    if (!type || !prompt) continue;

    let base = typeof r.id === 'string' ? slugifySurveyText(r.id, 30) : '';
    if (!base) base = slugifySurveyText(prompt, 24) || `fraga-${out.length + 1}`;
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);

    const q: SurveyQuestion = { id, type, prompt, required: r.required === true };
    if (type === 'choice' || type === 'multi_choice') {
      const seen = new Set<string>();
      const choices: string[] = [];
      if (Array.isArray(r.choices)) {
        for (const c of r.choices) {
          if (typeof c !== 'string') continue;
          const label = c.trim().slice(0, SURVEY_MAX_CHOICE_LEN);
          if (!label || seen.has(label)) continue;
          seen.add(label);
          choices.push(label);
          if (choices.length >= SURVEY_MAX_CHOICES) break;
        }
      }
      // En val-fråga utan minst två alternativ är obesvarbar → släpp den.
      if (choices.length < 2) continue;
      q.choices = choices;
    }
    out.push(q);
  }
  return out;
}

export type SurveyValidation =
  | { ok: true; answers: SurveyAnswers }
  | { ok: false; error: string };

/**
 * Validerar besökarens svar mot frågelistan och returnerar en RENSAD kopia
 * (bara kända frågor, rätt typ, cappad text). Obligatoriska frågor måste vara
 * besvarade; okända nycklar kastas tyst. En helt tom inlämning avvisas.
 */
export function validateSurveyAnswers(
  questions: SurveyQuestion[],
  raw: unknown
): SurveyValidation {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const answers: SurveyAnswers = {};

  for (const q of questions) {
    const v = input[q.id];
    const empty =
      v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (q.required) return { ok: false, error: `Frågan "${q.prompt}" är obligatorisk.` };
      continue;
    }
    switch (q.type) {
      case 'rating':
      case 'nps': {
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
        const [lo, hi] = q.type === 'rating' ? [1, 5] : [0, 10];
        if (!Number.isInteger(n) || n < lo || n > hi) {
          return { ok: false, error: `Ogiltigt svar på "${q.prompt}".` };
        }
        answers[q.id] = n;
        break;
      }
      case 'yes_no': {
        if (v !== 'yes' && v !== 'no') return { ok: false, error: `Ogiltigt svar på "${q.prompt}".` };
        answers[q.id] = v;
        break;
      }
      case 'choice': {
        if (typeof v !== 'string' || !q.choices?.includes(v)) {
          return { ok: false, error: `Ogiltigt svar på "${q.prompt}".` };
        }
        answers[q.id] = v;
        break;
      }
      case 'multi_choice': {
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !q.choices?.includes(x))) {
          return { ok: false, error: `Ogiltigt svar på "${q.prompt}".` };
        }
        answers[q.id] = Array.from(new Set(v as string[]));
        break;
      }
      case 'short_text':
      case 'long_text': {
        if (typeof v !== 'string') return { ok: false, error: `Ogiltigt svar på "${q.prompt}".` };
        const t = v.trim().slice(0, q.type === 'short_text' ? 200 : SURVEY_MAX_TEXT_ANSWER);
        if (!t) {
          if (q.required) return { ok: false, error: `Frågan "${q.prompt}" är obligatorisk.` };
          break;
        }
        answers[q.id] = t;
        break;
      }
    }
  }

  if (Object.keys(answers).length === 0) {
    return { ok: false, error: 'Besvara minst en fråga innan du skickar in.' };
  }
  return { ok: true, answers };
}

// ── Aggregering ───────────────────────────────────────────────────────────────

export interface NpsResult {
  /** Promoters − detractors, i procentenheter (−100…100). null = inga svar. */
  score: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  total: number;
}

export function computeNps(values: number[]): NpsResult {
  const total = values.length;
  if (total === 0) return { score: null, promoters: 0, passives: 0, detractors: 0, total: 0 };
  let promoters = 0;
  let detractors = 0;
  for (const v of values) {
    if (v >= 9) promoters++;
    else if (v <= 6) detractors++;
  }
  const passives = total - promoters - detractors;
  const score = Math.round(((promoters - detractors) / total) * 100);
  return { score, promoters, passives, detractors, total };
}

export interface SurveyQuestionStats {
  id: string;
  type: SurveyQuestionType;
  prompt: string;
  /** Antal som besvarat just den här frågan. */
  answered: number;
  /** rating/nps: medelvärde. */
  average?: number;
  /** rating: 1–5, nps: 0–10, choice/yes_no/multi_choice: per alternativ. */
  distribution?: { label: string; count: number }[];
  nps?: NpsResult;
  /** Fritext: de senaste svaren (nyast först — ordning från indata). */
  texts?: string[];
}

export interface SurveySummary {
  responses: number;
  questions: SurveyQuestionStats[];
}

const TEXT_SAMPLE_LIMIT = 50;

/** Aggregerar svar (redan validerade vid inskick) till statistik per fråga. */
export function aggregateSurvey(
  questions: SurveyQuestion[],
  responses: SurveyAnswers[]
): SurveySummary {
  const stats: SurveyQuestionStats[] = questions.map((q) => {
    const vals = responses
      .map((r) => r[q.id])
      .filter((v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0));
    const base = { id: q.id, type: q.type, prompt: q.prompt, answered: vals.length };

    if (q.type === 'rating' || q.type === 'nps') {
      const nums = vals.filter((v): v is number => typeof v === 'number');
      const [lo, hi] = q.type === 'rating' ? [1, 5] : [0, 10];
      const distribution: { label: string; count: number }[] = [];
      for (let i = lo; i <= hi; i++) {
        distribution.push({ label: String(i), count: nums.filter((n) => n === i).length });
      }
      const average = nums.length
        ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
        : undefined;
      return {
        ...base,
        answered: nums.length,
        average,
        distribution,
        nps: q.type === 'nps' ? computeNps(nums) : undefined
      };
    }
    if (q.type === 'yes_no') {
      return {
        ...base,
        distribution: [
          { label: 'Ja', count: vals.filter((v) => v === 'yes').length },
          { label: 'Nej', count: vals.filter((v) => v === 'no').length }
        ]
      };
    }
    if (q.type === 'choice' || q.type === 'multi_choice') {
      const flat = vals.flatMap((v) => (Array.isArray(v) ? v : [String(v)]));
      return {
        ...base,
        distribution: (q.choices ?? []).map((c) => ({
          label: c,
          count: flat.filter((x) => x === c).length
        }))
      };
    }
    return {
      ...base,
      texts: vals.filter((v): v is string => typeof v === 'string').slice(0, TEXT_SAMPLE_LIMIT)
    };
  });
  return { responses: responses.length, questions: stats };
}

// ── Mallar ────────────────────────────────────────────────────────────────────

export interface SurveyTemplate {
  kind: SurveyKind;
  label: string;
  description: string;
  welcome_title: string;
  welcome_body: string;
  thank_you_message: string;
  questions: SurveyQuestion[];
}

const q = (
  id: string,
  type: SurveyQuestionType,
  prompt: string,
  required = false,
  choices?: string[]
): SurveyQuestion => ({ id, type, prompt, required, ...(choices ? { choices } : {}) });

export const SURVEY_TEMPLATES: Record<SurveyKind, SurveyTemplate> = {
  course: {
    kind: 'course',
    label: SURVEY_KIND_LABEL.course,
    description: 'Snabb utvärdering efter en workshop eller utbildning.',
    welcome_title: 'Hur var det?',
    welcome_body: 'Det tar två minuter och är helt anonymt. Dina svar hjälper oss göra nästa tillfälle bättre.',
    thank_you_message: 'Tack för din feedback!',
    questions: [
      q('helhet', 'rating', 'Helhetsbetyg', true),
      q('nytta', 'rating', 'Hur användbart var innehållet för dig?', true),
      q('tempo', 'choice', 'Hur upplevde du tempot?', false, ['För långsamt', 'Lagom', 'För snabbt']),
      q('rekommendera', 'nps', 'Hur sannolikt är det att du rekommenderar detta till en kollega?', true),
      q('bra', 'long_text', 'Vad var bäst?'),
      q('battre', 'long_text', 'Vad kan vi göra bättre?')
    ]
  },
  event: {
    kind: 'event',
    label: SURVEY_KIND_LABEL.event,
    description: 'Utvärdera ett event, en frukostträff eller ett nätverksmöte.',
    welcome_title: 'Tack för att du kom!',
    welcome_body: 'Berätta vad du tyckte — anonymt och på två minuter.',
    thank_you_message: 'Tack! Vi ses nästa gång.',
    questions: [
      q('helhet', 'rating', 'Helhetsbetyg för eventet', true),
      q('program', 'rating', 'Programmet / innehållet'),
      q('natverk', 'rating', 'Möjligheten att nätverka'),
      q('rekommendera', 'nps', 'Hur sannolikt är det att du rekommenderar våra event?', true),
      q('amnen', 'long_text', 'Vilka ämnen vill du se på framtida event?')
    ]
  },
  program: {
    kind: 'program',
    label: SURVEY_KIND_LABEL.program,
    description: 'Utvärdera tiden i inkubatorn — stöd, coachning och nätverk.',
    welcome_title: 'Hur har det varit i inkubatorn?',
    welcome_body: 'Din ärliga åsikt är guld värd. Svaren är anonyma och analyseras samlat.',
    thank_you_message: 'Tack — vi använder dina svar för att utveckla programmet.',
    questions: [
      q('rekommendera', 'nps', 'Hur sannolikt är det att du rekommenderar Movexum till en annan grundare?', true),
      q('coachning', 'rating', 'Kvaliteten på coachningen'),
      q('natverk', 'rating', 'Tillgång till nätverk och kontakter'),
      q('kapital', 'rating', 'Stöd kring finansiering'),
      q('mest', 'multi_choice', 'Vad har gett mest värde?', false, [
        'Coachning',
        'Workshops',
        'Nätverk',
        'Finansieringsstöd',
        'Kontorsplats och miljö'
      ]),
      q('saknas', 'long_text', 'Vad saknar du i programmet?'),
      q('kontakt', 'yes_no', 'Får vi höra av oss för en fördjupande intervju?')
    ]
  },
  followup: {
    kind: 'followup',
    label: SURVEY_KIND_LABEL.followup,
    description: 'Uppföljning av alumni och bolag — effekt över tid.',
    welcome_title: 'Hur har det gått sedan sist?',
    welcome_body: 'Hjälp oss följa upp effekten av inkubatorn. Det tar ett par minuter.',
    thank_you_message: 'Tack! Det hjälper oss visa effekten av vårt arbete.',
    questions: [
      q('lever', 'yes_no', 'Är bolaget fortfarande aktivt?', true),
      q('anstallda', 'choice', 'Antal anställda idag', false, ['0–1', '2–5', '6–10', '11–25', '26 eller fler']),
      q('finansiering', 'yes_no', 'Har bolaget tagit in externt kapital sedan inkubatorn?'),
      q('nytta', 'rating', 'Hur mycket bidrog inkubatorn till er utveckling?', true),
      q('behov', 'multi_choice', 'Vilket stöd behöver ni nu?', false, [
        'Finansiering',
        'Kunder och försäljning',
        'Rekrytering',
        'Internationalisering',
        'Juridik och IP'
      ]),
      q('fritt', 'long_text', 'Något du vill dela med oss?')
    ]
  },
  custom: {
    kind: 'custom',
    label: SURVEY_KIND_LABEL.custom,
    description: 'Börja med en tom enkät och bygg frågorna själv.',
    welcome_title: 'Vi vill höra vad du tycker',
    welcome_body: '',
    thank_you_message: 'Tack för dina svar!',
    questions: [q('helhet', 'rating', 'Helhetsbetyg', true)]
  }
};

// ── Uppföljning av något (koppling till källa) ────────────────────────────────
//
// En enkät kan skapas "från" en aktivitet i årshjulet (kampanj), ett event, en
// workshop, ett uppdrag, ett bolag eller en Startupkompass-modul. Kopplingen är
// polymorf och lagras som (link_kind, link_id, link_label) på `surveys` — inga
// relationer, så en raderad källa bryter aldrig enkäten (etiketten lever kvar).

export type SurveyLinkKind =
  | 'annual_wheel'
  | 'event'
  | 'workshop'
  | 'mission'
  | 'startup'
  | 'compass_module';

export const SURVEY_LINK_KINDS: SurveyLinkKind[] = [
  'annual_wheel',
  'event',
  'workshop',
  'mission',
  'startup',
  'compass_module'
];

export const SURVEY_LINK_KIND_LABEL: Record<SurveyLinkKind, string> = {
  annual_wheel: 'Aktivitet i årshjulet',
  event: 'Event',
  workshop: 'Workshop',
  mission: 'Uppdrag',
  startup: 'Bolag',
  compass_module: 'Startupkompass-modul'
};

/** Mallen som passar bäst som utgångspunkt för en uppföljning av källan. */
export const SURVEY_LINK_DEFAULT_KIND: Record<SurveyLinkKind, SurveyKind> = {
  annual_wheel: 'custom',
  event: 'event',
  workshop: 'course',
  mission: 'followup',
  startup: 'followup',
  compass_module: 'custom'
};

export interface SurveyLinkRef {
  kind: SurveyLinkKind;
  id: string;
}

export function isSurveyLinkKind(v: unknown): v is SurveyLinkKind {
  return typeof v === 'string' && (SURVEY_LINK_KINDS as string[]).includes(v);
}

const LINK_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Tolkar `?for=<kind>:<id>` — bara kända typer och ofarliga id:n. */
export function parseSurveyLinkRef(raw: unknown): SurveyLinkRef | null {
  if (typeof raw !== 'string') return null;
  const i = raw.indexOf(':');
  if (i <= 0) return null;
  const kind = raw.slice(0, i);
  const id = raw.slice(i + 1);
  if (!isSurveyLinkKind(kind) || !LINK_ID_RE.test(id)) return null;
  return { kind, id };
}

export function surveyLinkRefParam(ref: SurveyLinkRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** Intern länk tillbaka till källan. `slug` behövs bara för kompassmoduler. */
export function surveyLinkHref(ref: SurveyLinkRef, slug?: string): string {
  switch (ref.kind) {
    case 'annual_wheel':
      return `/arshjul?item=${encodeURIComponent(ref.id)}`;
    case 'event':
      return `/events/${encodeURIComponent(ref.id)}`;
    case 'workshop':
      return `/education/workshops/${encodeURIComponent(ref.id)}`;
    case 'mission':
      return `/uppdrag/${encodeURIComponent(ref.id)}`;
    case 'startup':
      return `/startups/${encodeURIComponent(ref.id)}`;
    case 'compass_module':
      return slug
        ? `/inflode/admin/modules/${encodeURIComponent(slug)}`
        : '/inflode/admin/modules';
  }
}

// ── Utskick till deltagare (§ 39.5) ──────────────────────────────────────────

/** Hårt tak per utskick (robusthet + skydd mot massutskick av misstag). */
export const SURVEY_MAX_RECIPIENTS = 500;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Plockar ut giltiga, dedupliserade e-postadresser ur en lista deltagare.
 * Adresserna används TRANSIENT för själva utskicket och lagras aldrig på
 * enkäten (GDPR § 5) — bara antalet.
 */
export function collectSurveyRecipients(
  rows: ReadonlyArray<{ email?: string | null }>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const raw = (r.email || '').trim().toLowerCase();
    if (!raw || raw.length > 254 || !EMAIL_RE.test(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= SURVEY_MAX_RECIPIENTS) break;
  }
  return out;
}

/**
 * Standardtid för automatiskt utskick: kl. 09:00 svensk tid dagen efter att
 * eventet slutade (annars dagen efter starten). Returnerar null om eventet
 * saknar datum. Svenska dygnsgränser (§ 38) — aldrig serverns UTC.
 */
export function defaultSurveySendAt(event: {
  starts_at?: string | null;
  ends_at?: string | null;
}): Date | null {
  const endIso = event.ends_at || event.starts_at;
  if (!endIso) return null;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return null;
  const key = stockholmDateKey(end); // YYYY-MM-DD i svensk tid
  const [y, m, d] = key.split('-').map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const nextKey = nextDay.toISOString().slice(0, 10);
  return parseStockholmLocalDateTime(`${nextKey}T09:00`);
}
