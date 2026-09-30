// Önskemål & buggar (CLAUDE.md § 49) — intern backlog där användarna i
// systemet lägger upp kort med frågor, buggar, önskemål om nya funktioner och
// ändringar, kopplade till den del av plattformen de rör. Ledningen
// (admin/incubator_lead) svarar och klarmarkerar.
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
 * Status. `open` = väntar på svar, `answered` = besvarad (kan behöva
 * åtgärd), `done` = klarmarkerad. MÅSTE spegla select-värdena i migration
 * 1700000176.
 */
export const FEEDBACK_STATUSES = ['open', 'answered', 'done'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: 'Öppen',
  answered: 'Besvarad',
  done: 'Klar'
};

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
  { id: 'mal', module: 'mal', label: 'Mål & verksamhetsplan', route: '/mal' },
  { id: 'arshjul', module: 'arshjul', label: 'Årshjul', route: '/arshjul' },
  { id: 'filer', module: 'filer', label: 'Filer', route: '/filer' },
  { id: 'inflode', module: 'inflode', label: 'Marknadsverktyg / Startupkompassen', route: '/inflode' },
  { id: 'uppdrag', module: 'uppdrag', label: 'Tvärfunktionella team', route: '/uppdrag' },
  { id: 'startups', module: 'startups', label: 'Bolag & bolagskort', route: '/startups' },
  { id: 'kontakter', module: 'kontakter', label: 'Kontaktbok', route: '/kontakter' },
  { id: 'de_minimis', module: 'de_minimis', label: 'De minimis', route: '/de-minimis' },
  { id: 'checkar', module: 'checkar', label: 'Stödcheckar', route: '/checkar' },
  { id: 'projekt', module: 'projekt', label: 'Projekt (finansiering)', route: '/projekt' },
  { id: 'upphandlingar', module: 'upphandlingar', label: 'Upphandlingar', route: '/upphandlingar' },
  { id: 'investerare', module: 'investerare', label: 'Investerarrelationer', route: '/investerare' },
  { id: 'events', module: 'events', label: 'Events', route: '/events' },
  { id: 'community', module: 'community', label: 'Community', route: '/community' },
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

// ─── Sortering & räkning ────────────────────────────────────────────────────

export interface FeedbackSortable {
  status: FeedbackStatus;
  kind: FeedbackKind;
  created?: string;
}

const STATUS_ORDER: Record<FeedbackStatus, number> = { open: 0, answered: 1, done: 2 };
const KIND_ORDER: Record<FeedbackKind, number> = { bug: 0, question: 1, change: 2, feature: 3 };

/**
 * Backlog-ordning: öppna först (buggar och frågor före ändringar/nya
 * funktioner), sedan besvarade, sist klara — nyast först inom varje grupp.
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
  const out: Record<FeedbackStatus, number> = { open: 0, answered: 0, done: 0 };
  for (const it of items) out[it.status] += 1;
  return out;
}
