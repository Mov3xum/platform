// Önskemål & buggar (CLAUDE.md § 49) — intern backlog där användarna i
// systemet lägger upp kort med frågor, buggar, önskemål om nya funktioner och
// ändringar, kopplade till den del av plattformen de rör. Ledningen
// (admin/incubator_lead) svarar, flyttar kortet genom flödet
// Öppen → Påbörjad → Väntar återkoppling → Klar och kan be den som lade upp
// kortet (eller en annan kollega) att TESTA att det blev rätt.
//
// Ren, React-/server-fri domänlogik (enhetstestad i feedback.test.ts) som
// delas av UI, server actions och skrivvägen — så validering och behörighet
// aldrig divergerar.

import type { Role } from './index';

// ─── Vokabulär ──────────────────────────────────────────────────────────────

/** Vilken sorts kort. MÅSTE spegla select-värdena i migration 1700000176. */
export const FEEDBACK_KINDS = ['bug', 'feature', 'change', 'question'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  bug: 'Bugg',
  feature: 'Ny funktion',
  change: 'Ändring',
  question: 'Fråga'
};

export const FEEDBACK_KIND_DESCRIPTIONS: Record<FeedbackKind, string> = {
  bug: 'Något fungerar inte som det ska.',
  feature: 'Något som saknas och borde finnas.',
  change: 'Något som finns men borde fungera annorlunda.',
  question: 'Något du undrar över hur det är tänkt.'
};

/**
 * Status — kortets plats i flödet:
 *   `open`              = Öppen: inte påbörjad än, väntar på ledningen.
 *   `in_progress`       = Påbörjad: ledningen jobbar på det.
 *   `awaiting_feedback` = Väntar återkoppling: åtgärdat, någon (testaren)
 *                         ska pröva att det fungerar och återkoppla.
 *   `done`              = Klar.
 * MÅSTE spegla select-värdena i migration 1700000176 + 1700000208. Det
 * äldre värdet `answered` (migration 1700000176) ligger kvar i schemat så
 * befintliga rader aldrig blir ogiltiga; läsvägen tolkar det som
 * `in_progress` (`normalizeFeedbackStatus`) och migrationen backfillar.
 */
export const FEEDBACK_STATUSES = ['open', 'in_progress', 'awaiting_feedback', 'done'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: 'Öppen',
  in_progress: 'Påbörjad',
  awaiting_feedback: 'Väntar återkoppling',
  done: 'Klar'
};

/** Kolumnens undertext på tavlan. */
export const FEEDBACK_STATUS_HINTS: Record<FeedbackStatus, string> = {
  open: 'Inte påbörjad än',
  in_progress: 'Ledningen jobbar på det',
  awaiting_feedback: 'Testaren prövar och återkopplar',
  done: 'Klart och bekräftat'
};

/** Äldre lagrat värde (före migration 1700000208) → nuvarande status. */
export function normalizeFeedbackStatus(value: unknown): FeedbackStatus {
  if (value === 'answered') return 'in_progress';
  return isFeedbackStatus(value) ? value : 'open';
}

/**
 * Vilken del av plattformen kortet rör. Fast lista (samma mönster som
 * `file-topics.ts`/`competences.ts`) — fritext skulle drifta isär och göra
 * filtreringen oanvändbar. Lagras som TEXT i PB och valideras här, så en ny
 * sida kan läggas till utan migration. Håll nycklarna i synk med modul-id:n
 * i `coreModules` där en sådan finns (då kan kortet länka till sidan).
 */
export interface FeedbackArea {
  id: string;
  label: string;
  /** Intern sökväg till sidan (visas som länk på kortet). */
  route?: string;
  /**
   * Modul-id i `coreModules` som området hör till. Bara områden vars modul
   * är AKTIVERAD på personens profil (§ 36.3) får väljas — se
   * `allowedFeedbackAreas`. Saknas modul är området alltid valbart
   * (tvärgående: mobil, inloggning, "annat").
   */
  module?: string;
}

export const FEEDBACK_AREAS: readonly FeedbackArea[] = [
  { id: 'hem', module: 'hem', label: 'Översikt (startsidan)', route: '/hem' },
  { id: 'idag', module: 'idag', label: 'Chatt / AI-agent', route: '/chatt' },
  { id: 'inkorg', module: 'inkorg', label: 'Mina uppgifter', route: '/inkorg' },
  { id: 'mal', module: 'mal', label: 'Måluppföljning', route: '/mal' },
  { id: 'arshjul', module: 'arshjul', label: 'Årshjul', route: '/arshjul' },
  { id: 'filer', module: 'filer', label: 'Filer', route: '/filer' },
  { id: 'inflode', module: 'inflode', label: 'Marknadsverktyg / Startupkompassen', route: '/inflode' },
  { id: 'uppdrag', module: 'uppdrag', label: 'Tvärfunktionella team', route: '/uppdrag' },
  { id: 'startups', module: 'startups', label: 'Bolag & bolagskort', route: '/startups' },
  { id: 'kontakter', module: 'kontakter', label: 'Kontaktbok', route: '/kontakter' },
  { id: 'talang', module: 'talang', label: 'Studenter & talang', route: '/talang' },
  { id: 'de_minimis', module: 'de_minimis', label: 'De minimis', route: '/de-minimis' },
  { id: 'checkar', module: 'checkar', label: 'Stödcheckar', route: '/checkar' },
  { id: 'projekt', module: 'projekt', label: 'Projekt (finansiering)', route: '/projekt' },
  { id: 'upphandlingar', module: 'upphandlingar', label: 'Upphandlingar', route: '/upphandlingar' },
  { id: 'investerare', module: 'investerare', label: 'Investerarrelationer', route: '/investerare' },
  { id: 'events', module: 'events', label: 'Events', route: '/inflode/events' },
  { id: 'community', module: 'community', label: 'Community', route: '/inflode/community' },
  { id: 'education', module: 'education', label: 'Utbildning & workshops', route: '/education' },
  { id: 'rapporter', module: 'rapporter', label: 'Rapportering', route: '/rapporter' },
  { id: 'agenter', module: 'agenter', label: 'AI-agenter (verktygslådan)', route: '/toolbox' },
  { id: 'kunskapsbas', module: 'kunskapsbas', label: 'Kunskapsbas', route: '/kunskapsbas' },
  { id: 'integrationer', module: 'integrationer', label: 'Integrationer', route: '/integrationer' },
  { id: 'installningar', module: 'installningar', label: 'Inställningar & användare', route: '/installningar' },
  { id: 'min_oversikt', module: 'min_oversikt', label: 'Mitt bolag (bolagsmedlemmens vy)', route: '/min-oversikt' },
  { id: 'mobil', label: 'Mobil / app-läge' },
  { id: 'inloggning', label: 'Inloggning & konto', route: '/konto' },
  { id: 'onskemal', module: 'onskemal', label: 'Önskemål & buggar (den här sidan)', route: '/onskemal' },
  { id: 'annat', label: 'Annat / hela plattformen' }
];

export const FEEDBACK_AREA_IDS: readonly string[] = FEEDBACK_AREAS.map((a) => a.id);

/**
 * Områden en person får välja: de vars modul är aktiverad på hens profil
 * (`isModuleEnabled` = `canAccessModuleForUser` i appen) plus de
 * modul-lösa. Används av BÅDE formuläret och server-valideringen så
 * dropdownen och gränsen aldrig divergerar.
 */
export function allowedFeedbackAreas(isModuleEnabled: (moduleId: string) => boolean): FeedbackArea[] {
  return FEEDBACK_AREAS.filter((a) => !a.module || isModuleEnabled(a.module));
}

export function isFeedbackArea(value: unknown): value is string {
  return typeof value === 'string' && FEEDBACK_AREA_IDS.includes(value);
}

export function feedbackAreaLabel(id: string | null | undefined): string {
  if (!id) return 'Okänt område';
  return FEEDBACK_AREAS.find((a) => a.id === id)?.label ?? id;
}

export function feedbackAreaRoute(id: string | null | undefined): string | null {
  if (!id) return null;
  return FEEDBACK_AREAS.find((a) => a.id === id)?.route ?? null;
}

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return typeof value === 'string' && (FEEDBACK_KINDS as readonly string[]).includes(value);
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return typeof value === 'string' && (FEEDBACK_STATUSES as readonly string[]).includes(value);
}

// ─── Roller ─────────────────────────────────────────────────────────────────

/** Vem får lägga upp kort. Movexum-personal (observer är read-only, § 6). */
export const FEEDBACK_AUTHOR_ROLES: readonly Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

/** Vem får svara, klarmarkera och återöppna: ledningen. */
export const FEEDBACK_RESPONDER_ROLES: readonly Role[] = ['admin', 'incubator_lead'];

function hasAny(roles: readonly Role[] | undefined, allowed: readonly Role[]): boolean {
  return Boolean(roles?.some((r) => allowed.includes(r)));
}

export function canCreateFeedback(roles: readonly Role[] | undefined): boolean {
  return hasAny(roles, FEEDBACK_AUTHOR_ROLES);
}

export function canRespondToFeedback(roles: readonly Role[] | undefined): boolean {
  return hasAny(roles, FEEDBACK_RESPONDER_ROLES);
}

/**
 * Kortet får redigeras (rubrik/beskrivning/typ/område) av författaren så
 * länge det inte är klarmarkerat, och av ledningen alltid.
 */
export function canEditFeedback(
  user: { id: string; roles: readonly Role[] | undefined },
  item: { author: string | null; status: FeedbackStatus }
): boolean {
  if (canRespondToFeedback(user.roles)) return true;
  return Boolean(item.author) && item.author === user.id && item.status !== 'done';
}

/** Radera: ledningen alltid; författaren bara sitt eget, obesvarade kort. */
export function canDeleteFeedback(
  user: { id: string; roles: readonly Role[] | undefined },
  item: { author: string | null; status: FeedbackStatus; answer: string | null }
): boolean {
  if (canRespondToFeedback(user.roles)) return true;
  return Boolean(item.author) && item.author === user.id && item.status === 'open' && !item.answer;
}

/**
 * Testa: den utpekade testaren återkopplar ("fungerar" / "fungerar inte")
 * när kortet väntar på återkoppling. Ledningen får alltid återkoppla (de
 * kan också testa själva). Ingen testare ⇒ bara ledningen.
 */
export function canTestFeedback(
  user: { id: string; roles: readonly Role[] | undefined },
  item: { tester: string | null; status: FeedbackStatus }
): boolean {
  if (item.status !== 'awaiting_feedback') return false;
  if (canRespondToFeedback(user.roles)) return true;
  return Boolean(item.tester) && item.tester === user.id;
}

/** Kortet är "mitt" när jag skrev det eller är utpekad testare. */
export function isMyFeedback(item: { author: string | null; tester: string | null }, userId: string): boolean {
  return item.author === userId || item.tester === userId;
}

/**
 * Vem som ska testa när kortet flyttas till "Väntar återkoppling" utan att
 * en testare valts: den som lade upp kortet (hen vet vad som förväntades).
 * Saknas författaren (raderad användare) förblir testaren tom — då
 * återkopplar ledningen själv.
 */
export function defaultFeedbackTester(item: { author: string | null; tester: string | null }): string | null {
  return item.tester ?? item.author ?? null;
}

/**
 * Vad ett statusbyte innebär för testarfälten: att lämna "Väntar
 * återkoppling" nollar inget (historiken av vem som testade står kvar via
 * `test_note`/`tested_at`), men att gå TILL det utan testare pekar ut
 * författaren. Ren så UI och action räknar lika.
 */
export function testerAfterStatusChange(
  item: { author: string | null; tester: string | null },
  next: FeedbackStatus
): string | null {
  if (next === 'awaiting_feedback') return defaultFeedbackTester(item);
  return item.tester;
}

// ─── Validering ─────────────────────────────────────────────────────────────

export const FEEDBACK_TITLE_MAX = 160;
export const FEEDBACK_BODY_MAX = 5000;
export const FEEDBACK_ANSWER_MAX = 5000;

export interface FeedbackInput {
  title: string;
  description: string;
  kind: FeedbackKind;
  area: string;
}

export type FeedbackValidation = { ok: true; value: FeedbackInput } | { ok: false; error: string };

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

export function validateFeedbackInput(input: Record<string, unknown>): FeedbackValidation {
  const title = cleanText(input.title).replace(/\s+/g, ' ');
  if (!title) return { ok: false, error: 'Skriv en kort rubrik.' };
  if (title.length > FEEDBACK_TITLE_MAX) {
    return { ok: false, error: `Rubriken får vara högst ${FEEDBACK_TITLE_MAX} tecken.` };
  }
  const description = cleanText(input.description);
  if (!description) return { ok: false, error: 'Beskriv vad du vill ha eller vad som är fel.' };
  if (description.length > FEEDBACK_BODY_MAX) {
    return { ok: false, error: `Beskrivningen får vara högst ${FEEDBACK_BODY_MAX} tecken.` };
  }
  if (!isFeedbackKind(input.kind)) {
    return { ok: false, error: 'Välj om det är en bugg, ny funktion, ändring eller fråga.' };
  }
  if (!isFeedbackArea(input.area)) {
    return { ok: false, error: 'Välj vilken del av plattformen det gäller.' };
  }
  return { ok: true, value: { title, description, kind: input.kind, area: input.area } };
}

export type FeedbackAnswerValidation = { ok: true; value: string } | { ok: false; error: string };

export function validateFeedbackAnswer(input: unknown): FeedbackAnswerValidation {
  const answer = cleanText(input);
  if (!answer) return { ok: false, error: 'Skriv ett svar.' };
  if (answer.length > FEEDBACK_ANSWER_MAX) {
    return { ok: false, error: `Svaret får vara högst ${FEEDBACK_ANSWER_MAX} tecken.` };
  }
  return { ok: true, value: answer };
}

export const FEEDBACK_TEST_NOTE_MAX = 2000;

export type FeedbackTestResult = 'ok' | 'fail';

export interface FeedbackTestInput {
  result: FeedbackTestResult;
  note: string;
}

export type FeedbackTestValidation = { ok: true; value: FeedbackTestInput } | { ok: false; error: string };

/**
 * Testarens återkoppling: "fungerar" (noten valfri) eller "fungerar inte"
 * (noten krävs — ledningen måste veta vad som fortfarande är fel).
 */
export function validateFeedbackTest(input: Record<string, unknown>): FeedbackTestValidation {
  const result = input.result;
  if (result !== 'ok' && result !== 'fail') {
    return { ok: false, error: 'Ange om det fungerar eller inte.' };
  }
  const note = cleanText(input.note);
  if (result === 'fail' && !note) {
    return { ok: false, error: 'Beskriv vad som fortfarande inte fungerar.' };
  }
  if (note.length > FEEDBACK_TEST_NOTE_MAX) {
    return { ok: false, error: `Återkopplingen får vara högst ${FEEDBACK_TEST_NOTE_MAX} tecken.` };
  }
  return { ok: true, value: { result, note } };
}

/** Status efter testarens återkoppling: fungerar ⇒ klar, annars tillbaka till påbörjad. */
export function statusAfterFeedbackTest(result: FeedbackTestResult): FeedbackStatus {
  return result === 'ok' ? 'done' : 'in_progress';
}

// ─── Sortering & räkning ────────────────────────────────────────────────────

export interface FeedbackSortable {
  status: FeedbackStatus;
  kind: FeedbackKind;
  created?: string;
}

const STATUS_ORDER: Record<FeedbackStatus, number> = { open: 0, in_progress: 1, awaiting_feedback: 2, done: 3 };
const KIND_ORDER: Record<FeedbackKind, number> = { bug: 0, question: 1, change: 2, feature: 3 };

/**
 * Backlog-ordning: öppna först (buggar och frågor före ändringar/nya
 * funktioner), sedan påbörjade, sedan de som väntar på återkoppling, sist
 * klara — nyast först inom varje grupp.
 */
export function compareFeedbackItems(a: FeedbackSortable, b: FeedbackSortable): number {
  const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (s !== 0) return s;
  if (a.status === 'open') {
    const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (k !== 0) return k;
  }
  return (b.created ?? '').localeCompare(a.created ?? '');
}

export function countFeedbackByStatus<T extends { status: FeedbackStatus }>(
  items: readonly T[]
): Record<FeedbackStatus, number> {
  const out: Record<FeedbackStatus, number> = { open: 0, in_progress: 0, awaiting_feedback: 0, done: 0 };
  for (const it of items) out[it.status] += 1;
  return out;
}
