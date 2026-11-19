/**
 * Startupkompassen på engelska (CLAUDE.md § 23.13, 2026-11).
 *
 * Två lager:
 *
 * 1. **Gränssnittet** (knappar, steg, fel, samtycke …) — fasta svenska och
 *    engelska strängar i `COMPASS_UI`. Komponenterna väljer ordbok efter
 *    besökarens språk (`?lang=en` på /m/<slug>).
 * 2. **Modulens innehåll** (rubriker, startsida, frågor, svarsalternativ,
 *    resultatprofiler) — författat på svenska av personalen. Den engelska
 *    versionen lagras på modulen (`compass_modules.translations.en`) som en
 *    PLATT karta nyckel → text, där nycklarna härleds ur modulen
 *    (`compassTranslatableEntries`). Den översätts AUTOMATISKT (Mistral, EU)
 *    första gången en besökare väljer English och sparas på modulen — det
 *    finns inget redaktörssteg. Språkknappen visas på alla moduler, och den
 *    engelska sidan säger att texten är maskinöversatt (art. 50).
 *
 * Varje översatt text bär en hash av den svenska källan
 * (`sources[nyckel]`) så en ändrad svensk text översätts om vid nästa
 * engelska visning. En nyckel utan engelsk text faller tillbaka på svenskan
 * — sidan går aldrig sönder.
 *
 * Ren modul: ingen IO, inga beroenden — delas av server, klient och test.
 */

import type { ResultBucket } from './compass-quiz';

export const COMPASS_LOCALES = ['sv', 'en'] as const;
export type CompassLocale = (typeof COMPASS_LOCALES)[number];

/** Query-parametern på den publika sidan: `/m/<slug>?lang=en`. */
export const COMPASS_LANG_PARAM = 'lang';

export const COMPASS_LOCALE_LABEL: Record<CompassLocale, string> = {
  sv: 'Svenska',
  en: 'English'
};

/** `en` ⇒ engelska, allt annat (även saknat) ⇒ svenska. */
export function parseCompassLocale(value: unknown): CompassLocale {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim().toLowerCase() === 'en' ? 'en' : 'sv';
}

// ── Lagring ────────────────────────────────────────────────────────────────

export interface StoredCompassTranslation {
  /** Nyckel → engelsk text. */
  texts: Record<string, string>;
  /** Nyckel → hash av den svenska källan när texten sparades. */
  sources: Record<string, string>;
  updated_at?: string;
}

export interface CompassTranslations {
  en?: StoredCompassTranslation;
}

/** Tak per text och antal nycklar (fältet är json ≤ 1 MB). */
export const COMPASS_TRANSLATION_MAX_TEXT = 4000;
export const COMPASS_TRANSLATION_MAX_KEYS = 1500;
const KEY_RE = /^[a-z]+\.[A-Za-z0-9_.:-]{1,220}$/;

function cleanTranslationText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Styrtecken bort (radbrytningar behålls — startsidan/samtycket är flerradiga).
  // eslint-disable-next-line no-control-regex
  const t = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return t ? t.slice(0, COMPASS_TRANSLATION_MAX_TEXT) : undefined;
}

function cleanTextMap(raw: unknown, valueCleaner: (v: unknown) => string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= COMPASS_TRANSLATION_MAX_KEYS) break;
    if (!KEY_RE.test(key)) continue;
    const clean = valueCleaner(value);
    if (clean === undefined) continue;
    out[key] = clean;
    n++;
  }
  return out;
}

/** Tolerant läsning av `compass_modules.translations` (okänt ⇒ tomt). */
export function normalizeCompassTranslations(raw: unknown): CompassTranslations {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const en = (value as Record<string, unknown>).en;
  if (!en || typeof en !== 'object' || Array.isArray(en)) return {};
  const e = en as Record<string, unknown>;
  const texts = cleanTextMap(e.texts, cleanTranslationText);
  const sources = cleanTextMap(e.sources, (v) =>
    typeof v === 'string' && /^[0-9a-f]{1,16}$/.test(v) ? v : undefined
  );
  return {
    en: {
      texts,
      sources,
      updated_at: typeof e.updated_at === 'string' ? e.updated_at.slice(0, 40) : undefined
    }
  };
}

/**
 * Deterministisk, kort hash (FNV-1a 32 bit, hex) av en svensk källtext.
 * Bara för ändringsdetektering — ingen säkerhetsfunktion.
 */
export function compassSourceHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ── Vad som översätts ──────────────────────────────────────────────────────

/** Modulfält som besökaren ser (svenska källan). */
export const COMPASS_TRANSLATABLE_MODULE_FIELDS = [
  'name',
  'hero_eyebrow',
  'welcome_title',
  'welcome_body',
  'target_audience',
  'start_page_title',
  'start_page_body',
  'consent_note',
  'intro_message',
  'success_message'
] as const;

export type CompassTranslatableModuleField = (typeof COMPASS_TRANSLATABLE_MODULE_FIELDS)[number];

export interface CompassTranslationEntry {
  key: string;
  /** Den svenska källan. */
  source: string;
}

/** Minsta modulform som behövs för att räkna fram nycklarna. */
export type TranslatableModule = Partial<Record<CompassTranslatableModuleField, string | null>> & {
  result_buckets?: ResultBucket[] | null;
};

export interface TranslatableQuestion {
  id: string;
  key?: string;
  prompt: string;
  help_text?: string | null;
  choices?: { value: string; label: string }[] | null;
}

/**
 * Alla texter i modulen som besökaren ser, med stabila nycklar:
 * `m.<fält>`, `q.<frågans id>.prompt|help`, `q.<id>.c.<svarsvärde>`,
 * `b.<profil>.title|body|cta`, `b.<profil>.tip.<n>`. Tomma källor hoppas
 * över (inget att översätta).
 */
export function compassTranslatableEntries(
  module: TranslatableModule,
  questions: TranslatableQuestion[]
): CompassTranslationEntry[] {
  const out: CompassTranslationEntry[] = [];
  const push = (key: string, source: unknown) => {
    const text = typeof source === 'string' ? source.trim() : '';
    if (text) out.push({ key, source: text });
  };
  for (const field of COMPASS_TRANSLATABLE_MODULE_FIELDS) push(`m.${field}`, module[field]);
  for (const q of questions) {
    push(`q.${q.id}.prompt`, q.prompt);
    push(`q.${q.id}.help`, q.help_text);
    for (const c of q.choices ?? []) {
      if (!c || typeof c.value !== 'string') continue;
      push(`q.${q.id}.c.${c.value}`, c.label);
    }
  }
  for (const b of module.result_buckets ?? []) {
    if (!b || typeof b.key !== 'string') continue;
    push(`b.${b.key}.title`, b.title);
    push(`b.${b.key}.body`, b.body);
    (b.tips ?? []).forEach((tip, i) => push(`b.${b.key}.tip.${i}`, tip));
    push(`b.${b.key}.cta`, b.cta?.label);
  }
  return out;
}

export type CompassTranslationEntryState = 'missing' | 'stale' | 'ok';

/** Läget för en text: saknas, källan ändrad sedan översättningen, eller klar. */
export function compassTranslationEntryState(
  entry: CompassTranslationEntry,
  stored: Pick<StoredCompassTranslation, 'texts' | 'sources'> | undefined
): CompassTranslationEntryState {
  const text = stored?.texts[entry.key];
  if (!text) return 'missing';
  const hash = stored?.sources[entry.key];
  if (hash && hash !== compassSourceHash(entry.source)) return 'stale';
  return 'ok';
}

/** Texter som saknar engelska eller vars svenska källa ändrats. */
export function compassEntriesToTranslate(
  entries: CompassTranslationEntry[],
  stored: Pick<StoredCompassTranslation, 'texts' | 'sources'> | undefined
): CompassTranslationEntry[] {
  return entries.filter((e) => compassTranslationEntryState(e, stored) !== 'ok');
}

/**
 * Slår ihop nya översättningar med de sparade. Bara nycklar som finns i
 * modulen nu behålls (texter för borttagna frågor rensas). En ny text får
 * hashen av sin nuvarande svenska källa; en text som INTE översattes nu
 * behåller sin gamla hash — är källan ändrad förblir den "stale" och
 * översätts vid nästa försök, och den äldre engelskan visas under tiden.
 */
export function mergeCompassTranslation(
  entries: CompassTranslationEntry[],
  stored: Pick<StoredCompassTranslation, 'texts' | 'sources'> | undefined,
  fresh: Record<string, unknown>,
  updatedAt?: string
): StoredCompassTranslation {
  const texts: Record<string, string> = {};
  const sources: Record<string, string> = {};
  for (const e of entries) {
    const next = cleanTranslationText(fresh[e.key]);
    if (next) {
      texts[e.key] = next;
      sources[e.key] = compassSourceHash(e.source);
      continue;
    }
    const prev = stored?.texts[e.key];
    if (prev) {
      texts[e.key] = prev;
      const hash = stored?.sources[e.key];
      if (hash) sources[e.key] = hash;
    }
  }
  return { texts, sources, updated_at: updatedAt };
}

// ── Tillämpa ───────────────────────────────────────────────────────────────

const pick = (texts: Record<string, string>, key: string, fallback: string): string => {
  const t = texts[key];
  return typeof t === 'string' && t.trim() ? t : fallback;
};

/** Modulens besökartexter på engelska (saknad text ⇒ svenskan). */
export function applyCompassModuleTranslation<M extends TranslatableModule>(
  module: M,
  texts: Record<string, string>
): M {
  const out = { ...module } as M & Record<string, unknown>;
  for (const field of COMPASS_TRANSLATABLE_MODULE_FIELDS) {
    const current = module[field];
    if (typeof current === 'string' && current.trim()) {
      (out as Record<string, unknown>)[field] = pick(texts, `m.${field}`, current);
    }
  }
  if (Array.isArray(module.result_buckets)) {
    (out as Record<string, unknown>).result_buckets = module.result_buckets.map((b) =>
      translateResultBucket(b, texts)
    );
  }
  return out;
}

/** Frågornas texter på engelska — `value` och poäng rörs aldrig (svaren lagras på värdet). */
export function applyCompassQuestionTranslation<Q extends TranslatableQuestion>(
  questions: Q[],
  texts: Record<string, string>
): Q[] {
  return questions.map((q) => ({
    ...q,
    prompt: pick(texts, `q.${q.id}.prompt`, q.prompt),
    help_text: q.help_text ? pick(texts, `q.${q.id}.help`, q.help_text) : q.help_text,
    choices: Array.isArray(q.choices)
      ? q.choices.map((c) => ({ ...c, label: pick(texts, `q.${q.id}.c.${c.value}`, c.label) }))
      : q.choices
  }));
}

/** En resultatprofil på engelska (nyckel, länk och poänggränser oförändrade). */
export function translateResultBucket<B extends ResultBucket | null | undefined>(
  bucket: B,
  texts: Record<string, string>
): B {
  if (!bucket) return bucket;
  const k = bucket.key;
  return {
    ...bucket,
    title: pick(texts, `b.${k}.title`, bucket.title),
    body: pick(texts, `b.${k}.body`, bucket.body),
    tips: Array.isArray(bucket.tips) ? bucket.tips.map((t, i) => pick(texts, `b.${k}.tip.${i}`, t)) : bucket.tips,
    cta: bucket.cta ? { ...bucket.cta, label: pick(texts, `b.${k}.cta`, bucket.cta.label) } : bucket.cta
  };
}

/**
 * De sparade engelska texterna när besökaren valt engelska — annars null
 * (svenska visas). En nyckel som ännu inte översatts faller tillbaka på
 * svenskan i `apply…`-funktionerna.
 */
export function storedEnglishTexts(raw: unknown, locale: CompassLocale): Record<string, string> | null {
  if (locale !== 'en') return null;
  return normalizeCompassTranslations(raw).en?.texts ?? {};
}

// ── Gränssnittet ───────────────────────────────────────────────────────────

export interface CompassUiStrings {
  language: string;
  /** Visas på den engelska sidan — texten är maskinöversatt, svenskan är originalet. */
  autoTranslated: string;
  beforeWeStart: string;
  /** Startsidans rubrik när modulen inte angett någon. */
  startPageTitle: string;
  dataHandling: string;
  flowLabel: Record<'chat' | 'quiz' | 'wizard', string>;
  flowWord: Record<'chat' | 'quiz' | 'wizard', string>;
  startUnderstand: string;
  start: string;
  footChat: string;
  footForm: string;
  nextStep: string;
  continueNext: string;
  doneContinue: string;
  noQuestionsWizard: string;
  noQuestionsQuiz: string;
  thanksAnswers: string;
  thanksDefault: string;
  redirecting: string;
  requiredField: string;
  pickAnswer: string;
  almostDone: string;
  questionOf: (n: number, total: number) => string;
  back: string;
  next: string;
  submit: string;
  submitting: string;
  somethingWrong: string;
  serverStatus: (status: number) => string;
  yourResult: string;
  thanksForAnswers: string;
  creatingPdf: string;
  downloadResult: string;
  pdfFailed: string;
  calculating: string;
  showResult: string;
  yourDetails: string;
  requiredNote: string;
  choose: string;
  chooseOptional: string;
  attachmentsInPreview: string;
  teamPlaceholder: string;
  websitePlaceholder: string;
  maxFiles: (n: number) => string;
  uploadFailedStatus: (status: number) => string;
  uploadFailed: string;
  removeFailed: string;
  remove: string;
  removeFile: (name: string) => string;
  uploading: string;
  attachMore: string;
  chooseFiles: string;
  dropHint: (n: number) => string;
  attachmentError: Record<'empty' | 'too_large' | 'type', string>;
  howToProceed: string;
  contactMe: { label: string; hint: string };
  selfReach: { label: string; hint: string };
  chatEnded: string;
  closingTitle: string;
  summaryNeedsEmail: string;
  sendSummary: string;
  greeting: (name: string) => string;
  chatProvider: string;
  aiBadge: string;
  typing: string;
  thanksDetails: string;
  chatThanksDefault: string;
  summarySent: (email: string) => string;
  summaryEmailFailed: (reason: string) => string;
  downloadSummary: string;
  aiDisclaimer: string;
  chatEndedThanks: string;
  finishChat: string;
  finishChatTitle: string;
  inputEnded: string;
  inputPlaceholder: string;
  inputAria: string;
  send: string;
  noReply: string;
  requiredQuestion: (prompt: string) => string;
}

export const COMPASS_UI: Record<CompassLocale, CompassUiStrings> = {
  sv: {
    language: 'Språk',
    autoTranslated: 'Automatiskt översatt från svenska.',
    beforeWeStart: 'Innan vi börjar',
    startPageTitle: 'Innan du börjar',
    dataHandling: 'Så hanterar vi dina uppgifter',
    flowLabel: { chat: 'AI-assisterad chatt', quiz: 'Quiz', wizard: 'Formulär' },
    flowWord: { chat: 'AI-chatt', quiz: 'Quiz', wizard: 'Formulär' },
    startUnderstand: 'Jag förstår, starta',
    start: 'Starta',
    footChat: 'Drivs av Mistral / Le Chat (EU-suveränt) · Genererat av AI – verifiera innan delning',
    footForm: 'Dina svar hanteras inom EU och delas aldrig vidare.',
    nextStep: 'Nästa steg',
    continueNext: 'Fortsätt till nästa steg',
    doneContinue: 'Klar? Gå vidare till nästa steg.',
    noQuestionsWizard: 'Den här modulen har inga frågor publicerade ännu.',
    noQuestionsQuiz: 'Det här quizet har inga frågor publicerade ännu.',
    thanksAnswers: 'Tack — vi har dina svar.',
    thanksDefault: 'En människa från Movexum tittar på din ansökan och hör av sig inom 3 arbetsdagar.',
    redirecting: 'Du skickas vidare till',
    requiredField: 'Det här fältet är obligatoriskt.',
    pickAnswer: 'Välj ett svar för att gå vidare.',
    almostDone: 'Snart klar',
    questionOf: (n, total) => `Fråga ${n} av ${total}`,
    back: '← Tillbaka',
    next: 'Nästa →',
    submit: 'Skicka in →',
    submitting: 'Skickar…',
    somethingWrong: 'Något gick fel',
    serverStatus: (status) => `Servern svarade ${status}`,
    yourResult: 'Ditt resultat',
    thanksForAnswers: 'Tack för dina svar!',
    creatingPdf: 'Skapar PDF…',
    downloadResult: '↓ Ladda ner mitt resultat (PDF)',
    pdfFailed: 'Kunde inte skapa PDF:en. Försök igen.',
    calculating: 'Beräknar…',
    showResult: 'Visa mitt resultat →',
    yourDetails: 'Dina uppgifter',
    requiredNote:
      'Fält märkta * är obligatoriska. Vi hanterar dina uppgifter inom EU och delar dem aldrig vidare.',
    choose: 'Välj …',
    chooseOptional: 'Välj (frivilligt)',
    attachmentsInPreview: 'Bilagor laddas upp i den publicerade modulen — inte i förhandsgranskningen.',
    teamPlaceholder: 'Anna Andersson, anna@exempel.se\nBo Berg, bo@exempel.se',
    websitePlaceholder: 'www.exempel.se',
    maxFiles: (n) => `Du kan bifoga högst ${n} filer.`,
    uploadFailedStatus: (status) => `Uppladdningen misslyckades (HTTP ${status}).`,
    uploadFailed: 'Uppladdningen misslyckades.',
    removeFailed: 'Filen kunde inte tas bort.',
    remove: 'Ta bort',
    removeFile: (name) => `Ta bort ${name}`,
    uploading: 'Laddar upp …',
    attachMore: 'Bifoga fler filer',
    chooseFiles: 'Välj filer att bifoga',
    dropHint: (n) => `eller dra och släpp här · högst ${n} filer`,
    attachmentError: {
      empty: 'Filen är tom.',
      too_large: 'Filen är för stor (högst 25 MB).',
      type: 'Filtypen stöds inte. Använd PDF, PowerPoint, Word, Excel eller en bild.'
    },
    howToProceed: 'Hur vill du gå vidare?',
    contactMe: {
      label: 'Jag vill att Movexum kontaktar mig',
      hint: 'Någon från Movexum hör av sig på dina kontaktuppgifter.'
    },
    selfReach: {
      label: 'Jag hör av mig själv när jag är redo',
      hint: 'Vi väntar på dig — ingen kontakt från oss.'
    },
    chatEnded: 'Samtalet är avslutat',
    closingTitle: 'Några uppgifter innan vi rundar av',
    summaryNeedsEmail:
      'Ange en e-postadress för att få sammanfattningen skickad — eller bocka ur valet.',
    sendSummary: 'Skicka sammanfattningen av samtalet till min e-post',
    greeting: (name) =>
      `Hej! Jag är ${name}. Berätta gärna lite om idén du går och funderar på — vad försöker du lösa, och för vem?`,
    chatProvider: 'Mistral · Le Chat · EU-suveränt',
    aiBadge: 'AI-ASSISTENT',
    typing: 'Assistenten skriver',
    thanksDetails: 'Tack — vi har dina uppgifter.',
    chatThanksDefault: 'En människa från Movexum tittar på det du berättat och hör av sig om du bett om det.',
    summarySent: (email) => `Sammanfattningen är skickad till ${email}.`,
    summaryEmailFailed: (reason) => `Sammanfattningen kunde inte mejlas (${reason}) — ladda ner den i stället.`,
    downloadSummary: 'Ladda ner sammanfattning (PDF)',
    aiDisclaimer: 'Genererat av AI – verifiera innan delning.',
    chatEndedThanks: 'Samtalet är avslutat — tack för att du delade din idé.',
    finishChat: 'Avsluta',
    finishChatTitle: 'Avsluta samtalet och lämna dina uppgifter',
    inputEnded: 'Samtalet är avslutat',
    inputPlaceholder: 'Skriv ditt svar…',
    inputAria: 'Ditt meddelande',
    send: 'Skicka →',
    noReply: 'Ingen replik från servern',
    requiredQuestion: (prompt) => `Fältet "${prompt}" är obligatoriskt.`
  },
  en: {
    language: 'Language',
    autoTranslated: 'Automatically translated from Swedish.',
    beforeWeStart: 'Before we start',
    startPageTitle: 'Before you start',
    dataHandling: 'How we handle your information',
    flowLabel: { chat: 'AI-assisted chat', quiz: 'Quiz', wizard: 'Form' },
    flowWord: { chat: 'AI chat', quiz: 'Quiz', wizard: 'Form' },
    startUnderstand: 'I understand, start',
    start: 'Start',
    footChat: 'Powered by Mistral / Le Chat (EU-sovereign) · AI-generated – verify before sharing',
    footForm: 'Your answers are handled within the EU and never shared with third parties.',
    nextStep: 'Next step',
    continueNext: 'Continue to the next step',
    doneContinue: 'Done? Continue to the next step.',
    noQuestionsWizard: 'This module has no published questions yet.',
    noQuestionsQuiz: 'This quiz has no published questions yet.',
    thanksAnswers: 'Thank you — we have your answers.',
    thanksDefault: 'Someone from Movexum will look at your application and get back to you within 3 working days.',
    redirecting: 'Redirecting you to',
    requiredField: 'This field is required.',
    pickAnswer: 'Choose an answer to continue.',
    almostDone: 'Almost done',
    questionOf: (n, total) => `Question ${n} of ${total}`,
    back: '← Back',
    next: 'Next →',
    submit: 'Submit →',
    submitting: 'Sending…',
    somethingWrong: 'Something went wrong',
    serverStatus: (status) => `The server responded ${status}`,
    yourResult: 'Your result',
    thanksForAnswers: 'Thank you for your answers!',
    creatingPdf: 'Creating PDF…',
    downloadResult: '↓ Download my result (PDF)',
    pdfFailed: 'Could not create the PDF. Please try again.',
    calculating: 'Calculating…',
    showResult: 'Show my result →',
    yourDetails: 'Your details',
    requiredNote:
      'Fields marked * are required. We handle your information within the EU and never share it with third parties.',
    choose: 'Choose …',
    chooseOptional: 'Choose (optional)',
    attachmentsInPreview: 'Attachments are uploaded in the published module — not in the preview.',
    teamPlaceholder: 'Anna Andersson, anna@example.com\nBo Berg, bo@example.com',
    websitePlaceholder: 'www.example.com',
    maxFiles: (n) => `You can attach at most ${n} files.`,
    uploadFailedStatus: (status) => `The upload failed (HTTP ${status}).`,
    uploadFailed: 'The upload failed.',
    removeFailed: 'The file could not be removed.',
    remove: 'Remove',
    removeFile: (name) => `Remove ${name}`,
    uploading: 'Uploading …',
    attachMore: 'Attach more files',
    chooseFiles: 'Choose files to attach',
    dropHint: (n) => `or drag and drop here · max ${n} files`,
    attachmentError: {
      empty: 'The file is empty.',
      too_large: 'The file is too large (max 25 MB).',
      type: 'File type not supported. Use PDF, PowerPoint, Word, Excel or an image.'
    },
    howToProceed: 'How would you like to proceed?',
    contactMe: {
      label: 'I would like Movexum to contact me',
      hint: 'Someone from Movexum will get in touch using your contact details.'
    },
    selfReach: {
      label: "I'll get in touch myself when I'm ready",
      hint: "We'll wait for you — no contact from us."
    },
    chatEnded: 'The conversation has ended',
    closingTitle: 'A few details before we wrap up',
    summaryNeedsEmail: 'Enter an email address to receive the summary — or untick the option.',
    sendSummary: 'Send the summary of the conversation to my email',
    greeting: (name) =>
      `Hi! I'm ${name}. Tell me a little about the idea you've been thinking about — what are you trying to solve, and for whom?`,
    chatProvider: 'Mistral · Le Chat · EU-sovereign',
    aiBadge: 'AI ASSISTANT',
    typing: 'The assistant is typing',
    thanksDetails: 'Thank you — we have your details.',
    chatThanksDefault: "Someone from Movexum will look at what you've shared and get in touch if you asked us to.",
    summarySent: (email) => `The summary has been sent to ${email}.`,
    summaryEmailFailed: (reason) => `The summary could not be emailed (${reason}) — download it instead.`,
    downloadSummary: 'Download summary (PDF)',
    aiDisclaimer: 'AI-generated – verify before sharing.',
    chatEndedThanks: 'The conversation has ended — thank you for sharing your idea.',
    finishChat: 'Finish',
    finishChatTitle: 'End the conversation and leave your details',
    inputEnded: 'The conversation has ended',
    inputPlaceholder: 'Type your answer…',
    inputAria: 'Your message',
    send: 'Send →',
    noReply: 'No reply from the server',
    requiredQuestion: (prompt) => `The field "${prompt}" is required.`
  }
};

export function compassUi(locale: CompassLocale | undefined): CompassUiStrings {
  return COMPASS_UI[locale === 'en' ? 'en' : 'sv'];
}
