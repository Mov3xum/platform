/**
 * Technology Readiness Level (TRL) 1–9 — de UTFÖRLIGA kriterierna ur
 * KTH Innovation Readiness Level™ (© KTH Innovation, Creative Commons
 * BY-NC-SA, kthinnovationreadinesslevel.com), i Movexums svenska översättning.
 *
 * Används av SPARK (CLAUDE.md § 61.5/§ 61.7): företagets egen uppgift i
 * formuläret, Movexums bedömning inför acceleratorn och AI-förslaget läser
 * SAMMA kriterier härifrån. Bara TRL-axeln — KTH:s övriga axlar (CRL, BRL,
 * IPRL, TMRL, FRL) hör till bolagskortets IRL (§ 52.2, `kth-irl.ts`) och
 * används inte i SPARK.
 *
 * Regler:
 *  - Texten är en översättning, inte en omtolkning. Ändra den bara mot en ny
 *    utgåva av KTH:s material, aldrig för att "passa" ett enskilt fall.
 *  - Licensen kräver att källan anges där texten visas (`KTH_TRL_SOURCE`) och
 *    att bearbetningar delas på samma villkor. Icke-kommersiell användning.
 *
 * Ren modul, inga beroenden, enhetstestad (`spark.test.ts`).
 */

export interface KthTrlLevel {
  level: number;
  /** KTH:s korta formulering (termometern). */
  summary: string;
  /** Vad som ska vara uppfyllt för att nivån ska vara nådd. */
  criteria: readonly string[];
}

export interface KthTrlTerm {
  term: string;
  definition: string;
}

export const KTH_TRL_SOURCE =
  'Kriterierna följer KTH Innovation Readiness Level™ (© KTH Innovation, CC BY-NC-SA, kthinnovationreadinesslevel.com) i Movexums översättning.';

export const KTH_TRL_LEVELS: readonly KthTrlLevel[] = [
  {
    level: 1,
    summary: 'Intressanta forskningsresultat eller en första teknikidé har identifierats.',
    criteria: [
      'Forskningsresultat med möjlig nytta eller användbara tillämpningar har identifierats.',
      'Det finns en vag idé om en teknik som ska utvecklas.'
    ]
  },
  {
    level: 2,
    summary: 'Teknikkoncept och/eller tillämpning är formulerad.',
    criteria: [
      'Ett möjligt teknikkoncept är definierat och beskrivet.',
      'Praktiska tillämpningar kan definieras och undersökas men är spekulativa — det finns inga belägg eller någon detaljerad analys som visar att tekniken fungerar.'
    ]
  },
  {
    level: 3,
    summary: 'Proof-of-concept för kritiska funktioner och/eller egenskaper i laboratoriemiljö.',
    criteria: [
      'Tester i laboratoriemiljö (analytiska och/eller experimentella) av viktiga parametrar, egenskaper och funktioner visar att teknikkonceptet kan fungera och är genomförbart.',
      'Aktiv forskning och utveckling har inletts för att utveckla tekniken vidare.',
      'Det finns en första idé om slutanvändarnas krav, specifikationer och/eller användningsfall.'
    ]
  },
  {
    level: 4,
    summary: 'Tekniken är validerad i laboratoriemiljö.',
    criteria: [
      'Grundkomponenterna är integrerade och har visats fungera tillsammans och ge önskat resultat i laboratoriemiljö.',
      'Testresultaten ger första belägg för att teknikkonceptet kommer att fungera (första validering).'
    ]
  },
  {
    level: 5,
    summary: 'Tekniken är validerad i relevant miljö.',
    criteria: [
      'Grundkomponenterna är integrerade och testade i en mer realistisk form i en relevant miljö.',
      'Testresultaten ger belägg för att tekniken kommer att fungera (validering).',
      'Slutanvändarnas krav, specifikationer och/eller användningsfall är tydligare definierade utifrån återkoppling från användare.'
    ]
  },
  {
    level: 6,
    summary: 'Prototyp demonstrerad i relevant miljö.',
    criteria: [
      'En representativ modell eller prototyp av tekniken har visats fungera i en relevant miljö.',
      'Demonstrationen visar att de flesta viktiga prestandakraven uppfylls.'
    ]
  },
  {
    level: 7,
    summary: 'Prototyp demonstrerad i operationell miljö.',
    criteria: [
      'En prototyp nära eller i nivå med den kompletta tekniken har visats fungera i en operationell miljö.',
      'Slutanvändarnas krav, specifikationer och/eller användningsfall är kompletta.'
    ]
  },
  {
    level: 8,
    summary: 'Tekniken är komplett och demonstrerad i faktisk drift.',
    criteria: [
      'Den kompletta tekniken är bevisat fungerande i faktisk drift hos de första användarna.',
      'Tekniken uppfyller alla prestandakrav och specifikationer.',
      'Tekniken är komplett, funktionell, kompatibel och producerbar: den innehåller allt användaren behöver, fungerar som den ska, passar användarens processer och system och går att tillverka till rimlig kostnad.'
    ]
  },
  {
    level: 9,
    summary: 'Tekniken är komplett och bevisad i faktisk drift över tid.',
    criteria: [
      'Den kompletta tekniken är skalbar och bevisat fungerande i faktisk drift hos flera användare över tid.',
      'Utveckling, förbättring och optimering av teknik och produktion pågår löpande.'
    ]
  }
];

/** Begreppen kriterierna bygger på — KTH:s egna definitioner. */
export const KTH_TRL_TERMS: readonly KthTrlTerm[] = [
  {
    term: 'Teknik',
    definition: 'Produkten, tjänsten, metoden, systemet eller lösningen — det konkreta ni vill utveckla.'
  },
  {
    term: 'Laboratoriemiljö',
    definition: 'Miljön där tekniken vanligtvis utvecklas, ofta inte samma miljö som den ska användas i.'
  },
  {
    term: 'Relevant miljö',
    definition: 'Labb eller annan kontrollerad miljö som efterliknar de viktigaste och mest krävande förhållandena i den operationella miljön.'
  },
  {
    term: 'Operationell miljö',
    definition: 'Miljö som uppfyller alla operationella krav och specifikationer där slutanvändarna ska använda tekniken.'
  },
  {
    term: 'Faktisk drift',
    definition: 'Slutanvändarna använder tekniken på egen hand i sin dagliga verksamhet.'
  },
  {
    term: 'Representativ modell',
    definition: 'En fungerande form av tekniken, oftast i mindre skala, nära eller enligt operationell specifikation.'
  },
  {
    term: 'Prototyp',
    definition: 'Tekniken i en form som går att använda för att utvärdera slutproduktens tekniska genomförbarhet, tillverkningsbarhet eller nytta.'
  },
  {
    term: 'Validering',
    definition: 'Testresultat ger belägg för att tekniken kommer att fungera.'
  },
  {
    term: 'Visats fungera (demonstration)',
    definition: 'Uppfyller de flesta viktiga prestandakraven.'
  },
  {
    term: 'Bevisat fungerande',
    definition: 'Uppfyller alla prestandakrav och specifikationer.'
  },
  {
    term: 'Komplett teknik',
    definition:
      'Komplett (innehåller allt användaren behöver för att använda den), funktionell (allt fungerar som det ska för att lösa användarens problem eller behov), kompatibel (fungerar med människor, processer, mål, infrastruktur och system hos användaren) och producerbar (går att tillverka till rimlig kostnad).'
  }
];

export function kthTrlLevel(level: unknown): KthTrlLevel | null {
  const n = typeof level === 'string' ? Number(level) : level;
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  return KTH_TRL_LEVELS.find((l) => l.level === n) ?? null;
}

/** Kriterierna för en nivå; tom lista för ett okänt värde. */
export function kthTrlCriteria(level: unknown): readonly string[] {
  return kthTrlLevel(level)?.criteria ?? [];
}

/**
 * Skalan som promptunderlag: en rad per nivå med KTH:s korta formulering och
 * kriterierna, följt av begreppen. Samma text som människan ser.
 */
export function kthTrlPromptLines(): string[] {
  return [
    ...KTH_TRL_LEVELS.map((l) => `- TRL ${l.level}: ${l.summary} Kriterier: ${l.criteria.join(' ')}`),
    'Begrepp:',
    ...KTH_TRL_TERMS.map((t) => `- ${t.term}: ${t.definition}`)
  ];
}
