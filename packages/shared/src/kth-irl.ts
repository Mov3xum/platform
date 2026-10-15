/**
 * KTH Innovation Readiness Level™ (IRL) — sex axlar, skala 1–9.
 *
 * KTH Innovation mäter ett bolags mognad längs sex dimensioner som ritas som
 * en radar (spindel): kund (CRL), teknik (TRL), affär (BRL), immateriella
 * rättigheter (IPRL), team (TMRL) och finansiering (FRL). Den här modulen är
 * källan av sanning för axlarna, nivåbeskrivningarna, valideringen och
 * radarns geometri — den delas av bolagskortet (`/startups/[id]/utveckling`),
 * server-actionen och testerna. Ren, inga beroenden, enhetstestad.
 *
 * Lagring: `startup_readiness_assessments` (migration 1700000104 + 1700000193)
 * — en rad per bedömningstillfälle (tidsserie). `crl`/`tmrl`/`brl` delas med
 * Vinnovas lägesredovisning och Bedömning excellens (§ 51); `srl` (hållbarhet)
 * är Vinnovas tillägg och ritas inte i KTH-radarn.
 *
 * Nivåbeskrivningarna är en förkortad svensk sammanfattning — KTH:s
 * fullständiga beskrivningar och frågor finns på
 * kthinnovationreadinesslevel.com.
 */

export type IrlAxisKey = 'crl' | 'trl' | 'brl' | 'iprl' | 'tmrl' | 'frl';

/** Vinnovas tilläggsaxel (hållbarhet) — lagras i samma rad, ritas inte i radarn. */
export type IrlExtraAxisKey = 'srl';

export interface KthIrlAxis {
  key: IrlAxisKey;
  /** Förkortning, t.ex. "CRL". */
  short: string;
  /** Svensk etikett. */
  label: string;
  /** Engelsk etikett som i KTH:s diagram. */
  labelEn: string;
  /** Vad axeln mäter — en mening. */
  question: string;
  /** Nivå 1–9 (index 0–8). */
  levels: readonly string[];
}

/**
 * Axlarna i KTH-diagrammets ordning, medurs från toppen:
 * kund · team · affär · IPR · finansiering · teknik.
 */
export const KTH_IRL_AXES: readonly KthIrlAxis[] = [
  {
    key: 'crl',
    short: 'CRL',
    label: 'Kund',
    labelEn: 'Customer',
    question: 'Hur väl känner bolaget kundens behov och hur långt har kunderna kommit mot att köpa?',
    levels: [
      'Hypotes om möjliga behov på marknaden.',
      'Identifierat specifika behov på marknaden.',
      'Första återkopplingen från marknaden inhämtad.',
      'Problem och behov bekräftade hos flera kunder och användare.',
      'Etablerat intresse för produkten (t.ex. avsiktsförklaringar).',
      'Produktens nytta bekräftad genom partnerskap eller första kundtester.',
      'Kunder i utökade tester eller första testförsäljning.',
      'Första produkterna sålda.',
      'Omfattande försäljning.'
    ]
  },
  {
    key: 'tmrl',
    short: 'TMRL',
    label: 'Team',
    labelEn: 'Team',
    question: 'Har bolaget kompetensen, engagemanget och organisationen som krävs?',
    levels: [
      'Liten eller ingen teamkompetens — ofta en enskild person.',
      'Behovet av kompetens och resurser är identifierat.',
      'Viss kompetens på plats; söker kompletterande personer eller partners.',
      'En drivande person och ett kärnteam med kompletterande kompetens.',
      'Team med kompetens och engagemang för verifiering; plan för teamets utveckling.',
      'Organisation och roller är tydliga; nyckelkompetens rekryteras.',
      'Erfaret, samspelt team med gemensamma mål.',
      'Professionell organisation med styrelse och processer.',
      'Organisationen är fullt fungerande och presterar väl.'
    ]
  },
  {
    key: 'brl',
    short: 'BRL',
    label: 'Affär',
    labelEn: 'Business',
    question: 'Hur långt har affärsmodellen kommit — från hypotes till verifierad och skalbar?',
    levels: [
      'Hypotes om en möjlig affärsidé.',
      'Beskrivet affärskoncept och en första marknadsbild.',
      'Utkast till affärsmodell; preliminär marknads- och konkurrensanalys.',
      'Affärsmodellens nyckelantaganden identifierade och delvis testade.',
      'Affärsmodellen testad mot kunder; första intäktsmodell.',
      'Affärsmodell och prissättning validerade med kunder eller partners.',
      'Affärsmodellen bekräftad genom första försäljning eller avtal.',
      'Försäljning och nyckeltal visar att affärsmodellen håller.',
      'Affärsmodellen skalar med återkommande intäkter.'
    ]
  },
  {
    key: 'iprl',
    short: 'IPRL',
    label: 'IPR',
    labelEn: 'IPR',
    question: 'Är bolagets immateriella tillgångar identifierade, ägda och skyddade?',
    levels: [
      'Hypotes om möjlig immateriell egendom (IP).',
      'Möjlig IP identifierad, liksom vem som äger den.',
      'IP beskriven i detalj; skyddsmöjligheter bedömda.',
      'Nyhetsgranskning och första bedömning av frihet att verka (FTO).',
      'IP-strategi utformad; beslut om skydd fattat.',
      'Ansökan om skydd inlämnad (t.ex. patent eller varumärke).',
      'Stärkt IP-position (t.ex. internationell ansökan, avtal om ägande).',
      'IP-strategin bekräftad i affären; FTO genomförd.',
      'Starkt IP-skydd beviljat och upprätthållet.'
    ]
  },
  {
    key: 'frl',
    short: 'FRL',
    label: 'Finansiering',
    labelEn: 'Funding',
    question: 'Är finansieringsbehovet förstått och finns kapitalet för nästa steg?',
    levels: [
      'Ingen tydlig bild av finansieringsbehovet.',
      'Behovet av resurser och finansiering för de första stegen beskrivet.',
      'Första (mjuka) finansieringen säkrad för verifiering.',
      'Finansieringsstrategi och investerarorienterad pitch framtagen.',
      'Pitch och finansieringsplan testade mot investerare.',
      'Extern finansiering i dialog eller betydande mjuk finansiering beviljad.',
      'Förhandling med investerare (term sheet).',
      'Investering säkrad; bolaget följer finansieringsplanen.',
      'Finansiering för tillväxt säkrad, eller bolaget är självfinansierande.'
    ]
  },
  {
    key: 'trl',
    short: 'TRL',
    label: 'Teknik',
    labelEn: 'Technology',
    question: 'Hur långt har tekniken eller lösningen kommit — från idé till bevisad i drift?',
    levels: [
      'Grundläggande principer observerade; idé om användning.',
      'Teknikkoncept och tillämpning formulerade.',
      'Experimentellt bevis för konceptet (proof of concept).',
      'Tekniken validerad i labbmiljö.',
      'Tekniken validerad i relevant miljö.',
      'Prototyp demonstrerad i relevant miljö.',
      'Prototyp demonstrerad i verklig miljö.',
      'Komplett system kvalificerat och testat.',
      'Systemet bevisat i verklig drift.'
    ]
  }
] as const;

export const IRL_AXIS_KEYS: readonly IrlAxisKey[] = KTH_IRL_AXES.map((a) => a.key);

export const IRL_EXTRA_AXIS = {
  key: 'srl' as IrlExtraAxisKey,
  short: 'SRL',
  label: 'Hållbarhet',
  question: 'Vinnovas tillägg: hur väl har bolaget integrerat hållbarhet i affären? (ritas inte i KTH-radarn)'
};

export const IRL_MIN = 1;
export const IRL_MAX = 9;
export const IRL_AXIS_NOTE_MAX = 500;
export const IRL_NOTE_MAX = 1000;

export const IRL_SOURCE_NOTE =
  'Förkortad svensk sammanfattning av KTH Innovation Readiness Level™ (KTH Innovation). Fullständiga beskrivningar: kthinnovationreadinesslevel.com.';

export type IrlProfile = Partial<Record<IrlAxisKey, number>>;
export type IrlAxisNotes = Partial<Record<IrlAxisKey, string>>;

export function irlAxis(key: IrlAxisKey): KthIrlAxis {
  return KTH_IRL_AXES.find((a) => a.key === key)!;
}

export function isIrlAxisKey(v: unknown): v is IrlAxisKey {
  return typeof v === 'string' && (IRL_AXIS_KEYS as readonly string[]).includes(v);
}

/** Heltal 1–9, annars null. PB lagrar 0 för ett tomt tal → 0 = ej bedömd. */
export function normalizeIrlLevel(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n >= IRL_MIN && n <= IRL_MAX ? n : null;
}

/** Bygger en profil ur en godtycklig rad (okända nycklar och ogiltiga tal släpps). */
export function normalizeIrlProfile(raw: unknown): IrlProfile {
  const out: IrlProfile = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const key of IRL_AXIS_KEYS) {
    const lvl = normalizeIrlLevel(r[key]);
    if (lvl !== null) out[key] = lvl;
  }
  return out;
}

const PERSONNUMMER_RE = /\b\d{6,8}[-+]?\d{4}\b/g;

/** Fritext: personnummer saneras (§ 15.6), whitespace plattas, kapas. */
export function cleanIrlText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(PERSONNUMMER_RE, '[REDACTED]').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function normalizeIrlAxisNotes(raw: unknown): IrlAxisNotes {
  const out: IrlAxisNotes = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const key of IRL_AXIS_KEYS) {
    const text = cleanIrlText(r[key], IRL_AXIS_NOTE_MAX);
    if (text) out[key] = text;
  }
  return out;
}

export interface IrlAssessmentInput {
  levels: Record<string, unknown>;
  srl?: unknown;
  axisNotes?: Record<string, unknown>;
  note?: unknown;
  assessedAt?: unknown;
}

export interface NormalizedIrlAssessment {
  profile: IrlProfile;
  srl: number | null;
  axisNotes: IrlAxisNotes;
  note: string;
  /** YYYY-MM-DD */
  assessedAt: string;
}

/**
 * Validerar en ny bedömning. Minst en KTH-axel måste vara satt; varje satt
 * nivå måste vara ett heltal 1–9 (ett ogiltigt värde är ett FEL, aldrig en
 * tyst borttagning). Datum: YYYY-MM-DD, inte i framtiden (default idag).
 */
export function validateIrlAssessmentInput(
  input: IrlAssessmentInput,
  today: string
): { ok: true; value: NormalizedIrlAssessment } | { ok: false; error: string } {
  const profile: IrlProfile = {};
  const levels = input.levels && typeof input.levels === 'object' ? input.levels : {};
  for (const key of Object.keys(levels)) {
    if (!isIrlAxisKey(key)) return { ok: false, error: `Okänd IRL-axel: ${key}.` };
  }
  for (const axis of KTH_IRL_AXES) {
    const raw = levels[axis.key];
    if (raw === undefined || raw === null || raw === '' || raw === 0) continue;
    const lvl = normalizeIrlLevel(raw);
    if (lvl === null) return { ok: false, error: `${axis.label} (${axis.short}) måste vara en nivå 1–9.` };
    profile[axis.key] = lvl;
  }
  if (Object.keys(profile).length === 0) {
    return { ok: false, error: 'Sätt minst en nivå innan du sparar bedömningen.' };
  }
  let srl: number | null = null;
  if (input.srl !== undefined && input.srl !== null && input.srl !== '' && input.srl !== 0) {
    srl = normalizeIrlLevel(input.srl);
    if (srl === null) return { ok: false, error: 'Hållbarhet (SRL) måste vara en nivå 1–9.' };
  }
  let assessedAt = today;
  if (typeof input.assessedAt === 'string' && input.assessedAt.trim() !== '') {
    const d = input.assessedAt.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) {
      return { ok: false, error: 'Ogiltigt bedömningsdatum.' };
    }
    if (d > today) return { ok: false, error: 'Bedömningsdatumet kan inte ligga i framtiden.' };
    assessedAt = d;
  }
  return {
    ok: true,
    value: {
      profile,
      srl,
      axisNotes: normalizeIrlAxisNotes(input.axisNotes),
      note: cleanIrlText(input.note, IRL_NOTE_MAX),
      assessedAt
    }
  };
}

export interface IrlSummary {
  /** Antal bedömda axlar (0–6). */
  assessed: number;
  /** Medelvärde över bedömda axlar, en decimal; null när inget är bedömt. */
  average: number | null;
  min: number | null;
  max: number | null;
  /** Axlar på lägsta nivån — där nästa insats gör mest nytta. */
  weakest: IrlAxisKey[];
  strongest: IrlAxisKey[];
  /** Axlar som saknar nivå. */
  missing: IrlAxisKey[];
}

export function summarizeIrl(profile: IrlProfile): IrlSummary {
  const set = KTH_IRL_AXES.filter((a) => typeof profile[a.key] === 'number');
  const values = set.map((a) => profile[a.key] as number);
  const missing = KTH_IRL_AXES.filter((a) => typeof profile[a.key] !== 'number').map((a) => a.key);
  if (values.length === 0) {
    return { assessed: 0, average: null, min: null, max: null, weakest: [], strongest: [], missing };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const average = Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
  return {
    assessed: values.length,
    average,
    min,
    max,
    weakest: set.filter((a) => profile[a.key] === min).map((a) => a.key),
    strongest: max > min ? set.filter((a) => profile[a.key] === max).map((a) => a.key) : [],
    missing
  };
}

export interface IrlAxisDelta {
  key: IrlAxisKey;
  from: number | null;
  to: number | null;
  /** to − from när båda finns, annars null. */
  delta: number | null;
}

/** Förändring per axel mellan två bedömningar (äldre → nyare). */
export function diffIrlProfiles(previous: IrlProfile, current: IrlProfile): IrlAxisDelta[] {
  return KTH_IRL_AXES.map((a) => {
    const from = typeof previous[a.key] === 'number' ? (previous[a.key] as number) : null;
    const to = typeof current[a.key] === 'number' ? (current[a.key] as number) : null;
    return { key: a.key, from, to, delta: from !== null && to !== null ? to - from : null };
  });
}

/** Beskrivningen av nivån, eller null för en ogiltig nivå. */
export function irlLevelDescription(key: IrlAxisKey, level: number | null | undefined): string | null {
  const lvl = normalizeIrlLevel(level);
  return lvl === null ? null : irlAxis(key).levels[lvl - 1] ?? null;
}

/** Vad nästa nivå kräver (null på nivå 9 eller utan nivå → nivå 1). */
export function irlNextStep(key: IrlAxisKey, level: number | null | undefined): string | null {
  const lvl = normalizeIrlLevel(level);
  if (lvl === IRL_MAX) return null;
  return irlAxis(key).levels[lvl === null ? 0 : lvl] ?? null;
}

export interface IrlRadarPoint {
  key: IrlAxisKey;
  /** Vinkel i radianer (0 = uppåt, medurs). */
  angle: number;
  x: number;
  y: number;
  /** Punkt för axelns ytterkant (nivå 9). */
  outerX: number;
  outerY: number;
  level: number | null;
}

/**
 * Radarns hörn. Axel i ligger på vinkeln i·60° medurs från toppen; en saknad
 * nivå ritas i centrum (0) men rapporteras som `level: null`.
 */
export function irlRadarPoints(
  profile: IrlProfile,
  geometry: { cx: number; cy: number; r: number }
): IrlRadarPoint[] {
  const n = KTH_IRL_AXES.length;
  return KTH_IRL_AXES.map((axis, i) => {
    const angle = (i * 2 * Math.PI) / n;
    const level = typeof profile[axis.key] === 'number' ? (profile[axis.key] as number) : null;
    const rr = ((level ?? 0) / IRL_MAX) * geometry.r;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    return {
      key: axis.key,
      angle,
      x: round2(geometry.cx + rr * sin),
      y: round2(geometry.cy - rr * cos),
      outerX: round2(geometry.cx + geometry.r * sin),
      outerY: round2(geometry.cy - geometry.r * cos),
      level
    };
  });
}

/** Ring för nivå `level` (1–9) som polygonpunkter "x,y x,y …". */
export function irlRingPoints(level: number, geometry: { cx: number; cy: number; r: number }): string {
  const n = KTH_IRL_AXES.length;
  const rr = (level / IRL_MAX) * geometry.r;
  return Array.from({ length: n }, (_, i) => {
    const a = (i * 2 * Math.PI) / n;
    return `${round2(geometry.cx + rr * Math.sin(a))},${round2(geometry.cy - rr * Math.cos(a))}`;
  }).join(' ');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
