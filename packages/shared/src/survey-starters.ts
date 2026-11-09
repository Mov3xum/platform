// Movexums standardmallar för utvärdering (CLAUDE.md § 53.3).
//
// Färdiga, genomarbetade mallar per typ av aktivitet. De finns alltid —
// ingenting behöver seedas — och refereras med `starter:<nyckel>` överallt
// där en mall väljs (ny enkät, eventformuläret, inbjudningssidan). Personalen
// kan lägga till en kopia som egen mall under Utvärdering och ändra den
// fritt; en egen mall för en eventtyp går alltid före standardmallen.
//
// Varje mall följer samma bärande struktur så att resultaten går att jämföra
// mellan aktiviteter och mot målen (§ 53.4): ett obligatoriskt helhetsbetyg
// (1–5, nyckel `helhet`) och en NPS-fråga (`rekommendera`), däremellan det
// som är specifikt för formatet, och sist en fritextfråga om förbättringar.
// Ren data + uppslag, enhetstestad (`survey-starters.test.ts`).

import { EVENT_TYPES, isEventType } from './event-participants';
import type { EventType } from './index';
import { pickSurveyTemplateForEventType, type SurveyTemplateCandidate } from './survey';
import type { SurveyKind, SurveyQuestion, SurveyQuestionType } from './survey';

export const SURVEY_STARTER_PREFIX = 'starter:';

export interface SurveyStarterTemplate {
  key: string;
  name: string;
  /** Kort beskrivning i mallgalleriet. */
  summary: string;
  kind: SurveyKind;
  /** Eventtyper mallen är standard för. Varje eventtyp har exakt en standardmall. */
  template_for: EventType[];
  /** Beskrivningen som följer med enkäten (intern). */
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

const OVERALL = (prompt: string) => q('helhet', 'rating', prompt, true);
const NPS = (prompt: string) => q('rekommendera', 'nps', prompt, true);
const IMPROVE = q('battre', 'long_text', 'Vad skulle göra nästa tillfälle ännu bättre?');

export const SURVEY_STARTER_TEMPLATES: readonly SurveyStarterTemplate[] = [
  {
    key: 'frukost',
    name: 'Frukostträff & mingel',
    summary: 'Nätverksträffar, frukostar och matchning — fokus på nya kontakter och relevans.',
    kind: 'event',
    template_for: ['mingle', 'matching'],
    description: 'Utvärdering av nätverksträff eller matchning.',
    welcome_title: 'Tack för att du kom!',
    welcome_body: 'Berätta kort vad du tyckte — det tar under två minuter och är helt anonymt.',
    thank_you_message: 'Tack! Vi ses på nästa träff.',
    questions: [
      OVERALL('Helhetsintryck av träffen'),
      q('kontakter', 'choice', 'Hur många nya, relevanta kontakter fick du?', true, ['Inga', '1–2', '3–5', 'Fler än 5']),
      q('relevans', 'rating', 'Hur relevant var innehållet för dig och din verksamhet?'),
      q('format', 'choice', 'Hur passade tid och format?', false, ['Mycket bra', 'Bra', 'Mindre bra']),
      NPS('Hur sannolikt är det att du rekommenderar våra träffar till en kollega?'),
      q('amnen', 'long_text', 'Vilket ämne eller vilken gäst vill du se nästa gång?'),
      IMPROVE
    ]
  },
  {
    key: 'workshop',
    name: 'Workshop & utbildning',
    summary: 'Halvdag, kurs eller utbildningstillfälle — lärande, nytta och ledarskap.',
    kind: 'course',
    template_for: ['workshop'],
    description: 'Utvärdering av workshop eller utbildning.',
    welcome_title: 'Hur var workshoppen?',
    welcome_body: 'Två minuter, helt anonymt. Dina svar formar nästa tillfälle.',
    thank_you_message: 'Tack för din feedback — lycka till med det du tar med dig!',
    questions: [
      OVERALL('Helhetsbetyg för workshoppen'),
      q('nytta', 'rating', 'Hur användbart var innehållet för dig?', true),
      q('ledare', 'rating', 'Hur bra var workshopledaren på att förklara och engagera?'),
      q('tillampa', 'yes_no', 'Kommer du att använda något du lärt dig inom den närmaste månaden?'),
      q('tempo', 'choice', 'Hur upplevde du tempot?', false, ['För långsamt', 'Lagom', 'För snabbt']),
      NPS('Hur sannolikt är det att du rekommenderar workshoppen till någon i din situation?'),
      q('bast', 'long_text', 'Vad var mest värdefullt?'),
      IMPROVE
    ]
  },
  {
    key: 'pitch',
    name: 'Pitchevent & demodag',
    summary: 'Pitchtävlingar och demodagar — både för den som pitchade och för publiken.',
    kind: 'event',
    template_for: ['pitch'],
    description: 'Utvärdering av pitchevent eller demodag.',
    welcome_title: 'Tack för att du var med!',
    welcome_body: 'Oavsett om du pitchade eller lyssnade vill vi veta hur det kändes. Anonymt och snabbt.',
    thank_you_message: 'Tack! Din feedback hjälper oss bygga bättre mötesplatser för bolag och kapital.',
    questions: [
      OVERALL('Helhetsbetyg för eventet'),
      q('roll', 'choice', 'Vilken var din roll?', true, ['Jag pitchade', 'Investerare', 'Partner eller rådgivare', 'Publik']),
      q('kvalitet', 'rating', 'Hur bedömer du kvaliteten på pitcharna?'),
      q('uppfoljning', 'yes_no', 'Fick du kontakt med någon du vill följa upp?'),
      q('organisation', 'rating', 'Hur väl fungerade upplägg och tidshållning?'),
      NPS('Hur sannolikt är det att du rekommenderar eventet till andra?'),
      IMPROVE
    ]
  },
  {
    key: 'konferens',
    name: 'Konferens & seminarium',
    summary: 'Seminarier och konferenser — talare, program och det praktiska.',
    kind: 'event',
    template_for: ['conference'],
    description: 'Utvärdering av konferens eller seminarium.',
    welcome_title: 'Hur var dagen?',
    welcome_body: 'Hjälp oss göra programmet ännu bättre. Det tar två minuter och är anonymt.',
    thank_you_message: 'Tack för att du deltog och för din feedback!',
    questions: [
      OVERALL('Helhetsbetyg för konferensen'),
      q('talare', 'rating', 'Hur bedömer du talarna?', true),
      q('relevans', 'rating', 'Hur relevant var programmet för dig?'),
      q('bast', 'short_text', 'Vilken programpunkt gav dig mest?'),
      q('praktiskt', 'rating', 'Lokal, mat och information före eventet'),
      q('natverk', 'rating', 'Möjligheten att nätverka'),
      NPS('Hur sannolikt är det att du rekommenderar konferensen till en kollega?'),
      q('amnen', 'long_text', 'Vilka ämnen eller talare vill du se nästa gång?')
    ]
  },
  {
    key: 'hackathon',
    name: 'Hackathon',
    summary: 'Hackathons och innovationstävlingar — utmaning, stöd och vad som händer sen.',
    kind: 'event',
    template_for: ['hack'],
    description: 'Utvärdering av hackathon.',
    welcome_title: 'Bra jobbat!',
    welcome_body: 'Berätta hur du upplevde hackathonet — anonymt och på två minuter.',
    thank_you_message: 'Tack! Hör gärna av dig om du vill ta idén vidare.',
    questions: [
      OVERALL('Helhetsbetyg för hackathonet'),
      q('utmaning', 'rating', 'Hur engagerande var utmaningen?', true),
      q('stod', 'rating', 'Hur bra var stödet från mentorer och arrangörer?'),
      q('fick', 'multi_choice', 'Vad tar du med dig?', false, [
        'Nya kontakter',
        'Ny kunskap',
        'En idé att jobba vidare med',
        'Ett team',
        'Inspiration'
      ]),
      q('vidare', 'yes_no', 'Vill du fortsätta utveckla idén — gärna med stöd från Movexum?'),
      NPS('Hur sannolikt är det att du rekommenderar hackathonet till en vän?'),
      IMPROVE
    ]
  },
  {
    key: 'kort',
    name: 'Kort eventutvärdering',
    summary: 'Tre frågor på trettio sekunder — för alla aktiviteter som inte passar någon annan mall.',
    kind: 'event',
    template_for: ['other'],
    description: 'Kort utvärdering av en aktivitet.',
    welcome_title: 'Tre snabba frågor',
    welcome_body: 'Det tar trettio sekunder och är helt anonymt.',
    thank_you_message: 'Tack för hjälpen!',
    questions: [
      OVERALL('Helhetsbetyg'),
      NPS('Hur sannolikt är det att du rekommenderar den här aktiviteten till någon annan?'),
      IMPROVE
    ]
  }
];

export function starterTemplateRef(key: string): string {
  return `${SURVEY_STARTER_PREFIX}${key}`;
}

/** Standardmallen för en referens (`starter:<nyckel>`) — null om okänd. */
export function getSurveyStarterTemplate(ref: unknown): SurveyStarterTemplate | null {
  if (typeof ref !== 'string' || !ref.startsWith(SURVEY_STARTER_PREFIX)) return null;
  const key = ref.slice(SURVEY_STARTER_PREFIX.length);
  return SURVEY_STARTER_TEMPLATES.find((t) => t.key === key) ?? null;
}

export function isStarterTemplateRef(ref: unknown): boolean {
  return getSurveyStarterTemplate(ref) !== null;
}

/** Standardmallen för en eventtyp. Null för okänd typ. */
export function pickStarterTemplateForEventType(type: unknown): SurveyStarterTemplate | null {
  if (!isEventType(type)) return null;
  return SURVEY_STARTER_TEMPLATES.find((t) => t.template_for.includes(type)) ?? null;
}

/** Eventtyper i standardordning (för etiketter i galleriet). */
export function starterTemplateEventTypes(t: SurveyStarterTemplate): EventType[] {
  return EVENT_TYPES.filter((e) => t.template_for.includes(e));
}

/**
 * Mallen en utvärdering av en eventtyp utgår från: tenantens egen mall för
 * typen (id) går före Movexums standardmall (`starter:<nyckel>`). Null bara
 * för okänd eventtyp.
 */
export function defaultEvaluationTemplateRef(
  templates: ReadonlyArray<SurveyTemplateCandidate>,
  type: unknown
): string | null {
  const own = pickSurveyTemplateForEventType(templates, type);
  if (own) return own;
  const starter = pickStarterTemplateForEventType(type);
  return starter ? starterTemplateRef(starter.key) : null;
}
