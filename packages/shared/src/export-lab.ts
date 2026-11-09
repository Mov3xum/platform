/**
 * Export Lab (CLAUDE.md § 58) — REN domänlogik för den AI-stödda
 * internationaliseringsanalysen per bolag: vokabulär (MÅSTE spegla migration
 * 1700000210), forskningsramverken analysen bygger på (Uppsala-modellen,
 * Born Global/INV, CAGE, Hofstede/Meyer, inträdesform, marknadsurval,
 * effectuation, exportmognad, KTH IRL), de FEM exportmognadsnivåerna, de SEX
 * mognadsdimensionerna med sin IRL-koppling, regelverkskatalogen,
 * kulturdimensionerna, de typade resultaten (exportprofil, informationsgap,
 * exportplan, uppdateringsdelta), TOLERANT normalisering av modellens
 * JSON-svar, marknadsgranskningen (människans beslut), IRL-grindarna och
 * statusmaskinen. Ingen IO. Enhetstestad i export-lab.test.ts.
 *
 * Analysen är beslutsstöd om BOLAG (inte individer); människan granskar
 * marknadsurvalet och exportplanen i gränssnittet (EU AI Act art. 14).
 */

import type { Role, StartupPhase } from './index';
import { IRL_AXIS_KEYS, type IrlAxisKey, type IrlProfile } from './kth-irl';

// ─── Vokabulär (speglar migration 1700000210) ───────────────────────────────

export const EXPORT_COMPANY_STATUSES = ['draft', 'market_review', 'info_collection', 'needs_more_info', 'planned'] as const;
export type ExportCompanyStatus = (typeof EXPORT_COMPANY_STATUSES)[number];

export const EXPORT_ASSESSMENT_TYPES = ['initial', 'update'] as const;
export type ExportAssessmentType = (typeof EXPORT_ASSESSMENT_TYPES)[number];

export const EXPORT_ASSESSMENT_STATUSES = ['profile_pending', 'market_review', 'info_pending', 'needs_more_info', 'plan_pending', 'complete', 'failed'] as const;
export type ExportAssessmentStatus = (typeof EXPORT_ASSESSMENT_STATUSES)[number];

export const EXPORT_GAP_SEVERITIES = ['required', 'recommended'] as const;
export type ExportGapSeverity = (typeof EXPORT_GAP_SEVERITIES)[number];
export const EXPORT_GAP_STATUSES = ['open', 'answered', 'not_available'] as const;
export type ExportGapStatus = (typeof EXPORT_GAP_STATUSES)[number];

export const EXPORT_UPLOAD_STAGES = ['innovation_description', 'full_information', 'gap_response', 'update'] as const;
export type ExportUploadStage = (typeof EXPORT_UPLOAD_STAGES)[number];

export const EXPORT_JOB_TYPES = ['profile', 'sufficiency', 'plan', 'update_plan'] as const;
export type ExportJobType = (typeof EXPORT_JOB_TYPES)[number];

/** Steg i AI-pipelinen (lease-namn och promptnycklar). */
export const EXPORT_STEPS = ['profile', 'sufficiency', 'plan', 'update'] as const;
export type ExportStep = (typeof EXPORT_STEPS)[number];

export const EXPORT_FRAMEWORK_VERSION = 'movexum-export-v0.1';

/** Movexum-personal som får driva en analys; observer läser. */
export const EXPORT_MANAGE_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
export const EXPORT_READ_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];
export const EXPORT_DELETE_ROLES: Role[] = ['admin', 'incubator_lead'];

export function canManageExportLab(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((r) => EXPORT_MANAGE_ROLES.includes(r));
}
export function canReadExportLab(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((r) => EXPORT_READ_ROLES.includes(r));
}
export function canDeleteExportLab(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((r) => EXPORT_DELETE_ROLES.includes(r));
}

/** Plattformens bolagsfas → analysens fas (samma fyra som Impact Navigator). */
export const EXPORT_PHASES = ['SCREENING', 'BOOST_CHAMBER', 'INKUBATOR', 'ACCELERATOR'] as const;
export type ExportPhase = (typeof EXPORT_PHASES)[number];
export function exportPhaseFor(phase: StartupPhase | string): ExportPhase {
  switch (phase) {
    case 'boost_chamber':
      return 'BOOST_CHAMBER';
    case 'incubation':
    case 'prescale':
      return 'INKUBATOR';
    case 'acceleration':
    case 'alumni':
      return 'ACCELERATOR';
    default:
      return 'SCREENING';
  }
}

// ─── Forskningsramverk (grunden för promptarna och transparensen) ──────────

export interface ExportFramework {
  key: string;
  name: string;
  source: string;
  usedFor: string;
}

/**
 * Beprövade modeller inom internationalisering för startups. Listan visas för
 * personalen ("Så funkar det") och skrivs in i systemprompten — modellen får
 * aldrig hitta på egna ramverk.
 */
export const EXPORT_FRAMEWORKS: readonly ExportFramework[] = [
  {
    key: 'uppsala',
    name: 'Uppsala-modellen',
    source: 'Johanson & Vahlne (1977; reviderad 2009: nätverk och insidership)',
    usedFor: 'Stegvis engagemang: börja på psykiskt nära marknader, öka åtagandet i takt med erfarenhet och lärande; nätverkets insiderposition avgör vilka marknader som öppnas.'
  },
  {
    key: 'born_global',
    name: 'Born Global / International New Ventures',
    source: 'Oviatt & McDougall (1994); Knight & Cavusgil (2004)',
    usedFor: 'När tidig och parallell internationalisering är rimlig: kunskapsintensiva, nischade eller digitala erbjudanden med global efterfrågan och liten hemmamarknad.'
  },
  {
    key: 'cage',
    name: 'CAGE-distansramverket',
    source: 'Ghemawat (2001)',
    usedFor: 'Marknadsval: kulturell, administrativ/regulatorisk, geografisk och ekonomisk distans från Sverige — och vad varje avstånd betyder för just bolagets erbjudande.'
  },
  {
    key: 'hofstede_meyer',
    name: 'Hofstedes kulturdimensioner & Meyers Culture Map',
    source: 'Hofstede (1980/2010); Meyer (2014)',
    usedFor: 'Kulturella likheter och skillnader i affärspraktik: kommunikation, beslut, förtroende, tid, hierarki — översatt till konkreta råd per marknad.'
  },
  {
    key: 'entry_mode',
    name: 'Val av inträdesform',
    source: 'Root (1994); Anderson & Gatignon (1986); Dunning (OLI)',
    usedFor: 'Indirekt export via agent/distributör, direkt export, licensiering, partnerskap/JV, dotterbolag eller digital plattform — vägt mot kontroll, resurser, risk och lärande.'
  },
  {
    key: 'market_screening',
    name: 'Marknadsurval i tre steg',
    source: 'Cavusgil (1985); Kumar, Stam & Joachimsthaler (1994)',
    usedFor: 'Makro (tillgänglighet, storlek, tillväxt) → bransch (konkurrens, kanaler, reglering) → bolag (passform, nätverk, förmåga att konkurrera).'
  },
  {
    key: 'effectuation',
    name: 'Effectuation & lean internationalisering',
    source: 'Sarasvathy (2001); Blank (2013)',
    usedFor: 'Tidiga bolag: utgå från befintliga medel och nätverk, sätt en acceptabel förlust, testa billigt med riktiga kunder innan större åtaganden.'
  },
  {
    key: 'export_readiness',
    name: 'Exportmognad',
    source: 'Cavusgil & Nevin (1981); Business Sweden/Enterprise Europe Network-checklistor',
    usedFor: 'Är bolaget redo? Erbjudande, marknadskunskap, affärsmodell, team, finansiering och regelefterlevnad bedöms var för sig innan första exportsteget.'
  },
  {
    key: 'kth_irl',
    name: 'KTH Innovation Readiness Level',
    source: 'KTH Innovation (CLAUDE.md § 52.2)',
    usedFor: 'Bolagets framdrift: nivåerna 1–9 för kund, team, affär, IPR, finansiering och teknik styr vilket internationaliseringssteg som är rimligt och vilka grindar som behöver passeras.'
  }
];

// ─── Exportmognadsnivåer (fem, låg → hög) ────────────────────────────────────

export const EXPORT_READINESS_LEVELS = ['EXPLORE', 'PREPARE', 'PILOT', 'ESTABLISH', 'SCALE'] as const;
export type ExportReadinessLevel = (typeof EXPORT_READINESS_LEVELS)[number];

export const EXPORT_READINESS_LEVEL_LABELS: Record<ExportReadinessLevel, string> = {
  EXPLORE: 'Utforskar',
  PREPARE: 'Förbereder',
  PILOT: 'Pilotexport',
  ESTABLISH: 'Etablerar',
  SCALE: 'Skalar internationellt'
};
export const EXPORT_READINESS_LEVEL_CRITERIA: Record<ExportReadinessLevel, string> = {
  EXPLORE: 'Hemmamarknaden är ännu inte validerad eller innovationen är inte redo för kunder utanför Sverige; internationalisering är en hypotes.',
  PREPARE: 'Första kundvalidering finns; bolaget väljer och undersöker marknader, bygger nätverk och klarar av regelverk innan första steget.',
  PILOT: 'Bolaget genomför eller står inför en första avgränsad export: en pilotkund, partner eller test på en utvald marknad.',
  ESTABLISH: 'Repeterbar försäljning på en till två utländska marknader; kanaler, prissättning och efterlevnad fungerar.',
  SCALE: 'Flera marknader, lokal närvaro eller skalbar distribution; internationalisering är en integrerad del av tillväxtplanen.'
};
export const EXPORT_READINESS_LEVEL_CRITERIA_TEXT = EXPORT_READINESS_LEVELS.map(
  (l) => `- ${l} = ${EXPORT_READINESS_LEVEL_LABELS[l]} – ${EXPORT_READINESS_LEVEL_CRITERIA[l]}`
).join('\n');
export const EXPORT_READINESS_LEVEL_RANK: Record<ExportReadinessLevel, number> = { EXPLORE: 0, PREPARE: 1, PILOT: 2, ESTABLISH: 3, SCALE: 4 };

export function getExportReadinessLabel(level?: string | null): string | undefined {
  if (!level || !Object.prototype.hasOwnProperty.call(EXPORT_READINESS_LEVEL_LABELS, level)) return undefined;
  return EXPORT_READINESS_LEVEL_LABELS[level as ExportReadinessLevel];
}

// ─── Internationaliseringsvägar ─────────────────────────────────────────────

export const EXPORT_PATHWAYS = ['GRADUAL', 'BORN_GLOBAL', 'NETWORK_LED', 'DIGITAL_FIRST'] as const;
export type ExportPathway = (typeof EXPORT_PATHWAYS)[number];
export const EXPORT_PATHWAY_LABELS: Record<ExportPathway, string> = {
  GRADUAL: 'Stegvis (Uppsala)',
  BORN_GLOBAL: 'Born global',
  NETWORK_LED: 'Nätverksdriven',
  DIGITAL_FIRST: 'Digital först'
};
export const EXPORT_PATHWAY_DESCRIPTIONS: Record<ExportPathway, string> = {
  GRADUAL: 'Validera hemma, gå sedan till psykiskt nära marknader (Norden, DACH, Benelux) och öka åtagandet i takt med lärandet.',
  BORN_GLOBAL: 'Nischat eller kunskapsintensivt erbjudande med global efterfrågan — flera marknader tidigt och parallellt, ofta via partners.',
  NETWORK_LED: 'Följ befintliga kunder, investerare, partners eller kluster in på de marknader där bolaget redan har en insiderposition.',
  DIGITAL_FIRST: 'Digital distribution med låg geografisk friktion — marknader väljs efter efterfrågan, språk, betalning och regelverk snarare än närhet.'
};

// ─── Mognadsdimensioner med IRL-koppling ────────────────────────────────────

export const EXPORT_DIMENSIONS = ['OFFER', 'MARKET', 'BUSINESS', 'TEAM', 'FINANCE', 'COMPLIANCE'] as const;
export type ExportDimension = (typeof EXPORT_DIMENSIONS)[number];
export const EXPORT_DIMENSION_LABELS: Record<ExportDimension, string> = {
  OFFER: 'Erbjudande & innovation',
  MARKET: 'Marknadskunskap & kundvalidering',
  BUSINESS: 'Affärsmodell & prissättning',
  TEAM: 'Team & kapacitet',
  FINANCE: 'Finansiering & uthållighet',
  COMPLIANCE: 'Regelverk & IP-skydd'
};
export const EXPORT_DIMENSION_DESCRIPTIONS: Record<ExportDimension, string> = {
  OFFER: 'Är innovationen tillräckligt mogen, anpassningsbar och särskiljande för kunder utanför Sverige?',
  MARKET: 'Hur väl känner bolaget behov, segment och köpbeteende på tänkta marknader — och är hemmamarknaden validerad?',
  BUSINESS: 'Fungerar affärsmodell, prissättning, betalningsvillkor och kanaler i en annan marknad?',
  TEAM: 'Finns tid, språk, erfarenhet och nätverk för att driva internationalisering utan att hemmaaffären tappar fart?',
  FINANCE: 'Räcker kapitalet för längre säljcykler, resor, certifiering och lokal anpassning?',
  COMPLIANCE: 'Vilka regelverk, standarder och IP-skydd krävs — och är de hanterade innan första kunden?'
};
/** Vilka KTH IRL-axlar som främst bär varje dimension. */
export const EXPORT_DIMENSION_IRL_AXES: Record<ExportDimension, readonly IrlAxisKey[]> = {
  OFFER: ['trl', 'iprl'],
  MARKET: ['crl'],
  BUSINESS: ['brl'],
  TEAM: ['tmrl'],
  FINANCE: ['frl'],
  COMPLIANCE: ['iprl']
};

export const EXPORT_DIMENSION_STATUSES = ['READY', 'PARTIAL', 'NOT_READY'] as const;
export type ExportDimensionStatus = (typeof EXPORT_DIMENSION_STATUSES)[number];
export const EXPORT_DIMENSION_STATUS_LABELS: Record<ExportDimensionStatus, string> = { READY: 'Redo', PARTIAL: 'Delvis', NOT_READY: 'Inte redo' };

// ─── CAGE, prioritet, inträdesform, generella skalor ────────────────────────

export const EXPORT_CAGE_KEYS = ['cultural', 'administrative', 'geographic', 'economic'] as const;
export type ExportCageKey = (typeof EXPORT_CAGE_KEYS)[number];
export const EXPORT_CAGE_LABELS: Record<ExportCageKey, string> = {
  cultural: 'Kulturell distans',
  administrative: 'Administrativ & regulatorisk distans',
  geographic: 'Geografisk distans',
  economic: 'Ekonomisk distans'
};

export const EXPORT_DISTANCES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ExportDistance = (typeof EXPORT_DISTANCES)[number];
export const EXPORT_DISTANCE_LABELS: Record<ExportDistance, string> = { LOW: 'Liten', MEDIUM: 'Måttlig', HIGH: 'Stor' };

export const EXPORT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ExportPriority = (typeof EXPORT_PRIORITIES)[number];
export const EXPORT_PRIORITY_LABELS: Record<ExportPriority, string> = { LOW: 'Låg', MEDIUM: 'Medel', HIGH: 'Hög' };
export const EXPORT_CONFIDENCES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ExportConfidence = (typeof EXPORT_CONFIDENCES)[number];
export const EXPORT_CONFIDENCE_LABELS: Record<ExportConfidence, string> = { LOW: 'Låg', MEDIUM: 'Medel', HIGH: 'Hög' };
export const EXPORT_HORIZONS = ['SHORT', 'MEDIUM', 'LONG'] as const;
export type ExportHorizon = (typeof EXPORT_HORIZONS)[number];
export const EXPORT_HORIZON_LABELS: Record<ExportHorizon, string> = { SHORT: 'Kort sikt', MEDIUM: 'Medellång sikt', LONG: 'Lång sikt' };
export const EXPORT_INFORMATION_STATUSES = ['SUFFICIENT', 'PARTIAL', 'MISSING'] as const;
export type ExportInformationStatus = (typeof EXPORT_INFORMATION_STATUSES)[number];
export const EXPORT_INFORMATION_STATUS_LABELS: Record<ExportInformationStatus, string> = { SUFFICIENT: 'Tillräckligt', PARTIAL: 'Delvis', MISSING: 'Saknas' };

/** Marknadens plats i planen — människans beslut i marknadsgranskningen. */
export const EXPORT_MARKET_PRIORITIES = ['PRIMARY', 'SECONDARY', 'LATER', 'EXCLUDED'] as const;
export type ExportMarketPriority = (typeof EXPORT_MARKET_PRIORITIES)[number];
export const EXPORT_MARKET_PRIORITY_LABELS: Record<ExportMarketPriority, string> = {
  PRIMARY: 'Första marknad',
  SECONDARY: 'Nästa marknad',
  LATER: 'Senare',
  EXCLUDED: 'Utesluten'
};
export type ExportSelectedMarketPriority = Exclude<ExportMarketPriority, 'EXCLUDED'>;

export const EXPORT_ENTRY_MODES = ['INDIRECT_EXPORT', 'DIRECT_EXPORT', 'LICENSING', 'PARTNERSHIP_JV', 'SUBSIDIARY', 'DIGITAL_PLATFORM'] as const;
export type ExportEntryMode = (typeof EXPORT_ENTRY_MODES)[number];
export const EXPORT_ENTRY_MODE_LABELS: Record<ExportEntryMode, string> = {
  INDIRECT_EXPORT: 'Indirekt export (agent/distributör)',
  DIRECT_EXPORT: 'Direkt export (egen försäljning)',
  LICENSING: 'Licensiering',
  PARTNERSHIP_JV: 'Partnerskap / joint venture',
  SUBSIDIARY: 'Eget dotterbolag',
  DIGITAL_PLATFORM: 'Digital plattform / självbetjäning'
};

// ─── Regelverkskatalog ──────────────────────────────────────────────────────

export interface ExportRegulatoryDomain {
  key: string;
  name: string;
  description: string;
}
/**
 * Regelverksområden modellen får välja bland (plus fritext i `otherRegulations`).
 * Katalogen är ett vägledande stöd — ingen juridisk bedömning; varje punkt ska
 * verifieras med rådgivare/myndighet innan inträde.
 */
export const EXPORT_REGULATORY_DOMAINS: readonly ExportRegulatoryDomain[] = [
  { key: 'ce_marking', name: 'CE-märkning & produktdirektiv', description: 'Maskin-, lågspännings-, EMC-, radio-, leksaks- och liknande direktiv för produkter på EU:s inre marknad.' },
  { key: 'mdr_ivdr', name: 'Medicinteknik (MDR/IVDR)', description: 'Klassificering, anmält organ, klinisk utvärdering och registrering för medicintekniska produkter; FDA m.fl. utanför EU.' },
  { key: 'gdpr_data', name: 'Dataskydd & dataöverföring', description: 'GDPR, tredjelandsöverföringar, lokala dataskyddslagar och krav på datalagring.' },
  { key: 'ai_act', name: 'AI-förordningen', description: 'Riskklassificering, transparens och dokumentation för AI-system som sätts på EU-marknaden.' },
  { key: 'product_safety', name: 'Produktsäkerhet & märkning', description: 'Allmän produktsäkerhet, språkkrav på märkning, bruksanvisningar och garantier.' },
  { key: 'reach_chemicals', name: 'Kemikalier & material (REACH, RoHS)', description: 'Registrering, begränsningar och deklarationer för kemiska ämnen och material.' },
  { key: 'export_control', name: 'Exportkontroll & produkter med dubbla användningsområden', description: 'Tillståndskrav för teknik, programvara och komponenter som kan ha militär användning.' },
  { key: 'sanctions', name: 'Sanktioner & handelsrestriktioner', description: 'Sanktionslistor, embargon och restriktioner som påverkar marknader, kunder och partners.' },
  { key: 'customs_tariffs', name: 'Tull, ursprung & handelsavtal', description: 'Tullsatser, ursprungsregler, frihandelsavtal och importformaliteter utanför EU.' },
  { key: 'vat_tax', name: 'Moms & skatt', description: 'Momsregistrering, OSS/IOSS, fast driftställe och skatt vid gränsöverskridande försäljning.' },
  { key: 'cybersecurity', name: 'Cybersäkerhet (CRA, NIS2)', description: 'Säkerhetskrav för produkter med digitala element och för leverantörer till väsentliga verksamheter.' },
  { key: 'food_health', name: 'Livsmedel, hälsa & kosttillskott', description: 'Novel food, hälsopåståenden, märkning och registrering för livsmedel och kosttillskott.' },
  { key: 'energy_environment', name: 'Energi, ekodesign & producentansvar', description: 'Ekodesign, energimärkning, producentansvar för förpackningar och elektronik.' },
  { key: 'public_procurement', name: 'Offentlig upphandling', description: 'Upphandlingsregler, kvalificering och lokala krav när kunden är offentlig.' },
  { key: 'consumer_law', name: 'Konsumenträtt & e-handel', description: 'Ångerrätt, avtalsvillkor, prisinformation och plattformsregler vid försäljning till konsumenter.' },
  { key: 'employment', name: 'Arbetsrätt, utstationering & etablering', description: 'Anställning, utstationering, bolagsbildning och tillstånd vid lokal närvaro.' },
  { key: 'sector_licensing', name: 'Branschspecifika tillstånd & certifieringar', description: 'Lokala certifieringar, standarder eller licenser som krävs i branschen (bygg, energi, fintech, utbildning m.fl.).' },
  { key: 'ip_protection', name: 'IP-skydd på målmarknaden', description: 'Patent, varumärke, design och domäner — prioriterade länder, tidsfrister och kostnader.' }
];
const REGULATORY_KEYS = new Set(EXPORT_REGULATORY_DOMAINS.map((d) => d.key));
export function regulatoryDomainName(key: string): string {
  return EXPORT_REGULATORY_DOMAINS.find((d) => d.key === key)?.name ?? key;
}

// ─── Kulturdimensioner (Hofstede + Meyer) ───────────────────────────────────

export interface ExportCultureDimension {
  key: string;
  name: string;
  source: 'hofstede' | 'meyer';
  description: string;
}
export const EXPORT_CULTURE_DIMENSIONS: readonly ExportCultureDimension[] = [
  { key: 'power_distance', name: 'Maktdistans', source: 'hofstede', description: 'Hur hierarki och titlar påverkar vem som fattar beslut och hur man når dem.' },
  { key: 'individualism', name: 'Individualism vs. kollektivism', source: 'hofstede', description: 'Om affärer görs med personen eller gruppen; betydelsen av relationer och lojalitet.' },
  { key: 'uncertainty_avoidance', name: 'Osäkerhetsundvikande', source: 'hofstede', description: 'Behov av detaljer, garantier, referenser och formella avtal innan beslut.' },
  { key: 'long_term', name: 'Långsiktig orientering', source: 'hofstede', description: 'Tålamod i relationsbyggande och syn på investering kontra snabb avkastning.' },
  { key: 'communicating', name: 'Kommunikation (låg/hög kontext)', source: 'meyer', description: 'Hur explicit budskap och förväntningar uttrycks i möten och skrift.' },
  { key: 'evaluating', name: 'Återkoppling', source: 'meyer', description: 'Direkt eller indirekt negativ feedback — påverkar förhandling och leverantörsrelation.' },
  { key: 'deciding', name: 'Beslutsfattande', source: 'meyer', description: 'Konsensus eller uppifrån — avgör säljcykelns längd och vem som ska övertygas.' },
  { key: 'trusting', name: 'Förtroende (uppgift/relation)', source: 'meyer', description: 'Om förtroende byggs genom resultat eller genom personlig relation över tid.' },
  { key: 'scheduling', name: 'Tid & planering', source: 'meyer', description: 'Linjär eller flexibel syn på tidsplaner, möten och leveransdatum.' }
];
export const EXPORT_CULTURE_COMPARISONS = ['SIMILAR', 'SOMEWHAT_DIFFERENT', 'VERY_DIFFERENT'] as const;
export type ExportCultureComparison = (typeof EXPORT_CULTURE_COMPARISONS)[number];
export const EXPORT_CULTURE_COMPARISON_LABELS: Record<ExportCultureComparison, string> = {
  SIMILAR: 'Liknar Sverige',
  SOMEWHAT_DIFFERENT: 'Delvis annorlunda',
  VERY_DIFFERENT: 'Tydligt annorlunda'
};

// ─── Etiketter ───────────────────────────────────────────────────────────────

export const EXPORT_COMPANY_STATUS_LABELS: Record<ExportCompanyStatus, string> = {
  draft: 'Utkast',
  market_review: 'Marknader granskas',
  info_collection: 'Informationsinsamling',
  needs_more_info: 'Behöver mer information',
  planned: 'Exportplan klar'
};
export const EXPORT_ASSESSMENT_STATUS_LABELS: Record<ExportAssessmentStatus, string> = {
  profile_pending: 'Exportprofil väntar',
  market_review: 'Marknader granskas',
  info_pending: 'Informationsgap granskas',
  needs_more_info: 'Behöver mer information',
  plan_pending: 'Exportplan väntar',
  complete: 'Klar',
  failed: 'Misslyckades'
};
export const EXPORT_UPLOAD_STAGE_LABELS: Record<ExportUploadStage, string> = {
  innovation_description: 'Innovations- & ambitionsbeskrivning',
  full_information: 'Övrigt underlag',
  gap_response: 'Kompletteringssvar',
  update: 'Uppdatering'
};
export const EXPORT_JOB_TYPE_LABELS: Record<ExportJobType, string> = {
  profile: 'Exportprofil & marknadsurval',
  sufficiency: 'Informationsgapanalys',
  plan: 'Exportplan',
  update_plan: 'Uppdaterad exportplan'
};
export const EXPORT_GAP_SEVERITY_LABELS: Record<ExportGapSeverity, string> = { required: 'Krävs', recommended: 'Rekommenderas' };
export const EXPORT_GAP_STATUS_LABELS: Record<ExportGapStatus, string> = { open: 'Obesvarad', answered: 'Besvarad', not_available: 'Ej tillgänglig' };
export const EXPORT_EXTRACTION_STATUS_LABELS: Record<string, string> = { pending: 'Väntar', complete: 'Klar', failed: 'Misslyckades' };

export const EXPORT_DISCLAIMER =
  'Export Lab är ett coachande beslutsstöd baserat enbart på tillhandahållet material och beprövade modeller för internationalisering. Det är inte juridisk rådgivning, tull- eller skatterådgivning, och ingen garanti för marknadsutfall. Regelverk, tullsatser och kulturella generaliseringar ska verifieras mot aktuella källor innan beslut. Genererat av AI — verifiera innan delning.';

// ─── IRL-grindar (deterministiska) ──────────────────────────────────────────

export interface ExportIrlGate {
  axis: IrlAxisKey;
  /** Lägsta nivå Movexum anser rimlig innan en första pilotexport. */
  threshold: number;
  why: string;
}
/**
 * Movexums arbetshypotes för vad som bör vara på plats innan första
 * exportsteget (pilot). Trösklarna är coachande riktvärden — inte spärrar —
 * och ska justeras när Movexum samlat erfarenhet (§ 58).
 */
export const EXPORT_IRL_GATES: readonly ExportIrlGate[] = [
  { axis: 'crl', threshold: 5, why: 'Etablerat kundintresse på hemmamarknaden innan samma sak prövas utomlands.' },
  { axis: 'trl', threshold: 6, why: 'Innovationen bör vara demonstrerad i relevant miljö — en pilotkund utomlands ska inte vara första testet.' },
  { axis: 'brl', threshold: 5, why: 'En affärsmodell testad mot kunder med första intäktsmodell gör prissättning utomlands möjlig att resonera om.' },
  { axis: 'tmrl', threshold: 4, why: 'Ett kärnteam med kompletterande kompetens behövs för att orka driva två marknader.' },
  { axis: 'frl', threshold: 4, why: 'Finansiering som räcker för längre säljcykler, resor och anpassning.' },
  { axis: 'iprl', threshold: 4, why: 'IP-strategin bör vara formulerad innan erbjudandet visas för partners och konkurrenter i nya länder.' }
];

export interface ExportIrlGateResult {
  axis: IrlAxisKey;
  level: number | null;
  threshold: number;
  met: boolean | null;
  why: string;
}

/** Prövar IRL-profilen mot grindarna; `null` när axeln inte är bedömd. */
export function evaluateExportIrlGates(profile: IrlProfile | null | undefined): ExportIrlGateResult[] {
  return EXPORT_IRL_GATES.map((g) => {
    const level = profile && typeof profile[g.axis] === 'number' ? (profile[g.axis] as number) : null;
    return { axis: g.axis, level, threshold: g.threshold, met: level === null ? null : level >= g.threshold, why: g.why };
  });
}

/**
 * Föreslagen exportmognadsnivå ur IRL-profilen (deterministisk ledtråd till
 * modellen och personalen): bygger på den svagaste av de bärande axlarna
 * kund/affär/teknik, dämpad av team/finansiering. `null` utan bedömning.
 */
export function suggestExportReadinessFromIrl(profile: IrlProfile | null | undefined): ExportReadinessLevel | null {
  if (!profile) return null;
  const vals = IRL_AXIS_KEYS.filter((k) => typeof profile[k] === 'number').map((k) => profile[k] as number);
  if (vals.length === 0) return null;
  const core = (['crl', 'brl', 'trl'] as const).map((k) => profile[k]).filter((v): v is number => typeof v === 'number');
  const support = (['tmrl', 'frl'] as const).map((k) => profile[k]).filter((v): v is number => typeof v === 'number');
  const coreMin = core.length ? Math.min(...core) : Math.min(...vals);
  const supportMin = support.length ? Math.min(...support) : coreMin;
  const effective = Math.min(coreMin, supportMin + 2);
  if (effective <= 3) return 'EXPLORE';
  if (effective <= 5) return 'PREPARE';
  if (effective <= 6) return 'PILOT';
  if (effective <= 7) return 'ESTABLISH';
  return 'SCALE';
}

// ─── Typade resultat ────────────────────────────────────────────────────────

export interface ExportEvidence {
  documentName: string | null;
  note: string;
  excerpt: string | null;
}

export interface ExportCageAssessment {
  distance: ExportDistance;
  note: string;
}

export interface ExportMarket {
  /** MKT-NN, stabil inom en analysversion. */
  code: string;
  country: string;
  region: string;
  priority: ExportMarketPriority;
  rationale: string;
  cage: Record<ExportCageKey, ExportCageAssessment>;
  attractiveness: ExportPriority;
  abilityToCompete: ExportPriority;
  entryModeHint: ExportEntryMode | null;
  regulatoryDomains: string[];
  culturalNotes: string[];
  networkLeads: string[];
  evidence: ExportEvidence[];
  confidence: ExportConfidence;
  uncertaintyNotes: string[];
  /** Markerar att människan lade till eller lyfte marknaden. */
  addedByUser?: boolean;
}

export interface ExportConsideredMarket {
  code: string;
  country: string;
  rationale: string;
}

export interface ExportDimensionAssessment {
  key: ExportDimension;
  status: ExportDimensionStatus;
  rationale: string;
  irlAxes: IrlAxisKey[];
  evidence: ExportEvidence[];
}

export interface ExportRegulatoryRelevance {
  key: string;
  name: string;
  relevance: ExportPriority;
  why: string;
}

export interface ExportProfile {
  companySummary: string;
  innovationSummary: string;
  internationalAmbitionSummary: string;
  pathway: { code: ExportPathway; labelSv: string; rationale: string };
  readinessLevel: { level: ExportReadinessLevel; labelSv: string; rationale: string };
  readinessDimensions: ExportDimensionAssessment[];
  candidateMarkets: ExportMarket[];
  consideredButNotPrioritized: ExportConsideredMarket[];
  regulatoryDomains: ExportRegulatoryRelevance[];
  otherRegulations: string[];
  assumptions: string[];
  warnings: string[];
}

export interface ExportSufficiencyQuestion {
  question: string;
  missingInformation: string;
  whyThisMattersForPlan: string;
  severity: 'REQUIRED' | 'RECOMMENDED';
  exampleHelpfulEvidence: string;
}

export interface ExportSufficiencyCheck {
  /** Marknadskod (MKT-NN) eller dimension (OFFER …). */
  code: string;
  kind: 'MARKET' | 'DIMENSION';
  name: string;
  informationStatus: ExportInformationStatus;
  rationale: string;
  whatWeKnow: string[];
  missingInformation: string[];
  question: ExportSufficiencyQuestion | null;
  confidence: ExportConfidence;
}

export interface ExportSufficiency {
  readyForPlan: boolean;
  /** 0–100. */
  overallInformationQuality: number;
  generalComment: string;
  checks: ExportSufficiencyCheck[];
  generalMissingInformation: string[];
  userMessage: string;
}

export interface ExportRegulatoryAction {
  key: string;
  name: string;
  requirement: string;
  actionBeforeEntry: string;
  estimatedEffort: ExportPriority;
}

export interface ExportCulturalPlaybookItem {
  dimension: string;
  comparedToSweden: ExportCultureComparison;
  implication: string;
  doThis: string;
  avoidThis: string;
}

export interface ExportMarketPlan {
  code: string;
  country: string;
  priority: ExportSelectedMarketPriority;
  entryMode: { mode: ExportEntryMode; labelSv: string; rationale: string; alternatives: string[] };
  localValueProposition: string;
  targetSegments: string[];
  channelsAndPartners: string[];
  regulatory: ExportRegulatoryAction[];
  culturalPlaybook: ExportCulturalPlaybookItem[];
  businessConditions: { pricingAndPayment: string; competition: string; logisticsAndDelivery: string; financingAndSupport: string };
  risks: string[];
  firstMilestones: string[];
}

export interface ExportPlanAction {
  title: string;
  description: string;
  owner: string;
  irlAxis: IrlAxisKey | null;
  marketCode: string | null;
}

export interface ExportPlanPhase {
  name: string;
  timeframe: string;
  goals: string[];
  actions: ExportPlanAction[];
  successCriteria: string[];
}

export interface ExportKpi {
  name: string;
  target: string;
  why: string;
}

export interface ExportReadinessGap {
  dimension: ExportDimension;
  gap: string;
  action: string;
  irlAxis: IrlAxisKey | null;
  priority: ExportPriority;
}

export interface ExportRisk {
  title: string;
  description: string;
  severity: ExportPriority;
  timeHorizon: ExportHorizon;
  mitigation: string;
  marketCode: string | null;
}

export interface ExportDiscussionQuestion {
  question: string;
  whyImportant: string;
  suggestedOwnerRole?: string;
}

export interface ExportPlan {
  executiveSummary: string;
  internationalStrategy: {
    pathway: { code: ExportPathway; labelSv: string; rationale: string };
    readinessLevel: { level: ExportReadinessLevel; labelSv: string; rationale: string };
    sequencing: string;
    guidingPrinciples: string[];
  };
  marketPlans: ExportMarketPlan[];
  firstExportPlan: {
    horizon: string;
    objective: string;
    phases: ExportPlanPhase[];
    budgetAndResources: { estimatedCosts: string[]; fundingOptions: string[]; supportActors: string[] };
    kpis: ExportKpi[];
  };
  readinessGaps: ExportReadinessGap[];
  risks: ExportRisk[];
  discussionQuestions: ExportDiscussionQuestion[];
  informationQualityComment: string;
  assumptions: string[];
  limitations: string[];
  disclaimer: string;
}

export interface ExportUpdateDelta {
  whatChangedSincePreviousPlan: string[];
  marketChanges: string[];
  newRisks: string[];
  reducedRisks: string[];
  changedReadinessLevel?: string;
  recommendedNextDiscussions: string[];
}

export interface ExportUpdateAnalysis {
  updatedPlan: ExportPlan;
  deltaSummary: ExportUpdateDelta;
}

// ─── Normalisering (modellens svar är UNTRUSTED data) ───────────────────────

export const EXPORT_TEXT_MAX = 6000;
const LIST_MAX = 30;
const MARKETS_MAX = 8;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown, max = EXPORT_TEXT_MAX): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}
function strOrNull(v: unknown, max = EXPORT_TEXT_MAX): string | null {
  const s = str(v, max);
  return s ? s : null;
}
function strList(v: unknown, max = LIST_MAX): string[] {
  if (typeof v === 'string') return v.trim() ? [str(v)] : [];
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' || typeof x === 'number' ? str(x) : typeof x === 'object' && x ? str(rec(x).text ?? rec(x).title ?? rec(x).note ?? rec(x).name) : ''))
    .filter(Boolean)
    .slice(0, max);
}
function normalizeToken(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = normalizeToken(v);
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}
function oneOfOrNull<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = normalizeToken(v);
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}
function int(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
function confidence(v: unknown): ExportConfidence {
  const token = oneOfOrNull(v, EXPORT_CONFIDENCES);
  if (token) return token;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 'MEDIUM';
  const x = n > 1 ? n / 100 : n;
  return x >= 0.75 ? 'HIGH' : x >= 0.4 ? 'MEDIUM' : 'LOW';
}
function evidence(v: unknown): ExportEvidence[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 12)
    .map((e) => {
      if (typeof e === 'string') return { documentName: null, note: str(e), excerpt: null };
      const r = rec(e);
      return { documentName: strOrNull(r.documentName ?? r.document, 300), note: str(r.note), excerpt: strOrNull(r.excerpt) };
    })
    .filter((e) => e.note || e.excerpt);
}
function irlAxisOrNull(v: unknown): IrlAxisKey | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (IRL_AXIS_KEYS as readonly string[]).includes(s) ? (s as IrlAxisKey) : null;
}
function irlAxes(v: unknown, fallback: readonly IrlAxisKey[]): IrlAxisKey[] {
  const list = (Array.isArray(v) ? v : []).map(irlAxisOrNull).filter((a): a is IrlAxisKey => a !== null);
  return list.length ? Array.from(new Set(list)) : [...fallback];
}
export function formatExportMarketCode(index: number): string {
  return `MKT-${String(index + 1).padStart(2, '0')}`;
}
function marketCode(v: unknown, index: number): string {
  const s = str(v, 20).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return /^MKT-\d{2,3}$/.test(s) ? s : formatExportMarketCode(index);
}
function regulatoryKeys(v: unknown): string[] {
  const list = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
    .map((k) => (typeof k === 'string' ? k : str(rec(k).key, 60)).trim().toLowerCase().replace(/[\s-]+/g, '_'))
    .filter((k) => REGULATORY_KEYS.has(k));
  return Array.from(new Set(list)).slice(0, 12);
}
function cage(v: unknown): Record<ExportCageKey, ExportCageAssessment> {
  const r = rec(v);
  const one = (k: ExportCageKey): ExportCageAssessment => {
    const x = r[k];
    if (typeof x === 'string') return { distance: oneOf(x, EXPORT_DISTANCES, 'MEDIUM'), note: '' };
    const xr = rec(x);
    return { distance: oneOf(xr.distance ?? xr.level, EXPORT_DISTANCES, 'MEDIUM'), note: str(xr.note ?? xr.rationale, 1500) };
  };
  return { cultural: one('cultural'), administrative: one('administrative'), geographic: one('geographic'), economic: one('economic') };
}
function pathwayOf(v: unknown): { code: ExportPathway; labelSv: string; rationale: string } {
  const r = rec(v);
  const direct = oneOfOrNull(r.code ?? v, EXPORT_PATHWAYS);
  let code: ExportPathway = direct ?? 'GRADUAL';
  if (!direct) {
    const label = str(r.labelSv ?? (typeof v === 'string' ? v : ''), 80).toLowerCase();
    for (const p of EXPORT_PATHWAYS) if (label && EXPORT_PATHWAY_LABELS[p].toLowerCase() === label) code = p;
  }
  return { code, labelSv: EXPORT_PATHWAY_LABELS[code], rationale: str(r.rationale) };
}
function readinessOf(v: unknown): { level: ExportReadinessLevel; labelSv: string; rationale: string } {
  const r = rec(v);
  const direct = oneOfOrNull(r.level ?? v, EXPORT_READINESS_LEVELS);
  let level: ExportReadinessLevel = direct ?? 'PREPARE';
  if (!direct) {
    const label = str(r.labelSv ?? (typeof v === 'string' ? v : ''), 80).toLowerCase();
    for (const l of EXPORT_READINESS_LEVELS) if (label && EXPORT_READINESS_LEVEL_LABELS[l].toLowerCase() === label) level = l;
  }
  return { level, labelSv: EXPORT_READINESS_LEVEL_LABELS[level], rationale: str(r.rationale) };
}

export function normalizeExportMarket(raw: unknown, index: number): ExportMarket {
  const r = rec(raw);
  return {
    code: marketCode(r.code, index),
    country: str(r.country ?? r.name, 120) || 'Okänd marknad',
    region: str(r.region, 120),
    priority: oneOf(r.priority, EXPORT_MARKET_PRIORITIES, 'SECONDARY'),
    rationale: str(r.rationale),
    cage: cage(r.cage),
    attractiveness: oneOf(r.attractiveness, EXPORT_PRIORITIES, 'MEDIUM'),
    abilityToCompete: oneOf(r.abilityToCompete, EXPORT_PRIORITIES, 'MEDIUM'),
    entryModeHint: oneOfOrNull(r.entryModeHint ?? r.entryMode, EXPORT_ENTRY_MODES),
    regulatoryDomains: regulatoryKeys(r.regulatoryDomains),
    culturalNotes: strList(r.culturalNotes, 12),
    networkLeads: strList(r.networkLeads, 12),
    evidence: evidence(r.evidence),
    confidence: confidence(r.confidence),
    uncertaintyNotes: strList(r.uncertaintyNotes, 12),
    ...(r.addedByUser === true ? { addedByUser: true } : {})
  };
}

export function normalizeExportProfile(raw: unknown): ExportProfile {
  const r = rec(raw);
  const dims = Array.isArray(r.readinessDimensions) ? r.readinessDimensions : [];
  const byKey = new Map<ExportDimension, ExportDimensionAssessment>();
  for (const d of dims) {
    const dr = rec(d);
    const key = oneOfOrNull(dr.key ?? dr.dimension, EXPORT_DIMENSIONS);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      key,
      status: oneOf(dr.status, EXPORT_DIMENSION_STATUSES, 'PARTIAL'),
      rationale: str(dr.rationale),
      irlAxes: irlAxes(dr.irlAxes, EXPORT_DIMENSION_IRL_AXES[key]),
      evidence: evidence(dr.evidence)
    });
  }
  // Alla sex dimensionerna finns alltid — saknade märks som "Delvis" utan motivering.
  const readinessDimensions = EXPORT_DIMENSIONS.map(
    (key) => byKey.get(key) ?? { key, status: 'PARTIAL' as const, rationale: 'Dimensionen bedömdes inte i detta steg.', irlAxes: [...EXPORT_DIMENSION_IRL_AXES[key]], evidence: [] }
  );
  const markets = (Array.isArray(r.candidateMarkets) ? r.candidateMarkets : []).slice(0, MARKETS_MAX).map(normalizeExportMarket);
  const considered = (Array.isArray(r.consideredButNotPrioritized) ? r.consideredButNotPrioritized : []).slice(0, 12).map((m, i) => {
    const mr = rec(m);
    return { code: marketCode(mr.code, 50 + i), country: str(mr.country ?? mr.name, 120) || 'Okänd marknad', rationale: str(mr.rationale) };
  });
  const reg = (Array.isArray(r.regulatoryDomains) ? r.regulatoryDomains : [])
    .map((d) => {
      const dr = rec(d);
      const key = (typeof d === 'string' ? d : str(dr.key, 60)).trim().toLowerCase().replace(/[\s-]+/g, '_');
      if (!REGULATORY_KEYS.has(key)) return null;
      return { key, name: regulatoryDomainName(key), relevance: oneOf(dr.relevance, EXPORT_PRIORITIES, 'MEDIUM'), why: str(dr.why ?? dr.rationale, 1500) };
    })
    .filter((x): x is ExportRegulatoryRelevance => x !== null)
    .slice(0, 12);
  return {
    companySummary: str(r.companySummary),
    innovationSummary: str(r.innovationSummary),
    internationalAmbitionSummary: str(r.internationalAmbitionSummary),
    pathway: pathwayOf(r.pathway),
    readinessLevel: readinessOf(r.readinessLevel),
    readinessDimensions,
    candidateMarkets: markets,
    consideredButNotPrioritized: considered,
    regulatoryDomains: reg,
    otherRegulations: strList(r.otherRegulations, 10),
    assumptions: strList(r.assumptions),
    warnings: strList(r.warnings)
  };
}

export function normalizeExportSufficiency(raw: unknown): ExportSufficiency {
  const r = rec(raw);
  const checks = Array.isArray(r.checks) ? r.checks : Array.isArray(r.aspectChecks) ? r.aspectChecks : [];
  return {
    readyForPlan: r.readyForPlan === true || r.readyForFinalAnalysis === true,
    overallInformationQuality: int(r.overallInformationQuality, 0, 100, 0),
    generalComment: str(r.generalComment),
    checks: checks.slice(0, 16).map((c, i) => {
      const cr = rec(c);
      const codeRaw = str(cr.code, 40).toUpperCase();
      const dimension = oneOfOrNull(codeRaw, EXPORT_DIMENSIONS);
      const kind: 'MARKET' | 'DIMENSION' = dimension ? 'DIMENSION' : oneOf(cr.kind, ['MARKET', 'DIMENSION'] as const, 'MARKET');
      const code = dimension ?? (kind === 'MARKET' ? marketCode(codeRaw, i) : oneOf(codeRaw, EXPORT_DIMENSIONS, 'MARKET'));
      const q = rec(cr.question);
      const questionText = str(q.question ?? (typeof cr.question === 'string' ? cr.question : ''));
      return {
        code,
        kind,
        name: str(cr.name, 200) || (dimension ? EXPORT_DIMENSION_LABELS[dimension] : code),
        informationStatus: oneOf(cr.informationStatus, EXPORT_INFORMATION_STATUSES, 'PARTIAL'),
        rationale: str(cr.rationale),
        whatWeKnow: strList(cr.whatWeKnow),
        missingInformation: strList(cr.missingInformation),
        question: questionText
          ? {
              question: questionText,
              missingInformation: str(q.missingInformation),
              whyThisMattersForPlan: str(q.whyThisMattersForPlan ?? q.whyThisMatters ?? q.whyThisMattersForFinalAssessment),
              severity: oneOf(q.severity, ['REQUIRED', 'RECOMMENDED'] as const, 'RECOMMENDED'),
              exampleHelpfulEvidence: str(q.exampleHelpfulEvidence)
            }
          : null,
        confidence: confidence(cr.confidence)
      };
    }),
    generalMissingInformation: strList(r.generalMissingInformation),
    userMessage: str(r.userMessage)
  };
}

function marketPlan(raw: unknown, index: number): ExportMarketPlan {
  const r = rec(raw);
  const em = rec(r.entryMode);
  const mode = oneOf(em.mode ?? r.entryMode, EXPORT_ENTRY_MODES, 'INDIRECT_EXPORT');
  const bc = rec(r.businessConditions);
  return {
    code: marketCode(r.code, index),
    country: str(r.country, 120) || 'Okänd marknad',
    priority: oneOf(r.priority, ['PRIMARY', 'SECONDARY', 'LATER'] as const, 'SECONDARY'),
    entryMode: { mode, labelSv: EXPORT_ENTRY_MODE_LABELS[mode], rationale: str(em.rationale), alternatives: strList(em.alternatives, 6) },
    localValueProposition: str(r.localValueProposition),
    targetSegments: strList(r.targetSegments, 10),
    channelsAndPartners: strList(r.channelsAndPartners, 12),
    regulatory: (Array.isArray(r.regulatory) ? r.regulatory : [])
      .slice(0, 12)
      .map((x) => {
        const xr = rec(x);
        const key = str(xr.key, 60).trim().toLowerCase().replace(/[\s-]+/g, '_');
        return {
          key: REGULATORY_KEYS.has(key) ? key : 'other',
          name: str(xr.name, 200) || (REGULATORY_KEYS.has(key) ? regulatoryDomainName(key) : 'Övrigt regelverk'),
          requirement: str(xr.requirement),
          actionBeforeEntry: str(xr.actionBeforeEntry),
          estimatedEffort: oneOf(xr.estimatedEffort, EXPORT_PRIORITIES, 'MEDIUM')
        };
      })
      .filter((x) => x.requirement || x.actionBeforeEntry),
    culturalPlaybook: (Array.isArray(r.culturalPlaybook) ? r.culturalPlaybook : [])
      .slice(0, 12)
      .map((x) => {
        const xr = rec(x);
        return {
          dimension: str(xr.dimension, 120),
          comparedToSweden: oneOf(xr.comparedToSweden, EXPORT_CULTURE_COMPARISONS, 'SOMEWHAT_DIFFERENT'),
          implication: str(xr.implication),
          doThis: str(xr.doThis),
          avoidThis: str(xr.avoidThis)
        };
      })
      .filter((x) => x.dimension && (x.implication || x.doThis)),
    businessConditions: {
      pricingAndPayment: str(bc.pricingAndPayment),
      competition: str(bc.competition),
      logisticsAndDelivery: str(bc.logisticsAndDelivery),
      financingAndSupport: str(bc.financingAndSupport)
    },
    risks: strList(r.risks, 10),
    firstMilestones: strList(r.firstMilestones, 10)
  };
}

export function normalizeExportPlan(raw: unknown): ExportPlan {
  const r = rec(raw);
  const strat = rec(r.internationalStrategy);
  const fep = rec(r.firstExportPlan);
  const budget = rec(fep.budgetAndResources);
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, LIST_MAX) : []);
  return {
    executiveSummary: str(r.executiveSummary),
    internationalStrategy: {
      pathway: pathwayOf(strat.pathway ?? r.pathway),
      readinessLevel: readinessOf(strat.readinessLevel ?? r.readinessLevel),
      sequencing: str(strat.sequencing),
      guidingPrinciples: strList(strat.guidingPrinciples, 10)
    },
    marketPlans: list(r.marketPlans).slice(0, MARKETS_MAX).map(marketPlan),
    firstExportPlan: {
      horizon: str(fep.horizon, 80) || '12 månader',
      objective: str(fep.objective),
      phases: list(fep.phases)
        .slice(0, 6)
        .map((p) => {
          const pr = rec(p);
          return {
            name: str(pr.name, 120),
            timeframe: str(pr.timeframe, 120),
            goals: strList(pr.goals, 10),
            actions: list(pr.actions)
              .slice(0, 12)
              .map((a) => {
                const ar = rec(a);
                return {
                  title: str(ar.title, 200),
                  description: str(ar.description),
                  owner: str(ar.owner, 120),
                  irlAxis: irlAxisOrNull(ar.irlAxis),
                  marketCode: /^MKT-\d{2,3}$/.test(str(ar.marketCode, 20).toUpperCase()) ? str(ar.marketCode, 20).toUpperCase() : null
                };
              })
              .filter((a) => a.title),
            successCriteria: strList(pr.successCriteria, 10)
          };
        })
        .filter((p) => p.name),
      budgetAndResources: {
        estimatedCosts: strList(budget.estimatedCosts, 12),
        fundingOptions: strList(budget.fundingOptions, 12),
        supportActors: strList(budget.supportActors, 12)
      },
      kpis: list(fep.kpis)
        .slice(0, 10)
        .map((k) => {
          const kr = rec(k);
          return { name: str(kr.name, 200), target: str(kr.target, 300), why: str(kr.why) };
        })
        .filter((k) => k.name)
    },
    readinessGaps: list(r.readinessGaps)
      .map((g) => {
        const gr = rec(g);
        return {
          dimension: oneOf(gr.dimension, EXPORT_DIMENSIONS, 'MARKET'),
          gap: str(gr.gap),
          action: str(gr.action),
          irlAxis: irlAxisOrNull(gr.irlAxis),
          priority: oneOf(gr.priority, EXPORT_PRIORITIES, 'MEDIUM')
        };
      })
      .filter((g) => g.gap),
    risks: list(r.risks)
      .map((x) => {
        const xr = rec(x);
        return {
          title: str(xr.title, 200),
          description: str(xr.description),
          severity: oneOf(xr.severity, EXPORT_PRIORITIES, 'MEDIUM'),
          timeHorizon: oneOf(xr.timeHorizon, EXPORT_HORIZONS, 'MEDIUM'),
          mitigation: str(xr.mitigation ?? xr.mitigationSuggestion),
          marketCode: /^MKT-\d{2,3}$/.test(str(xr.marketCode, 20).toUpperCase()) ? str(xr.marketCode, 20).toUpperCase() : null
        };
      })
      .filter((x) => x.title),
    discussionQuestions: list(r.discussionQuestions)
      .map((q) => {
        const qr = rec(q);
        const owner = str(qr.suggestedOwnerRole, 100);
        return { question: str(qr.question), whyImportant: str(qr.whyImportant), ...(owner ? { suggestedOwnerRole: owner } : {}) };
      })
      .filter((q) => q.question),
    informationQualityComment: str(r.informationQualityComment, 400),
    assumptions: strList(r.assumptions),
    limitations: strList(r.limitations),
    disclaimer: str(r.disclaimer) || EXPORT_DISCLAIMER
  };
}

export function normalizeExportUpdateDelta(raw: unknown): ExportUpdateDelta {
  const r = rec(raw);
  const changed = str(r.changedReadinessLevel, 200);
  return {
    whatChangedSincePreviousPlan: strList(r.whatChangedSincePreviousPlan ?? r.whatChangedSinceLastAssessment),
    marketChanges: strList(r.marketChanges),
    newRisks: strList(r.newRisks),
    reducedRisks: strList(r.reducedRisks),
    ...(changed ? { changedReadinessLevel: changed } : {}),
    recommendedNextDiscussions: strList(r.recommendedNextDiscussions)
  };
}

export function normalizeExportUpdateAnalysis(raw: unknown): ExportUpdateAnalysis {
  const r = rec(raw);
  return {
    updatedPlan: normalizeExportPlan(r.updatedPlan ?? r.plan ?? raw),
    deltaSummary: normalizeExportUpdateDelta(r.deltaSummary ?? r.delta)
  };
}

/** Tolerant JSON-extraktion ur ett modellsvar (kan ha omgivande text/kodstaket). */
export function parseExportModelJson(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ─── Marknadsgranskning (människans beslut) ─────────────────────────────────

export interface ExportMarketDecision {
  code: string;
  priority: string;
  comment?: string;
}
export interface ExportMarketPromotion {
  code: string;
  comment?: string;
}
export interface ExportMarketChange {
  code: string;
  country: string;
  originalPriority: ExportMarketPriority;
  newPriority: ExportMarketPriority;
  comment: string;
}

function normalizePriority(input: string | undefined, fallback: ExportMarketPriority): ExportMarketPriority {
  const s = normalizeToken(input);
  return (EXPORT_MARKET_PRIORITIES as readonly string[]).includes(s) ? (s as ExportMarketPriority) : fallback;
}

export function promoteExportConsideredMarket(market: ExportConsideredMarket, comment: string): ExportMarket {
  const userRationale = comment
    ? `Movexum har lyft marknaden till planen. Användarens motivering: ${comment}`
    : 'Movexum har lyft marknaden till planen och den ska därför ingå i den fortsatta analysen.';
  const neutral: ExportCageAssessment = { distance: 'MEDIUM', note: 'Inte bedömd av modellen — prövas i nästa steg.' };
  return {
    code: market.code,
    country: market.country,
    region: '',
    priority: 'SECONDARY',
    rationale: userRationale,
    cage: { cultural: neutral, administrative: neutral, geographic: neutral, economic: neutral },
    attractiveness: 'MEDIUM',
    abilityToCompete: 'MEDIUM',
    entryModeHint: null,
    regulatoryDomains: [],
    culturalNotes: [],
    networkLeads: [],
    evidence: [{ documentName: null, note: comment ? `Användarbedömning: ${comment}` : 'Lyft av användaren i marknadsgranskningen.', excerpt: null }],
    confidence: 'LOW',
    uncertaintyNotes: [`Modellens tidigare bedömning: ${market.rationale}`, 'Den manuella prioriteringen bör följas upp i informationsgapanalysen.'],
    addedByUser: true
  };
}

/** Egen marknad tillagd av personalen (`MKT-NN`, nästa lediga nummer). */
export function createExportCustomMarket(profile: ExportProfile, input: { country: string; comment?: string }): ExportMarket {
  const used = new Set([...profile.candidateMarkets, ...profile.consideredButNotPrioritized].map((m) => m.code));
  let n = profile.candidateMarkets.length + 1;
  while (used.has(formatExportMarketCode(n - 1))) n += 1;
  const promoted = promoteExportConsideredMarket({ code: formatExportMarketCode(n - 1), country: input.country.trim(), rationale: 'Marknaden fanns inte i modellens urval.' }, input.comment?.trim() ?? '');
  return { ...promoted, rationale: input.comment?.trim() ? `Tillagd av användaren: ${input.comment.trim()}` : 'Tillagd av användaren i marknadsgranskningen.' };
}

/**
 * Tillämpar personalens granskning: prioritet per föreslagen marknad
 * (Första/Nästa/Senare/Utesluten + kommentar), uppflyttning av övervägda
 * marknader och egen marknad. Returnerar den justerade profilen och varje
 * faktisk ändring (→ `export_market_reviews`). Ordningen blir Första → Nästa
 * → Senare; uteslutna flyttas till consideredButNotPrioritized.
 */
export function applyExportMarketReview(
  profile: ExportProfile,
  input: { decisions: readonly ExportMarketDecision[]; promotions: readonly ExportMarketPromotion[]; customMarket?: { country: string; comment?: string } | null }
): { profile: ExportProfile; changes: ExportMarketChange[] } {
  const decisions = new Map(input.decisions.map((d) => [d.code, d]));
  const promotions = new Map(input.promotions.map((p) => [p.code, p]));
  const selectedCodes = new Set(profile.candidateMarkets.map((m) => m.code));
  const changes: ExportMarketChange[] = [];
  const excluded: ExportConsideredMarket[] = [];

  const markets = profile.candidateMarkets.flatMap((m): ExportMarket[] => {
    const decision = decisions.get(m.code);
    const priority = normalizePriority(decision?.priority, m.priority);
    const comment = decision?.comment?.trim() ?? '';
    if (priority !== m.priority || comment) changes.push({ code: m.code, country: m.country, originalPriority: m.priority, newPriority: priority, comment });
    if (priority === 'EXCLUDED') {
      excluded.push({ code: m.code, country: m.country, rationale: comment ? `${m.rationale}\n\nAnvändarkommentar: ${comment}` : m.rationale });
      return [];
    }
    return [{ ...m, priority, uncertaintyNotes: comment ? [...m.uncertaintyNotes, `Användarkommentar: ${comment}`] : m.uncertaintyNotes }];
  });

  const remaining: ExportConsideredMarket[] = [];
  for (const m of profile.consideredButNotPrioritized) {
    const promotion = promotions.get(m.code);
    if (!promotion || selectedCodes.has(m.code)) {
      remaining.push(m);
      continue;
    }
    const comment = promotion.comment?.trim() ?? '';
    markets.push(promoteExportConsideredMarket(m, comment));
    changes.push({ code: m.code, country: m.country, originalPriority: 'EXCLUDED', newPriority: 'SECONDARY', comment });
  }
  const working: ExportProfile = { ...profile, candidateMarkets: markets, consideredButNotPrioritized: [...remaining, ...excluded] };
  if (input.customMarket?.country?.trim()) {
    const custom = createExportCustomMarket(working, input.customMarket);
    working.candidateMarkets = [...working.candidateMarkets, custom];
    changes.push({ code: custom.code, country: custom.country, originalPriority: 'EXCLUDED', newPriority: 'SECONDARY', comment: input.customMarket.comment?.trim() ?? '' });
  }
  const rank: Record<ExportMarketPriority, number> = { PRIMARY: 0, SECONDARY: 1, LATER: 2, EXCLUDED: 3 };
  working.candidateMarkets = [...working.candidateMarkets].sort((a, b) => rank[a.priority] - rank[b.priority]);
  return { profile: working, changes };
}

/** Personalens korrigering av bolagsbilden läggs under texten. */
export function applyExportSummaryComment(profile: ExportProfile, summaryComment: string): ExportProfile {
  const c = summaryComment.trim();
  if (!c) return profile;
  return { ...profile, companySummary: `${profile.companySummary}\n\nAnvändarkorrigering av bolagsbilden: ${c}` };
}

// ─── Presentation ───────────────────────────────────────────────────────────

export function getExportSufficiencyComment(sufficiency?: ExportSufficiency | null): string {
  if (!sufficiency) return '-';
  const counts = sufficiency.checks.reduce(
    (acc, c) => ({
      sufficient: acc.sufficient + (c.informationStatus === 'SUFFICIENT' ? 1 : 0),
      partial: acc.partial + (c.informationStatus === 'PARTIAL' ? 1 : 0),
      missing: acc.missing + (c.informationStatus === 'MISSING' ? 1 : 0)
    }),
    { sufficient: 0, partial: 0, missing: 0 }
  );
  const parts = [
    counts.sufficient ? `${counts.sufficient} ${counts.sufficient === 1 ? 'del har' : 'delar har'} tillräcklig information` : undefined,
    counts.partial ? `${counts.partial} ${counts.partial === 1 ? 'är delvis belyst' : 'är delvis belysta'}` : undefined,
    counts.missing ? `${counts.missing} saknar viktig information` : undefined
  ].filter((p): p is string => Boolean(p));
  const summary = !parts.length ? 'Inga marknader eller dimensioner har informationsbedömts ännu' : parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} och ${parts[parts.length - 1]}`;
  if (!sufficiency.readyForPlan) {
    return `Underlaget är fortfarande svagt för en trygg exportplan. ${summary}. Komplettera framför allt frågorna nedan, annars behöver planen markera större osäkerhet.`;
  }
  if (counts.partial > 0 || counts.missing > 0) {
    return `Underlaget räcker för en första exportplan, men är inte komplett. ${summary}. Svaren nedan gör marknadsval, inträdesform och tidsplan säkrare.`;
  }
  return `Underlaget ger en bra grund för en första exportplan. ${summary}. Planen ska ändå markera antaganden där marknaden ännu inte är testad.`;
}

// ─── Statusmaskin ────────────────────────────────────────────────────────────

export function exportCompanyStatusFor(status: ExportAssessmentStatus): ExportCompanyStatus {
  switch (status) {
    case 'profile_pending':
      return 'draft';
    case 'market_review':
      return 'market_review';
    case 'info_pending':
    case 'plan_pending':
      return 'info_collection';
    case 'needs_more_info':
    case 'failed':
      return 'needs_more_info';
    case 'complete':
      return 'planned';
  }
}

export type ExportNextStep = 'run_profile' | 'review_markets' | 'run_sufficiency' | 'answer_gaps' | 'run_plan' | 'done' | 'retry';

export function exportNextStep(status: ExportAssessmentStatus, openRequiredGaps: number): ExportNextStep {
  switch (status) {
    case 'profile_pending':
      return 'run_profile';
    case 'market_review':
      return 'review_markets';
    case 'info_pending':
      return 'run_sufficiency';
    case 'needs_more_info':
      return openRequiredGaps > 0 ? 'answer_gaps' : 'run_plan';
    case 'plan_pending':
      return 'run_plan';
    case 'complete':
      return 'done';
    case 'failed':
      return 'retry';
  }
}

/** Steget i fyrstegsguiden (1 = skapa … 4 = exportplan). */
export function exportStepFor(status: ExportAssessmentStatus, hasPlan: boolean): 1 | 2 | 3 | 4 {
  if (hasPlan || status === 'complete') return 4;
  if (status === 'profile_pending' || status === 'failed' || status === 'market_review') return 2;
  return 3;
}

export function parseExportAssessmentVersion(value?: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) ? version : null;
}

export function isExportCompanyStatus(v: unknown): v is ExportCompanyStatus {
  return typeof v === 'string' && (EXPORT_COMPANY_STATUSES as readonly string[]).includes(v);
}
export function isExportAssessmentStatus(v: unknown): v is ExportAssessmentStatus {
  return typeof v === 'string' && (EXPORT_ASSESSMENT_STATUSES as readonly string[]).includes(v);
}
export function isExportUploadStage(v: unknown): v is ExportUploadStage {
  return typeof v === 'string' && (EXPORT_UPLOAD_STAGES as readonly string[]).includes(v);
}
export function isExportReadinessLevel(v: unknown): v is ExportReadinessLevel {
  return typeof v === 'string' && (EXPORT_READINESS_LEVELS as readonly string[]).includes(v);
}

/** Svarsstatus ur personalens val + vad som faktiskt lämnades. */
export function exportGapResponseStatus(requested: string, answer: string | null, hasReadableDocumentEvidence: boolean): ExportGapStatus {
  const r = requested.trim().toLowerCase();
  if (r === 'not_available') return 'not_available';
  return answer || hasReadableDocumentEvidence ? 'answered' : 'open';
}
