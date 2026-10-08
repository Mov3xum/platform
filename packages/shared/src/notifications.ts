// Notifikationssystemet (CLAUDE.md § 50) — katalog, inställningar och
// gruppering.
//
// Ren, React-/server-fri domänlogik (enhetstestad i notifications.test.ts)
// som delas av producenterna (`lib/notifications-server.ts`), notislistan,
// klockan i topplisten och inställningssidan under Mitt konto. EN katalog
// styr etikett, ikon, kategori, prioritet, mottagargrupp och standardkanaler
// per notistyp — så att en ny typ dyker upp i inställningarna automatiskt och
// aldrig kräver en schemaändring (`notifications.kind` är text sedan
// migration 1700000186; giltigheten kontrolleras här).

import type { Role } from './index';

// ─── Kategorier ─────────────────────────────────────────────────────────────

export const NOTIFICATION_CATEGORIES = [
  'samarbete',
  'uppgifter',
  'utbildning',
  'kalender',
  'avtal',
  'kontakter',
  'stodcheckar',
  'plattform'
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_META: Record<
  NotificationCategory,
  { label: string; description: string; icon: string }
> = {
  samarbete: {
    label: 'Team & uppdrag',
    description: 'Kommentarer, omnämnanden och ändringar i tvärfunktionella team.',
    icon: 'people'
  },
  uppgifter: {
    label: 'Uppgifter',
    description: 'Kanban-kort som tilldelas dig och deadlines som närmar sig.',
    icon: 'inbox'
  },
  utbildning: {
    label: 'Workshops & dokument',
    description: 'Workshops och utbildningsdokument som tilldelas bolaget.',
    icon: 'cap'
  },
  kalender: {
    label: 'Kalender',
    description: 'Möten och events du bjuds in till.',
    icon: 'calendar'
  },
  avtal: {
    label: 'Avtal',
    description: 'Avtal som väntar på din signatur och avtal som blivit signerade.',
    icon: 'pencil'
  },
  kontakter: {
    label: 'Kontaktboken',
    description: 'Förfrågningar om att använda kontakter och svar på dina förfrågningar.',
    icon: 'user'
  },
  stodcheckar: {
    label: 'Stödcheckar',
    description: 'Ansökningar, kompletteringar, kommentarer och beslut.',
    icon: 'shield'
  },
  plattform: {
    label: 'Plattformen',
    description: 'Svar på dina önskemål och buggrapporter.',
    icon: 'help'
  }
};

// ─── Kanaler ────────────────────────────────────────────────────────────────

/** Leveranskanaler. Bara `in_app` levereras i dag — e-post (Resend), webbpush
 *  och sammanställning kommer i nästa steg och läser samma inställningar. */
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** E-post: av, direkt, eller samlat i sammanställningen. */
export const NOTIFICATION_EMAIL_MODES = ['off', 'instant', 'digest'] as const;
export type NotificationEmailMode = (typeof NOTIFICATION_EMAIL_MODES)[number];

export const NOTIFICATION_PRIORITIES = ['normal', 'high'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

/** Vem en notistyp normalt når — styr vilka typer som visas i inställningarna. */
export type NotificationAudience = 'staff' | 'member' | 'all';

// ─── Katalog ────────────────────────────────────────────────────────────────

export const NOTIFICATION_KINDS = [
  // Team & uppdrag (migration 1700000052)
  'comment',
  'mention',
  'assigned',
  'status_change',
  'stage_advance',
  'collaborator_invited',
  // Uppgifter
  'task_assigned',
  'due_soon',
  // Utbildning
  'workshop_assigned',
  'document_assigned',
  // Kalender
  'event_invited',
  // Avtal
  'agreement_to_sign',
  'agreement_signed',
  // Kontaktboken (§ 45.3)
  'contact_request',
  'contact_decision',
  // Stödcheckar (§ 46)
  'support_check_submitted',
  'support_check_changes',
  'support_check_decision',
  'support_check_comment',
  // Plattformen (§ 49)
  'feedback_answered',
  'feedback_done'
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationKindMeta {
  /** Rubrik i listan ("Ny kommentar"). */
  label: string;
  /** Förklaring i inställningarna ("När någon kommenterar ett uppdrag du är med i"). */
  description: string;
  icon: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  audience: NotificationAudience;
  /** Någon väntar på dig — kan inte stängas av i appen och tystas aldrig. */
  mandatory?: boolean;
  /** Olästa notiser av typen om SAMMA sak slås ihop ("Ny kommentar (3)"). */
  groupable?: boolean;
  defaults: { in_app: boolean; email: NotificationEmailMode; push: boolean };
}

const NORMAL_DEFAULTS = { in_app: true, email: 'digest', push: false } as const;
const HIGH_DEFAULTS = { in_app: true, email: 'instant', push: true } as const;

export const NOTIFICATION_CATALOG: Record<NotificationKind, NotificationKindMeta> = {
  comment: {
    label: 'Ny kommentar',
    description: 'När någon kommenterar ett uppdrag du är med i.',
    icon: 'message',
    category: 'samarbete',
    priority: 'normal',
    audience: 'all',
    groupable: true,
    defaults: NORMAL_DEFAULTS
  },
  mention: {
    label: 'Du blev nämnd',
    description: 'När någon @-nämner dig i en kommentar.',
    icon: 'spark',
    category: 'samarbete',
    priority: 'high',
    audience: 'all',
    defaults: HIGH_DEFAULTS
  },
  assigned: {
    label: 'Tillagd i ett team',
    description: 'När du läggs till som deltagare i ett tvärfunktionellt team eller uppdrag.',
    icon: 'people',
    category: 'samarbete',
    priority: 'normal',
    audience: 'all',
    defaults: NORMAL_DEFAULTS
  },
  status_change: {
    label: 'Status ändrad',
    description: 'När status ändras på ett uppdrag du är med i.',
    icon: 'badge-check',
    category: 'samarbete',
    priority: 'normal',
    audience: 'all',
    groupable: true,
    defaults: NORMAL_DEFAULTS
  },
  stage_advance: {
    label: 'Steg klart',
    description: 'När ett steg bockas av i ett uppdrag du är med i.',
    icon: 'check',
    category: 'samarbete',
    priority: 'normal',
    audience: 'all',
    groupable: true,
    defaults: NORMAL_DEFAULTS
  },
  collaborator_invited: {
    label: 'Inbjuden som medarbetare',
    description: 'När du bjuds in att samarbeta kring en workshop eller ett dokument för ett bolag.',
    icon: 'people',
    category: 'samarbete',
    priority: 'normal',
    audience: 'staff',
    defaults: NORMAL_DEFAULTS
  },
  task_assigned: {
    label: 'Uppgift tilldelad',
    description: 'När du tilldelas ett kort på en bolags- eller uppdragstavla.',
    icon: 'inbox',
    category: 'uppgifter',
    priority: 'normal',
    audience: 'staff',
    defaults: NORMAL_DEFAULTS
  },
  due_soon: {
    label: 'Deadline närmar sig',
    description: 'Påminnelse när en uppgift du äger snart förfaller eller är försenad.',
    icon: 'clock',
    category: 'uppgifter',
    priority: 'normal',
    audience: 'all',
    defaults: NORMAL_DEFAULTS
  },
  workshop_assigned: {
    label: 'Ny workshop',
    description: 'När en workshop tilldelas ditt bolag.',
    icon: 'cap',
    category: 'utbildning',
    priority: 'normal',
    audience: 'member',
    defaults: NORMAL_DEFAULTS
  },
  document_assigned: {
    label: 'Nytt utbildningsdokument',
    description: 'När ett utbildningsdokument tilldelas ditt bolag.',
    icon: 'doc',
    category: 'utbildning',
    priority: 'normal',
    audience: 'member',
    defaults: NORMAL_DEFAULTS
  },
  event_invited: {
    label: 'Inbjudan till möte',
    description: 'När du bjuds in till ett möte eller event.',
    icon: 'calendar',
    category: 'kalender',
    priority: 'normal',
    audience: 'all',
    defaults: NORMAL_DEFAULTS
  },
  agreement_to_sign: {
    label: 'Avtal att signera',
    description: 'När ett avtal väntar på din signatur.',
    icon: 'pencil',
    category: 'avtal',
    priority: 'high',
    audience: 'all',
    mandatory: true,
    defaults: HIGH_DEFAULTS
  },
  agreement_signed: {
    label: 'Avtal signerat',
    description: 'När alla parter har signerat ett avtal du är part i eller har skickat.',
    icon: 'badge-check',
    category: 'avtal',
    priority: 'normal',
    audience: 'all',
    defaults: NORMAL_DEFAULTS
  },
  contact_request: {
    label: 'Förfrågan om kontakt',
    description: 'När en kollega vill använda en kontakt du äger.',
    icon: 'user',
    category: 'kontakter',
    priority: 'high',
    audience: 'staff',
    mandatory: true,
    defaults: HIGH_DEFAULTS
  },
  contact_decision: {
    label: 'Svar på din förfrågan',
    description: 'När kontaktens ägare godkänner eller avböjer din förfrågan.',
    icon: 'check',
    category: 'kontakter',
    priority: 'normal',
    audience: 'staff',
    defaults: NORMAL_DEFAULTS
  },
  support_check_submitted: {
    label: 'Ny ansökan om stödcheck',
    description: 'När ett bolag du coachar skickar in eller kompletterar en ansökan.',
    icon: 'inbox',
    category: 'stodcheckar',
    priority: 'normal',
    audience: 'staff',
    defaults: NORMAL_DEFAULTS
  },
  support_check_changes: {
    label: 'Komplettering begärd',
    description: 'När Movexum ber ditt bolag komplettera en ansökan.',
    icon: 'alert',
    category: 'stodcheckar',
    priority: 'high',
    audience: 'member',
    mandatory: true,
    defaults: HIGH_DEFAULTS
  },
  support_check_decision: {
    label: 'Beslut om stödcheck',
    description: 'När en ansökan beviljas eller avslås.',
    icon: 'shield',
    category: 'stodcheckar',
    priority: 'high',
    audience: 'member',
    mandatory: true,
    defaults: HIGH_DEFAULTS
  },
  support_check_comment: {
    label: 'Kommentar på ansökan',
    description: 'När någon kommenterar en ansökan du är inblandad i.',
    icon: 'message',
    category: 'stodcheckar',
    priority: 'normal',
    audience: 'all',
    groupable: true,
    defaults: NORMAL_DEFAULTS
  },
  feedback_answered: {
    label: 'Svar på ditt önskemål',
    description: 'När ledningen svarar på ett kort du lagt upp under Önskemål & buggar.',
    icon: 'message',
    category: 'plattform',
    priority: 'normal',
    audience: 'staff',
    defaults: NORMAL_DEFAULTS
  },
  feedback_done: {
    label: 'Ditt önskemål är klart',
    description: 'När ett kort du lagt upp markeras som klart.',
    icon: 'check',
    category: 'plattform',
    priority: 'normal',
    audience: 'staff',
    defaults: NORMAL_DEFAULTS
  }
};

/** Notistyper som fanns som select-värden före migration 1700000186. Mot ett
 *  schema där migrationen inte körts faller okända typer tillbaka på
 *  `assigned` så att notisen aldrig tappas tyst. */
export const LEGACY_NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'comment',
  'mention',
  'assigned',
  'status_change',
  'stage_advance',
  'due_soon',
  'contact_request',
  'contact_decision',
  'support_check_submitted',
  'support_check_changes',
  'support_check_decision',
  'support_check_comment'
];

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

const UNKNOWN_KIND_META: NotificationKindMeta = {
  label: 'Notis',
  description: '',
  icon: 'bell',
  category: 'plattform',
  priority: 'normal',
  audience: 'all',
  defaults: NORMAL_DEFAULTS
};

/** Metadata för en notistyp — okända värden (äldre data) får en neutral fallback. */
export function notificationMeta(kind: string): NotificationKindMeta {
  return isNotificationKind(kind) ? NOTIFICATION_CATALOG[kind] : UNKNOWN_KIND_META;
}

// ─── Vilka typer som är relevanta för en roll ───────────────────────────────

const STAFF_LIKE: readonly Role[] = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];

function audienceMatches(audience: NotificationAudience, roles: readonly string[]): boolean {
  if (audience === 'all') return true;
  const staff = roles.some((r) => (STAFF_LIKE as readonly string[]).includes(r));
  const member = roles.includes('startup_member');
  return audience === 'staff' ? staff : member;
}

/** Notistyperna som visas i inställningarna för en användare med dessa roller,
 *  i katalogens ordning. Inställningarna är dynamiska: en ny typ i katalogen
 *  dyker upp här utan ändring i UI:t. */
export function notificationKindsForRoles(roles: readonly string[]): NotificationKind[] {
  return NOTIFICATION_KINDS.filter((k) => audienceMatches(NOTIFICATION_CATALOG[k].audience, roles));
}

/** Samma urval grupperat per kategori (kategorier utan typer utelämnas). */
export function groupNotificationKindsByCategory(
  kinds: readonly NotificationKind[]
): Array<{ category: NotificationCategory; kinds: NotificationKind[] }> {
  return NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    kinds: kinds.filter((k) => NOTIFICATION_CATALOG[k].category === category)
  })).filter((g) => g.kinds.length > 0);
}

// ─── Inställningar per användare ────────────────────────────────────────────

export interface NotificationKindPreference {
  in_app?: boolean;
  email?: NotificationEmailMode;
  push?: boolean;
}

/** En tystad sak ("sluta få notiser om det här uppdraget"). `label` är bara
 *  för visning i inställningarna. */
export interface MutedNotificationEntity {
  type: string;
  id: string;
  label?: string;
}

export const NOTIFICATION_DIGEST_FREQUENCIES = ['off', 'daily', 'weekdays', 'weekly'] as const;
export type NotificationDigestFrequency = (typeof NOTIFICATION_DIGEST_FREQUENCIES)[number];

export interface NotificationDigestSettings {
  frequency: NotificationDigestFrequency;
  /** "HH:MM" i svensk tid (Europe/Stockholm). */
  time: string;
  /** 1 = måndag … 7 = söndag (ISO). Används när frequency = weekly. */
  weekday: number;
}

export interface NotificationPreferences {
  kinds: Partial<Record<NotificationKind, NotificationKindPreference>>;
  muted: MutedNotificationEntity[];
  digest: NotificationDigestSettings;
}

export const DEFAULT_NOTIFICATION_DIGEST: NotificationDigestSettings = {
  frequency: 'daily',
  time: '07:30',
  weekday: 1
};

export const MAX_MUTED_NOTIFICATION_ENTITIES = 200;

export function defaultNotificationPreferences(): NotificationPreferences {
  return { kinds: {}, muted: [], digest: { ...DEFAULT_NOTIFICATION_DIGEST } };
}

const ENTITY_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const ENTITY_TYPE_RE = /^[a-z][a-z0-9_]{0,39}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidNotificationEntity(type: unknown, id: unknown): boolean {
  return typeof type === 'string' && typeof id === 'string' && ENTITY_TYPE_RE.test(type) && ENTITY_ID_RE.test(id);
}

/**
 * Tvättar inställningar från databasen eller klienten till en giltig form.
 * Okända typer/kanaler/värden släpps tyst (lagrad data kan vara äldre än
 * katalogen); tystade saker valideras och dedupliceras. Aldrig ett kast.
 */
export function normalizeNotificationPreferences(raw: unknown): NotificationPreferences {
  const out = defaultNotificationPreferences();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const src = raw as Record<string, unknown>;

  const kinds = src.kinds;
  if (kinds && typeof kinds === 'object' && !Array.isArray(kinds)) {
    for (const [key, value] of Object.entries(kinds as Record<string, unknown>)) {
      if (!isNotificationKind(key) || !value || typeof value !== 'object') continue;
      const v = value as Record<string, unknown>;
      const pref: NotificationKindPreference = {};
      if (typeof v.in_app === 'boolean') pref.in_app = v.in_app;
      if (typeof v.email === 'string' && (NOTIFICATION_EMAIL_MODES as readonly string[]).includes(v.email)) {
        pref.email = v.email as NotificationEmailMode;
      }
      if (typeof v.push === 'boolean') pref.push = v.push;
      if (Object.keys(pref).length > 0) out.kinds[key] = pref;
    }
  }

  if (Array.isArray(src.muted)) {
    const seen = new Set<string>();
    for (const item of src.muted) {
      if (!item || typeof item !== 'object') continue;
      const m = item as Record<string, unknown>;
      if (!isValidNotificationEntity(m.type, m.id)) continue;
      const key = `${m.type}:${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = typeof m.label === 'string' ? m.label.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
      out.muted.push({ type: String(m.type), id: String(m.id), ...(label ? { label } : {}) });
      if (out.muted.length >= MAX_MUTED_NOTIFICATION_ENTITIES) break;
    }
  }

  const digest = src.digest;
  if (digest && typeof digest === 'object' && !Array.isArray(digest)) {
    const d = digest as Record<string, unknown>;
    if (
      typeof d.frequency === 'string' &&
      (NOTIFICATION_DIGEST_FREQUENCIES as readonly string[]).includes(d.frequency)
    ) {
      out.digest.frequency = d.frequency as NotificationDigestFrequency;
    }
    if (typeof d.time === 'string' && TIME_RE.test(d.time)) out.digest.time = d.time;
    if (typeof d.weekday === 'number' && Number.isInteger(d.weekday) && d.weekday >= 1 && d.weekday <= 7) {
      out.digest.weekday = d.weekday;
    }
  }

  return out;
}

/** Den faktiska inställningen för en typ: användarens val ovanpå katalogens
 *  standard. En obligatorisk typ är alltid på i appen. */
export function effectiveNotificationChannels(
  prefs: NotificationPreferences,
  kind: NotificationKind
): { in_app: boolean; email: NotificationEmailMode; push: boolean } {
  const meta = NOTIFICATION_CATALOG[kind];
  const own = prefs.kinds[kind] ?? {};
  return {
    in_app: meta.mandatory ? true : own.in_app ?? meta.defaults.in_app,
    email: own.email ?? meta.defaults.email,
    push: own.push ?? meta.defaults.push
  };
}

export function isNotificationEntityMuted(
  prefs: NotificationPreferences,
  entity: { type: string; id: string } | null | undefined
): boolean {
  if (!entity) return false;
  return prefs.muted.some((m) => m.type === entity.type && m.id === entity.id);
}

/**
 * Ska notisen skapas i mottagarens notislista? Obligatoriska typer går alltid
 * fram (någon väntar på mottagaren) — även för tystade saker.
 */
export function shouldDeliverInApp(
  prefs: NotificationPreferences,
  kind: NotificationKind,
  entity?: { type: string; id: string } | null
): boolean {
  if (NOTIFICATION_CATALOG[kind].mandatory) return true;
  if (!effectiveNotificationChannels(prefs, kind).in_app) return false;
  return !isNotificationEntityMuted(prefs, entity);
}

/** Sätt en kanal för en typ. Tar bort överstyrningen när den sammanfaller med
 *  katalogens standard, så att en framtida ändrad standard får genomslag. */
export function setNotificationKindChannel(
  prefs: NotificationPreferences,
  kind: NotificationKind,
  channel: NotificationChannel,
  value: boolean | NotificationEmailMode
): NotificationPreferences {
  const meta = NOTIFICATION_CATALOG[kind];
  const current: NotificationKindPreference = { ...(prefs.kinds[kind] ?? {}) };
  if (channel === 'email') {
    if (typeof value !== 'string' || !(NOTIFICATION_EMAIL_MODES as readonly string[]).includes(value)) return prefs;
    if (value === meta.defaults.email) delete current.email;
    else current.email = value as NotificationEmailMode;
  } else {
    if (typeof value !== 'boolean') return prefs;
    if (channel === 'in_app' && meta.mandatory) return prefs;
    if (value === meta.defaults[channel]) delete current[channel];
    else current[channel] = value;
  }
  const kinds = { ...prefs.kinds };
  if (Object.keys(current).length === 0) delete kinds[kind];
  else kinds[kind] = current;
  return { ...prefs, kinds };
}

/** Tysta eller sluta tysta en sak. */
export function toggleMutedNotificationEntity(
  prefs: NotificationPreferences,
  entity: MutedNotificationEntity,
  muted: boolean
): NotificationPreferences {
  if (!isValidNotificationEntity(entity.type, entity.id)) return prefs;
  const rest = prefs.muted.filter((m) => !(m.type === entity.type && m.id === entity.id));
  if (!muted) return { ...prefs, muted: rest };
  const label = entity.label?.replace(/\s+/g, ' ').trim().slice(0, 120);
  return {
    ...prefs,
    muted: [{ type: entity.type, id: entity.id, ...(label ? { label } : {}) }, ...rest].slice(
      0,
      MAX_MUTED_NOTIFICATION_ENTITIES
    )
  };
}

// ─── Innehåll, länkar och gruppering ────────────────────────────────────────

export const NOTIFICATION_TITLE_MAX = 200;
export const NOTIFICATION_SNIPPET_MAX = 280;

const PERSONNUMMER_RE = /\b\d{6,8}[-+]?\d{4}\b/g;

/** Plattar, personnummer-tvättar (§ 15.6) och kapar fritext till en notis. */
export function cleanNotificationText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim().replace(PERSONNUMMER_RE, '[REDACTED]');
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * En notis får bara länka INOM appen: en relativ sökväg som börjar med ett
 * snedstreck (aldrig `//host`, `/\host`, `javascript:` eller en extern
 * adress). Annat ersätts med fallbacken — en notis ska aldrig kunna bli en
 * nätfiskelänk.
 */
export function safeNotificationHref(href: unknown, fallback = '/inkorg'): string {
  if (typeof href !== 'string') return fallback;
  const value = href.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  return value.slice(0, 500);
}

/** Antal tidigare händelser som slagits ihop i en grupperad notis, kapat. */
export const NOTIFICATION_GROUP_MAX = 999;

export function nextNotificationGroupCount(current: unknown): number {
  const n = typeof current === 'number' && Number.isFinite(current) && current >= 1 ? Math.floor(current) : 1;
  return Math.min(n + 1, NOTIFICATION_GROUP_MAX);
}

/** Gruppnyckel för en sammanslagningsbar typ om en viss sak, annars null. */
export function defaultNotificationGroupKey(
  kind: NotificationKind,
  entity: { type: string; id: string } | null | undefined
): string | null {
  if (!NOTIFICATION_CATALOG[kind].groupable || !entity) return null;
  if (!isValidNotificationEntity(entity.type, entity.id)) return null;
  return `${kind}:${entity.type}:${entity.id}`;
}

/** Rubriken för en grupperad notis ("3 nya kommentarer" — etiketten + antal). */
export function groupedNotificationLabel(kind: string, count: number): string {
  const label = notificationMeta(kind).label;
  return count > 1 ? `${label} (${count})` : label;
}

// ─── Lagringsminimering ─────────────────────────────────────────────────────

/** Lästa notiser rensas efter 90 dagar, olästa efter 180 (GDPR art. 5.1 e). */
export const NOTIFICATION_RETENTION_READ_DAYS = 90;
export const NOTIFICATION_RETENTION_UNREAD_DAYS = 180;

export function notificationRetentionCutoffs(now: Date): { read: string; unread: string } {
  const day = 24 * 60 * 60 * 1000;
  return {
    read: new Date(now.getTime() - NOTIFICATION_RETENTION_READ_DAYS * day).toISOString(),
    unread: new Date(now.getTime() - NOTIFICATION_RETENTION_UNREAD_DAYS * day).toISOString()
  };
}
