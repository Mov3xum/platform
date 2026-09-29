// Inloggningssidans utseende (CLAUDE.md § 48).
//
// Admin/incubator_lead väljer en MALL, en accentfärg (bara Movexums
// brand-tokens — aldrig fri hex, § 2.2/§ 5), rubrik + underrubrik samt bild
// och/eller video för landningssidan där alla loggar in (/login). Valet
// lagras på `tenants` (migration 1700000172) och gäller för ALLA användare i
// systemet — sidan är oinloggad, så den visar den tenant som deployen
// resolvar (`resolveLoginBrandingTenant`, lib/login-branding.server.ts).
//
// Ren modul (ingen React, ingen IO) — delas av editorn, server-actionen,
// upload-routen och själva inloggningssidan, och enhetstestas. Saknat/okänt
// värde ⇒ `centered` = exakt hur sidan såg ut före funktionen, så en
// oapplicerad migration ändrar aldrig utseendet.

export const LOGIN_LAYOUTS = ['centered', 'split_left', 'split_right', 'cover', 'panel'] as const;
export type LoginLayout = (typeof LOGIN_LAYOUTS)[number];
export const DEFAULT_LOGIN_LAYOUT: LoginLayout = 'centered';

export interface LoginLayoutMeta {
  label: string;
  description: string;
  /** Som i Startupkompassen: optional = visas om den finns; featured = mallen bygger på bilden. */
  media: 'optional' | 'featured';
  mediaHint: string;
}

export const LOGIN_LAYOUT_META: Record<LoginLayout, LoginLayoutMeta> = {
  centered: {
    label: 'Centrerad',
    description: 'Inloggningskortet mitt på sidan, logotypen uppe till vänster. Lugn och neutral — så som sidan alltid sett ut.',
    media: 'optional',
    mediaHint: 'Bild eller video visas som mjuk, tonad bakgrund bakom kortet. Fungerar lika bra utan.'
  },
  split_left: {
    label: 'Bild till vänster',
    description: 'Bilden eller videon fyller vänster halva hela vägen ned, formuläret ligger till höger.',
    media: 'featured',
    mediaHint: 'Fyller hela vänsterspalten (stående eller kvadratiskt motiv passar bäst). Utan bild visas en panel i accentfärgen.'
  },
  split_right: {
    label: 'Bild till höger',
    description: 'Speglad split — formuläret först, bilden eller videon som sällskap till höger.',
    media: 'featured',
    mediaHint: 'Fyller hela högerspalten. Utan bild visas en panel i accentfärgen.'
  },
  cover: {
    label: 'Heltäckande',
    description: 'Bilden eller videon täcker hela skärmen bakom ett glaskort med formuläret. Mest dramatisk.',
    media: 'featured',
    mediaHint: 'Täcker hela sidan som bakgrund (liggande format, gärna lugnt motiv). Utan bild används accentfärgen.'
  },
  panel: {
    label: 'Färgpanel',
    description: 'En panel i accentfärgen bär logotyp, rubrik och bilden som en bricka; formuläret ligger bredvid.',
    media: 'optional',
    mediaHint: 'Visas som en rundad bricka i panelen. Utan bild bär panelen bara rubriken — fortfarande snyggt.'
  }
};

export function isLoginLayout(v: unknown): v is LoginLayout {
  return typeof v === 'string' && (LOGIN_LAYOUTS as readonly string[]).includes(v);
}

export function normalizeLoginLayout(raw: unknown): LoginLayout {
  if (typeof raw !== 'string') return DEFAULT_LOGIN_LAYOUT;
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return isLoginLayout(v) ? v : DEFAULT_LOGIN_LAYOUT;
}

/** Sann när mallen är byggd runt bild/video (visar accentpanel utan media). */
export function loginLayoutFeaturesMedia(layout: LoginLayout): boolean {
  return LOGIN_LAYOUT_META[layout].media === 'featured';
}

// Accentfärg = Movexums brand-tokens (`--movexum-*` i tokens.css). Bara
// toner som bär vit text med god kontrast får väljas — panelen/omslaget
// lägger rubrik och logotyp i vitt ovanpå färgen.
export const LOGIN_ACCENTS = [
  'morkbla',
  'djupbla',
  'morklila',
  'lila',
  'morkgron',
  'gron',
  'morkorange',
  'orange'
] as const;
export type LoginAccent = (typeof LOGIN_ACCENTS)[number];
export const DEFAULT_LOGIN_ACCENT: LoginAccent = 'morkbla';

export const LOGIN_ACCENT_LABELS: Record<LoginAccent, string> = {
  morkbla: 'Mörkblå',
  djupbla: 'Djupblå',
  morklila: 'Mörklila',
  lila: 'Movexum lila',
  morkgron: 'Mörkgrön',
  gron: 'Movexum grön',
  morkorange: 'Mörkorange',
  orange: 'Movexum orange'
};

export function isLoginAccent(v: unknown): v is LoginAccent {
  return typeof v === 'string' && (LOGIN_ACCENTS as readonly string[]).includes(v);
}

export function normalizeLoginAccent(raw: unknown): LoginAccent {
  if (typeof raw !== 'string') return DEFAULT_LOGIN_ACCENT;
  const v = raw.trim().toLowerCase();
  return isLoginAccent(v) ? v : DEFAULT_LOGIN_ACCENT;
}

/** CSS-variabel för accenten — aldrig ett hex-värde i kod eller data. */
export function loginAccentVar(accent: unknown): string {
  return `var(--movexum-${normalizeLoginAccent(accent)})`;
}

export const LOGIN_HEADLINE_MAX = 120;
export const LOGIN_TAGLINE_MAX = 300;
export const DEFAULT_LOGIN_HEADLINE = 'Välkommen tillbaka';
export const DEFAULT_LOGIN_TAGLINE = 'Logga in för att fortsätta till din arbetsyta.';

/** Trimmar, plattar radbrytningar och cappar en rubriktext; tomt ⇒ ''. */
export function cleanLoginText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() : flat;
}

/** Fälten på `tenants` som bär inloggningssidans utseende (migration 1700000172). */
export const LOGIN_BRANDING_FIELDS = [
  'login_layout',
  'login_accent',
  'login_headline',
  'login_tagline',
  'login_image',
  'login_video'
] as const;
export type LoginBrandingField = (typeof LOGIN_BRANDING_FIELDS)[number];

export interface LoginBranding {
  layout: LoginLayout;
  accent: LoginAccent;
  /** Rubrik som visas; tom sträng i posten ⇒ standardtexten. */
  headline: string;
  tagline: string;
  /** PB-filnamn (inte URL) — null när ingen fil laddats upp. */
  imageFilename: string | null;
  videoFilename: string | null;
}

export const DEFAULT_LOGIN_BRANDING: LoginBranding = {
  layout: DEFAULT_LOGIN_LAYOUT,
  accent: DEFAULT_LOGIN_ACCENT,
  headline: DEFAULT_LOGIN_HEADLINE,
  tagline: DEFAULT_LOGIN_TAGLINE,
  imageFilename: null,
  videoFilename: null
};

function fileName(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) return v[0].trim();
  return null;
}

/**
 * Tolkar en `tenants`-post (eller vilket råobjekt som helst) till ett giltigt
 * utseende. Okända/saknade värden ⇒ standard, så sidan alltid renderar.
 */
export function normalizeLoginBranding(raw: Record<string, unknown> | null | undefined): LoginBranding {
  if (!raw) return { ...DEFAULT_LOGIN_BRANDING };
  const headline = cleanLoginText(raw.login_headline, LOGIN_HEADLINE_MAX);
  const tagline = cleanLoginText(raw.login_tagline, LOGIN_TAGLINE_MAX);
  return {
    layout: normalizeLoginLayout(raw.login_layout),
    accent: normalizeLoginAccent(raw.login_accent),
    headline: headline || DEFAULT_LOGIN_HEADLINE,
    tagline: tagline || DEFAULT_LOGIN_TAGLINE,
    imageFilename: fileName(raw.login_image),
    videoFilename: fileName(raw.login_video)
  };
}

/**
 * Vilka av utseendets fält som saknas i ett PB-schema. PocketBase släpper
 * okända fält tyst vid update (§ 24.4-invarianten) — därför kontrolleras
 * närvaron innan en sparning rapporteras som lyckad.
 */
export function missingLoginBrandingFields(record: Record<string, unknown> | null | undefined): LoginBrandingField[] {
  if (!record) return [...LOGIN_BRANDING_FIELDS];
  return LOGIN_BRANDING_FIELDS.filter((f) => !(f in record));
}

export interface LoginBrandingInput {
  layout?: unknown;
  accent?: unknown;
  headline?: unknown;
  tagline?: unknown;
}

export type LoginBrandingValidation =
  | { ok: true; value: { login_layout: LoginLayout; login_accent: LoginAccent; login_headline: string; login_tagline: string } }
  | { ok: false; error: string };

/**
 * Validerar formulärets fält till exakt det som skrivs till `tenants`.
 * Okänd mall/accent avvisas med de giltiga namnen — aldrig tyst default
 * (samma princip som årshjulets kategorier, § 30.3).
 */
export function validateLoginBrandingInput(input: LoginBrandingInput): LoginBrandingValidation {
  const layoutRaw = typeof input.layout === 'string' ? input.layout.trim().toLowerCase() : '';
  const layout = layoutRaw === '' ? DEFAULT_LOGIN_LAYOUT : layoutRaw;
  if (!isLoginLayout(layout)) {
    return { ok: false, error: `Okänd mall "${layoutRaw}". Giltiga: ${LOGIN_LAYOUTS.join(', ')}.` };
  }
  const accentRaw = typeof input.accent === 'string' ? input.accent.trim().toLowerCase() : '';
  const accent = accentRaw === '' ? DEFAULT_LOGIN_ACCENT : accentRaw;
  if (!isLoginAccent(accent)) {
    return { ok: false, error: `Okänd accentfärg "${accentRaw}". Giltiga: ${LOGIN_ACCENTS.join(', ')}.` };
  }
  if (typeof input.headline === 'string' && input.headline.trim().length > LOGIN_HEADLINE_MAX) {
    return { ok: false, error: `Rubriken får vara högst ${LOGIN_HEADLINE_MAX} tecken.` };
  }
  if (typeof input.tagline === 'string' && input.tagline.trim().length > LOGIN_TAGLINE_MAX) {
    return { ok: false, error: `Underrubriken får vara högst ${LOGIN_TAGLINE_MAX} tecken.` };
  }
  return {
    ok: true,
    value: {
      login_layout: layout,
      login_accent: accent,
      login_headline: cleanLoginText(input.headline, LOGIN_HEADLINE_MAX),
      login_tagline: cleanLoginText(input.tagline, LOGIN_TAGLINE_MAX)
    }
  };
}
