// Startupkompassen — MALLAR för hur en publik modul (/m/<slug>) ser ut.
//
// En modul väljer EN mall (`compass_modules.layout`, migration 1700000154)
// som styr hela sidans komposition: var bild/video ligger, om texten ligger
// över ett omslag eller bredvid flödet, och hur "tungt" chromet är. Mallen
// är ren presentation — den ändrar inget i flödet, i vad som samlas in eller
// i lead-garantin (CLAUDE.md § 23.6). Saknat/okänt värde ⇒ `classic`
// (exakt hur sidan såg ut före mallarna), så en oapplicerad migration ändrar
// aldrig utseendet på befintliga moduler.
//
// Ren modul (ingen React, ingen IO) — delas av editorn, server-actionen, det
// delade skrivlagret och den publika sidan, och enhetstestas.

export const COMPASS_LAYOUTS = [
  'classic',
  'split_left',
  'split_right',
  'cover',
  'panel',
  'minimal'
] as const;

export type CompassLayout = (typeof COMPASS_LAYOUTS)[number];

export const DEFAULT_COMPASS_LAYOUT: CompassLayout = 'classic';

export interface CompassLayoutMeta {
  /** Kort etikett i mallväljaren. */
  label: string;
  /** En mening om känslan/när mallen passar. */
  description: string;
  /**
   * Hur mallen använder omslagsbild/-video:
   * - `optional` — visas om den finns, mallen fungerar lika bra utan.
   * - `featured` — mallen är byggd runt bilden; utan bild visas en brand-panel.
   * - `none` — mallen visar aldrig bild/video (renodlad typografi).
   */
  media: 'optional' | 'featured' | 'none';
  /** Tips som visas under uppladdningen när mallen är vald. */
  mediaHint: string;
  /** Rekommenderade flödestyper (bara vägledning i UI:t — alla mallar fungerar för alla flöden). */
  bestFor: ReadonlyArray<'chat' | 'wizard' | 'quiz'>;
}

export const COMPASS_LAYOUT_META: Record<CompassLayout, CompassLayoutMeta> = {
  classic: {
    label: 'Klassisk',
    description: 'Bild eller video överst, rubrik under och flödet i ett upphöjt kort. Lugn och tydlig.',
    media: 'optional',
    mediaHint: 'Visas som en bred banner ovanför rubriken. Fungerar bra utan bild.',
    bestFor: ['wizard', 'quiz', 'chat']
  },
  split_left: {
    label: 'Bild till vänster',
    description: 'Bilden fyller vänster halva hela vägen ned, flödet ligger till höger. Levande och modern.',
    media: 'featured',
    mediaHint: 'Fyller hela vänsterspalten (stående format passar bäst). Utan bild visas en färgpanel i accentfärgen.',
    bestFor: ['quiz', 'wizard']
  },
  split_right: {
    label: 'Bild till höger',
    description: 'Som "Bild till vänster" men speglad — flödet först, bilden som sällskap till höger.',
    media: 'featured',
    mediaHint: 'Fyller hela högerspalten (stående format passar bäst). Utan bild visas en färgpanel i accentfärgen.',
    bestFor: ['chat', 'wizard']
  },
  cover: {
    label: 'Heltäckande',
    description: 'Bilden täcker hela skärmen bakom ett glaskort. Vit text, mörk ton — mest dramatisk.',
    media: 'featured',
    mediaHint: 'Täcker hela sidan som bakgrund (liggande format, gärna mörkt eller lugnt motiv). Utan bild används en mörkblå ton.',
    bestFor: ['quiz', 'chat']
  },
  panel: {
    label: 'Färgpanel',
    description: 'En panel i accentfärgen bär rubriken; bilden ligger som en bricka i panelen och flödet lyfts upp över kanten.',
    media: 'optional',
    mediaHint: 'Visas som en rundad bricka i panelen. Utan bild bär panelen bara rubriken — fortfarande snyggt.',
    bestFor: ['wizard', 'quiz', 'chat']
  },
  minimal: {
    label: 'Minimal',
    description: 'Ingen bild, inga kort — bara stor typografi och hårlinjer. Redaktionellt och avskalat.',
    media: 'none',
    mediaHint: 'Mallen Minimal visar ingen bild eller video. Uppladdat material sparas men syns inte.',
    bestFor: ['wizard', 'chat']
  }
};

export function isCompassLayout(v: unknown): v is CompassLayout {
  return typeof v === 'string' && (COMPASS_LAYOUTS as readonly string[]).includes(v);
}

/**
 * Tolkar ett råvärde (formulär, PB-post, agent) till en giltig mall.
 * Trimmar och gemenar; tomt/okänt ⇒ `classic`. Accepterar även några
 * vardagliga alias (t.ex. "vänster", "helskärm") så att chatten kan sätta
 * mallen från naturligt språk utan att gissa fel.
 */
export function normalizeCompassLayout(raw: unknown): CompassLayout {
  if (typeof raw !== 'string') return DEFAULT_COMPASS_LAYOUT;
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (isCompassLayout(v)) return v;
  const alias: Record<string, CompassLayout> = {
    klassisk: 'classic',
    standard: 'classic',
    default: 'classic',
    vanster: 'split_left',
    'vänster': 'split_left',
    bild_till_vanster: 'split_left',
    'bild_till_vänster': 'split_left',
    left: 'split_left',
    hoger: 'split_right',
    'höger': 'split_right',
    bild_till_hoger: 'split_right',
    'bild_till_höger': 'split_right',
    right: 'split_right',
    heltackande: 'cover',
    'heltäckande': 'cover',
    fullscreen: 'cover',
    helskarm: 'cover',
    'helskärm': 'cover',
    fargpanel: 'panel',
    'färgpanel': 'panel',
    minimalistisk: 'minimal',
    avskalad: 'minimal'
  };
  return alias[v] ?? DEFAULT_COMPASS_LAYOUT;
}

/** Sann när mallen faktiskt visar uppladdad bild/video. */
export function compassLayoutShowsMedia(layout: CompassLayout): boolean {
  return COMPASS_LAYOUT_META[layout].media !== 'none';
}
