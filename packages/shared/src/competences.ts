// ── Kompetenstaxonomi (migration 1700000130) ────────────────────────────────
// CLAUDE.md § 29. Fast Movexum-taxonomi över de kompetenser som "kopplas på"
// tvärfunktionella team (omorganisationen 2026-11). Den används för att tagga
// personer (users.competences) och externa resurser (contacts.skills tolkas mot
// listan) samt som whitelist åt team-matchnings-AI:n (lib/ai/team-match.ts).
//
// Listan är medvetet liten och förutsägbar — UI:t (kompetenschips, profil-
// formuläret) designas kring den, och en osäker AI-gissning faller tillbaka på
// människa-i-loopen i stället för att hitta på en ny kompetens.
//
// Lägg ALDRIG till en kompetens här utan att även utöka select-värdena i en
// migration (fältet `users.competences` är en PB-select) samt spegla i
// scripts/setup-via-api.mjs.

export type CompetenceId =
  | 'affarscoaching'
  | 'affarsutveckling'
  | 'projektledning'
  | 'kommunikation'
  | 'hr_personal'
  | 'juridik'
  | 'finansiering_kapital'
  | 'ai_teknik'
  | 'hallbarhet'
  | 'internationalisering'
  | 'boost_chamber'
  | 'design'
  | 'branschspecifik'
  | 'annat';

export interface CompetenceDef {
  id: CompetenceId;
  /** Visningsnamn i UI (svenska). */
  label: string;
  /** Kort beskrivning — matas till team-matchnings-AI:n som ledtråd. */
  description: string;
  /** Synonymer/nyckelord (svenska) — hjälper både AI:n och fritext-tolkning
   * av contacts.skills att mappa till rätt kompetens. */
  keywords: string[];
  /** Ikonnamn i proto/Icon. */
  icon: string;
}

/** Default-kompetensen för osäkra/övriga taggar. */
export const DEFAULT_COMPETENCE: CompetenceId = 'annat';

/**
 * Källan av sanning för kompetenstaxonomin. Ordningen styr renderingen
 * (annat sist).
 */
export const COMPETENCES: readonly CompetenceDef[] = [
  {
    id: 'affarscoaching',
    label: 'Affärscoaching',
    description:
      'Coachning av grundare och team, affärsmodell, kundvalidering, säljutveckling.',
    keywords: ['coach', 'coaching', 'affärscoach', 'mentor', 'sälj', 'kundvalidering', 'affärsmodell'],
    icon: 'compass'
  },
  {
    id: 'affarsutveckling',
    label: 'Affärsutveckling & strategi',
    description:
      'Strategi, tillväxtplaner, go-to-market, partnerskap och affärsutveckling.',
    keywords: ['strategi', 'affärsutveckling', 'tillväxt', 'go-to-market', 'gtm', 'partnerskap', 'business development'],
    icon: 'target'
  },
  {
    id: 'projektledning',
    label: 'Projektledning',
    description:
      'Leda projekt och processer, planering, koordinering, leverans och uppföljning.',
    keywords: ['projektledning', 'projektledare', 'process', 'planering', 'koordinering', 'leverans', 'agil'],
    icon: 'flow'
  },
  {
    id: 'kommunikation',
    label: 'Kommunikation & paketering',
    description:
      'Kommunikation, marknadsföring, paketering, pitch, content, event och PR.',
    keywords: ['kommunikation', 'kommunikatör', 'marknad', 'marknadsföring', 'paketering', 'pitch', 'content', 'pr', 'event'],
    icon: 'message'
  },
  {
    id: 'hr_personal',
    label: 'HR & personal',
    description:
      'HR, rekrytering, arbetsmiljö, skyddsombud, ledarskap, regionens rutiner, Sobona.',
    keywords: ['hr', 'personal', 'rekrytering', 'arbetsmiljö', 'skyddsombud', 'ledarskap', 'sobona', 'handledning'],
    icon: 'people'
  },
  {
    id: 'juridik',
    label: 'Juridik & avtal',
    description:
      'Avtal, bolagsrätt, IP/patent, GDPR, statsstöd och regelefterlevnad.',
    keywords: ['juridik', 'jurist', 'avtal', 'ip', 'patent', 'gdpr', 'statsstöd', 'regelverk', 'compliance'],
    icon: 'shield'
  },
  {
    id: 'finansiering_kapital',
    label: 'Finansiering & kapital',
    description:
      'Kapitalanskaffning, investerare, term sheets, ekonomi, budget, offentlig finansiering (Vinnova/EU).',
    keywords: ['finansiering', 'kapital', 'investerare', 'ekonomi', 'budget', 'term sheet', 'vinnova', 'eu', 'bidrag', 'de minimis', 'cfo'],
    icon: 'graph'
  },
  {
    id: 'ai_teknik',
    label: 'AI & teknik',
    description:
      'AI, mjukvara, produktutveckling, datadrivna lösningar och teknisk validering.',
    keywords: ['ai', 'teknik', 'tech', 'mjukvara', 'utvecklare', 'produkt', 'data', 'deeptech', 'cto'],
    icon: 'bolt'
  },
  {
    id: 'hallbarhet',
    label: 'Hållbarhet & ESG',
    description:
      'Hållbarhet, ESG, miljö, klimat, impact och hållbara affärsmodeller.',
    keywords: ['hållbarhet', 'esg', 'miljö', 'klimat', 'impact', 'sustainability'],
    icon: 'spark'
  },
  {
    id: 'internationalisering',
    label: 'Internationalisering',
    description:
      'Export, marknadsetablering utomlands, internationell expansion och nätverk.',
    keywords: ['internationalisering', 'export', 'utland', 'expansion', 'eoi', 'internationell'],
    icon: 'globe'
  },
  {
    id: 'boost_chamber',
    label: 'Boost Chamber / spets',
    description:
      'Boost Chamber-kompetens, SPARK/spetsprogram och avancerad bolagsutveckling.',
    keywords: ['boost chamber', 'bc', 'spark', 'spets', 'prestep', 'accelerator'],
    icon: 'star'
  },
  {
    id: 'design',
    label: 'Design & UX',
    description:
      'Design, UX/UI, varumärke, visuell identitet och prototyper.',
    keywords: ['design', 'ux', 'ui', 'varumärke', 'brand', 'grafisk', 'prototyp'],
    icon: 'image'
  },
  {
    id: 'branschspecifik',
    label: 'Branschspecifik kunskap',
    description:
      'Djup domän-/branschkunskap (t.ex. life science, industri, energi, offentlig sektor).',
    keywords: ['bransch', 'domän', 'life science', 'industri', 'energi', 'offentlig', 'medtech', 'foodtech'],
    icon: 'briefcase'
  },
  {
    id: 'annat',
    label: 'Annat',
    description: 'Kompetens som inte passar i någon annan kategori.',
    icon: 'user',
    keywords: []
  }
] as const;

export const COMPETENCE_IDS: readonly CompetenceId[] = COMPETENCES.map((c) => c.id);

export const COMPETENCE_LABELS: Record<CompetenceId, string> = COMPETENCES.reduce(
  (acc, c) => {
    acc[c.id] = c.label;
    return acc;
  },
  {} as Record<CompetenceId, string>
);

/** Typ-säker check att en sträng är en giltig kompetens. */
export function isCompetenceId(value: unknown): value is CompetenceId {
  return typeof value === 'string' && (COMPETENCE_IDS as string[]).includes(value);
}

/** Normaliserar en (möjligen ogiltig) sträng till en giltig kompetens. */
export function resolveCompetence(value: unknown): CompetenceId {
  return isCompetenceId(value) ? value : DEFAULT_COMPETENCE;
}

/** Filtrerar en lista till bara giltiga, unika kompetens-id:n (taxonomi-ordning). */
export function sanitizeCompetences(values: unknown): CompetenceId[] {
  if (!Array.isArray(values)) return [];
  const wanted = new Set(values.filter(isCompetenceId));
  return COMPETENCE_IDS.filter((id) => wanted.has(id));
}

/**
 * Tolkar fritext (t.ex. `contacts.skills`, kommaseparerat) till kompetens-id:n
 * via nyckelords-/etikettmatchning. Heuristisk och avsiktligt konservativ —
 * används bara för att berika kandidatlistan åt matchnings-AI:n, aldrig som
 * säkerhetsgräns.
 */
export function inferCompetencesFromText(text: string | null | undefined): CompetenceId[] {
  if (!text || typeof text !== 'string') return [];
  const hay = text.toLowerCase();
  const hits = new Set<CompetenceId>();
  for (const c of COMPETENCES) {
    if (c.id === 'annat') continue;
    if (hay.includes(c.label.toLowerCase())) {
      hits.add(c.id);
      continue;
    }
    for (const kw of c.keywords) {
      if (kw.length >= 3 && hay.includes(kw.toLowerCase())) {
        hits.add(c.id);
        break;
      }
    }
  }
  return COMPETENCE_IDS.filter((id) => hits.has(id));
}
