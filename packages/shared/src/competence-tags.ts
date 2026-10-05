// ── Kompetens-hashtags, nivåer, belastning & teamrankning ───────────────────
// CLAUDE.md § 29.7. Ren, enhetstestad domänlogik (ingen IO, ingen React).
//
// De 14 kompetensOMRÅDENA (competences.ts) är rubriker. Under dem sätter
// personalen HASHTAGS = specialiseringar ("#vinnova-ansökan", "#medtech") med
// en NIVÅ (kan bidra / stark / expert) och kan markera taggar hen VILL
// UTVECKLAS inom. Vokabulären är tenant-gemensam och växer kontrollerat: en
// seedad lista + taggar kollegor lagt till (synliga i autocompleten så språket
// konvergerar). Fritext normaliseras alltid till slug.
//
// Teamförslaget räknar FÖRST, frågar AI:n SIST: behovet (områden + taggar)
// matchas deterministiskt mot kandidaternas taggar/nivåer, bolagsrelation och
// NUVARANDE BELASTNING (antal aktiva team) → en rankad, förklarbar shortlist.
// Modellen får bara sätta ihop teamet ur shortlistan.
//
// GDPR § 5: yrkeskompetens (berättigat intresse), inte art. 9. Taggar får
// aldrig innehålla personuppgifter — slug-normaliseringen och UI-texten säger
// det, och personnummer-mönster avvisas. `users` är fortsatt denylistad för
// chatten; taggarna läses bara av den isolerade matcharen.

import {
  COMPETENCES,
  COMPETENCE_IDS,
  COMPETENCE_LABELS,
  isCompetenceId,
  type CompetenceId
} from './competences';

// ── Nivåer ──────────────────────────────────────────────────────────────────

export const COMPETENCE_LEVELS = ['contribute', 'strong', 'expert'] as const;
export type CompetenceLevel = (typeof COMPETENCE_LEVELS)[number];

export const COMPETENCE_LEVEL_LABELS: Record<CompetenceLevel, string> = {
  contribute: 'Kan bidra',
  strong: 'Stark',
  expert: 'Expert'
};

/** Vikt per nivå i rankningen (expert räknas tre gånger "kan bidra"). */
export const COMPETENCE_LEVEL_WEIGHT: Record<CompetenceLevel, number> = {
  contribute: 1,
  strong: 2,
  expert: 3
};

export function isCompetenceLevel(value: unknown): value is CompetenceLevel {
  return typeof value === 'string' && (COMPETENCE_LEVELS as readonly string[]).includes(value);
}

// ── Taggar ──────────────────────────────────────────────────────────────────

export const COMPETENCE_TAG_MAX_LENGTH = 40;
export const USER_COMPETENCE_TAGS_MAX = 40;
export const DEVELOPMENT_INTERESTS_MAX = 10;

export interface CompetenceTagDef {
  /** Normaliserad slug, det som lagras på personer (`#vinnova-ansokan`). */
  slug: string;
  /** Visningsnamn (utan #). */
  label: string;
  /** Kompetensområde taggen sorteras under. */
  area: CompetenceId;
}

export interface UserCompetenceTag {
  tag: string;
  area: CompetenceId;
  level: CompetenceLevel;
}

const PERSONNUMMER_RE = /\d{6,8}[-+]?\d{4}/;

/**
 * Normaliserar fritext till en tagg-slug: gemener, utan #, mellanslag/
 * understreck → bindestreck, bara a-z0-9åäö och bindestreck, max 40 tecken.
 * Tom sträng = ogiltig.
 */
export function normalizeCompetenceTagSlug(input: unknown): string {
  if (typeof input !== 'string') return '';
  if (PERSONNUMMER_RE.test(input)) return '';
  let s = input.trim().toLowerCase().replace(/^#+/, '');
  s = s
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9åäöéü-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, COMPETENCE_TAG_MAX_LENGTH);
}

/** Visningsetikett ur en slug när vokabulären saknar en bättre. */
export function competenceTagLabelFromSlug(slug: string): string {
  return slug.replace(/-/g, ' ');
}

/**
 * Seedad startvokabulär ur Movexums vardag (migration 1700000178 skriver
 * den per tenant). Lägg hellre till här än i fri text — men nya taggar via
 * profilen är tillåtna och landar i tenantens lista.
 */
export const COMPETENCE_TAG_SEED: readonly CompetenceTagDef[] = [
  // Affärscoaching
  { slug: 'affarsmodell', label: 'Affärsmodell', area: 'affarscoaching' },
  { slug: 'kundvalidering', label: 'Kundvalidering', area: 'affarscoaching' },
  { slug: 'b2b-salj', label: 'B2B-sälj', area: 'affarscoaching' },
  { slug: 'b2c', label: 'B2C', area: 'affarscoaching' },
  { slug: 'prissattning', label: 'Prissättning', area: 'affarscoaching' },
  { slug: 'grundarcoaching', label: 'Grundarcoaching', area: 'affarscoaching' },
  { slug: 'irl-bedomning', label: 'IRL-bedömning', area: 'affarscoaching' },
  // Affärsutveckling & strategi
  { slug: 'go-to-market', label: 'Go-to-market', area: 'affarsutveckling' },
  { slug: 'tillvaxtstrategi', label: 'Tillväxtstrategi', area: 'affarsutveckling' },
  { slug: 'partnerskap', label: 'Partnerskap', area: 'affarsutveckling' },
  { slug: 'styrelsearbete', label: 'Styrelsearbete', area: 'affarsutveckling' },
  { slug: 'exit-forberedelse', label: 'Exit-förberedelse', area: 'affarsutveckling' },
  // Projektledning
  { slug: 'projektledning-agil', label: 'Agil projektledning', area: 'projektledning' },
  { slug: 'eu-projekt', label: 'EU-projekt', area: 'projektledning' },
  { slug: 'vinnova-rapportering', label: 'Vinnova-rapportering', area: 'projektledning' },
  { slug: 'upphandling', label: 'Upphandling', area: 'projektledning' },
  { slug: 'eventproduktion', label: 'Eventproduktion', area: 'projektledning' },
  // Kommunikation & paketering
  { slug: 'pitchtraning', label: 'Pitchträning', area: 'kommunikation' },
  { slug: 'storytelling', label: 'Storytelling', area: 'kommunikation' },
  { slug: 'linkedin', label: 'LinkedIn', area: 'kommunikation' },
  { slug: 'pr-media', label: 'PR & media', area: 'kommunikation' },
  { slug: 'nyhetsbrev', label: 'Nyhetsbrev', area: 'kommunikation' },
  { slug: 'content-produktion', label: 'Content-produktion', area: 'kommunikation' },
  // HR & personal
  { slug: 'rekrytering', label: 'Rekrytering', area: 'hr_personal' },
  { slug: 'ledarskap', label: 'Ledarskap', area: 'hr_personal' },
  { slug: 'teamutveckling', label: 'Teamutveckling', area: 'hr_personal' },
  { slug: 'arbetsmiljo', label: 'Arbetsmiljö', area: 'hr_personal' },
  // Juridik & avtal
  { slug: 'aktieagaravtal', label: 'Aktieägaravtal', area: 'juridik' },
  { slug: 'ip-strategi', label: 'IP-strategi', area: 'juridik' },
  { slug: 'gdpr', label: 'GDPR', area: 'juridik' },
  { slug: 'statsstod', label: 'Statsstöd', area: 'juridik' },
  { slug: 'de-minimis', label: 'De minimis', area: 'juridik' },
  { slug: 'bolagsbildning', label: 'Bolagsbildning', area: 'juridik' },
  // Finansiering & kapital
  { slug: 'vinnova-ansokan', label: 'Vinnova-ansökan', area: 'finansiering_kapital' },
  { slug: 'eic', label: 'EIC', area: 'finansiering_kapital' },
  { slug: 'almi', label: 'Almi', area: 'finansiering_kapital' },
  { slug: 'angelinvesterare', label: 'Ängelinvesterare', area: 'finansiering_kapital' },
  { slug: 'vc', label: 'Riskkapital (VC)', area: 'finansiering_kapital' },
  { slug: 'term-sheet', label: 'Term sheet', area: 'finansiering_kapital' },
  { slug: 'budget-prognos', label: 'Budget & prognos', area: 'finansiering_kapital' },
  { slug: 'vardering', label: 'Värdering', area: 'finansiering_kapital' },
  { slug: 'stodcheckar', label: 'Stödcheckar', area: 'finansiering_kapital' },
  // AI & teknik
  { slug: 'ai-strategi', label: 'AI-strategi', area: 'ai_teknik' },
  { slug: 'saas', label: 'SaaS', area: 'ai_teknik' },
  { slug: 'produktutveckling', label: 'Produktutveckling', area: 'ai_teknik' },
  { slug: 'mvp', label: 'MVP', area: 'ai_teknik' },
  { slug: 'data-analys', label: 'Data & analys', area: 'ai_teknik' },
  { slug: 'cybersakerhet', label: 'Cybersäkerhet', area: 'ai_teknik' },
  // Hållbarhet & ESG
  { slug: 'esg-rapportering', label: 'ESG-rapportering', area: 'hallbarhet' },
  { slug: 'klimatberakning', label: 'Klimatberäkning', area: 'hallbarhet' },
  { slug: 'cirkular-ekonomi', label: 'Cirkulär ekonomi', area: 'hallbarhet' },
  { slug: 'impact-matning', label: 'Impact-mätning', area: 'hallbarhet' },
  // Internationalisering
  { slug: 'export', label: 'Export', area: 'internationalisering' },
  { slug: 'eoi', label: 'EoI', area: 'internationalisering' },
  { slug: 'norden', label: 'Norden', area: 'internationalisering' },
  { slug: 'usa', label: 'USA', area: 'internationalisering' },
  { slug: 'tyskland-dach', label: 'Tyskland/DACH', area: 'internationalisering' },
  // Boost Chamber / spets
  { slug: 'boost-chamber', label: 'Boost Chamber', area: 'boost_chamber' },
  { slug: 'spark', label: 'SPARK', area: 'boost_chamber' },
  { slug: 'deeptech', label: 'Deeptech', area: 'boost_chamber' },
  // Design & UX
  { slug: 'ux-research', label: 'UX-research', area: 'design' },
  { slug: 'varumarke', label: 'Varumärke', area: 'design' },
  { slug: 'prototyper', label: 'Prototyper', area: 'design' },
  // Branschspecifik kunskap
  { slug: 'medtech', label: 'Medtech', area: 'branschspecifik' },
  { slug: 'life-science', label: 'Life science', area: 'branschspecifik' },
  { slug: 'industri', label: 'Industri', area: 'branschspecifik' },
  { slug: 'energi', label: 'Energi', area: 'branschspecifik' },
  { slug: 'foodtech', label: 'Foodtech', area: 'branschspecifik' },
  { slug: 'offentlig-sektor', label: 'Offentlig sektor', area: 'branschspecifik' },
  { slug: 'besoksnaring', label: 'Besöksnäring', area: 'branschspecifik' },
  { slug: 'skog-tra', label: 'Skog & trä', area: 'branschspecifik' },
  { slug: 'gaming', label: 'Gaming', area: 'branschspecifik' }
] as const;

/**
 * Sanerar en visningsetikett: bara bokstäver, siffror, mellanslag och
 * `& / ( ) + . -`, max 60 tecken. Etiketter når Mistral-prompten (behovs-
 * tolkningen), så fri text släpps aldrig igenom (prompt-injection, § 9.3).
 */
export function sanitizeCompetenceTagLabel(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[^\p{L}\p{N} &/()+.-]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * Slår ihop seed + tenantens egna taggar till en vokabulär (unik per slug).
 * Bara GODKÄNDA taggar får bära sin egen etikett; en `suggested`-tagg visas
 * med slug-härledd etikett tills ledningen godkänt den (en kollega ska inte
 * kunna sätta fri text som alla ser och som når prompten).
 */
export function mergeCompetenceTagVocabulary(
  extra: ReadonlyArray<{ slug?: unknown; label?: unknown; area?: unknown; status?: unknown }>
): CompetenceTagDef[] {
  const bySlug = new Map<string, CompetenceTagDef>();
  for (const t of COMPETENCE_TAG_SEED) bySlug.set(t.slug, t);
  for (const raw of extra) {
    const slug = normalizeCompetenceTagSlug(raw.slug);
    if (!slug || bySlug.has(slug)) continue;
    const area = isCompetenceId(raw.area) ? raw.area : 'annat';
    const approved = raw.status === 'approved';
    const cleanLabel = approved ? sanitizeCompetenceTagLabel(raw.label) : '';
    const label = cleanLabel || competenceTagLabelFromSlug(slug);
    bySlug.set(slug, { slug, label, area });
  }
  return Array.from(bySlug.values());
}

export function competenceTagsByArea(
  vocabulary: readonly CompetenceTagDef[]
): Array<{ area: CompetenceId; label: string; tags: CompetenceTagDef[] }> {
  return COMPETENCE_IDS.map((area) => ({
    area,
    label: COMPETENCE_LABELS[area],
    tags: vocabulary.filter((t) => t.area === area)
  })).filter((g) => g.tags.length > 0 || g.area !== 'annat');
}

/**
 * Sanerar en lista av användartaggar (från formulär eller DB): normaliserad
 * slug, giltigt område (okänt → vokabulärens, annars `annat`), giltig nivå
 * (okänd → `contribute`), unika, max 40. Klienten är aldrig säkerhetsgränsen.
 */
export function sanitizeUserCompetenceTags(
  values: unknown,
  vocabulary: readonly CompetenceTagDef[] = COMPETENCE_TAG_SEED
): UserCompetenceTag[] {
  if (!Array.isArray(values)) return [];
  const areaBySlug = new Map(vocabulary.map((t) => [t.slug, t.area]));
  const out: UserCompetenceTag[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { tag?: unknown; area?: unknown; level?: unknown };
    const tag = normalizeCompetenceTagSlug(r.tag);
    if (!tag || seen.has(tag)) continue;
    const area: CompetenceId = isCompetenceId(r.area)
      ? r.area
      : (areaBySlug.get(tag) ?? 'annat');
    const level: CompetenceLevel = isCompetenceLevel(r.level) ? r.level : 'contribute';
    out.push({ tag, area, level });
    seen.add(tag);
    if (out.length >= USER_COMPETENCE_TAGS_MAX) break;
  }
  return out;
}

/** Sanerar "vill utvecklas inom" (slugs, unika, max 10). */
export function sanitizeDevelopmentInterests(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const raw of values) {
    const slug = normalizeCompetenceTagSlug(raw);
    if (slug && !out.includes(slug)) out.push(slug);
    if (out.length >= DEVELOPMENT_INTERESTS_MAX) break;
  }
  return out;
}

/** Härleder kompetensOMRÅDEN (users.competences) ur taggarna, i taxonomiordning. */
export function deriveCompetenceAreas(tags: readonly UserCompetenceTag[]): CompetenceId[] {
  const set = new Set(tags.map((t) => t.area));
  return COMPETENCE_IDS.filter((id) => set.has(id));
}

/** Högsta nivå per område ur taggarna. */
export function areaLevels(tags: readonly UserCompetenceTag[]): Partial<Record<CompetenceId, CompetenceLevel>> {
  const out: Partial<Record<CompetenceId, CompetenceLevel>> = {};
  for (const t of tags) {
    const cur = out[t.area];
    if (!cur || COMPETENCE_LEVEL_WEIGHT[t.level] > COMPETENCE_LEVEL_WEIGHT[cur]) out[t.area] = t.level;
  }
  return out;
}

// ── Belastning ──────────────────────────────────────────────────────────────

/** Uppdragsstatusar som räknas som pågående team. Utkast och klara räknas inte. */
export const ACTIVE_MISSION_STATUSES = ['preparation', 'in_progress', 'review'] as const;

export interface TeamMemberLoad {
  /** Antal pågående team personen ingår i. */
  active: number;
  /** …varav som ansvarig (lead/utfärdare). */
  leading: number;
}

export const EMPTY_LOAD: TeamMemberLoad = { active: 0, leading: 0 };

export type LoadLevel = 'free' | 'normal' | 'high' | 'full';

export const LOAD_LEVEL_LABELS: Record<LoadLevel, string> = {
  free: 'Ledig',
  normal: 'Normal belastning',
  high: 'Hög belastning',
  full: 'Fullbelagd'
};

/** Trösklar (aktiva team) — ansvarig räknas som ett extra team. */
export const LOAD_THRESHOLDS = { normalMax: 2, highMax: 4 } as const;

/** Viktad belastning: varje team 1, varje ansvar +1. */
export function weightedLoad(load: TeamMemberLoad): number {
  return Math.max(0, load.active) + Math.max(0, load.leading);
}

export function loadLevel(load: TeamMemberLoad): LoadLevel {
  const w = weightedLoad(load);
  if (w === 0) return 'free';
  if (w <= LOAD_THRESHOLDS.normalMax) return 'normal';
  if (w <= LOAD_THRESHOLDS.highMax) return 'high';
  return 'full';
}

/** Poängjustering i rankningen: ledig lyfts, hög/full belastning dras ned. */
export const LOAD_SCORE_ADJUST: Record<LoadLevel, number> = {
  free: 0.5,
  normal: 0,
  high: -1.5,
  full: -3
};

export function describeLoad(load: TeamMemberLoad): string {
  if (load.active === 0) return 'Inga pågående team';
  const base = `${load.active} pågående team`;
  return load.leading > 0 ? `${base}, ansvarig i ${load.leading}` : base;
}

export interface MissionLoadRow {
  status: string;
  issuer?: string | null;
  mentor?: string | null;
  recipients?: readonly string[] | null;
  participants_json?: ReadonlyArray<{ user_id?: unknown; role?: unknown }> | null;
}

/**
 * Räknar NUVARANDE belastning per person ur uppdragslistan: ett pågående
 * uppdrag räknas en gång per person oavsett hur många vägar hen är kopplad
 * (utfärdare, mottagare, deltagare); ansvarig = `lead` i participants_json
 * eller utfärdare utan deltagarlista.
 */
export function computeTeamLoads(missions: readonly MissionLoadRow[]): Map<string, TeamMemberLoad> {
  const out = new Map<string, TeamMemberLoad>();
  const bump = (id: string, leading: boolean) => {
    const cur = out.get(id) ?? { active: 0, leading: 0 };
    out.set(id, { active: cur.active + 1, leading: cur.leading + (leading ? 1 : 0) });
  };
  for (const m of missions) {
    if (!(ACTIVE_MISSION_STATUSES as readonly string[]).includes(m.status)) continue;
    const members = new Map<string, boolean>();
    const participants = Array.isArray(m.participants_json) ? m.participants_json : [];
    for (const p of participants) {
      if (!p || typeof p.user_id !== 'string' || !p.user_id) continue;
      const isLead = p.role === 'lead';
      members.set(p.user_id, (members.get(p.user_id) ?? false) || isLead);
    }
    if (m.issuer) members.set(m.issuer, (members.get(m.issuer) ?? false) || participants.length === 0);
    if (m.mentor) members.set(m.mentor, members.get(m.mentor) ?? false);
    for (const r of m.recipients ?? []) if (r) members.set(r, members.get(r) ?? false);
    for (const [id, leading] of members) bump(id, leading);
  }
  return out;
}

// ── Behov & rankning ────────────────────────────────────────────────────────

export interface TeamNeed {
  areas: CompetenceId[];
  tags: string[];
}

/**
 * Heuristisk behovstolkning ur fritext (fallback när AI:n inte svarar, och
 * komplement till den): träffar på taggarnas etikett/slug och områdenas
 * nyckelord. Konservativ — hellre färre, säkra träffar.
 */
export function inferTeamNeedFromText(
  text: string,
  vocabulary: readonly CompetenceTagDef[] = COMPETENCE_TAG_SEED
): TeamNeed {
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9åäöéü#\s-]/g, ' ')} `;
  const tags = new Set<string>();
  const areas = new Set<CompetenceId>();
  for (const t of vocabulary) {
    const label = t.label.toLowerCase();
    const slugWords = t.slug.replace(/-/g, ' ');
    if (
      (label.length >= 3 && hay.includes(label)) ||
      hay.includes(`#${t.slug}`) ||
      (slugWords.length >= 4 && hay.includes(` ${slugWords} `))
    ) {
      tags.add(t.slug);
      areas.add(t.area);
    }
  }
  for (const c of COMPETENCES) {
    if (c.id === 'annat') continue;
    if (c.keywords.some((kw) => kw.length >= 4 && hay.includes(kw.toLowerCase()))) areas.add(c.id);
  }
  return {
    areas: COMPETENCE_IDS.filter((id) => areas.has(id)),
    tags: Array.from(tags)
  };
}

/** Sanerar ett behov (från AI eller fritext) mot taxonomi + vokabulär. */
export function sanitizeTeamNeed(
  raw: { areas?: unknown; tags?: unknown },
  vocabulary: readonly CompetenceTagDef[] = COMPETENCE_TAG_SEED
): TeamNeed {
  const known = new Set(vocabulary.map((t) => t.slug));
  const areaBySlug = new Map(vocabulary.map((t) => [t.slug, t.area]));
  const tags: string[] = [];
  const areas = new Set<CompetenceId>();
  for (const t of Array.isArray(raw.tags) ? raw.tags : []) {
    const slug = normalizeCompetenceTagSlug(t);
    if (slug && known.has(slug) && !tags.includes(slug)) {
      tags.push(slug);
      const a = areaBySlug.get(slug);
      if (a) areas.add(a);
    }
    if (tags.length >= 12) break;
  }
  for (const a of Array.isArray(raw.areas) ? raw.areas : []) {
    if (isCompetenceId(a) && a !== 'annat') areas.add(a);
  }
  return { areas: COMPETENCE_IDS.filter((id) => areas.has(id)), tags };
}

export interface RankableCandidate {
  id: string;
  name: string;
  title?: string;
  tags: readonly UserCompetenceTag[];
  /** Kompetensområden utan hashtag (äldre profiler) — räknas som "kan bidra". */
  areas?: readonly CompetenceId[];
  developmentInterests?: readonly string[];
  load: TeamMemberLoad;
  /** Har redan en relation till bolaget (coach/mentor för det). */
  relatedToStartup?: boolean;
  /** Meriter ur avslutade team (`computeTeamMerits`). */
  merit?: TeamMerit;
}

export interface RankedCandidate {
  id: string;
  name: string;
  title?: string;
  score: number;
  matchedTags: Array<{ tag: string; level: CompetenceLevel }>;
  matchedAreas: Array<{ area: CompetenceId; level: CompetenceLevel }>;
  developmentMatches: string[];
  load: TeamMemberLoad;
  loadLevel: LoadLevel;
  relatedToStartup: boolean;
  merit: TeamMerit;
  /** Läsbara skäl, PII-fria (taggar, områden, belastning, meriter). */
  reasons: string[];
}

export const TEAM_SHORTLIST_SIZE = 12;

/** Poängvikter — hashtag-träff väger mer än områdes-träff. */
const TAG_WEIGHT = 3;
const AREA_WEIGHT = 1.5;
const STARTUP_RELATION_BONUS = 2;
const DEVELOPMENT_BONUS = 0.75;
/** Meriter väger lätt: relevanta avslutade team (tak 3) och avslutade team totalt (tak 5). */
const MERIT_RELEVANT_BONUS = 0.75;
const MERIT_RELEVANT_CAP = 3;
const MERIT_COMPLETED_BONUS = 0.15;
const MERIT_COMPLETED_CAP = 5;

/**
 * Deterministisk rankning av kandidater mot ett behov. Resultatet är sorterat
 * (högst poäng först, lika poäng → lägre belastning → namn). Kandidater utan
 * någon träff och utan bolagsrelation får 0 och hamnar sist men behålls, så
 * anroparen kan visa dem som "ingen träff" om listan är kort.
 */
export function rankTeamCandidates(
  need: TeamNeed,
  candidates: readonly RankableCandidate[]
): RankedCandidate[] {
  const needTags = new Set(need.tags);
  const needAreas = new Set(need.areas);
  const ranked = candidates.map<RankedCandidate>((c) => {
    const reasons: string[] = [];
    let score = 0;
    const matchedTags: RankedCandidate['matchedTags'] = [];
    for (const t of c.tags) {
      if (needTags.has(t.tag)) {
        matchedTags.push({ tag: t.tag, level: t.level });
        score += TAG_WEIGHT * COMPETENCE_LEVEL_WEIGHT[t.level];
      }
    }
    const levels = areaLevels(c.tags);
    for (const a of c.areas ?? []) if (!levels[a]) levels[a] = 'contribute';
    const matchedAreas: RankedCandidate['matchedAreas'] = [];
    for (const area of need.areas) {
      const lvl = levels[area];
      if (lvl) {
        matchedAreas.push({ area, level: lvl });
        score += AREA_WEIGHT * COMPETENCE_LEVEL_WEIGHT[lvl];
      }
    }
    const developmentMatches = (c.developmentInterests ?? []).filter((s) => needTags.has(s));
    score += DEVELOPMENT_BONUS * developmentMatches.length;
    const relatedToStartup = Boolean(c.relatedToStartup);
    if (relatedToStartup) score += STARTUP_RELATION_BONUS;
    const merit = c.merit ?? EMPTY_MERIT;
    score +=
      MERIT_RELEVANT_BONUS * Math.min(MERIT_RELEVANT_CAP, merit.relevant) +
      MERIT_COMPLETED_BONUS * Math.min(MERIT_COMPLETED_CAP, merit.completed);

    const lvl = loadLevel(c.load);
    const hasMatch = matchedTags.length > 0 || matchedAreas.length > 0 || relatedToStartup;
    if (hasMatch) score += LOAD_SCORE_ADJUST[lvl];
    score = Math.max(0, Math.round(score * 100) / 100);

    if (matchedTags.length > 0) {
      reasons.push(
        matchedTags
          .map((m) => `#${m.tag} (${COMPETENCE_LEVEL_LABELS[m.level].toLowerCase()})`)
          .join(', ')
      );
    }
    const tagAreas = new Set(matchedTags.map((m) => c.tags.find((x) => x.tag === m.tag)?.area));
    const areaOnly = matchedAreas.filter((a) => !tagAreas.has(a.area));
    if (areaOnly.length > 0) {
      reasons.push(areaOnly.map((a) => COMPETENCE_LABELS[a.area]).join(', '));
    }
    if (developmentMatches.length > 0) {
      reasons.push(`vill utvecklas inom ${developmentMatches.map((s) => `#${s}`).join(', ')}`);
    }
    if (relatedToStartup) reasons.push('arbetar redan med bolaget');
    const meritText = describeMerit(merit);
    if (meritText) reasons.push(meritText);
    reasons.push(describeLoad(c.load));

    return {
      id: c.id,
      name: c.name,
      title: c.title,
      score,
      matchedTags,
      matchedAreas,
      developmentMatches,
      load: c.load,
      loadLevel: lvl,
      relatedToStartup,
      merit,
      reasons
    };
  });

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      weightedLoad(a.load) - weightedLoad(b.load) ||
      a.name.localeCompare(b.name, 'sv')
  );
  return ranked;
}

export interface TeamNeedGaps {
  /** Efterfrågade taggar ingen kandidat har. */
  tags: string[];
  /** Efterfrågade områden ingen kandidat täcker. */
  areas: CompetenceId[];
}

/** Vilka delar av behovet som saknas helt bland kandidaterna (→ extern kompetens). */
export function teamNeedGaps(need: TeamNeed, candidates: readonly RankableCandidate[]): TeamNeedGaps {
  const haveTags = new Set<string>();
  const haveAreas = new Set<CompetenceId>();
  for (const c of candidates) {
    for (const t of c.tags) {
      haveTags.add(t.tag);
      haveAreas.add(t.area);
    }
    for (const a of c.areas ?? []) haveAreas.add(a);
  }
  return {
    tags: need.tags.filter((t) => !haveTags.has(t)),
    areas: need.areas.filter((a) => !haveAreas.has(a))
  };
}

// ── Meriter ur avslutade team (§ 29.7, steg 2) ──────────────────────────────
//
// Ett avslutat team är det enda beviset på att en kompetens faktiskt använts.
// `missions.needed_tags` (migration 1700000179) bär vilka hashtags teamet
// sattes ihop för; när ett nytt behov matchar dem får personen meritpoäng.
// Räknas live ur uppdragen, lagras aldrig, och väger lätt — självdeklarerad
// nivå och belastning är fortfarande huvudsignalerna. Ingen prestationsdom:
// bara "har ingått i N avslutade team, varav M med liknande behov".

export const COMPLETED_MISSION_STATUSES = ['done'] as const;
export const NEEDED_TAGS_MAX = 12;

export interface TeamMerit {
  /** Antal avslutade team personen ingått i. */
  completed: number;
  /** …varav team vars `needed_tags` överlappar det aktuella behovet. */
  relevant: number;
}

export const EMPTY_MERIT: TeamMerit = { completed: 0, relevant: 0 };

export interface MissionMeritRow extends MissionLoadRow {
  needed_tags?: unknown;
}

/** Sanerar en lista hashtag-slugs (behov på ett uppdrag), unika, cappad. */
export function sanitizeNeededTags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const raw of values) {
    const slug = normalizeCompetenceTagSlug(raw);
    if (slug && !out.includes(slug)) out.push(slug);
    if (out.length >= NEEDED_TAGS_MAX) break;
  }
  return out;
}

function missionMemberIds(m: MissionLoadRow): string[] {
  const ids = new Set<string>();
  for (const p of Array.isArray(m.participants_json) ? m.participants_json : []) {
    if (p && typeof p.user_id === 'string' && p.user_id) ids.add(p.user_id);
  }
  if (m.issuer) ids.add(m.issuer);
  if (m.mentor) ids.add(m.mentor);
  for (const r of m.recipients ?? []) if (r) ids.add(r);
  return Array.from(ids);
}

/**
 * Meriter per person ur AVSLUTADE uppdrag: `completed` = antal, `relevant` =
 * de vars `needed_tags` delar minst en hashtag med behovet.
 */
export function computeTeamMerits(
  missions: readonly MissionMeritRow[],
  needTags: readonly string[]
): Map<string, TeamMerit> {
  const need = new Set(needTags);
  const out = new Map<string, TeamMerit>();
  for (const m of missions) {
    if (!(COMPLETED_MISSION_STATUSES as readonly string[]).includes(m.status)) continue;
    const tags = sanitizeNeededTags(m.needed_tags);
    const relevant = tags.some((t) => need.has(t));
    for (const id of missionMemberIds(m)) {
      const cur = out.get(id) ?? { completed: 0, relevant: 0 };
      out.set(id, { completed: cur.completed + 1, relevant: cur.relevant + (relevant ? 1 : 0) });
    }
  }
  return out;
}

export function describeMerit(merit: TeamMerit): string | null {
  if (merit.completed === 0) return null;
  const base = `${merit.completed} avslutade team`;
  return merit.relevant > 0 ? `${base}, ${merit.relevant} med liknande behov` : base;
}

// ── Täckning & inaktuella profiler (§ 29.7, steg 3) ─────────────────────────

export interface CoverageProfile {
  id: string;
  name: string;
  tags: readonly UserCompetenceTag[];
  developmentInterests?: readonly string[];
}

export interface CompetenceCoverageRow {
  slug: string;
  label: string;
  area: CompetenceId;
  /** Antal personer med taggen. */
  people: number;
  byLevel: Record<CompetenceLevel, number>;
  maxLevel: CompetenceLevel | null;
  /** Personer som VILL utvecklas inom taggen (utan att ha den). */
  learners: number;
}

/** Täckning per hashtag i vokabulären (plus taggar som bara finns på personer). */
export function summarizeCompetenceCoverage(
  profiles: readonly CoverageProfile[],
  vocabulary: readonly CompetenceTagDef[]
): CompetenceCoverageRow[] {
  const rows = new Map<string, CompetenceCoverageRow>();
  const ensure = (slug: string, label: string, area: CompetenceId) => {
    let row = rows.get(slug);
    if (!row) {
      row = {
        slug,
        label,
        area,
        people: 0,
        byLevel: { contribute: 0, strong: 0, expert: 0 },
        maxLevel: null,
        learners: 0
      };
      rows.set(slug, row);
    }
    return row;
  };
  for (const t of vocabulary) ensure(t.slug, t.label, t.area);
  for (const p of profiles) {
    const seen = new Set<string>();
    for (const t of p.tags) {
      if (seen.has(t.tag)) continue;
      seen.add(t.tag);
      const row = ensure(t.tag, competenceTagLabelFromSlug(t.tag), t.area);
      row.people += 1;
      row.byLevel[t.level] += 1;
      if (!row.maxLevel || COMPETENCE_LEVEL_WEIGHT[t.level] > COMPETENCE_LEVEL_WEIGHT[row.maxLevel]) {
        row.maxLevel = t.level;
      }
    }
    for (const slug of p.developmentInterests ?? []) {
      if (seen.has(slug)) continue;
      const row = rows.get(slug);
      if (row) row.learners += 1;
    }
  }
  return Array.from(rows.values()).sort(
    (a, b) =>
      COMPETENCE_IDS.indexOf(a.area) - COMPETENCE_IDS.indexOf(b.area) ||
      b.people - a.people ||
      a.label.localeCompare(b.label, 'sv')
  );
}

/** Hashtags i vokabulären som ingen i organisationen har — grupperat per område. */
export function competenceCoverageGaps(
  coverage: readonly CompetenceCoverageRow[]
): Array<{ area: CompetenceId; label: string; tags: CompetenceCoverageRow[] }> {
  return COMPETENCE_IDS.map((area) => ({
    area,
    label: COMPETENCE_LABELS[area],
    tags: coverage.filter((r) => r.area === area && r.people === 0)
  })).filter((g) => g.tags.length > 0);
}

/**
 * Hashtags som efterfrågats av uppdrag (`needed_tags`) men som ingen har —
 * det tydligaste tecknet på ett kompetensgap att rekrytera/koppla externt för.
 */
export function uncoveredNeededTags(
  missions: readonly MissionMeritRow[],
  coverage: readonly CompetenceCoverageRow[]
): Array<{ slug: string; missions: number }> {
  const covered = new Set(coverage.filter((r) => r.people > 0).map((r) => r.slug));
  const counts = new Map<string, number>();
  for (const m of missions) {
    for (const slug of sanitizeNeededTags(m.needed_tags)) {
      if (covered.has(slug)) continue;
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([slug, n]) => ({ slug, missions: n }))
    .sort((a, b) => b.missions - a.missions || a.slug.localeCompare(b.slug, 'sv'));
}

/** Efter så många dagar räknas en kompetensprofil som inaktuell. */
export const COMPETENCE_PROFILE_STALE_DAYS = 180;

export type CompetenceProfileStatus = 'missing' | 'stale' | 'fresh' | 'unknown';

/**
 * `missing` = inga taggar alls; `stale` = taggar men senast uppdaterad för
 * mer än 180 dagar sedan; `unknown` = taggar utan tidsstämpel (sparade före
 * migration 1700000179); annars `fresh`.
 */
export function competenceProfileStatus(
  updatedAt: string | null | undefined,
  hasTags: boolean,
  now: Date = new Date()
): CompetenceProfileStatus {
  if (!hasTags) return 'missing';
  if (!updatedAt) return 'unknown';
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return 'unknown';
  const ageDays = (now.getTime() - t) / 86_400_000;
  return ageDays > COMPETENCE_PROFILE_STALE_DAYS ? 'stale' : 'fresh';
}

export const COMPETENCE_PROFILE_STATUS_LABELS: Record<CompetenceProfileStatus, string> = {
  missing: 'Saknar hashtags',
  stale: 'Inaktuell (> 6 mån)',
  fresh: 'Aktuell',
  unknown: 'Datum saknas'
};
