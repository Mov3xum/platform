/**
 * Startupkompassen — avsnittet "Dina uppgifter" sist i ett intag-flöde
 * (CLAUDE.md § 23.11).
 *
 * Besökaren fyller i kontaktuppgifter och bakgrund EFTER frågorna (chattens
 * avslutssteg, formulärets och quizets sista steg). Vilka fält som visas och
 * vilka som är obligatoriska styrs per modul i steg 4 av modul-admin och
 * lagras som `compass_modules.contact_fields` (json, migration 1700000208).
 *
 * Ren modul (ingen IO, ingen React) — delas av klienten (formuläret), server-
 * routarna (validering: klienten är aldrig säkerhetsgränsen) och modul-admin.
 * Enhetstestad i `compass-contact.test.ts`.
 *
 * GDPR § 5: alla värden trimmas, cappas och personnummer-saneras här;
 * fasta val (kön, kommun, kontaktväg) släpper bara kända nycklar igenom.
 * Kön på grundare behandlas som GDPR art. 9-klass (samma som
 * `startups.founder_gender`, § 10.2): fältet kan ALDRIG göras obligatoriskt
 * och fältmaskas för AI via `gender`-mönstret i `lib/ai/redaction.ts`.
 */

export const CONTACT_FIELD_KEYS = [
  'name',
  'email',
  'phone',
  'organization',
  'founder_gender',
  'team_members',
  'kommun',
  'referral_channel'
] as const;

export type ContactFieldKey = (typeof CONTACT_FIELD_KEYS)[number];

export type ContactFieldMode = 'hidden' | 'optional' | 'required';

export const CONTACT_FIELD_MODES: readonly ContactFieldMode[] = ['hidden', 'optional', 'required'];

export const CONTACT_FIELD_MODE_LABEL: Record<ContactFieldMode, string> = {
  hidden: 'Visas inte',
  optional: 'Frivillig',
  required: 'Obligatorisk'
};

/** Konfiguration per modul: ett läge per fält. */
export type ContactSectionConfig = Record<ContactFieldKey, ContactFieldMode>;

export interface ContactFieldMeta {
  label: string;
  /** Kort hjälptext under fältet (visas för besökaren). */
  hint?: string;
  /**
   * Fält som aldrig får vara obligatoriska. Reserverat — kön på grundare har
   * sedan 2026-11-04 alternativet "Vill inte ange", så det kan krävas utan
   * att tvinga fram en uppgift (GDPR art. 9-klass, § 23.11).
   */
  neverRequired?: boolean;
  /** Lead-fältets max-längd (speglar schemat i migration 1700000208). */
  max: number;
}

export const CONTACT_FIELD_META: Record<ContactFieldKey, ContactFieldMeta> = {
  name: { label: 'Namn på idéägaren', max: 200 },
  email: { label: 'E-post', max: 254 },
  phone: { label: 'Telefonnummer', max: 50 },
  organization: { label: 'Organisation', max: 200 },
  founder_gender: {
    label: 'Kön på grundare',
    hint: 'Används bara för Vinnovas statistik över könsfördelning i stödprogrammen — aldrig i bedömningen av idén. Du kan välja att inte ange.',
    max: 20
  },
  team_members: {
    label: 'Övriga teammedlemmar',
    hint: 'Namn och e-post till eventuella övriga i teamet, en per rad.',
    max: 2000
  },
  kommun: { label: 'Kommuntillhörighet', max: 80 },
  referral_channel: { label: 'Hur kom du i kontakt med Movexum?', max: 60 }
};

/**
 * Kön på grundare — fasta val (kvinna / man / mixat team) plus "Vill inte
 * ange" (migration 1700000209), så att fältet kan vara obligatoriskt och
 * ändå ge besökaren en utväg: ett svar utan att tvinga fram en uppgift.
 */
export const FOUNDER_GENDER_OPTIONS = [
  { value: 'kvinna', label: 'Kvinna' },
  { value: 'man', label: 'Man' },
  { value: 'mixat_team', label: 'Mixat team' },
  { value: 'vill_inte_ange', label: 'Vill inte ange' }
] as const;

/** Besökaren svarade men valde att inte ange kön. */
export const FOUNDER_GENDER_DECLINED: FounderGender = 'vill_inte_ange';

export type FounderGender = (typeof FOUNDER_GENDER_OPTIONS)[number]['value'];

/**
 * Kommuntillhörighet — fasta val. Gävleborgs tio kommuner (Movexums
 * upptagningsområde) + "annan"/"utanför Sverige". Lagras som nyckel (text)
 * på leadet så listan kan utökas utan migration; okända nycklar avvisas här.
 */
export const KOMMUN_OPTIONS = [
  { value: 'bollnas', label: 'Bollnäs' },
  { value: 'gavle', label: 'Gävle' },
  { value: 'hofors', label: 'Hofors' },
  { value: 'hudiksvall', label: 'Hudiksvall' },
  { value: 'ljusdal', label: 'Ljusdal' },
  { value: 'nordanstig', label: 'Nordanstig' },
  { value: 'ockelbo', label: 'Ockelbo' },
  { value: 'ovanaker', label: 'Ovanåker' },
  { value: 'sandviken', label: 'Sandviken' },
  { value: 'soderhamn', label: 'Söderhamn' },
  { value: 'annan_sverige', label: 'Annan kommun i Sverige' },
  { value: 'utanfor_sverige', label: 'Utanför Sverige' }
] as const;

export type KommunKey = (typeof KOMMUN_OPTIONS)[number]['value'];

/** Hur besökaren kom i kontakt med Movexum — fasta val. */
export const REFERRAL_CHANNEL_OPTIONS = [
  { value: 'sociala_medier', label: 'Sociala medier (LinkedIn, Instagram, Facebook …)' },
  { value: 'event', label: 'Event, föreläsning eller mässa' },
  { value: 'rekommendation', label: 'Rekommendation från vän, kollega eller annan grundare' },
  { value: 'partner', label: 'Via Almi, Region Gävleborg, kommunen eller annan partner' },
  { value: 'hogskola', label: 'Högskola eller universitet' },
  { value: 'sokmotor', label: 'Sökte på nätet' },
  { value: 'press', label: 'Press, nyheter eller nyhetsbrev' },
  { value: 'movexum', label: 'Någon från Movexum kontaktade mig' },
  { value: 'annat', label: 'Annat' }
] as const;

export type ReferralChannelKey = (typeof REFERRAL_CHANNEL_OPTIONS)[number]['value'];

type Option = { readonly value: string; readonly label: string };

function labelOf(options: readonly Option[], value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return options.find((o) => o.value === value)?.label;
}

export const founderGenderLabel = (v: unknown): string | undefined => labelOf(FOUNDER_GENDER_OPTIONS, v);
export const kommunLabel = (v: unknown): string | undefined => labelOf(KOMMUN_OPTIONS, v);
export const referralChannelLabel = (v: unknown): string | undefined =>
  labelOf(REFERRAL_CHANNEL_OPTIONS, v);

/** Alla fält dolda — ett formulär UTAN avslutssteg (dagens beteende för wizard). */
export const CONTACT_SECTION_NONE: ContactSectionConfig = {
  name: 'hidden',
  email: 'hidden',
  phone: 'hidden',
  organization: 'hidden',
  founder_gender: 'hidden',
  team_members: 'hidden',
  kommun: 'hidden',
  referral_channel: 'hidden'
};

/**
 * Standard för NYA intag-moduler: hela avsnittet som inflödesansvarig bad om
 * (2026-11) — kontaktuppgifter obligatoriska, bakgrundsfälten frivilliga.
 */
export const CONTACT_SECTION_DEFAULT: ContactSectionConfig = {
  name: 'required',
  email: 'required',
  phone: 'optional',
  organization: 'hidden',
  founder_gender: 'optional',
  team_members: 'optional',
  kommun: 'optional',
  referral_channel: 'optional'
};

export interface LegacyContactRequirements {
  require_email?: boolean | null;
  require_phone?: boolean | null;
  require_organization?: boolean | null;
}

/**
 * Konfiguration för en modul som saknar `contact_fields` (skapad före
 * migration 1700000208, eller en instans där den inte applicerats): exakt
 * det avslutssteget visade förut, så ingen befintlig modul ändrar utseende.
 *   - chat/quiz: namn + e-post alltid, telefon/organisation bara när krävda.
 *   - wizard: inget avslutssteg alls (kontakt kom via frågorna).
 */
export function legacyContactSection(
  flowType: string | undefined,
  legacy: LegacyContactRequirements
): ContactSectionConfig {
  if (flowType === 'wizard') return { ...CONTACT_SECTION_NONE };
  return {
    ...CONTACT_SECTION_NONE,
    name: 'optional',
    email: legacy.require_email ? 'required' : 'optional',
    phone: legacy.require_phone ? 'required' : 'hidden',
    organization: legacy.require_organization ? 'required' : 'hidden'
  };
}

function isMode(v: unknown): v is ContactFieldMode {
  return v === 'hidden' || v === 'optional' || v === 'required';
}

/**
 * Normaliserar `contact_fields` ur databasen (json, sträng eller null).
 * Okända nycklar släpps, okända lägen blir `hidden`, och fält märkta
 * `neverRequired` sänks till `optional`. Saknat/ogiltigt värde ⇒
 * legacy-konfigurationen (aldrig ett undantag).
 */
export function normalizeContactSection(
  raw: unknown,
  fallback: ContactSectionConfig
): ContactSectionConfig {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ...fallback };
  const out: ContactSectionConfig = { ...CONTACT_SECTION_NONE };
  const rec = obj as Record<string, unknown>;
  for (const key of CONTACT_FIELD_KEYS) {
    const mode = rec[key];
    let m: ContactFieldMode = isMode(mode) ? mode : 'hidden';
    if (m === 'required' && CONTACT_FIELD_META[key].neverRequired) m = 'optional';
    out[key] = m;
  }
  return out;
}

/** Konfigurationen för en modul — lagrad eller legacy. */
export function contactSectionForModule(module: {
  flow_type?: string;
  contact_fields?: unknown;
  require_email?: boolean | null;
  require_phone?: boolean | null;
  require_organization?: boolean | null;
}): ContactSectionConfig {
  return normalizeContactSection(module.contact_fields, legacyContactSection(module.flow_type, module));
}

/** Visas avsnittet alls? (minst ett fält som inte är dolt) */
export function hasContactSection(config: ContactSectionConfig): boolean {
  return CONTACT_FIELD_KEYS.some((k) => config[k] !== 'hidden');
}

/** De fält som ska renderas, i fast ordning. */
export function visibleContactFields(config: ContactSectionConfig): ContactFieldKey[] {
  return CONTACT_FIELD_KEYS.filter((k) => config[k] !== 'hidden');
}

/**
 * Lägen ur ett formulär (modul-admin): `contact_<fält>` = hidden|optional|
 * required. Saknade fält ⇒ hidden. Samma normalisering som för databasen.
 */
export function contactSectionFromForm(get: (name: string) => unknown): ContactSectionConfig {
  const rec: Record<string, unknown> = {};
  for (const key of CONTACT_FIELD_KEYS) rec[key] = get(`contact_${key}`);
  return normalizeContactSection(rec, CONTACT_SECTION_NONE);
}

/**
 * De tre äldre booleanerna härleds ur konfigurationen så att ytor som läser
 * dem (och äldre instanser) ser samma krav som avsnittet ställer.
 */
export function legacyRequirementsFromSection(config: ContactSectionConfig): {
  require_email: boolean;
  require_phone: boolean;
  require_organization: boolean;
} {
  return {
    require_email: config.email === 'required',
    require_phone: config.phone === 'required',
    require_organization: config.organization === 'required'
  };
}

/** Validerade besökarvärden — bara fält som faktiskt angavs. */
export type ContactValues = Partial<Record<ContactFieldKey, string>>;

// Personnummer-sanering (samma regex som CRM-importen, § 15.6) — folk
// skriver ibland personnummer i fritext.
const PERSONNUMMER_RE = /\b\d{6,8}[-+]?\d{4}\b/g;

function cleanText(v: unknown, max: number, multiline = false): string | undefined {
  if (typeof v !== 'string') return undefined;
  let t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  t = multiline ? t.replace(/\r\n?/g, '\n').trim() : t.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.replace(PERSONNUMMER_RE, '[REDACTED]').slice(0, max);
}

/**
 * Tvättar besökarens kontaktvärden mot konfigurationen: dolda fält släpps,
 * fritext trimmas/cappas/saneras, fasta val måste vara kända nycklar (okänt
 * ⇒ som om inget angetts). Returnerar aldrig ett undantag.
 */
export function cleanContactValues(raw: unknown, config: ContactSectionConfig): ContactValues {
  const out: ContactValues = {};
  if (!raw || typeof raw !== 'object') return out;
  const rec = raw as Record<string, unknown>;
  for (const key of visibleContactFields(config)) {
    const max = CONTACT_FIELD_META[key].max;
    let value: string | undefined;
    switch (key) {
      case 'founder_gender':
        value = founderGenderLabel(rec[key]) ? (rec[key] as string) : undefined;
        break;
      case 'kommun':
        value = kommunLabel(rec[key]) ? (rec[key] as string) : undefined;
        break;
      case 'referral_channel':
        value = referralChannelLabel(rec[key]) ? (rec[key] as string) : undefined;
        break;
      case 'team_members':
        value = cleanText(rec[key], max, true);
        break;
      case 'email':
        value = cleanText(rec[key], max);
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) value = undefined;
        break;
      default:
        value = cleanText(rec[key], max);
    }
    if (value) out[key] = value;
  }
  return out;
}

/**
 * Första saknade obligatoriska fältet som ett svenskt felmeddelande — eller
 * null. Körs i klienten (snabb feedback) OCH server-side.
 */
export function missingContactField(
  values: ContactValues,
  config: ContactSectionConfig
): string | null {
  for (const key of CONTACT_FIELD_KEYS) {
    if (config[key] !== 'required') continue;
    if (!values[key]) return `${CONTACT_FIELD_META[key].label} krävs.`;
  }
  return null;
}

/** Läsbar etikett för ett lagrat värde (fasta val ⇒ etikett, annars texten). */
export function contactValueLabel(key: ContactFieldKey, value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  switch (key) {
    case 'founder_gender':
      return founderGenderLabel(value) ?? value;
    case 'kommun':
      return kommunLabel(value) ?? value;
    case 'referral_channel':
      return referralChannelLabel(value) ?? value;
    default:
      return value;
  }
}
