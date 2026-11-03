/**
 * Impact Navigator (CLAUDE.md § 56) — REN domänlogik för den AI-stödda
 * hållbarhetsanalysen per bolag, porterad från den tidigare fristående appen
 * (Movexum Impact Navigator): vokabulär (MÅSTE spegla migration 1700000206),
 * de FEM impactnivåerna med kriterier, svenska etiketter, de typade
 * resultaten (samma form som den gamla appens Zod-scheman producerade — så
 * importerad historik och nya körningar läses av samma gränssnitt), TOLERANT
 * normalisering av modellens JSON-svar inklusive äldre varianter
 * (poäng/scores → områdesbedömningar), väsentlighetsgranskningen
 * (beslut/uppflyttning/eget område), områdesbedömningar, informationsläge,
 * visningskoder, ESRS-referensområden och statusmaskinen. Ingen IO.
 * Enhetstestad i impact-navigator.test.ts.
 *
 * Analysen är beslutsstöd om BOLAG (inte individer); människan granskar
 * väsentligheten och slutanalysen i gränssnittet (EU AI Act art. 14).
 */

import type { Role, StartupPhase } from './index';

// ─── Vokabulär (speglar migration 1700000206) ───────────────────────────────

export const IMPACT_COMPANY_STATUSES = ['draft', 'materiality_review', 'info_collection', 'needs_more_info', 'analyzed'] as const;
export type ImpactCompanyStatus = (typeof IMPACT_COMPANY_STATUSES)[number];

export const IMPACT_ASSESSMENT_TYPES = ['initial', 'update'] as const;
export type ImpactAssessmentType = (typeof IMPACT_ASSESSMENT_TYPES)[number];

export const IMPACT_ASSESSMENT_STATUSES = [
  'materiality_pending',
  'materiality_review',
  'info_pending',
  'needs_more_info',
  'final_pending',
  'complete',
  'failed'
] as const;
export type ImpactAssessmentStatus = (typeof IMPACT_ASSESSMENT_STATUSES)[number];

export const IMPACT_GAP_SEVERITIES = ['required', 'recommended'] as const;
export type ImpactGapSeverity = (typeof IMPACT_GAP_SEVERITIES)[number];
export const IMPACT_GAP_STATUSES = ['open', 'answered', 'not_available'] as const;
export type ImpactGapStatus = (typeof IMPACT_GAP_STATUSES)[number];

export const IMPACT_UPLOAD_STAGES = ['idea_description', 'full_information', 'gap_response', 'update'] as const;
export type ImpactUploadStage = (typeof IMPACT_UPLOAD_STAGES)[number];

export const IMPACT_JOB_TYPES = ['materiality', 'sufficiency', 'final_analysis', 'update_analysis'] as const;
export type ImpactJobType = (typeof IMPACT_JOB_TYPES)[number];

/** AI-genererade områden har bara dessa tre kategorier (CUSTOM är ett äldre, persisterat värde). */
export const IMPACT_CATEGORIES = ['ENVIRONMENT', 'SOCIAL', 'GOVERNANCE'] as const;
export type ImpactCategory = (typeof IMPACT_CATEGORIES)[number];
export type ImpactPersistedCategory = ImpactCategory | 'CUSTOM';

/** De fem övergripande nivåerna — exakt originalets ordning (låg → hög). */
export const IMPACT_LEVELS = ['RISK_EXPOSED', 'RESPONSIBLE', 'SUSTAINABILITY_DRIVEN', 'IMPACT_DRIVEN', 'SYSTEM_CHANGING_IMPACT'] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

export const IMPACT_MATERIALITY_STATUSES = ['MATERIAL', 'UNCERTAIN', 'NOT_MATERIAL'] as const;
export type ImpactMaterialityStatus = (typeof IMPACT_MATERIALITY_STATUSES)[number];
export type ImpactSelectedStatus = 'MATERIAL' | 'UNCERTAIN';

export const IMPACT_CONFIDENCES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ImpactConfidence = (typeof IMPACT_CONFIDENCES)[number];
export const IMPACT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ImpactPriority = (typeof IMPACT_PRIORITIES)[number];
export const IMPACT_HORIZONS = ['SHORT', 'MEDIUM', 'LONG'] as const;
export type ImpactHorizon = (typeof IMPACT_HORIZONS)[number];
export const IMPACT_INFORMATION_STATUSES = ['SUFFICIENT', 'PARTIAL', 'MISSING'] as const;
export type ImpactInformationStatus = (typeof IMPACT_INFORMATION_STATUSES)[number];
export const IMPACT_MATERIALITY_DRIVERS = ['RISK', 'OPPORTUNITY', 'IMPACT', 'VALUE_CHAIN', 'REGULATORY', 'USER_IMPACT'] as const;
export type ImpactMaterialityDriver = (typeof IMPACT_MATERIALITY_DRIVERS)[number];
export const IMPACT_BMC_STATUSES = ['HARMFUL_OR_RISKY', 'COMPATIBLE_WITH_LONG_TERM_SUSTAINABILITY', 'UNCERTAIN'] as const;
export type ImpactBmcStatus = (typeof IMPACT_BMC_STATUSES)[number];
export const IMPACT_AREA_KEYS = ['overall', 'environment', 'social', 'governance'] as const;
export type ImpactAreaKey = (typeof IMPACT_AREA_KEYS)[number];

export const IMPACT_FRAMEWORK_VERSION = 'movexum-v0.1';

/** Originalets faser i analysen (prompten anpassar frågornas ambitionsnivå efter dem). */
export const IMPACT_PHASES = ['SCREENING', 'BOOST_CHAMBER', 'INKUBATOR', 'ACCELERATOR'] as const;
export type ImpactPhase = (typeof IMPACT_PHASES)[number];
export const IMPACT_PHASE_LABELS: Record<ImpactPhase, string> = {
  SCREENING: 'Screening',
  BOOST_CHAMBER: 'Boost Chamber',
  INKUBATOR: 'Inkubator',
  ACCELERATOR: 'Accelerator'
};

/** Plattformens bolagsfas → analysens fas (prompten känner bara originalets fyra). */
export function impactPhaseFor(phase: StartupPhase | string): ImpactPhase {
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

/** Movexum-personal som får driva en analys; observer läser. */
export const IMPACT_MANAGE_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
export const IMPACT_READ_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];
/** Bara ledningen får ta bort ett bolags hela analyshistorik. */
export const IMPACT_DELETE_ROLES: Role[] = ['admin', 'incubator_lead'];

export function canManageImpact(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((r) => IMPACT_MANAGE_ROLES.includes(r));
}
export function canReadImpact(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((r) => IMPACT_READ_ROLES.includes(r));
}
export function canDeleteImpact(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((r) => IMPACT_DELETE_ROLES.includes(r));
}

// ─── Etiketter (originalets ordalydelser) ───────────────────────────────────

export const IMPACT_COMPANY_STATUS_LABELS: Record<ImpactCompanyStatus, string> = {
  draft: 'Utkast',
  materiality_review: 'Väsentlighet granskas',
  info_collection: 'Informationsinsamling',
  needs_more_info: 'Behöver mer information',
  analyzed: 'Analyserad'
};
export const IMPACT_ASSESSMENT_STATUS_LABELS: Record<ImpactAssessmentStatus, string> = {
  materiality_pending: 'Väsentlighetsanalys väntar',
  materiality_review: 'Väsentlighet granskas',
  info_pending: 'Informationsgap granskas',
  needs_more_info: 'Behöver mer information',
  final_pending: 'Slutanalys väntar',
  complete: 'Klar',
  failed: 'Misslyckades'
};
export const IMPACT_LEVEL_LABELS: Record<ImpactLevel, string> = {
  RISK_EXPOSED: 'Riskexponerad',
  RESPONSIBLE: 'Ansvarsfullt',
  SUSTAINABILITY_DRIVEN: 'Hållbarhetsdrivande',
  IMPACT_DRIVEN: 'Impactdrivande',
  SYSTEM_CHANGING_IMPACT: 'Systemförändrande'
};
export const IMPACT_LEVEL_CRITERIA: Record<ImpactLevel, string> = {
  RISK_EXPOSED: 'Bolaget har betydande hållbarhetsutmaningar eller hög exponering mot framtida hållbarhetsrisker.',
  RESPONSIBLE: 'Bolaget arbetar för att minimera negativ påverkan och skapa långsiktigt hållbara förutsättningar.',
  SUSTAINABILITY_DRIVEN: 'Hållbarhet är en integrerad del av strategi, erbjudande och affärsutveckling.',
  IMPACT_DRIVEN: 'Samhälls- eller miljönyttan är en central del av affärsmodellen och värdeskapandet.',
  SYSTEM_CHANGING_IMPACT:
    'Bolaget har potential att förändra marknader, beteenden eller strukturer och därigenom skapa bred och varaktig samhälls- eller miljöpåverkan.'
};
export const IMPACT_LEVEL_CRITERIA_TEXT = IMPACT_LEVELS.map((level) => `- ${level} = ${IMPACT_LEVEL_LABELS[level]} – ${IMPACT_LEVEL_CRITERIA[level]}`).join('\n');
/** Rang för sortering (jämförelsen): 0 = Riskexponerad … 4 = Systemförändrande. */
export const IMPACT_LEVEL_RANK: Record<ImpactLevel, number> = {
  RISK_EXPOSED: 0,
  RESPONSIBLE: 1,
  SUSTAINABILITY_DRIVEN: 2,
  IMPACT_DRIVEN: 3,
  SYSTEM_CHANGING_IMPACT: 4
};

export function getImpactLevelLabel(level?: string | null): string | undefined {
  if (!level || !Object.prototype.hasOwnProperty.call(IMPACT_LEVEL_LABELS, level)) return undefined;
  return IMPACT_LEVEL_LABELS[level as ImpactLevel];
}

export const IMPACT_CATEGORY_LABELS: Record<ImpactPersistedCategory, string> = {
  ENVIRONMENT: 'Miljö',
  SOCIAL: 'Socialt & mänskliga rättigheter',
  GOVERNANCE: 'Etik & styrning',
  CUSTOM: 'Eget område'
};
export const IMPACT_CATEGORY_CODE_PREFIXES: Record<ImpactPersistedCategory, string> = {
  ENVIRONMENT: 'ENV',
  SOCIAL: 'SOC',
  GOVERNANCE: 'GOV',
  CUSTOM: 'OWN'
};
export const IMPACT_CONFIDENCE_LABELS: Record<ImpactConfidence, string> = { LOW: 'Låg', MEDIUM: 'Medel', HIGH: 'Hög' };
export const IMPACT_PRIORITY_LABELS: Record<ImpactPriority, string> = { LOW: 'Låg', MEDIUM: 'Medel', HIGH: 'Hög' };
/** Bakåtkompatibelt namn (chips använder det). */
export const IMPACT_GRADE_LABELS = IMPACT_PRIORITY_LABELS;
export type ImpactGrade = ImpactPriority;
export const IMPACT_HORIZON_LABELS: Record<ImpactHorizon, string> = { SHORT: 'Kort sikt', MEDIUM: 'Medellång sikt', LONG: 'Lång sikt' };
export const IMPACT_INFORMATION_STATUS_LABELS: Record<ImpactInformationStatus, string> = {
  SUFFICIENT: 'Tillräckligt',
  PARTIAL: 'Delvis',
  MISSING: 'Saknas'
};
export const IMPACT_MATERIALITY_LABELS: Record<ImpactMaterialityStatus, string> = {
  MATERIAL: 'Väsentlig',
  UNCERTAIN: 'Osäker',
  NOT_MATERIAL: 'Ej väsentlig'
};
export const IMPACT_MATERIALITY_DRIVER_LABELS: Record<ImpactMaterialityDriver, string> = {
  RISK: 'Risk',
  OPPORTUNITY: 'Möjlighet',
  IMPACT: 'Påverkan',
  VALUE_CHAIN: 'Värdekedja',
  REGULATORY: 'Regelverk',
  USER_IMPACT: 'Användarpåverkan'
};
export const IMPACT_MATERIALITY_DRIVER_DESCRIPTIONS: Record<ImpactMaterialityDriver, string> = {
  RISK: 'Kan skapa framtida affärs-, förtroende- eller hållbarhetsrisker.',
  OPPORTUNITY: 'Kan stärka erbjudandet, positioneringen eller möjligheten att skala ansvarsfullt.',
  IMPACT: 'Kan ge tydlig positiv eller negativ påverkan om affärsidén växer.',
  VALUE_CHAIN: 'Beror på leverantörer, produktion, drift, distribution eller andra led runt lösningen.',
  REGULATORY: 'Kan påverkas av regler, standarder, branschkrav eller kunders kravbild.',
  USER_IMPACT: 'Berör människors trygghet, integritet, tillgänglighet eller beslut.'
};
export const IMPACT_BMC_LABELS: Record<ImpactBmcStatus, string> = {
  HARMFUL_OR_RISKY: 'Skadlig eller riskabel',
  COMPATIBLE_WITH_LONG_TERM_SUSTAINABILITY: 'Förenlig med långsiktig hållbarhet',
  UNCERTAIN: 'Osäker'
};
export const IMPACT_UPLOAD_STAGE_LABELS: Record<ImpactUploadStage, string> = {
  idea_description: 'Idébeskrivning',
  full_information: 'Full information',
  gap_response: 'Kompletteringssvar',
  update: 'Uppdatering'
};
export const IMPACT_EXTRACTION_STATUS_LABELS: Record<string, string> = {
  pending: 'Väntar',
  complete: 'Klar',
  failed: 'Misslyckades'
};
export const IMPACT_GAP_SEVERITY_LABELS: Record<ImpactGapSeverity, string> = { required: 'Krävs', recommended: 'Rekommenderas' };
export const IMPACT_GAP_STATUS_LABELS: Record<ImpactGapStatus, string> = {
  open: 'Obesvarad',
  answered: 'Besvarad',
  not_available: 'Ej tillgänglig'
};
export const IMPACT_JOB_TYPE_LABELS: Record<ImpactJobType, string> = {
  materiality: 'Väsentlighetsanalys',
  sufficiency: 'Informationsgapanalys',
  final_analysis: 'Slutanalys',
  update_analysis: 'Uppdateringsanalys'
};
export const IMPACT_AREA_TITLES: Record<ImpactAreaKey, string> = {
  overall: 'Övergripande bedömning',
  environment: 'Miljömässig hållbarhet',
  social: 'Social hållbarhet',
  governance: 'Styrning och ansvar'
};

/** ESRS-referensområden — inspiration och mappningsstöd i väsentlighetsprompten, ingen sluten lista. */
export const IMPACT_FRAMEWORK_AREAS: ReadonlyArray<{ code: string; name: string; category: ImpactCategory }> = [
  { code: 'E1', name: 'Klimatförändringar', category: 'ENVIRONMENT' },
  { code: 'E2', name: 'Föroreningar', category: 'ENVIRONMENT' },
  { code: 'E3', name: 'Vatten och marina resurser', category: 'ENVIRONMENT' },
  { code: 'E4', name: 'Biologisk mångfald och ekosystem', category: 'ENVIRONMENT' },
  { code: 'E5', name: 'Resursanvändning och cirkularitet', category: 'ENVIRONMENT' },
  { code: 'S1', name: 'Egna anställda', category: 'SOCIAL' },
  { code: 'S2', name: 'Arbetstagare i värdekedjan', category: 'SOCIAL' },
  { code: 'S3', name: 'Påverkade samhällen', category: 'SOCIAL' },
  { code: 'S4', name: 'Konsumenter och slutanvändare', category: 'SOCIAL' },
  { code: 'G1', name: 'Affärsetik och bolagsstyrning', category: 'GOVERNANCE' }
];

export const IMPACT_DISCLAIMER =
  'Bedömningen är ett coachande beslutsstöd baserat enbart på tillhandahållet material. Den är inte en juridisk bedömning, teknisk säkerhetsgranskning, ESG-revision eller formell hållbarhetsrapportering. Genererat av AI — verifiera innan delning.';

// ─── Typade resultat (originalets scheman i persisterad form) ──────────────

export interface ImpactEvidence {
  documentName: string | null;
  note: string;
  excerpt: string | null;
}

export interface ImpactAspect {
  code: string;
  name: string;
  category: ImpactPersistedCategory;
  status: ImpactSelectedStatus;
  /** 1–5 (originalets heltalsskala). */
  materialityStrength: number;
  materialityDrivers: ImpactMaterialityDriver[];
  underlyingAspects: string[];
  rationale: string;
  startupSpecificReason: string;
  futureDevelopmentRelevance: string;
  evidence: ImpactEvidence[];
  confidence: ImpactConfidence;
  uncertaintyNotes: string[];
}

export interface ImpactConsideredAspect {
  code: string;
  name: string;
  category: ImpactPersistedCategory;
  rationale: string;
}

export interface ImpactMateriality {
  companySummary: string;
  sustainabilityPerspectiveSummary: string;
  materialityApproach: string;
  selectedAspects: ImpactAspect[];
  consideredButNotMaterial: ImpactConsideredAspect[];
  assumptions: string[];
  warnings: string[];
}

export interface ImpactSufficiencyQuestion {
  question: string;
  missingInformation: string;
  whyThisMattersForFinalAssessment: string;
  severity: 'REQUIRED' | 'RECOMMENDED';
  exampleHelpfulEvidence: string;
}

export interface ImpactAspectCheck {
  code: string;
  name: string;
  category: ImpactPersistedCategory;
  informationStatus: ImpactInformationStatus;
  rationale: string;
  whatWeKnow: string[];
  missingInformation: string[];
  question: ImpactSufficiencyQuestion | null;
  confidence: ImpactConfidence;
}

export interface ImpactSufficiency {
  readyForFinalAnalysis: boolean;
  /** 0–100. */
  overallInformationQuality: number;
  generalComment: string;
  aspectChecks: ImpactAspectCheck[];
  generalMissingInformation: string[];
  userMessage: string;
}

export interface ImpactRisk {
  aspectCode: string;
  category: ImpactPersistedCategory;
  title: string;
  description: string;
  severity: ImpactPriority;
  timeHorizon: ImpactHorizon;
  whyImportant: string;
  howItCanAffectFutureDevelopment: string;
  mitigationSuggestion: string;
  evidence: string[];
}

export interface ImpactOpportunity {
  aspectCode: string;
  category: ImpactPersistedCategory;
  title: string;
  description: string;
  potential: ImpactPriority;
  whyImportant: string;
  howCompanyCanUseIt: string;
  recommendedAction: string;
  evidence: string[];
}

export interface ImpactAreaAssessment {
  potentialLabel: string;
  assessment: string;
  uncertaintyNotes: string[];
}

export interface ImpactWorkItem {
  title: string;
  description: string;
  priority: ImpactPriority;
  realisticStartupNextStep: string;
}

export interface ImpactDiscussionQuestion {
  question: string;
  whyImportant: string;
  suggestedOwnerRole?: string;
  aspectCode?: string;
}

export interface ImpactGreenwashingRisk {
  claimOrRisk: string;
  whyRisky: string;
  howToSubstantiate: string;
}

export interface ImpactDashboard {
  executiveSummary: string;
  companySustainabilityDescription: string;
  businessModelCompatibility: { status: ImpactBmcStatus; rationale: string; consequencesIfScaled: string };
  impactLevel: { level: ImpactLevel; labelSv: string; rationale: string };
  areaAssessments: Record<ImpactAreaKey, ImpactAreaAssessment>;
  /** Högst ~12 ord om hur underlaget bör läsas, utan siffra. */
  informationQualityComment: string;
  whatCompanyNeedsToWorkOn: ImpactWorkItem[];
  risks: ImpactRisk[];
  opportunities: ImpactOpportunity[];
  discussionQuestions: ImpactDiscussionQuestion[];
  greenwashingRisks: ImpactGreenwashingRisk[];
  assumptions: string[];
  limitations: string[];
  disclaimer: string;
  /** Äldre analyser (före områdesbedömningarna) bar poäng 0–100 per område. */
  scores?: Record<ImpactAreaKey, number>;
  scoreRationale?: Record<ImpactAreaKey, string>;
  informationQualityScore?: number;
  informationQualityRationale?: string;
}

export interface ImpactChangedAreaAssessment {
  category: 'OVERALL' | 'ENVIRONMENT' | 'SOCIAL' | 'GOVERNANCE';
  previousPotential: string;
  newPotential: string;
  reason: string;
}

export interface ImpactUpdateDelta {
  whatChangedSinceLastAssessment: string[];
  newRisks: string[];
  reducedRisks: string[];
  newOpportunities: string[];
  changedImpactLevel?: string;
  changedAreaAssessments: ImpactChangedAreaAssessment[];
  recommendedNextDiscussions: string[];
}

export interface ImpactUpdateAnalysis {
  updatedDashboard: ImpactDashboard;
  deltaSummary: ImpactUpdateDelta;
}

// ─── Normalisering (modellens svar är UNTRUSTED data) ───────────────────────

export const IMPACT_TEXT_MAX = 6000;
const LIST_MAX = 30;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown, max = IMPACT_TEXT_MAX): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}
function strOrNull(v: unknown, max = IMPACT_TEXT_MAX): string | null {
  const s = str(v, max);
  return s ? s : null;
}
function strList(v: unknown, max = LIST_MAX): string[] {
  if (typeof v === 'string') return v.trim() ? [str(v)] : [];
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' || typeof x === 'number' ? str(x) : typeof x === 'object' && x ? str(rec(x).text ?? rec(x).title ?? rec(x).note ?? rec(x).reason) : ''))
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
function score100(v: unknown): number {
  return int(v, 0, 100, 0);
}
function score100OrUndef(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, n));
}
function confidence(v: unknown): ImpactConfidence {
  const token = oneOfOrNull(v, IMPACT_CONFIDENCES);
  if (token) return token;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 'MEDIUM';
  const x = n > 1 ? n / 100 : n;
  return x >= 0.75 ? 'HIGH' : x >= 0.4 ? 'MEDIUM' : 'LOW';
}
function strength(v: unknown): number {
  const grade = oneOfOrNull(v, IMPACT_PRIORITIES);
  if (grade) return grade === 'HIGH' ? 4 : grade === 'MEDIUM' ? 3 : 2;
  return int(v, 1, 5, 3);
}
function categoryFromCode(code: string): ImpactCategory | null {
  const c = code.toUpperCase();
  if (/(^|[-_])ENV(?:IRONMENT)?($|[-_])/.test(c)) return 'ENVIRONMENT';
  if (/(^|[-_])(SOC|CUS|CUSTOMER|CONSUMER)(?:IAL)?($|[-_])/.test(c)) return 'SOCIAL';
  if (/(^|[-_])GOV(?:ERNANCE)?($|[-_])/.test(c)) return 'GOVERNANCE';
  return null;
}
function persistedCategory(v: unknown, code: string): ImpactPersistedCategory {
  const token = normalizeToken(v);
  if ((IMPACT_CATEGORIES as readonly string[]).includes(token)) return token as ImpactCategory;
  if (token === 'CUSTOM') return 'CUSTOM';
  return categoryFromCode(code) ?? 'GOVERNANCE';
}
/** Till modellen/analysen: ett äldre CUSTOM-område får en modern huvudkategori. */
export function toAnalysisCategory(category: ImpactPersistedCategory, aspectCode: string): ImpactCategory {
  if (category !== 'CUSTOM') return category;
  return categoryFromCode(aspectCode) ?? 'GOVERNANCE';
}
function aspectCode(v: unknown, category: ImpactPersistedCategory, index: number): string {
  const s = str(v, 40).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (/^[A-Z]{2,4}(-[A-Z]{2,4})?-\d{1,3}$/.test(s)) return s;
  const prefix = category === 'CUSTOM' ? 'OWN' : `OWN-${IMPACT_CATEGORY_CODE_PREFIXES[category]}`;
  return `${prefix}-${String(index + 1).padStart(2, '0')}`;
}
function evidence(v: unknown): ImpactEvidence[] {
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

export function normalizeImpactMateriality(raw: unknown): ImpactMateriality {
  const r = rec(raw);
  const selected = Array.isArray(r.selectedAspects) ? r.selectedAspects : [];
  const selectedAspects: ImpactAspect[] = selected.slice(0, 12).map((a, i) => {
    const ar = rec(a);
    const codeGuess = str(ar.code, 40);
    const category = persistedCategory(ar.category, codeGuess);
    const drivers = (Array.isArray(ar.materialityDrivers) ? ar.materialityDrivers : [])
      .map((d) => oneOfOrNull(d, IMPACT_MATERIALITY_DRIVERS))
      .filter((d): d is ImpactMaterialityDriver => d !== null);
    return {
      code: aspectCode(ar.code, category, i),
      name: str(ar.name, 200) || 'Namnlöst område',
      category,
      status: oneOf(ar.status, ['MATERIAL', 'UNCERTAIN'] as const, 'MATERIAL'),
      materialityStrength: strength(ar.materialityStrength),
      materialityDrivers: Array.from(new Set(drivers)),
      underlyingAspects: strList(ar.underlyingAspects),
      rationale: str(ar.rationale),
      startupSpecificReason: str(ar.startupSpecificReason),
      futureDevelopmentRelevance: str(ar.futureDevelopmentRelevance),
      evidence: evidence(ar.evidence),
      confidence: confidence(ar.confidence),
      uncertaintyNotes: strList(ar.uncertaintyNotes)
    };
  });
  const nonMaterial = Array.isArray(r.consideredButNotMaterial) ? r.consideredButNotMaterial : [];
  return {
    companySummary: str(r.companySummary),
    sustainabilityPerspectiveSummary: str(r.sustainabilityPerspectiveSummary),
    materialityApproach: str(r.materialityApproach),
    selectedAspects,
    consideredButNotMaterial: nonMaterial.slice(0, 20).map((a, i) => {
      const ar = rec(a);
      const codeGuess = str(ar.code, 40);
      const category = persistedCategory(ar.category, codeGuess);
      return { code: aspectCode(ar.code, category, 50 + i), name: str(ar.name, 200) || 'Namnlöst område', category, rationale: str(ar.rationale) };
    }),
    assumptions: strList(r.assumptions),
    warnings: strList(r.warnings)
  };
}

export function normalizeImpactSufficiency(raw: unknown): ImpactSufficiency {
  const r = rec(raw);
  const checks = Array.isArray(r.aspectChecks) ? r.aspectChecks : [];
  return {
    readyForFinalAnalysis: r.readyForFinalAnalysis === true,
    overallInformationQuality: score100(r.overallInformationQuality),
    generalComment: str(r.generalComment),
    aspectChecks: checks.slice(0, 12).map((c, i) => {
      const cr = rec(c);
      const codeGuess = str(cr.code, 40);
      const category = persistedCategory(cr.category, codeGuess);
      const q = rec(cr.question);
      const questionText = str(q.question ?? (typeof cr.question === 'string' ? cr.question : ''));
      return {
        code: aspectCode(cr.code, category, i),
        name: str(cr.name, 200),
        category,
        informationStatus: oneOf(cr.informationStatus, IMPACT_INFORMATION_STATUSES, 'PARTIAL'),
        rationale: str(cr.rationale),
        whatWeKnow: strList(cr.whatWeKnow),
        missingInformation: strList(cr.missingInformation),
        question: questionText
          ? {
              question: questionText,
              missingInformation: str(q.missingInformation),
              whyThisMattersForFinalAssessment: str(q.whyThisMattersForFinalAssessment ?? q.whyThisMatters),
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

const LEGACY_AREA_FALLBACKS: Record<Exclude<ImpactAreaKey, 'overall'>, string> = {
  environment:
    'Tidigare analys saknar separat miljötext. Läs bedömningen som en äldre version och skapa en ny analysversion för en mer genomarbetad områdesbedömning.',
  social:
    'Tidigare analys saknar separat social text. Läs bedömningen som en äldre version och skapa en ny analysversion för en mer genomarbetad områdesbedömning.',
  governance:
    'Tidigare analys saknar separat styrningstext. Läs bedömningen som en äldre version och skapa en ny analysversion för en mer genomarbetad områdesbedömning.'
};

/** Äldre poäng (0–100) → potentialetikett, exakt som originalet. */
export function legacyPotentialLabel(score: number | undefined, fallback: string): string {
  if (score == null) return fallback || 'Ej bedömt';
  if (score < 40) return 'Osäker potential';
  if (score < 60) return 'Ansvarsfull';
  if (score < 80) return 'Ansvarsfull → Hållbarhetsdrivande';
  return 'Impactdrivande';
}

function firstSentence(input?: string | null): string | undefined {
  const trimmed = input?.trim();
  if (!trimmed) return undefined;
  return trimmed.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() ?? trimmed;
}

export function legacyInformationComment(score?: number | null): string {
  if (score == null) return 'Ej bedömt.';
  if (score < 45) return 'Begränsat underlag.';
  if (score < 70) return 'Första bedömning möjlig.';
  return 'Gott underlag.';
}

function legacyInformationQualityComment(rationale: string | undefined, score: number | undefined): string {
  const sentence = firstSentence(rationale);
  if (sentence && sentence.length <= 110) return sentence;
  if (sentence && score == null) return `${sentence.slice(0, 107)}...`;
  return legacyInformationComment(score);
}

function areaScores(v: unknown): Record<ImpactAreaKey, number> | undefined {
  const r = rec(v);
  const vals = IMPACT_AREA_KEYS.map((k) => score100OrUndef(r[k]));
  if (vals.every((x) => x === undefined)) return undefined;
  return { overall: vals[0] ?? 0, environment: vals[1] ?? 0, social: vals[2] ?? 0, governance: vals[3] ?? 0 };
}
function areaTexts(v: unknown): Record<ImpactAreaKey, string> | undefined {
  const r = rec(v);
  const vals = IMPACT_AREA_KEYS.map((k) => str(r[k]));
  if (vals.every((x) => !x)) return undefined;
  return { overall: vals[0], environment: vals[1], social: vals[2], governance: vals[3] };
}

/** Area-objekt ur modellsvaret eller sparad data; `fallback` när fältet saknas. */
function area(v: unknown, fallback: ImpactAreaAssessment): ImpactAreaAssessment {
  if (v === undefined || v === null) return fallback;
  const r = rec(v);
  return {
    potentialLabel: str(r.potentialLabel, 200) || fallback.potentialLabel,
    assessment: str(r.assessment) || fallback.assessment,
    uncertaintyNotes: Array.isArray(r.uncertaintyNotes) ? strList(r.uncertaintyNotes) : fallback.uncertaintyNotes
  };
}

/** `impactLevel` kan vara ett objekt, en kod eller en svensk etikett (toleransen gäller även äldre data). */
function impactLevelOf(v: unknown): ImpactLevel {
  const il = rec(v);
  const direct = oneOfOrNull(il.level ?? v, IMPACT_LEVELS);
  if (direct) return direct;
  const label = str(il.labelSv ?? (typeof v === 'string' ? v : ''), 80).toLowerCase();
  for (const level of IMPACT_LEVELS) {
    if (label && IMPACT_LEVEL_LABELS[level].toLowerCase() === label) return level;
  }
  return 'RESPONSIBLE';
}

function bmcStatus(v: unknown): ImpactBmcStatus {
  const token = normalizeToken(v);
  if ((IMPACT_BMC_STATUSES as readonly string[]).includes(token)) return token as ImpactBmcStatus;
  if (token === 'INCOMPATIBLE' || token === 'HARMFUL' || token === 'RISKY') return 'HARMFUL_OR_RISKY';
  if (token === 'COMPATIBLE') return 'COMPATIBLE_WITH_LONG_TERM_SUSTAINABILITY';
  return 'UNCERTAIN';
}

/**
 * Slutanalysen i kanonisk form (originalets `normalizeFinalOutput`):
 * `labelSv` och `areaAssessments.overall.potentialLabel` följer ALLTID
 * koden, `overall.uncertaintyNotes` är tom, äldre poäng blir
 * områdesbedömningar och en saknad informationskommentar härleds.
 */
export function normalizeImpactDashboard(raw: unknown): ImpactDashboard {
  const r = rec(raw);
  const level = impactLevelOf(r.impactLevel);
  const canonicalLabel = IMPACT_LEVEL_LABELS[level];
  const il = rec(r.impactLevel);
  const bmc = rec(r.businessModelCompatibility);
  const scores = areaScores(r.scores);
  const scoreRationale = areaTexts(r.scoreRationale);
  const informationQualityScore = score100OrUndef(r.informationQualityScore);
  const informationQualityRationale = str(r.informationQualityRationale) || undefined;
  const limitations = strList(r.limitations);
  const impactRationale = str(il.rationale);

  const legacyNotes = limitations.slice(0, 2);
  const legacyArea = (key: Exclude<ImpactAreaKey, 'overall'>): ImpactAreaAssessment => ({
    potentialLabel: legacyPotentialLabel(scores?.[key], canonicalLabel),
    assessment: scoreRationale?.[key] || LEGACY_AREA_FALLBACKS[key],
    uncertaintyNotes: legacyNotes
  });
  const areasRaw = r.areaAssessments === undefined || r.areaAssessments === null ? undefined : rec(r.areaAssessments);
  const overallRaw = areasRaw ? rec(areasRaw.overall) : {};
  const areaAssessments: Record<ImpactAreaKey, ImpactAreaAssessment> = {
    overall: {
      potentialLabel: canonicalLabel,
      assessment: str(overallRaw.assessment) || impactRationale || str(r.executiveSummary) || 'Övergripande bedömning saknas.',
      uncertaintyNotes: []
    },
    environment: area(areasRaw?.environment, legacyArea('environment')),
    social: area(areasRaw?.social, legacyArea('social')),
    governance: area(areasRaw?.governance, legacyArea('governance'))
  };

  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, LIST_MAX) : []);
  const mapRisk = (x: unknown): ImpactRisk => {
    const xr = rec(x);
    const code = str(xr.aspectCode, 40);
    return {
      aspectCode: code,
      category: persistedCategory(xr.category, code),
      title: str(xr.title, 200),
      description: str(xr.description),
      severity: oneOf(xr.severity, IMPACT_PRIORITIES, 'MEDIUM'),
      timeHorizon: oneOf(xr.timeHorizon, IMPACT_HORIZONS, 'MEDIUM'),
      whyImportant: str(xr.whyImportant),
      howItCanAffectFutureDevelopment: str(xr.howItCanAffectFutureDevelopment),
      mitigationSuggestion: str(xr.mitigationSuggestion),
      evidence: strList(xr.evidence, 10)
    };
  };
  const mapOpp = (x: unknown): ImpactOpportunity => {
    const xr = rec(x);
    const code = str(xr.aspectCode, 40);
    return {
      aspectCode: code,
      category: persistedCategory(xr.category, code),
      title: str(xr.title, 200),
      description: str(xr.description),
      potential: oneOf(xr.potential, IMPACT_PRIORITIES, 'MEDIUM'),
      whyImportant: str(xr.whyImportant),
      howCompanyCanUseIt: str(xr.howCompanyCanUseIt),
      recommendedAction: str(xr.recommendedAction),
      evidence: strList(xr.evidence, 10)
    };
  };

  const dashboard: ImpactDashboard = {
    executiveSummary: str(r.executiveSummary),
    companySustainabilityDescription: str(r.companySustainabilityDescription),
    businessModelCompatibility: {
      status: bmcStatus(bmc.status),
      rationale: str(bmc.rationale),
      consequencesIfScaled: str(bmc.consequencesIfScaled)
    },
    impactLevel: { level, labelSv: canonicalLabel, rationale: impactRationale },
    areaAssessments,
    informationQualityComment: str(r.informationQualityComment, 400) || legacyInformationQualityComment(informationQualityRationale, informationQualityScore),
    whatCompanyNeedsToWorkOn: list(r.whatCompanyNeedsToWorkOn)
      .map((w) => {
        const wr = rec(w);
        return {
          title: str(wr.title, 200),
          description: str(wr.description),
          priority: oneOf(wr.priority, IMPACT_PRIORITIES, 'MEDIUM'),
          realisticStartupNextStep: str(wr.realisticStartupNextStep)
        };
      })
      .filter((w) => w.title),
    risks: list(r.risks).map(mapRisk).filter((x) => x.title),
    opportunities: list(r.opportunities).map(mapOpp).filter((x) => x.title),
    discussionQuestions: list(r.discussionQuestions)
      .map((q) => {
        const qr = rec(q);
        const owner = str(qr.suggestedOwnerRole, 100);
        const code = str(qr.aspectCode, 40);
        return {
          question: str(qr.question),
          whyImportant: str(qr.whyImportant),
          ...(owner ? { suggestedOwnerRole: owner } : {}),
          ...(code ? { aspectCode: code } : {})
        };
      })
      .filter((q) => q.question),
    greenwashingRisks: list(r.greenwashingRisks)
      .map((g) => {
        const gr = rec(g);
        return { claimOrRisk: str(gr.claimOrRisk), whyRisky: str(gr.whyRisky), howToSubstantiate: str(gr.howToSubstantiate) };
      })
      .filter((g) => g.claimOrRisk),
    assumptions: strList(r.assumptions),
    limitations,
    disclaimer: str(r.disclaimer) || IMPACT_DISCLAIMER
  };
  if (scores) dashboard.scores = scores;
  if (scoreRationale) dashboard.scoreRationale = scoreRationale;
  if (informationQualityScore !== undefined) dashboard.informationQualityScore = informationQualityScore;
  if (informationQualityRationale) dashboard.informationQualityRationale = informationQualityRationale;
  return dashboard;
}

export function normalizeImpactUpdateDelta(raw: unknown): ImpactUpdateDelta {
  const r = rec(raw);
  const changed = str(r.changedImpactLevel, 200);
  const areas = Array.isArray(r.changedAreaAssessments) ? r.changedAreaAssessments : [];
  return {
    whatChangedSinceLastAssessment: strList(r.whatChangedSinceLastAssessment),
    newRisks: strList(r.newRisks),
    reducedRisks: strList(r.reducedRisks),
    newOpportunities: strList(r.newOpportunities),
    ...(changed ? { changedImpactLevel: changed } : {}),
    changedAreaAssessments: areas
      .slice(0, 8)
      .map((c): ImpactChangedAreaAssessment => {
        if (typeof c === 'string') return { category: 'OVERALL', previousPotential: '', newPotential: '', reason: str(c) };
        const cr = rec(c);
        return {
          category: oneOf(cr.category, ['OVERALL', 'ENVIRONMENT', 'SOCIAL', 'GOVERNANCE'] as const, 'OVERALL'),
          previousPotential: str(cr.previousPotential, 200),
          newPotential: str(cr.newPotential, 200),
          reason: str(cr.reason)
        };
      })
      .filter((c) => c.reason || c.newPotential),
    recommendedNextDiscussions: strList(r.recommendedNextDiscussions)
  };
}

/** Uppdateringssteget svarar `{ updatedDashboard, deltaSummary }` (äldre varianter tolereras). */
export function normalizeImpactUpdateAnalysis(raw: unknown): ImpactUpdateAnalysis {
  const r = rec(raw);
  return {
    updatedDashboard: normalizeImpactDashboard(r.updatedDashboard ?? r.dashboard ?? raw),
    deltaSummary: normalizeImpactUpdateDelta(r.deltaSummary ?? r.updateDelta ?? r.delta)
  };
}

/** Tolerant JSON-extraktion ur ett modellsvar (kan ha omgivande text/kodstaket). */
export function parseImpactModelJson(text: string): unknown {
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

// ─── Områdesbedömningar & informationsläge (presentation) ──────────────────

export interface ImpactAreaAssessmentItem {
  key: ImpactAreaKey;
  title: string;
  potentialLabel: string;
  assessment: string;
  uncertaintyNotes: string[];
}

/** De fyra områdeskorten (övergripande först); utan slutanalys "Ej bedömt". */
export function getImpactAreaAssessmentItems(dashboard?: ImpactDashboard | null): ImpactAreaAssessmentItem[] {
  return IMPACT_AREA_KEYS.map((key) => {
    const a = dashboard?.areaAssessments?.[key];
    return {
      key,
      title: IMPACT_AREA_TITLES[key],
      potentialLabel: key === 'overall' ? getImpactLevelLabel(dashboard?.impactLevel?.level) ?? 'Ej bedömt' : a?.potentialLabel ?? 'Ej bedömt',
      assessment: a?.assessment ?? (dashboard ? 'Bedömning saknas.' : 'Bedömning saknas.'),
      uncertaintyNotes: a?.uncertaintyNotes ?? (dashboard ? [] : ['Analysen saknas eller är ofullständig.'])
    };
  });
}

function compactComment(input: string | undefined, score: number | undefined): string | undefined {
  const sentence = firstSentence(input);
  if (!sentence) return undefined;
  if (sentence.length <= 110) return sentence;
  if (score != null) return legacyInformationComment(score);
  return `${sentence.slice(0, 107)}...`;
}

export function getImpactDashboardInformationComment(dashboard?: ImpactDashboard | null): string {
  if (!dashboard) return '-';
  return (
    compactComment(dashboard.informationQualityComment, dashboard.informationQualityScore) ??
    compactComment(dashboard.informationQualityRationale, dashboard.informationQualityScore) ??
    legacyInformationComment(dashboard.informationQualityScore)
  );
}

function areaWord(count: number): string {
  return count === 1 ? 'område' : 'områden';
}

export function getImpactSufficiencyInformationComment(sufficiency?: ImpactSufficiency | null): string {
  if (!sufficiency) return '-';
  const counts = sufficiency.aspectChecks.reduce(
    (acc, check) => ({
      sufficient: acc.sufficient + (check.informationStatus === 'SUFFICIENT' ? 1 : 0),
      partial: acc.partial + (check.informationStatus === 'PARTIAL' ? 1 : 0),
      missing: acc.missing + (check.informationStatus === 'MISSING' ? 1 : 0)
    }),
    { sufficient: 0, partial: 0, missing: 0 }
  );
  const parts = [
    counts.sufficient ? `${counts.sufficient} ${areaWord(counts.sufficient)} har tillräcklig information` : undefined,
    counts.partial ? (counts.partial === 1 ? '1 område är delvis belyst' : `${counts.partial} områden är delvis belysta`) : undefined,
    counts.missing ? `${counts.missing} ${areaWord(counts.missing)} saknar viktig information` : undefined
  ].filter((p): p is string => Boolean(p));
  const summary = !parts.length
    ? 'Inga väsentliga områden har informationsbedömts ännu'
    : parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} och ${parts[parts.length - 1]}`;

  if (!sufficiency.readyForFinalAnalysis) {
    return `Underlaget är fortfarande svagt för en trygg slutbedömning. ${summary}. Komplettera framför allt frågorna nedan, annars behöver analysen markera större osäkerhet.`;
  }
  if (counts.partial > 0 || counts.missing > 0) {
    return `Underlaget räcker för en första coachande bedömning, men är inte komplett. ${summary}. Svaren nedan hjälper till att göra risker, möjligheter och antaganden tydligare.`;
  }
  return `Underlaget ger en bra grund för en första coachande bedömning. ${summary}. Analysen ska ändå markera antaganden och osäkerheter där effekten ännu inte är validerad.`;
}

/** Jämförelsens rang av en potentialetikett (fri text ur äldre analyser tolereras). */
export function impactPotentialRank(label: string): number {
  if (label.includes('System')) return 5;
  if (label.includes('Impact')) return 4;
  if (label.includes('Hållbarhetsdrivande')) return 3;
  if (label.includes('Ansvarsfull')) return 2;
  if (label.includes('Osäker') || label.includes('Risk') || label.includes('Behöver')) return 1;
  return 0;
}
export function impactInformationRank(label: string): number {
  if (label.includes('Gott') || label.includes('bra grund')) return 3;
  if (label.includes('Första') || label.includes('räcker')) return 2;
  if (label.includes('Begränsat') || label.includes('svagt')) return 1;
  return 0;
}

// ─── Visningskoder (ENV-01, SOC-01 … per kategori i visningsordning) ───────

export function formatImpactAspectCode(category: ImpactPersistedCategory, categoryIndex: number): string {
  return `${IMPACT_CATEGORY_CODE_PREFIXES[category]}-${String(categoryIndex + 1).padStart(2, '0')}`;
}

export function createImpactAspectDisplayCodes<T extends { category: ImpactPersistedCategory }>(aspects: readonly T[]): string[] {
  const counts: Record<ImpactPersistedCategory, number> = { ENVIRONMENT: 0, SOCIAL: 0, GOVERNANCE: 0, CUSTOM: 0 };
  return aspects.map((aspect) => {
    const code = formatImpactAspectCode(aspect.category, counts[aspect.category]);
    counts[aspect.category] += 1;
    return code;
  });
}

// ─── Väsentlighetsgranskning (människans beslut) ────────────────────────────

export interface ImpactReviewDecision {
  aspectCode: string;
  status: string;
  comment?: string;
}
export interface ImpactReviewPromotion {
  aspectCode: string;
  comment?: string;
}
export interface ImpactReviewChange {
  aspectCode: string;
  originalStatus: ImpactMaterialityStatus;
  newStatus: ImpactMaterialityStatus;
  comment: string;
}

function normalizeReviewStatus(input: string | undefined, fallback: ImpactSelectedStatus): ImpactMaterialityStatus {
  const s = normalizeToken(input);
  return (IMPACT_MATERIALITY_STATUSES as readonly string[]).includes(s) ? (s as ImpactMaterialityStatus) : fallback;
}

export function promoteImpactConsideredAspect(aspect: ImpactConsideredAspect, comment: string): ImpactAspect {
  const userRationale = comment
    ? `Movexum har markerat området som väsentligt. Användarens motivering: ${comment}`
    : 'Movexum har markerat området som väsentligt och det ska därför ingå i den fortsatta analysen.';
  return {
    code: aspect.code,
    name: aspect.name,
    category: aspect.category,
    status: 'MATERIAL',
    materialityStrength: 3,
    materialityDrivers: ['IMPACT'],
    underlyingAspects: [aspect.name],
    rationale: userRationale,
    startupSpecificReason: comment || 'Området har prioriterats manuellt i materialitetsgranskningen.',
    futureDevelopmentRelevance: 'Området ska vägas in i analysen av bolagets framtida påverkan, risker och möjligheter.',
    evidence: [
      {
        documentName: null,
        note: comment ? `Användarbedömning: ${comment}` : 'Markerat som väsentligt av användaren i materialitetsgranskningen.',
        excerpt: null
      }
    ],
    confidence: 'LOW',
    uncertaintyNotes: [
      `AI:s tidigare bedömning var att området inte prioriterades i nuläget: ${aspect.rationale}`,
      'Den manuella prioriteringen bör följas upp i den fortsatta coachningen.'
    ]
  };
}

/**
 * Tillämpar personalens granskning (originalets `applyMaterialityReview`):
 * beslut per valt område (Väsentlig / Osäker / Ej väsentlig + kommentar) och
 * uppflyttning av övervägda områden. Returnerar den justerade väsentligheten
 * och varje faktisk ändring (→ `sustainability_materiality_overrides`).
 */
export function applyImpactMaterialityReview(
  materiality: ImpactMateriality,
  input: { decisions: readonly ImpactReviewDecision[]; promotions: readonly ImpactReviewPromotion[] }
): { materiality: ImpactMateriality; changes: ImpactReviewChange[] } {
  const decisions = new Map(input.decisions.map((d) => [d.aspectCode, d]));
  const promotions = new Map(input.promotions.map((p) => [p.aspectCode, p]));
  const selectedCodes = new Set(materiality.selectedAspects.map((a) => a.code));
  const changes: ImpactReviewChange[] = [];
  const newlyNotMaterial: ImpactConsideredAspect[] = [];

  const selectedAspects = materiality.selectedAspects.flatMap((aspect): ImpactAspect[] => {
    const decision = decisions.get(aspect.code);
    const status = normalizeReviewStatus(decision?.status, aspect.status);
    const comment = decision?.comment?.trim() ?? '';
    if (status !== aspect.status || comment) {
      changes.push({ aspectCode: aspect.code, originalStatus: aspect.status, newStatus: status, comment });
    }
    if (status === 'NOT_MATERIAL') {
      newlyNotMaterial.push({
        code: aspect.code,
        name: aspect.name,
        category: aspect.category,
        rationale: comment ? `${aspect.rationale}\n\nAnvändarkommentar: ${comment}` : aspect.rationale
      });
      return [];
    }
    return [
      {
        ...aspect,
        status,
        uncertaintyNotes: comment ? [...aspect.uncertaintyNotes, `Användarkommentar: ${comment}`] : aspect.uncertaintyNotes
      }
    ];
  });

  const remainingConsidered: ImpactConsideredAspect[] = [];
  for (const aspect of materiality.consideredButNotMaterial) {
    const promotion = promotions.get(aspect.code);
    if (!promotion || selectedCodes.has(aspect.code)) {
      remainingConsidered.push(aspect);
      continue;
    }
    const comment = promotion.comment?.trim() ?? '';
    selectedAspects.push(promoteImpactConsideredAspect(aspect, comment));
    changes.push({ aspectCode: aspect.code, originalStatus: 'NOT_MATERIAL', newStatus: 'MATERIAL', comment });
  }

  return {
    materiality: {
      ...materiality,
      selectedAspects,
      consideredButNotMaterial: [...remainingConsidered, ...newlyNotMaterial]
    },
    changes
  };
}

/** Eget område tillagt av personalen i granskningen (`OWN-<KAT>-NN`, nästa lediga nummer). */
export function createImpactCustomAspect(
  materiality: ImpactMateriality,
  input: { name: string; category: string; underlying?: string }
): ImpactAspect {
  const category = oneOf(input.category, IMPACT_CATEGORIES, 'GOVERNANCE');
  const prefix = `OWN-${IMPACT_CATEGORY_CODE_PREFIXES[category]}-`;
  const nextIndex =
    Math.max(
      0,
      ...[...materiality.selectedAspects, ...materiality.consideredButNotMaterial].map((aspect) => {
        if (!aspect.code.startsWith(prefix)) return 0;
        const index = Number(aspect.code.slice(prefix.length));
        return Number.isInteger(index) ? index : 0;
      })
    ) + 1;
  const name = input.name.trim();
  const underlying = (input.underlying ?? name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    code: `${prefix}${String(nextIndex).padStart(2, '0')}`,
    name,
    category,
    status: 'MATERIAL',
    materialityStrength: 3,
    materialityDrivers: ['RISK'],
    underlyingAspects: underlying.length ? underlying : [name],
    rationale: 'Tillagt av användaren i materialitetsgranskningen.',
    startupSpecificReason: 'Movexum bedömer att området bör diskuteras med bolaget.',
    futureDevelopmentRelevance: 'Området kan påverka bolagets framtida utveckling och bör följas upp.',
    evidence: [{ documentName: null, note: 'Användartillägg.', excerpt: null }],
    confidence: 'LOW',
    uncertaintyNotes: ['Tillagt manuellt och bör verifieras i nästa analyssteg.']
  };
}

/** Personalens korrigering av bolagssummeringen läggs under texten (originalets beteende). */
export function applyImpactSummaryComment(materiality: ImpactMateriality, summaryComment: string): ImpactMateriality {
  const c = summaryComment.trim();
  if (!c) return materiality;
  return { ...materiality, companySummary: `${materiality.companySummary}\n\nAnvändarkorrigering av bolagssummering: ${c}` };
}

// ─── Statusmaskin ────────────────────────────────────────────────────────────

/** Bolagets sammanfattande status (`startups.sustainability_status`) ur analysens status. */
export function impactCompanyStatusFor(status: ImpactAssessmentStatus): ImpactCompanyStatus {
  switch (status) {
    case 'materiality_pending':
      return 'draft';
    case 'materiality_review':
      return 'materiality_review';
    case 'info_pending':
    case 'final_pending':
      return 'info_collection';
    case 'needs_more_info':
      return 'needs_more_info';
    case 'complete':
      return 'analyzed';
    case 'failed':
      return 'needs_more_info';
  }
}

/** Vilket steg som är nästa i en analys (det UI:t erbjuder knappen för). */
export type ImpactNextStep = 'run_materiality' | 'review_materiality' | 'run_sufficiency' | 'answer_gaps' | 'run_final' | 'done' | 'retry';

export function impactNextStep(status: ImpactAssessmentStatus, openRequiredGaps: number): ImpactNextStep {
  switch (status) {
    case 'materiality_pending':
      return 'run_materiality';
    case 'materiality_review':
      return 'review_materiality';
    case 'info_pending':
      return 'run_sufficiency';
    case 'needs_more_info':
      return openRequiredGaps > 0 ? 'answer_gaps' : 'run_final';
    case 'final_pending':
      return 'run_final';
    case 'complete':
      return 'done';
    case 'failed':
      return 'retry';
  }
}

/** Steget i fyrstegsguiden (1 = skapa bolag … 4 = dashboard) som en analys befinner sig på. */
export function impactStepFor(status: ImpactAssessmentStatus, hasDashboard: boolean): 1 | 2 | 3 | 4 {
  if (hasDashboard || status === 'complete') return 4;
  if (status === 'materiality_pending' || status === 'failed') return 2;
  if (status === 'materiality_review') return 2;
  return 3;
}

/** `?version=` på dashboarden: bara positiva heltal. */
export function parseImpactAssessmentVersion(value?: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const version = Number(value);
  return Number.isSafeInteger(version) ? version : null;
}

export function isImpactCompanyStatus(v: unknown): v is ImpactCompanyStatus {
  return typeof v === 'string' && (IMPACT_COMPANY_STATUSES as readonly string[]).includes(v);
}
export function isImpactAssessmentStatus(v: unknown): v is ImpactAssessmentStatus {
  return typeof v === 'string' && (IMPACT_ASSESSMENT_STATUSES as readonly string[]).includes(v);
}
export function isImpactUploadStage(v: unknown): v is ImpactUploadStage {
  return typeof v === 'string' && (IMPACT_UPLOAD_STAGES as readonly string[]).includes(v);
}
export function isImpactMaterialityStatus(v: unknown): v is ImpactMaterialityStatus {
  return typeof v === 'string' && (IMPACT_MATERIALITY_STATUSES as readonly string[]).includes(v);
}
export function isImpactLevel(v: unknown): v is ImpactLevel {
  return typeof v === 'string' && (IMPACT_LEVELS as readonly string[]).includes(v);
}
export function isImpactPhase(v: unknown): v is ImpactPhase {
  return typeof v === 'string' && (IMPACT_PHASES as readonly string[]).includes(v);
}

/** Svarsstatus ur personalens val + vad som faktiskt lämnades (originalets `getGapResponseStatus`). */
export function impactGapResponseStatus(requested: string, answer: string | null, hasReadableDocumentEvidence: boolean): ImpactGapStatus {
  const r = requested.trim().toLowerCase();
  if (r === 'not_available') return 'not_available';
  return answer || hasReadableDocumentEvidence ? 'answered' : 'open';
}
