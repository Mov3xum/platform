// E-postkampanjer (CLAUDE.md § 55) — ren, IO-fri domänlogik.
//
// En kampanj är ETT utskick (eller en sparad mall): ämne, förhandsrad,
// avsändare, kategori, mottagarurval och innehållsblock som renderas
// server-side till tabellbaserad HTML + ren text (email-render.ts). Modellen
// skriver aldrig HTML själv och plattformen lagrar aldrig mottagarnas
// e-postadresser på kampanjen — bara deltagar-/kontaktrelationer, en hash för
// webhook-matchning och räknare.
//
// Leveransbarhet är designmålet: ett mejl som ser ut som ett personligt
// mejl från en person på Movexum (layout `plain`, få bilder, få länkar, riktig
// svarsadress) hamnar i Primär; ett bildtungt nyhetsbrev hamnar i Kampanjer
// oavsett avsändare. `checkEmailDeliverability` varnar för det som brukar
// klassas som skräppost INNAN utskicket.

import { isEmailMediaPath } from './email-media';
import type { InviteReason } from './event-invitations';

// ── Kategorier (preferenscentret) ───────────────────────────────────────────

/**
 * Vad mottagaren kan välja att få. `events` = inbjudningar (samma som
 * `contacts.invite_opt_out`, § 53.5), `newsletter` = nyhetsbrev (kräver
 * samtycke för privatpersoner), `program` = information till bolag i
 * programmet, `other` = övrigt. En-klicksavregistrering (RFC 8058) stänger av
 * ALLT — mottagaren förväntar sig att sluta få mejl.
 */
export const EMAIL_CATEGORIES = ['events', 'newsletter', 'program', 'other'] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

export const EMAIL_CATEGORY_LABELS: Record<EmailCategory, string> = {
  events: 'Event & inbjudningar',
  newsletter: 'Nyhetsbrev',
  program: 'Programinformation',
  other: 'Övrigt'
};

export const EMAIL_CATEGORY_DESCRIPTIONS: Record<EmailCategory, string> = {
  events: 'Inbjudningar och påminnelser om Movexums event och träffar.',
  newsletter: 'Nyheter från Movexum och startupscenen i regionen.',
  program: 'Information som rör inkubatorprogrammet.',
  other: 'Enstaka utskick som inte passar in någon annanstans.'
};

export function isEmailCategory(v: unknown): v is EmailCategory {
  return typeof v === 'string' && (EMAIL_CATEGORIES as readonly string[]).includes(v);
}

// ── Status ───────────────────────────────────────────────────────────────────

export const EMAIL_CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'cancelled'] as const;
export type EmailCampaignStatus = (typeof EMAIL_CAMPAIGN_STATUSES)[number];

export const EMAIL_CAMPAIGN_STATUS_LABELS: Record<EmailCampaignStatus, string> = {
  draft: 'Utkast',
  scheduled: 'Schemalagd',
  sending: 'Skickas',
  sent: 'Skickad',
  cancelled: 'Avbruten'
};

export function isEmailCampaignStatus(v: unknown): v is EmailCampaignStatus {
  return typeof v === 'string' && (EMAIL_CAMPAIGN_STATUSES as readonly string[]).includes(v);
}

/** Innehållet får ändras bara så länge inget skickats. */
export function campaignEditable(status: EmailCampaignStatus): boolean {
  return status === 'draft' || status === 'scheduled';
}

// ── Rättslig grund per utskick ─────────────────────────────────────────────

/**
 * `legitimate_interest` — B2B-kontakter i kontaktnätet får mejlet på
 * berättigat intresse med avregistrering i varje mejl (beslut 2026-10,
 * § 53.5). `consent_only` — bara kontakter som uttryckligen tackat ja till
 * nyhetsbrev (`newsletter_consent`, dubbel opt-in § 55.9); krävs för
 * nyhetsbrev till privatpersoner enligt marknadsföringslagen.
 */
export const EMAIL_CONSENT_MODES = ['legitimate_interest', 'consent_only'] as const;
export type EmailConsentMode = (typeof EMAIL_CONSENT_MODES)[number];

export const EMAIL_CONSENT_MODE_LABELS: Record<EmailConsentMode, string> = {
  legitimate_interest: 'Berättigat intresse (B2B-kontakter, avregistrering i varje mejl)',
  consent_only: 'Bara samtycke (mottagare som själva tackat ja till nyhetsbrev)'
};

export function isEmailConsentMode(v: unknown): v is EmailConsentMode {
  return typeof v === 'string' && (EMAIL_CONSENT_MODES as readonly string[]).includes(v);
}

export function defaultConsentMode(category: EmailCategory): EmailConsentMode {
  return category === 'newsletter' ? 'consent_only' : 'legitimate_interest';
}

// ── Mottagarstatus ──────────────────────────────────────────────────────────

export const EMAIL_RECIPIENT_STATUSES = [
  'pending',
  'sent',
  'failed',
  'bounced',
  'complained',
  'unsubscribed',
  'suppressed'
] as const;
export type EmailRecipientStatus = (typeof EMAIL_RECIPIENT_STATUSES)[number];

export const EMAIL_RECIPIENT_STATUS_LABELS: Record<EmailRecipientStatus, string> = {
  pending: 'Väntar',
  sent: 'Skickat',
  failed: 'Misslyckades',
  bounced: 'Studsade',
  complained: 'Markerade som skräppost',
  unsubscribed: 'Avregistrerade sig',
  suppressed: 'Spärrad — skickades inte'
};

// ── Leveransstatus från leverantören (§ 55.4) ───────────────────────────────

/**
 * Vad Resend själva säger om ett mejl EFTER att vi lämnat det ifrån oss
 * (`GET /emails/{id}` → `last_event`). "Skickat" i vår statistik betyder bara
 * att Resend tog emot mejlet; först `delivered` betyder att mottagarens
 * server tagit emot det. Hämtas på begäran ("Uppdatera leveransstatus") så
 * personalen får svar på "kom det fram?" även utan webhook.
 */
export const EMAIL_DELIVERY_STATUSES = ['queued', 'scheduled', 'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'canceled'] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

export const EMAIL_DELIVERY_STATUS_LABELS: Record<EmailDeliveryStatus, string> = {
  queued: 'Köat hos Resend',
  scheduled: 'Schemalagt hos Resend',
  sent: 'Skickat från Resend — inte bekräftat levererat än',
  delivered: 'Levererat till mottagarens server',
  delivery_delayed: 'Fördröjt — mottagarens server svarar inte än',
  bounced: 'Studsade',
  complained: 'Markerat som skräppost',
  failed: 'Misslyckades hos Resend',
  canceled: 'Avbrutet hos Resend'
};

/** Resends `last_event` (`delivered`, `bounced`, `opened` …) → vår status. Okänt ⇒ null. */
export function deliveryStatusFromProviderEvent(lastEvent: unknown): EmailDeliveryStatus | null {
  if (typeof lastEvent !== 'string') return null;
  const e = lastEvent.trim().toLowerCase().replace(/^email\./, '');
  // Öppnat/klickat förutsätter leverans — vi mäter inte öppningar själva.
  if (e === 'opened' || e === 'clicked') return 'delivered';
  if (e === 'bounce') return 'bounced';
  if (e === 'complaint') return 'complained';
  if (e === 'cancelled') return 'canceled';
  return (EMAIL_DELIVERY_STATUSES as readonly string[]).includes(e) ? (e as EmailDeliveryStatus) : null;
}

/** Status som inte ändras längre — behöver inte hämtas igen. */
export function isFinalDeliveryStatus(s: EmailDeliveryStatus | null | undefined): boolean {
  return s === 'delivered' || s === 'bounced' || s === 'complained' || s === 'failed' || s === 'canceled';
}

export interface EmailDeliverySummary {
  checked: number;
  delivered: number;
  pending: number;
  bounced: number;
  complained: number;
  failed: number;
  unchecked: number;
}

/** Sammanfattning av leveransstatusen över skickade mottagarrader. */
export function summarizeDeliveryStatuses(rows: readonly { status: string; delivery_status?: string | null }[]): EmailDeliverySummary {
  const out: EmailDeliverySummary = { checked: 0, delivered: 0, pending: 0, bounced: 0, complained: 0, failed: 0, unchecked: 0 };
  for (const r of rows) {
    if (r.status !== 'sent' && r.status !== 'bounced' && r.status !== 'complained') continue;
    const d = deliveryStatusFromProviderEvent(r.delivery_status);
    if (!d) {
      out.unchecked++;
      continue;
    }
    out.checked++;
    if (d === 'delivered') out.delivered++;
    else if (d === 'bounced') out.bounced++;
    else if (d === 'complained') out.complained++;
    else if (d === 'failed' || d === 'canceled') out.failed++;
    else out.pending++;
  }
  return out;
}

// ── Spärrlista ──────────────────────────────────────────────────────────────

/**
 * Varför en adress är spärrad. `bounce` = hård studs (adressen finns inte),
 * `complaint` = spamklagomål, `unsubscribe` = avregistrering utanför
 * kontaktboken (t.ex. en adress som inte är kontakt), `import` = Mailchimps
 * avregistrerade/rensade listor vid bytet, `manual` = personalen.
 */
export const EMAIL_SUPPRESSION_REASONS = ['bounce', 'complaint', 'unsubscribe', 'import', 'manual'] as const;
export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number];

export const EMAIL_SUPPRESSION_REASON_LABELS: Record<EmailSuppressionReason, string> = {
  bounce: 'Studsade (adressen finns inte)',
  complaint: 'Spamklagomål',
  unsubscribe: 'Avregistrerad',
  import: 'Importerad spärr (t.ex. Mailchimp)',
  manual: 'Spärrad av personalen'
};

export function isEmailSuppressionReason(v: unknown): v is EmailSuppressionReason {
  return typeof v === 'string' && (EMAIL_SUPPRESSION_REASONS as readonly string[]).includes(v);
}

/** Kontaktens synliga e-poststatus (`contacts.email_status`). Tomt = ok. */
export const CONTACT_EMAIL_STATUSES = ['bounced', 'complained', 'unsubscribed'] as const;
export type ContactEmailStatus = (typeof CONTACT_EMAIL_STATUSES)[number];

export const CONTACT_EMAIL_STATUS_LABELS: Record<ContactEmailStatus, string> = {
  bounced: 'E-posten studsar',
  complained: 'Markerade oss som skräppost',
  unsubscribed: 'Avregistrerad från utskick'
};

export function isContactEmailStatus(v: unknown): v is ContactEmailStatus {
  return typeof v === 'string' && (CONTACT_EMAIL_STATUSES as readonly string[]).includes(v);
}

export function contactEmailStatusForReason(reason: EmailSuppressionReason): ContactEmailStatus {
  if (reason === 'bounce') return 'bounced';
  if (reason === 'complaint') return 'complained';
  return 'unsubscribed';
}

/** Normaliserar en adress för hash/dedupe: trim + gemener. Null om ogiltig. */
export function normalizeEmailAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (!v || v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

/** `anna.svensson@example.se` → `a***@example.se` (visas i spärrlistan). */
export function maskEmailAddress(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***@${email.slice(at + 1)}`;
}

// ── Mottagarens val (preferenscentret) ──────────────────────────────────────

export interface EmailPreferenceSource {
  invite_opt_out?: boolean | null;
  /** Kategorier mottagaren stängt av (json-lista). `all` stänger av allt. */
  email_opt_out?: unknown;
  email_status?: string | null;
  newsletter_consent?: boolean | null;
}

export function emailOptOutCategories(source: EmailPreferenceSource): Set<EmailCategory | 'all'> {
  const out = new Set<EmailCategory | 'all'>();
  if (source.invite_opt_out === true) out.add('events');
  if (Array.isArray(source.email_opt_out)) {
    for (const v of source.email_opt_out) {
      if (v === 'all' || isEmailCategory(v)) out.add(v);
    }
  }
  return out;
}

/**
 * Får mottagaren ett mejl i kategorin? Nej vid avregistrering (kategorin
 * eller allt), studs/klagomål, eller när utskicket kräver samtycke som saknas.
 */
export function emailBlockedReason(
  source: EmailPreferenceSource,
  category: EmailCategory,
  consentMode: EmailConsentMode
): 'opt_out' | 'status' | 'no_consent' | null {
  const opt = emailOptOutCategories(source);
  if (opt.has('all') || opt.has(category)) return 'opt_out';
  if (source.email_status === 'bounced' || source.email_status === 'complained' || source.email_status === 'unsubscribed') {
    return 'status';
  }
  if (consentMode === 'consent_only' && source.newsletter_consent !== true) return 'no_consent';
  return null;
}

/** Nästa värde för `email_opt_out` + `invite_opt_out` efter ett val i preferenscentret. */
export function applyEmailPreference(
  source: EmailPreferenceSource,
  change: { category: EmailCategory | 'all'; optOut: boolean }
): { invite_opt_out: boolean; email_opt_out: Array<EmailCategory | 'all'> } {
  const set = emailOptOutCategories(source);
  if (change.category === 'all') {
    if (change.optOut) {
      set.clear();
      set.add('all');
    } else {
      set.clear();
    }
  } else if (change.optOut) {
    set.add(change.category);
  } else {
    set.delete(change.category);
    set.delete('all');
  }
  const email_opt_out = [...set].filter((c) => c !== 'events');
  return { invite_opt_out: set.has('events') || set.has('all'), email_opt_out };
}

// ── Innehållsblock ──────────────────────────────────────────────────────────

export const EMAIL_BLOCK_TYPES = [
  'heading',
  'paragraph',
  'button',
  'image',
  'divider',
  'spacer',
  'event_details',
  'rsvp',
  'ticket',
  'signature'
] as const;
export type EmailBlockType = (typeof EMAIL_BLOCK_TYPES)[number];

export const EMAIL_BLOCK_LABELS: Record<EmailBlockType, string> = {
  heading: 'Rubrik',
  paragraph: 'Text',
  button: 'Knapp',
  image: 'Bild',
  divider: 'Linje',
  spacer: 'Luft',
  event_details: 'Eventuppgifter',
  rsvp: 'Svarsknappar (Jag kommer / Jag kan inte)',
  ticket: 'Biljett & kalender (Visa din biljett)',
  signature: 'Signatur'
};

export type EmailBlock =
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'button'; label: string; url: string; style: 'primary' | 'secondary' }
  | { id: string; type: 'image'; url: string; alt: string; href: string }
  | { id: string; type: 'divider' }
  | { id: string; type: 'spacer'; size: 's' | 'm' | 'l' }
  | { id: string; type: 'event_details' }
  | { id: string; type: 'rsvp' }
  /** "Visa din biljett" + "Lägg i kalendern" — personlig länk till gästens anmälan (§ 55.11). */
  | { id: string; type: 'ticket' }
  | { id: string; type: 'signature'; name: string; title: string };

/** `Omit` som distribuerar över unionen (ett blockutkast utan id). */
export type EmailBlockDraft = EmailBlock extends infer B ? (B extends EmailBlock ? Omit<B, 'id'> : never) : never;

export const EMAIL_MAX_BLOCKS = 40;
export const EMAIL_TEXT_MAX = 4000;
export const EMAIL_SHORT_MAX = 200;
export const EMAIL_SUBJECT_MAX = 150;
export const EMAIL_PREHEADER_MAX = 200;
export const EMAIL_TITLE_MAX = 120;

const ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // Styrtecken (utom radbrytning) bort; radbrytningar behålls i text.
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function cleanLine(v: unknown, max: number): string {
  return cleanText(v, max).replace(/\s+/g, ' ').trim();
}

/**
 * En länk i ett mejl: https (eller http) till en riktig värd, eller en
 * platshållare `{{…}}` som fylls i vid rendering. Aldrig `javascript:`/`data:`.
 */
export function isSafeEmailUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s || s.length > 2000 || /[\s<>"']/.test(s)) return false;
  if (/^\{\{[^}]+\}\}$/.test(s)) return true;
  return /^https?:\/\/[^/]+/i.test(s);
}

let blockSeq = 0;
export function newEmailBlockId(): string {
  blockSeq = (blockSeq + 1) % 100000;
  return `b${Date.now().toString(36)}${blockSeq.toString(36)}`;
}

/**
 * Normaliserar blocklistan från klienten/DB: okända typer och ogiltiga länkar
 * släpps, texter cappas, id:n görs unika. Aldrig ett undantag.
 */
export function normalizeEmailBlocks(raw: unknown): EmailBlock[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: EmailBlock[] = [];
  for (const item of raw) {
    if (out.length >= EMAIL_MAX_BLOCKS) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    let id = typeof r.id === 'string' && ID_RE.test(r.id) ? r.id : newEmailBlockId();
    while (seen.has(id)) id = `${id}-2`.slice(0, 40);
    seen.add(id);
    switch (r.type) {
      case 'heading':
        out.push({ id, type: 'heading', text: cleanLine(r.text, EMAIL_SHORT_MAX) });
        break;
      case 'paragraph':
        out.push({ id, type: 'paragraph', text: cleanText(r.text, EMAIL_TEXT_MAX) });
        break;
      case 'button': {
        const url = typeof r.url === 'string' ? r.url.trim() : '';
        out.push({
          id,
          type: 'button',
          label: cleanLine(r.label, 80),
          url: isSafeEmailUrl(url) ? url : '',
          style: r.style === 'secondary' ? 'secondary' : 'primary'
        });
        break;
      }
      case 'image': {
        const url = typeof r.url === 'string' ? r.url.trim() : '';
        const href = typeof r.href === 'string' ? r.href.trim() : '';
        const isUploadedImage: boolean = isEmailMediaPath(url as unknown);
        out.push({
          id,
          type: 'image',
          // Uppladdad kampanjbild (app-relativ sökväg, § 55.9) eller en absolut https-adress.
          url: isUploadedImage || (isSafeEmailUrl(url) && !url.startsWith('{{')) ? url : '',
          alt: cleanLine(r.alt, EMAIL_SHORT_MAX),
          href: isSafeEmailUrl(href) ? href : ''
        });
        break;
      }
      case 'divider':
        out.push({ id, type: 'divider' });
        break;
      case 'spacer':
        out.push({ id, type: 'spacer', size: r.size === 's' || r.size === 'l' ? r.size : 'm' });
        break;
      case 'event_details':
        out.push({ id, type: 'event_details' });
        break;
      case 'rsvp':
        out.push({ id, type: 'rsvp' });
        break;
      case 'ticket':
        out.push({ id, type: 'ticket' });
        break;
      case 'signature':
        out.push({ id, type: 'signature', name: cleanLine(r.name, 120), title: cleanLine(r.title, 120) });
        break;
      default:
        break;
    }
  }
  return out;
}

export function blocksNeedEvent(blocks: readonly EmailBlock[]): boolean {
  return blocks.some((b) => b.type === 'event_details' || b.type === 'rsvp' || b.type === 'ticket');
}

/** Block med PERSONLIGA länkar till gästens anmälan — kräver en rad i eventets deltagarlista per mottagare. */
export function blocksNeedSignup(blocks: readonly EmailBlock[]): boolean {
  return blocks.some((b) => b.type === 'rsvp' || b.type === 'ticket');
}

// ── Utseende ─────────────────────────────────────────────────────────────────

/** Accentfärger = Movexums brand-tokens (§ 2.2) — mejl kräver hex. */
export const EMAIL_ACCENTS = ['morkbla', 'djupbla', 'morklila', 'lila', 'morkgron', 'gron', 'morkorange'] as const;
export type EmailAccent = (typeof EMAIL_ACCENTS)[number];

export const EMAIL_ACCENT_HEX: Record<EmailAccent, string> = {
  morkbla: '#002c40',
  djupbla: '#005470',
  morklila: '#452e75',
  lila: '#6138b5',
  morkgron: '#1d3a1f',
  gron: '#4a7d4a',
  morkorange: '#4b2718'
};

export const EMAIL_ACCENT_LABELS: Record<EmailAccent, string> = {
  morkbla: 'Mörkblå',
  djupbla: 'Djupblå',
  morklila: 'Mörklila',
  lila: 'Movexum lila',
  morkgron: 'Mörkgrön',
  gron: 'Movexum grön',
  morkorange: 'Mörkorange'
};

export function isEmailAccent(v: unknown): v is EmailAccent {
  return typeof v === 'string' && (EMAIL_ACCENTS as readonly string[]).includes(v);
}

/**
 * `card` = brandat kort på ljus bakgrund med wordmark (nyhetsbrev, inbjudan).
 * `plain` = ser ut som ett vanligt mejl från en person: vit bakgrund, ingen
 * ram, inga stora bilder — det som hamnar i Primär.
 */
export const EMAIL_LAYOUTS = ['card', 'plain'] as const;
export type EmailLayout = (typeof EMAIL_LAYOUTS)[number];

export const EMAIL_LAYOUT_LABELS: Record<EmailLayout, string> = {
  card: 'Brandat kort (nyhetsbrev, inbjudan)',
  plain: 'Personligt mejl (vit bakgrund, ser ut som ett vanligt mejl)'
};

export interface EmailDesign {
  accent: EmailAccent;
  layout: EmailLayout;
  /** Visa wordmarken överst (bara `card`). */
  show_logo: boolean;
}

export const DEFAULT_EMAIL_DESIGN: EmailDesign = { accent: 'morkbla', layout: 'card', show_logo: true };

export function normalizeEmailDesign(raw: unknown): EmailDesign {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    accent: isEmailAccent(r.accent) ? r.accent : DEFAULT_EMAIL_DESIGN.accent,
    layout: r.layout === 'plain' ? 'plain' : 'card',
    show_logo: r.show_logo !== false
  };
}

// ── Mottagarurval ────────────────────────────────────────────────────────────

export const EMAIL_AUDIENCE_MAX_KEYS = 5000;

/**
 * Eventets deltagarlista som mottagargrupp (§ 55.3) — DEN röda tråden från
 * inbjudan till uppföljning: samma `event_signups`-rader som svaren, närvaron
 * och målen bygger på. `unsent` = inbjudna som aldrig fått mejlet,
 * `unanswered` = alla som står som inbjudna, `confirmed` = tackat ja eller
 * längre i tratten, `attended` = markerade närvarande (eller längre).
 */
export const EMAIL_EVENT_GROUPS = ['unsent', 'unanswered', 'confirmed', 'attended'] as const;
export type EmailEventGroup = (typeof EMAIL_EVENT_GROUPS)[number];

export const EMAIL_EVENT_GROUP_LABELS: Record<EmailEventGroup, string> = {
  unsent: 'Inbjudna som inte fått mejlet',
  unanswered: 'Inbjudna som inte svarat',
  confirmed: 'Anmälda (tackat ja)',
  attended: 'Närvarande (deltog)'
};

export function isEmailEventGroup(v: unknown): v is EmailEventGroup {
  return typeof v === 'string' && (EMAIL_EVENT_GROUPS as readonly string[]).includes(v);
}

/** Steg i `event_signups` som ingår i respektive grupp (mottagaren måste också ha e-post). */
export function eventGroupMatches(group: EmailEventGroup, row: { stage?: string | null; invite_sent_at?: string | null }): boolean {
  const stage = row.stage ?? '';
  switch (group) {
    case 'unsent':
      return stage === 'invited' && !row.invite_sent_at;
    case 'unanswered':
      return stage === 'invited';
    case 'confirmed':
      return ['signup', 'attended', 'meeting', 'application', 'admitted'].includes(stage);
    case 'attended':
      return ['attended', 'meeting', 'application', 'admitted'].includes(stage);
  }
}

export interface EmailAudience {
  /** Senast visade lista i panelen (`inviteListValue`) — bara bekvämlighet. */
  list: string;
  /** Valda mottagare som `c:<id>` / `u:<id>` / `s:<id>` (`inviteSelectionKey`). */
  keys: string[];
  /** Eventets deltagarlista som grupp (kräver kopplat event); kombineras med `keys`. */
  event_group: EmailEventGroup | null;
}

export function normalizeEmailAudience(raw: unknown): EmailAudience {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const keys = Array.isArray(r.keys)
    ? [...new Set(r.keys.filter((k): k is string => typeof k === 'string' && /^[cus]:[a-zA-Z0-9_-]{1,64}$/.test(k)))].slice(
        0,
        EMAIL_AUDIENCE_MAX_KEYS
      )
    : [];
  return {
    list: typeof r.list === 'string' ? r.list.slice(0, 80) : 'everyone',
    keys,
    event_group: isEmailEventGroup(r.event_group) ? r.event_group : null
  };
}

/** Har urvalet någon mottagarkälla alls? */
export function audienceHasRecipients(a: EmailAudience): boolean {
  return a.keys.length > 0 || a.event_group !== null;
}

// ── Kampanjen ────────────────────────────────────────────────────────────────

export interface EmailCampaignContent {
  title: string;
  subject: string;
  preheader: string;
  category: EmailCategory;
  consent_mode: EmailConsentMode;
  blocks: EmailBlock[];
  design: EmailDesign;
  /** Avsändarens visningsnamn ("Hampus på Movexum"); tomt = organisationens standard. */
  sender_name: string;
  audience: EmailAudience;
}

export interface EmailCampaignInput {
  title?: unknown;
  subject?: unknown;
  preheader?: unknown;
  category?: unknown;
  consent_mode?: unknown;
  blocks?: unknown;
  design?: unknown;
  sender_name?: unknown;
  audience?: unknown;
}

export function normalizeEmailCampaignContent(raw: EmailCampaignInput): EmailCampaignContent {
  const category = isEmailCategory(raw.category) ? raw.category : 'other';
  return {
    title: cleanLine(raw.title, EMAIL_TITLE_MAX),
    subject: cleanLine(raw.subject, EMAIL_SUBJECT_MAX),
    preheader: cleanLine(raw.preheader, EMAIL_PREHEADER_MAX),
    category,
    consent_mode: isEmailConsentMode(raw.consent_mode) ? raw.consent_mode : defaultConsentMode(category),
    blocks: normalizeEmailBlocks(raw.blocks),
    design: normalizeEmailDesign(raw.design),
    sender_name: cleanLine(raw.sender_name, 80),
    audience: normalizeEmailAudience(raw.audience)
  };
}

/** Allt som måste finnas för att SPARA (inte skicka). */
export function validateEmailCampaignDraft(c: EmailCampaignContent): { ok: true } | { ok: false; error: string } {
  if (!c.title) return { ok: false, error: 'Ge utskicket ett internt namn.' };
  if (c.subject.length > EMAIL_SUBJECT_MAX) return { ok: false, error: `Ämnesraden får vara högst ${EMAIL_SUBJECT_MAX} tecken.` };
  return { ok: true };
}

/**
 * Allt som måste finnas för att SKICKA. `hasEvent` = kampanjen är kopplad till
 * ett event (eventblock och svarsknappar kräver det).
 */
export function validateEmailCampaignForSend(
  c: EmailCampaignContent,
  ctx: { hasEvent: boolean; recipients: number }
): { ok: true } | { ok: false; error: string } {
  if (c.audience.event_group && !ctx.hasEvent) {
    return { ok: false, error: 'Mottagargruppen "eventets deltagare" kräver att utskicket är kopplat till ett event.' };
  }
  const draft = validateEmailCampaignDraft(c);
  if (!draft.ok) return draft;
  if (!c.subject) return { ok: false, error: 'Skriv en ämnesrad.' };
  if (c.blocks.length === 0) return { ok: false, error: 'Mejlet har inget innehåll.' };
  if (!c.blocks.some((b) => (b.type === 'paragraph' || b.type === 'heading') && b.text)) {
    return { ok: false, error: 'Mejlet behöver minst en text eller rubrik.' };
  }
  if (blocksNeedEvent(c.blocks) && !ctx.hasEvent) {
    return { ok: false, error: 'Eventuppgifter och svarsknappar kräver att utskicket är kopplat till ett event.' };
  }
  for (const b of c.blocks) {
    if (b.type === 'button' && (!b.url || !b.label)) return { ok: false, error: 'En knapp saknar text eller länk.' };
    // Ett bildblock utan bild (mallens valfria bildplats) renderas inte och
    // stoppar inte utskicket — editorn visar att det är tomt.
  }
  if (ctx.recipients <= 0 && !c.audience.event_group) return { ok: false, error: 'Välj minst en mottagare.' };
  return { ok: true };
}

// ── Platshållare ─────────────────────────────────────────────────────────────

export interface EmailMergeData {
  first_name?: string;
  name?: string;
  organization?: string;
  sender_name?: string;
  event_name?: string;
  event_when?: string;
  event_location?: string;
  /** Publik länk till kopplad utvärdering (/u/<slug>), § 47. */
  survey_url?: string;
}

const MERGE_KEYS: Record<string, keyof EmailMergeData> = {
  förnamn: 'first_name',
  fornamn: 'first_name',
  namn: 'name',
  organisation: 'organization',
  bolag: 'organization',
  avsändare: 'sender_name',
  avsandare: 'sender_name',
  'event.namn': 'event_name',
  'event.tid': 'event_when',
  'event.plats': 'event_location',
  'utvärdering.länk': 'survey_url',
  'utvardering.lank': 'survey_url'
};

export const EMAIL_MERGE_FIELDS: Array<{ token: string; label: string }> = [
  { token: '{{förnamn|du}}', label: 'Förnamn (annars "du")' },
  { token: '{{namn}}', label: 'Hela namnet' },
  { token: '{{organisation}}', label: 'Organisation / bolag' },
  { token: '{{event.namn}}', label: 'Eventets namn' },
  { token: '{{event.tid}}', label: 'Eventets tid' },
  { token: '{{event.plats}}', label: 'Eventets plats' },
  { token: '{{utvärdering.länk}}', label: 'Länk till kopplad utvärdering (enkät)' },
  { token: '{{avsändare}}', label: 'Avsändarens namn' }
];

const MERGE_RE = /\{\{\s*([a-zA-ZåäöÅÄÖ.]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

/**
 * Fyller i `{{förnamn|du}}`, `{{event.namn}}` m.fl. Okända platshållare tas
 * bort (aldrig kvarlämnade måsvingar i ett skickat mejl). Resultatet är ren
 * text — anroparen escapar FÖRE insättning i HTML.
 */
export function renderMergeFields(text: string, data: EmailMergeData): string {
  return text.replace(MERGE_RE, (_m, key: string, fallback?: string) => {
    const field = MERGE_KEYS[key.toLowerCase()];
    const value = field ? (data[field] ?? '').trim() : '';
    return value || (fallback ?? '');
  });
}

/** Exempeldata för förhandsgranskning/testmejl. */
export const EMAIL_SAMPLE_MERGE: EmailMergeData = {
  first_name: 'Anna',
  name: 'Anna Svensson',
  organization: 'Exempelbolaget AB',
  sender_name: 'Movexum',
  event_name: 'Frukostträff: Finansiering 2027',
  event_when: '12 november 2026 08:00',
  event_location: 'Movexum, Gävle',
  survey_url: 'https://app.movexum.se/u/exempel'
};

// ── Mallstrukturer ──────────────────────────────────────────────────────────

export interface EmailTemplateStructure {
  key: string;
  name: string;
  summary: string;
  category: EmailCategory;
  design: EmailDesign;
  /** Mallen innehåller eventblock/svarsknappar och kräver ett kopplat event. */
  needsEvent: boolean;
  subject: string;
  preheader: string;
  blocks: EmailBlockDraft[];
}

const P = (text: string): EmailBlockDraft => ({ type: 'paragraph', text });
const H = (text: string): EmailBlockDraft => ({ type: 'heading', text });
const SIGN: EmailBlockDraft = { type: 'signature', name: '{{avsändare}}', title: 'Movexum' };

export const EMAIL_TEMPLATES: readonly EmailTemplateStructure[] = [
  {
    key: 'event_invite',
    name: 'Eventinbjudan',
    summary: 'Rubrik, eventuppgifter, kort text och svarsknappar. Svaren hamnar direkt i eventets deltagarlista.',
    category: 'events',
    design: { accent: 'morkbla', layout: 'card', show_logo: true },
    needsEvent: true,
    subject: 'Inbjudan: {{event.namn}}',
    preheader: '{{event.tid}} · {{event.plats}} — svara med ett klick.',
    blocks: [
      { type: 'image', url: '', alt: '', href: '' },
      H('{{event.namn}}'),
      { type: 'event_details' },
      P('Hej {{förnamn|du}}!\n\nVi vill gärna se dig på {{event.namn}}. Berätta kort vad träffen handlar om, vem den är för och varför det är värt tiden.'),
      { type: 'rsvp' },
      P('Har du frågor? Svara på det här mejlet.'),
      SIGN
    ]
  },
  {
    key: 'reminder',
    name: 'Påminnelse',
    summary: 'Kort påminnelse till dem som inte svarat, med eventuppgifter och svarsknappar.',
    category: 'events',
    design: { accent: 'morkbla', layout: 'plain', show_logo: false },
    needsEvent: true,
    subject: 'Påminnelse: {{event.namn}}',
    preheader: 'Platserna är begränsade — svara idag.',
    blocks: [
      P('Hej {{förnamn|du}},\n\nen kort påminnelse om {{event.namn}}. Vi har inte fått ditt svar än — hoppas du kan komma!'),
      { type: 'event_details' },
      { type: 'rsvp' },
      SIGN
    ]
  },
  {
    key: 'save_the_date',
    name: 'Save the date',
    summary: 'Tidig förvarning om ett kommande event, utan svarsknappar.',
    category: 'events',
    design: { accent: 'lila', layout: 'card', show_logo: true },
    needsEvent: true,
    subject: 'Save the date: {{event.namn}}',
    preheader: 'Boka {{event.tid}} i kalendern.',
    blocks: [
      { type: 'image', url: '', alt: '', href: '' },
      H('Save the date'),
      { type: 'event_details' },
      P('Vi planerar {{event.namn}} och vill att du bokar in dagen redan nu. Inbjudan med program och anmälan kommer längre fram.'),
      SIGN
    ]
  },
  {
    key: 'confirmed_reminder',
    name: 'Vi ses snart (anmälda)',
    summary: 'Påminnelse till dem som tackat ja: tid, plats, biljett med QR-kod och kalenderfil.',
    category: 'events',
    design: { accent: 'morkbla', layout: 'card', show_logo: true },
    needsEvent: true,
    subject: 'Vi ses snart: {{event.namn}}',
    preheader: '{{event.tid}} · {{event.plats}} — här är din biljett.',
    blocks: [
      H('Vi ses snart, {{förnamn|du}}!'),
      P('En påminnelse om att du är anmäld till {{event.namn}}. Här är allt du behöver.'),
      { type: 'event_details' },
      { type: 'ticket' },
      P('Kan du inte komma ändå? Ändra ditt svar via biljettlänken så kan platsen gå till någon annan.'),
      SIGN
    ]
  },
  {
    key: 'thank_you',
    name: 'Tack och utvärdering',
    summary: 'Tack för deltagandet med länk till den kopplade utvärderingen — steget efter eventet.',
    category: 'events',
    design: { accent: 'gron', layout: 'plain', show_logo: false },
    needsEvent: false,
    subject: 'Tack för att du var med på {{event.namn}}',
    preheader: 'Två minuter för din feedback.',
    blocks: [
      P('Hej {{förnamn|du}},\n\ntack för att du var med på {{event.namn}}! Det var roligt att se så många av er.'),
      P('Vi vill gärna veta vad du tyckte — det tar två minuter och hjälper oss göra nästa träff bättre.'),
      { type: 'button', label: 'Svara på utvärderingen', url: '{{utvärdering.länk}}', style: 'primary' },
      SIGN
    ]
  },
  {
    key: 'newsletter',
    name: 'Nyhetsbrev',
    summary: 'Flera korta notiser med rubrik, text och länk. Kräver samtycke för privatpersoner.',
    category: 'newsletter',
    design: { accent: 'morkbla', layout: 'card', show_logo: true },
    needsEvent: false,
    subject: 'Nytt från Movexum',
    preheader: 'Det viktigaste från inkubatorn den här månaden.',
    blocks: [
      { type: 'image', url: '', alt: '', href: '' },
      H('Nytt från Movexum'),
      P('Hej {{förnamn|du}}! Här är det viktigaste från inkubatorn och startupscenen i regionen.'),
      { type: 'divider' },
      H('Rubrik på första notisen'),
      P('Två till fyra meningar. Vad hände, varför spelar det roll och vad händer nu.'),
      { type: 'button', label: 'Läs mer', url: 'https://', style: 'secondary' },
      { type: 'divider' },
      H('Rubrik på andra notisen'),
      P('Två till fyra meningar.'),
      { type: 'divider' },
      SIGN
    ]
  },
  {
    key: 'personal',
    name: 'Personligt mejl',
    summary: 'Ren text från en person på Movexum, utan kort och bilder — det som oftast hamnar i Primär.',
    category: 'other',
    design: { accent: 'morkbla', layout: 'plain', show_logo: false },
    needsEvent: false,
    subject: '',
    preheader: '',
    blocks: [P('Hej {{förnamn|du}},\n\n'), SIGN]
  }
];

export function emailTemplateByKey(key: unknown): EmailTemplateStructure | null {
  return EMAIL_TEMPLATES.find((t) => t.key === key) ?? null;
}

/** Nya block med egna id:n ur en mallstruktur. */
export function instantiateEmailTemplate(t: EmailTemplateStructure): EmailBlock[] {
  return normalizeEmailBlocks(t.blocks.map((b) => ({ ...b, id: newEmailBlockId() })));
}

// ── Leveransbarhetskontroll ─────────────────────────────────────────────────

export interface DeliverabilityFinding {
  level: 'alert' | 'warn' | 'info';
  text: string;
}

const SPAM_WORDS = [
  'gratis',
  'free',
  'klicka här',
  'click here',
  'garanterat',
  'vinn',
  'winner',
  'kryptovaluta',
  '100%',
  'erbjudande gäller',
  'sista chansen',
  'köp nu',
  'buy now',
  'ingen risk'
];
const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 'rebrand.ly'];

/**
 * Heuristisk kontroll INNAN utskick: det som brukar klassas som skräppost
 * eller kampanj. Inget facit — Gmail/Outlook avgör — men varje punkt är en
 * känd signal. `links` = alla länkar i mejlet (utom avregistrering),
 * `textLength` = antal tecken ren text, `imageCount` = antal bilder.
 */
export function checkEmailDeliverability(input: {
  subject: string;
  preheader: string;
  textLength: number;
  imageCount: number;
  links: readonly string[];
  hasReplyTo: boolean;
  senderName: string;
  layout: EmailLayout;
  category: EmailCategory;
  consentMode: EmailConsentMode;
}): DeliverabilityFinding[] {
  const out: DeliverabilityFinding[] = [];
  const subject = input.subject.trim();
  if (!subject) out.push({ level: 'alert', text: 'Ämnesraden är tom.' });
  if (subject.length > 70) out.push({ level: 'warn', text: 'Ämnesraden är längre än 70 tecken och kapas i de flesta mejlklienter.' });
  const letters = subject.replace(/[^a-zA-ZåäöÅÄÖ]/g, '');
  if (letters.length >= 8 && letters === letters.toUpperCase()) {
    out.push({ level: 'alert', text: 'Ämnesraden är skriven i versaler — en stark skräppostsignal.' });
  }
  if ((subject.match(/!/g) ?? []).length >= 2) out.push({ level: 'warn', text: 'Flera utropstecken i ämnesraden.' });
  if (/\$\$|€€|kr kr/i.test(subject)) out.push({ level: 'warn', text: 'Valutasymboler i ämnesraden triggar skräppostfilter.' });
  const lowerSubject = subject.toLowerCase();
  const hits = SPAM_WORDS.filter((w) => lowerSubject.includes(w));
  if (hits.length > 0) out.push({ level: 'warn', text: `Ord som ofta klassas som skräppost i ämnesraden: ${hits.join(', ')}.` });
  if (!input.preheader) out.push({ level: 'info', text: 'Ingen förhandsrad — mejlklienten visar då början av texten.' });

  if (input.textLength < 80) out.push({ level: 'alert', text: 'Mejlet har mycket lite text. Ett mejl utan text eller med bara en bild klassas ofta som skräppost.' });
  if (input.imageCount > 0 && input.textLength < 300) {
    out.push({ level: 'warn', text: 'Mycket bild i förhållande till text. Skriv mer text eller ta bort bilder.' });
  }
  if (input.imageCount > 3) out.push({ level: 'info', text: 'Fler än tre bilder gör att mejlet oftare hamnar under Kampanjer i Gmail.' });

  const links = input.links.filter(Boolean);
  if (links.length > 8) out.push({ level: 'warn', text: `${links.length} länkar. Många länkar ger fliken Kampanjer eller skräppost — håll dig under åtta.` });
  const short = links.filter((l) => SHORTENERS.some((s) => l.toLowerCase().includes(`//${s}/`) || l.toLowerCase().includes(`.${s}/`)));
  if (short.length > 0) out.push({ level: 'alert', text: 'Länkförkortare (bit.ly m.fl.) blockeras av många skräppostfilter. Länka direkt till sidan.' });
  const insecure = links.filter((l) => /^http:\/\//i.test(l));
  if (insecure.length > 0) out.push({ level: 'warn', text: 'En eller flera länkar går över http (inte https).' });
  const hosts = new Set(
    links
      .map((l) => {
        const m = /^https?:\/\/([^/?#]+)/i.exec(l);
        return m ? m[1]!.toLowerCase() : '';
      })
      .filter(Boolean)
  );
  if (hosts.size > 4) out.push({ level: 'info', text: `Länkar till ${hosts.size} olika domäner. Färre domäner ger ett mer trovärdigt mejl.` });

  if (!input.hasReplyTo) out.push({ level: 'warn', text: 'Ingen riktig svarsadress. Ett mejl från en person med en adress man kan svara till hamnar oftare i Primär.' });
  if (!input.senderName) out.push({ level: 'info', text: 'Ingen avsändare vald — mejlet skickas från organisationens standardnamn.' });
  if (input.layout === 'card' && input.category !== 'newsletter') {
    out.push({ level: 'info', text: 'Brandat kort hamnar oftare under Kampanjer. Välj "Personligt mejl" om det ska se ut som ett mejl från en person.' });
  }
  if (input.category === 'newsletter' && input.consentMode !== 'consent_only') {
    out.push({ level: 'warn', text: 'Nyhetsbrev till privatpersoner kräver samtycke enligt marknadsföringslagen — välj "Bara samtycke" om listan inte är ren B2B.' });
  }
  return out;
}

export function deliverabilityVerdict(findings: readonly DeliverabilityFinding[]): 'ok' | 'warn' | 'alert' {
  if (findings.some((f) => f.level === 'alert')) return 'alert';
  if (findings.some((f) => f.level === 'warn')) return 'warn';
  return 'ok';
}

// ── Statistik ────────────────────────────────────────────────────────────────

export interface EmailCampaignCounts {
  recipients_count?: number | null;
  sent_count?: number | null;
  failed_count?: number | null;
  bounced_count?: number | null;
  complained_count?: number | null;
  unsubscribed_count?: number | null;
  clicked_count?: number | null;
  suppressed_count?: number | null;
}

export interface EmailCampaignRates {
  sent: number;
  delivered: number;
  bounceRate: number | null;
  complaintRate: number | null;
  clickRate: number | null;
  unsubscribeRate: number | null;
}

const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function emailCampaignRates(c: EmailCampaignCounts): EmailCampaignRates {
  const sent = n(c.sent_count);
  const bounced = Math.min(n(c.bounced_count), sent);
  const delivered = Math.max(sent - bounced, 0);
  const rate = (x: number, base: number) => (base > 0 ? x / base : null);
  return {
    sent,
    delivered,
    bounceRate: rate(bounced, sent),
    complaintRate: rate(n(c.complained_count), delivered),
    clickRate: rate(n(c.clicked_count), delivered),
    unsubscribeRate: rate(n(c.unsubscribed_count), delivered)
  };
}

/**
 * Gmails krav på avsändare (2024): spamklagomål under 0,3 %, helst under
 * 0,1 %. Studsar över 2 % tyder på en smutsig lista; över 5 % skadar ryktet.
 */
export const COMPLAINT_RATE_WARN = 0.001;
export const COMPLAINT_RATE_ALERT = 0.003;
export const BOUNCE_RATE_WARN = 0.02;
export const BOUNCE_RATE_ALERT = 0.05;

export function deliverabilityHealth(rates: Pick<EmailCampaignRates, 'bounceRate' | 'complaintRate'>): 'ok' | 'warn' | 'alert' | 'unknown' {
  if (rates.bounceRate === null && rates.complaintRate === null) return 'unknown';
  const b = rates.bounceRate ?? 0;
  const c = rates.complaintRate ?? 0;
  if (c >= COMPLAINT_RATE_ALERT || b >= BOUNCE_RATE_ALERT) return 'alert';
  if (c >= COMPLAINT_RATE_WARN || b >= BOUNCE_RATE_WARN) return 'warn';
  return 'ok';
}

export function formatRate(rate: number | null, decimals = 1): string {
  if (rate === null) return '–';
  return `${(rate * 100).toLocaleString('sv-SE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} %`;
}

/** Varför mottagaren får mejlet (fottexten) ur kampanjkategori + relation. */
export function emailReasonText(reason: InviteReason, category: EmailCategory, consentMode: EmailConsentMode): string {
  if (reason === 'program') return 'Du får det här mejlet eftersom ditt bolag deltar i Movexums inkubatorprogram.';
  if (reason === 'team') return 'Du får det här mejlet som medarbetare hos Movexum.';
  if (consentMode === 'consent_only') return 'Du får det här mejlet eftersom du har tackat ja till Movexums nyhetsbrev.';
  if (category === 'newsletter') return 'Du får det här mejlet eftersom du finns i Movexums kontaktnät.';
  return 'Du får det här mejlet eftersom du finns i Movexums kontaktnät.';
}

// ── Webhook-händelser ───────────────────────────────────────────────────────

export const EMAIL_EVENT_TYPES = ['delivered', 'bounced', 'complained', 'delivery_delayed', 'opened', 'clicked', 'unsubscribed'] as const;
export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];

/**
 * Översätter Resends händelsetyp (`email.bounced` …) till vår. Okänd ⇒ null.
 * `email.opened` kräver spårningspixel, som vi inte använder — ignoreras.
 */
export function emailEventTypeFromProvider(type: unknown): EmailEventType | null {
  if (typeof type !== 'string') return null;
  const t = type.replace(/^email\./, '');
  if (t === 'delivered' || t === 'bounced' || t === 'complained' || t === 'delivery_delayed') return t;
  return null;
}

/**
 * Hård studs = adressen finns inte/avvisas permanent → spärra. Mjuk (full
 * inkorg, tillfälligt fel) → ingen spärr, bara räknad. Resend anger
 * `bounce.type` (`Permanent`/`Transient`) och `subType`.
 */
export function isHardBounce(bounce: unknown): boolean {
  if (!bounce || typeof bounce !== 'object') return true;
  const b = bounce as { type?: unknown; subType?: unknown };
  const type = typeof b.type === 'string' ? b.type.toLowerCase() : '';
  if (type === 'transient' || type === 'undetermined') return false;
  return true;
}
