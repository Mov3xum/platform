/**
 * Impact Navigator (CLAUDE.md § 56) — REN domänlogik för den AI-stödda
 * hållbarhetsanalysen per bolag: vokabulär (MÅSTE spegla migration
 * 1700000206), svenska etiketter, statusmaskin, och TOLERANT normalisering av
 * modellens JSON-svar till typade resultat. Ingen IO. Enhetstestad i
 * impact-navigator.test.ts.
 *
 * Analysen är beslutsstöd om BOLAG (inte individer); människan granskar
 * väsentligheten och slutanalysen i gränssnittet (EU AI Act art. 14).
 */

import type { Role } from './index';

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

export const IMPACT_CATEGORIES = ['ENVIRONMENT', 'SOCIAL', 'GOVERNANCE'] as const;
export type ImpactCategory = (typeof IMPACT_CATEGORIES)[number];
export const IMPACT_LEVELS = ['IMPACT_DRIVEN', 'SUSTAINABILITY_DRIVEN', 'RISK_EXPOSED'] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];
export const IMPACT_MATERIALITY_STATUSES = ['MATERIAL', 'NOT_MATERIAL', 'UNCERTAIN'] as const;
export type ImpactMaterialityStatus = (typeof IMPACT_MATERIALITY_STATUSES)[number];
export const IMPACT_GRADES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type ImpactGrade = (typeof IMPACT_GRADES)[number];
export const IMPACT_HORIZONS = ['SHORT', 'MEDIUM', 'LONG'] as const;
export type ImpactHorizon = (typeof IMPACT_HORIZONS)[number];
export const IMPACT_BMC_STATUSES = ['COMPATIBLE_WITH_LONG_TERM_SUSTAINABILITY', 'UNCERTAIN', 'INCOMPATIBLE'] as const;
export type ImpactBmcStatus = (typeof IMPACT_BMC_STATUSES)[number];

export const IMPACT_FRAMEWORK_VERSION = 'movexum-v0.1';
export const IMPACT_PROMPT_VERSION = '2026-10-29-mistral-v1';

/** Movexum-personal som får driva en analys; observer läser. */
export const IMPACT_MANAGE_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];
export const IMPACT_READ_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor', 'observer'];

export function canManageImpact(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((r) => IMPACT_MANAGE_ROLES.includes(r));
}
export function canReadImpact(roles: readonly Role[] | undefined): boolean {
  return (roles ?? []).some((r) => IMPACT_READ_ROLES.includes(r));
}

// ─── Etiketter ───────────────────────────────────────────────────────────────

export const IMPACT_COMPANY_STATUS_LABELS: Record<ImpactCompanyStatus, string> = {
  draft: 'Utkast',
  materiality_review: 'Väsentlighet att granska',
  info_collection: 'Samlar underlag',
  needs_more_info: 'Behöver mer underlag',
  analyzed: 'Analyserad'
};
export const IMPACT_ASSESSMENT_STATUS_LABELS: Record<ImpactAssessmentStatus, string> = {
  materiality_pending: 'Väsentlighetsanalys väntar',
  materiality_review: 'Väsentlighet att granska',
  info_pending: 'Underlag prövas',
  needs_more_info: 'Behöver mer underlag',
  final_pending: 'Slutanalys väntar',
  complete: 'Klar',
  failed: 'Misslyckades'
};
export const IMPACT_LEVEL_LABELS: Record<ImpactLevel, string> = {
  IMPACT_DRIVEN: 'Impactdrivande',
  SUSTAINABILITY_DRIVEN: 'Hållbarhetsdrivande',
  RISK_EXPOSED: 'Riskexponerad'
};
export const IMPACT_CATEGORY_LABELS: Record<ImpactCategory, string> = {
  ENVIRONMENT: 'Miljö',
  SOCIAL: 'Socialt',
  GOVERNANCE: 'Styrning'
};
export const IMPACT_GRADE_LABELS: Record<ImpactGrade, string> = { HIGH: 'Hög', MEDIUM: 'Medel', LOW: 'Låg' };
export const IMPACT_HORIZON_LABELS: Record<ImpactHorizon, string> = { SHORT: 'Kort sikt', MEDIUM: 'Medellång sikt', LONG: 'Lång sikt' };
export const IMPACT_MATERIALITY_LABELS: Record<ImpactMaterialityStatus, string> = {
  MATERIAL: 'Väsentlig',
  NOT_MATERIAL: 'Ej väsentlig',
  UNCERTAIN: 'Osäker'
};
export const IMPACT_BMC_LABELS: Record<ImpactBmcStatus, string> = {
  COMPATIBLE_WITH_LONG_TERM_SUSTAINABILITY: 'Förenlig med långsiktig hållbarhet',
  UNCERTAIN: 'Osäker',
  INCOMPATIBLE: 'Oförenlig'
};
export const IMPACT_UPLOAD_STAGE_LABELS: Record<ImpactUploadStage, string> = {
  idea_description: 'Idébeskrivning',
  full_information: 'Fullständigt underlag',
  gap_response: 'Svar på komplettering',
  update: 'Uppdatering'
};
export const IMPACT_GAP_SEVERITY_LABELS: Record<ImpactGapSeverity, string> = { required: 'Krävs', recommended: 'Rekommenderas' };
export const IMPACT_GAP_STATUS_LABELS: Record<ImpactGapStatus, string> = {
  open: 'Obesvarad',
  answered: 'Besvarad',
  not_available: 'Finns inte'
};
export const IMPACT_JOB_TYPE_LABELS: Record<ImpactJobType, string> = {
  materiality: 'Väsentlighetsanalys',
  sufficiency: 'Tillräcklighetsprövning',
  final_analysis: 'Slutanalys',
  update_analysis: 'Uppdateringsanalys'
};

// ─── Typade resultat ─────────────────────────────────────────────────────────

export interface ImpactEvidence {
  note: string;
  excerpt: string;
  documentName: string;
}

export interface ImpactAspect {
  code: string;
  name: string;
  category: ImpactCategory;
  status: ImpactMaterialityStatus;
  rationale: string;
  startupSpecificReason: string;
  materialityStrength: ImpactGrade | null;
  confidence: number | null;
  futureDevelopmentRelevance: string;
  materialityDrivers: string[];
  underlyingAspects: string[];
  uncertaintyNotes: string[];
  evidence: ImpactEvidence[];
}

export interface ImpactNonMaterialAspect {
  code: string;
  name: string;
  category: ImpactCategory;
  rationale: string;
}

export interface ImpactMateriality {
  companySummary: string;
  sustainabilityPerspectiveSummary: string;
  materialityApproach: string;
  selectedAspects: ImpactAspect[];
  consideredButNotMaterial: ImpactNonMaterialAspect[];
  assumptions: string[];
  warnings: string[];
}

export interface ImpactAspectQuestion {
  question: string;
  severity: ImpactGapSeverity;
  missingInformation: string;
  exampleHelpfulEvidence: string;
  whyThisMatters: string;
}

export interface ImpactAspectCheck {
  code: string;
  name: string;
  category: ImpactCategory;
  informationStatus: string;
  confidence: number | null;
  whatWeKnow: string;
  missingInformation: string;
  rationale: string;
  question: ImpactAspectQuestion | null;
}

export interface ImpactSufficiency {
  readyForFinalAnalysis: boolean;
  overallInformationQuality: number;
  userMessage: string;
  generalComment: string;
  generalMissingInformation: string[];
  aspectChecks: ImpactAspectCheck[];
}

export interface ImpactRisk {
  title: string;
  category: ImpactCategory;
  aspectCode: string;
  severity: ImpactGrade;
  timeHorizon: ImpactHorizon;
  description: string;
  whyImportant: string;
  howItCanAffectFutureDevelopment: string;
  mitigationSuggestion: string;
  evidence: string[];
}

export interface ImpactOpportunity {
  title: string;
  category: ImpactCategory;
  aspectCode: string;
  potential: ImpactGrade;
  description: string;
  whyImportant: string;
  howCompanyCanUseIt: string;
  recommendedAction: string;
  evidence: string[];
}

export interface ImpactAreaAssessment {
  assessment: string;
  potentialLabel: string;
  uncertaintyNotes: string[];
}

export interface ImpactWorkItem {
  title: string;
  priority: ImpactGrade;
  description: string;
  realisticStartupNextStep: string;
}

export interface ImpactDashboard {
  executiveSummary: string;
  companySustainabilityDescription: string;
  impactLevel: { level: ImpactLevel; labelSv: string; rationale: string };
  businessModelCompatibility: { status: ImpactBmcStatus; rationale: string; consequencesIfScaled: string };
  areaAssessments: Record<'environment' | 'social' | 'governance' | 'overall', ImpactAreaAssessment>;
  risks: ImpactRisk[];
  opportunities: ImpactOpportunity[];
  greenwashingRisks: Array<{ claimOrRisk: string; whyRisky: string; howToSubstantiate: string }>;
  whatCompanyNeedsToWorkOn: ImpactWorkItem[];
  discussionQuestions: Array<{ question: string; aspectCode: string; whyImportant: string; suggestedOwnerRole: string }>;
  informationQualityScore: number;
  informationQualityComment: string;
  assumptions: string[];
  limitations: string[];
  disclaimer: string;
}

export interface ImpactUpdateDelta {
  whatChangedSinceLastAssessment: string[];
  newRisks: string[];
  reducedRisks: string[];
  newOpportunities: string[];
  changedAreaAssessments: string[];
  recommendedNextDiscussions: string[];
}

// ─── Normalisering (modellens svar är UNTRUSTED data) ───────────────────────

export const IMPACT_TEXT_MAX = 4000;
const LIST_MAX = 25;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown, max = IMPACT_TEXT_MAX): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}
function strList(v: unknown, max = LIST_MAX): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? str(x) : typeof x === 'object' && x ? str(rec(x).text ?? rec(x).title ?? rec(x).note) : '')).filter(Boolean).slice(0, max);
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  const s = typeof v === 'string' ? v.trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}
function oneOfOrNull<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase().replace(/[\s-]+/g, '_') : '';
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}
function num01(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return n > 1 ? Math.min(1, n / 100) : Math.max(0, n);
}
function score100(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function categoryFromCode(code: string): ImpactCategory | null {
  if (/-ENV-/i.test(code)) return 'ENVIRONMENT';
  if (/-SOC-/i.test(code)) return 'SOCIAL';
  if (/-GOV-/i.test(code)) return 'GOVERNANCE';
  return null;
}
function aspectCode(v: unknown, category: ImpactCategory, index: number): string {
  const s = str(v, 40).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (/^[A-Z]{2,4}-[A-Z]{3}-\d{2}$/.test(s)) return s;
  return `OWN-${category.slice(0, 3)}-${String(index + 1).padStart(2, '0')}`;
}
function evidence(v: unknown): ImpactEvidence[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 12)
    .map((e) => {
      if (typeof e === 'string') return { note: str(e), excerpt: '', documentName: '' };
      const r = rec(e);
      return { note: str(r.note), excerpt: str(r.excerpt), documentName: str(r.documentName ?? r.document, 300) };
    })
    .filter((e) => e.note || e.excerpt);
}

export function normalizeImpactMateriality(raw: unknown): ImpactMateriality {
  const r = rec(raw);
  const selected = Array.isArray(r.selectedAspects) ? r.selectedAspects : [];
  const selectedAspects: ImpactAspect[] = selected.slice(0, 12).map((a, i) => {
    const ar = rec(a);
    const codeGuess = str(ar.code, 40);
    const category = oneOfOrNull(ar.category, IMPACT_CATEGORIES) ?? categoryFromCode(codeGuess) ?? 'GOVERNANCE';
    return {
      code: aspectCode(ar.code, category, i),
      name: str(ar.name, 200) || 'Namnlös aspekt',
      category,
      status: oneOf(ar.status, IMPACT_MATERIALITY_STATUSES, 'MATERIAL'),
      rationale: str(ar.rationale),
      startupSpecificReason: str(ar.startupSpecificReason),
      materialityStrength: oneOfOrNull(ar.materialityStrength, IMPACT_GRADES),
      confidence: num01(ar.confidence),
      futureDevelopmentRelevance: str(ar.futureDevelopmentRelevance),
      materialityDrivers: strList(ar.materialityDrivers),
      underlyingAspects: strList(ar.underlyingAspects),
      uncertaintyNotes: strList(ar.uncertaintyNotes),
      evidence: evidence(ar.evidence)
    };
  });
  const nonMaterial = Array.isArray(r.consideredButNotMaterial) ? r.consideredButNotMaterial : [];
  return {
    companySummary: str(r.companySummary),
    sustainabilityPerspectiveSummary: str(r.sustainabilityPerspectiveSummary),
    materialityApproach: str(r.materialityApproach),
    selectedAspects,
    consideredButNotMaterial: nonMaterial.slice(0, 12).map((a, i) => {
      const ar = rec(a);
      const category = oneOfOrNull(ar.category, IMPACT_CATEGORIES) ?? categoryFromCode(str(ar.code, 40)) ?? 'GOVERNANCE';
      return { code: aspectCode(ar.code, category, 50 + i), name: str(ar.name, 200) || 'Namnlös aspekt', category, rationale: str(ar.rationale) };
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
    userMessage: str(r.userMessage),
    generalComment: str(r.generalComment),
    generalMissingInformation: strList(r.generalMissingInformation),
    aspectChecks: checks.slice(0, 12).map((c, i) => {
      const cr = rec(c);
      const category = oneOfOrNull(cr.category, IMPACT_CATEGORIES) ?? categoryFromCode(str(cr.code, 40)) ?? 'GOVERNANCE';
      const q = rec(cr.question);
      const questionText = str(q.question ?? (typeof cr.question === 'string' ? cr.question : ''));
      return {
        code: aspectCode(cr.code, category, i),
        name: str(cr.name, 200),
        category,
        informationStatus: str(cr.informationStatus, 60),
        confidence: num01(cr.confidence),
        whatWeKnow: str(cr.whatWeKnow),
        missingInformation: str(cr.missingInformation),
        rationale: str(cr.rationale),
        question: questionText
          ? {
              question: questionText,
              severity: oneOf(q.severity, ['REQUIRED', 'RECOMMENDED'] as const, 'RECOMMENDED').toLowerCase() as ImpactGapSeverity,
              missingInformation: str(q.missingInformation),
              exampleHelpfulEvidence: str(q.exampleHelpfulEvidence),
              whyThisMatters: str(q.whyThisMatters)
            }
          : null
      };
    })
  };
}

function area(v: unknown): ImpactAreaAssessment {
  const r = rec(v);
  return { assessment: str(r.assessment), potentialLabel: str(r.potentialLabel, 200), uncertaintyNotes: strList(r.uncertaintyNotes) };
}

export function normalizeImpactDashboard(raw: unknown): ImpactDashboard {
  const r = rec(raw);
  const il = rec(r.impactLevel);
  const level = oneOf(il.level ?? r.impactLevel, IMPACT_LEVELS, 'RISK_EXPOSED');
  const bmc = rec(r.businessModelCompatibility);
  const areas = rec(r.areaAssessments);
  const mapRisk = (x: unknown): ImpactRisk => {
    const xr = rec(x);
    const category = oneOfOrNull(xr.category, IMPACT_CATEGORIES) ?? categoryFromCode(str(xr.aspectCode, 40)) ?? 'GOVERNANCE';
    return {
      title: str(xr.title, 200),
      category,
      aspectCode: str(xr.aspectCode, 40),
      severity: oneOf(xr.severity, IMPACT_GRADES, 'MEDIUM'),
      timeHorizon: oneOf(xr.timeHorizon, IMPACT_HORIZONS, 'MEDIUM'),
      description: str(xr.description),
      whyImportant: str(xr.whyImportant),
      howItCanAffectFutureDevelopment: str(xr.howItCanAffectFutureDevelopment),
      mitigationSuggestion: str(xr.mitigationSuggestion),
      evidence: strList(xr.evidence, 10)
    };
  };
  const mapOpp = (x: unknown): ImpactOpportunity => {
    const xr = rec(x);
    const category = oneOfOrNull(xr.category, IMPACT_CATEGORIES) ?? categoryFromCode(str(xr.aspectCode, 40)) ?? 'GOVERNANCE';
    return {
      title: str(xr.title, 200),
      category,
      aspectCode: str(xr.aspectCode, 40),
      potential: oneOf(xr.potential, IMPACT_GRADES, 'MEDIUM'),
      description: str(xr.description),
      whyImportant: str(xr.whyImportant),
      howCompanyCanUseIt: str(xr.howCompanyCanUseIt),
      recommendedAction: str(xr.recommendedAction),
      evidence: strList(xr.evidence, 10)
    };
  };
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, LIST_MAX) : []);
  return {
    executiveSummary: str(r.executiveSummary),
    companySustainabilityDescription: str(r.companySustainabilityDescription),
    impactLevel: { level, labelSv: IMPACT_LEVEL_LABELS[level], rationale: str(il.rationale) },
    businessModelCompatibility: {
      status: oneOf(bmc.status, IMPACT_BMC_STATUSES, 'UNCERTAIN'),
      rationale: str(bmc.rationale),
      consequencesIfScaled: str(bmc.consequencesIfScaled)
    },
    areaAssessments: {
      environment: area(areas.environment),
      social: area(areas.social),
      governance: area(areas.governance),
      overall: area(areas.overall)
    },
    risks: list(r.risks).map(mapRisk).filter((x) => x.title),
    opportunities: list(r.opportunities).map(mapOpp).filter((x) => x.title),
    greenwashingRisks: list(r.greenwashingRisks)
      .map((g) => {
        const gr = rec(g);
        return { claimOrRisk: str(gr.claimOrRisk), whyRisky: str(gr.whyRisky), howToSubstantiate: str(gr.howToSubstantiate) };
      })
      .filter((g) => g.claimOrRisk),
    whatCompanyNeedsToWorkOn: list(r.whatCompanyNeedsToWorkOn)
      .map((w) => {
        const wr = rec(w);
        return {
          title: str(wr.title, 200),
          priority: oneOf(wr.priority, IMPACT_GRADES, 'MEDIUM'),
          description: str(wr.description),
          realisticStartupNextStep: str(wr.realisticStartupNextStep)
        };
      })
      .filter((w) => w.title),
    discussionQuestions: list(r.discussionQuestions)
      .map((q) => {
        const qr = rec(q);
        return {
          question: str(qr.question),
          aspectCode: str(qr.aspectCode, 40),
          whyImportant: str(qr.whyImportant),
          suggestedOwnerRole: str(qr.suggestedOwnerRole, 100)
        };
      })
      .filter((q) => q.question),
    informationQualityScore: score100(r.informationQualityScore),
    informationQualityComment: str(r.informationQualityComment),
    assumptions: strList(r.assumptions),
    limitations: strList(r.limitations),
    disclaimer: str(r.disclaimer) || IMPACT_DISCLAIMER
  };
}

export function normalizeImpactUpdateDelta(raw: unknown): ImpactUpdateDelta {
  const r = rec(raw);
  return {
    whatChangedSinceLastAssessment: strList(r.whatChangedSinceLastAssessment),
    newRisks: strList(r.newRisks),
    reducedRisks: strList(r.reducedRisks),
    newOpportunities: strList(r.newOpportunities),
    changedAreaAssessments: strList(r.changedAreaAssessments),
    recommendedNextDiscussions: strList(r.recommendedNextDiscussions)
  };
}

export const IMPACT_DISCLAIMER =
  'Bedömningen är ett coachande beslutsstöd baserat enbart på tillhandahållet material. Den är inte en juridisk bedömning, teknisk säkerhetsgranskning, ESG-revision eller formell hållbarhetsrapportering. Genererat av AI — verifiera innan delning.';

// ─── Väsentlighetsjusteringar (människans beslut) ───────────────────────────

export interface ImpactOverrideInput {
  aspectCode: string;
  newStatus: ImpactMaterialityStatus;
  comment?: string;
}

/**
 * Tillämpar personalens justeringar på modellens väsentlighet: en aspekt som
 * sätts NOT_MATERIAL flyttas till "övervägda men ej väsentliga", en som
 * sätts MATERIAL flyttas (tillbaka) till de valda. Returnerar även vilka
 * justeringar som faktiskt ändrade något (för audit).
 */
export function applyImpactOverrides(
  materiality: ImpactMateriality,
  overrides: readonly ImpactOverrideInput[]
): { materiality: ImpactMateriality; applied: Array<{ aspectCode: string; originalStatus: ImpactMaterialityStatus; newStatus: ImpactMaterialityStatus }> } {
  const selected = [...materiality.selectedAspects];
  const nonMaterial = [...materiality.consideredButNotMaterial];
  const applied: Array<{ aspectCode: string; originalStatus: ImpactMaterialityStatus; newStatus: ImpactMaterialityStatus }> = [];
  for (const o of overrides) {
    const code = o.aspectCode.trim().toUpperCase();
    const si = selected.findIndex((a) => a.code === code);
    if (si !== -1) {
      const a = selected[si];
      if (a.status === o.newStatus) continue;
      applied.push({ aspectCode: code, originalStatus: a.status, newStatus: o.newStatus });
      if (o.newStatus === 'NOT_MATERIAL') {
        selected.splice(si, 1);
        nonMaterial.push({ code: a.code, name: a.name, category: a.category, rationale: o.comment?.trim() || a.rationale });
      } else {
        selected[si] = { ...a, status: o.newStatus };
      }
      continue;
    }
    const ni = nonMaterial.findIndex((a) => a.code === code);
    if (ni !== -1 && o.newStatus !== 'NOT_MATERIAL') {
      const a = nonMaterial[ni];
      applied.push({ aspectCode: code, originalStatus: 'NOT_MATERIAL', newStatus: o.newStatus });
      nonMaterial.splice(ni, 1);
      selected.push({
        code: a.code,
        name: a.name,
        category: a.category,
        status: o.newStatus,
        rationale: o.comment?.trim() || a.rationale,
        startupSpecificReason: '',
        materialityStrength: null,
        confidence: null,
        futureDevelopmentRelevance: '',
        materialityDrivers: [],
        underlyingAspects: [],
        uncertaintyNotes: [],
        evidence: []
      });
    }
  }
  return { materiality: { ...materiality, selectedAspects: selected, consideredButNotMaterial: nonMaterial }, applied };
}

// ─── Statusmaskin ────────────────────────────────────────────────────────────

/** Bolagets sammanfattande status (`startups.sustainability_status`) ur senaste analysens status. */
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
      return openRequiredGaps > 0 ? 'answer_gaps' : 'run_sufficiency';
    case 'final_pending':
      return 'run_final';
    case 'complete':
      return 'done';
    case 'failed':
      return 'retry';
  }
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

// ─── Underlag till modellen (dataminimering) ────────────────────────────────

export interface ImpactSourceDocument {
  name: string;
  stage: ImpactUploadStage;
  text: string;
}

export const IMPACT_INPUT_MAX_CHARS = 90_000;
const IMPACT_DOC_MAX_CHARS = 40_000;

/**
 * Sätter ihop bolagets resa + dokumenttext + (ev.) svar på kompletteringar
 * till ETT datablock, cappat totalt. Dokument tas i given ordning; ett
 * dokument som inte ryms kapas och märks. Bara det som redan är
 * personnummer-sanerat på skrivvägen ska skickas hit.
 */
export function buildImpactInput(parts: {
  companyName: string;
  phase: string;
  industry: string;
  journeyText: string;
  documents: readonly ImpactSourceDocument[];
  gapAnswers?: readonly { question: string; answer: string }[];
  updateNarrative?: string;
}): { text: string; truncated: boolean; documentNames: string[] } {
  const out: string[] = [];
  out.push(`Bolag: ${parts.companyName}`, `Fas i inkubatorn: ${parts.phase}`, `Bransch: ${parts.industry}`, '', 'Bolagets resa (personalens beskrivning):', parts.journeyText || '(saknas)');
  if (parts.updateNarrative) out.push('', 'Vad som hänt sedan senaste analysen (bolagets uppdatering):', parts.updateNarrative);
  if (parts.gapAnswers && parts.gapAnswers.length) {
    out.push('', 'Svar på tidigare kompletteringsfrågor:');
    for (const g of parts.gapAnswers) out.push(`- Fråga: ${g.question}`, `  Svar: ${g.answer}`);
  }
  let truncated = false;
  const names: string[] = [];
  let used = out.join('\n').length;
  for (const d of parts.documents) {
    const header = `\n=== Dokument: ${d.name} (${IMPACT_UPLOAD_STAGE_LABELS[d.stage]}) ===\n`;
    const room = IMPACT_INPUT_MAX_CHARS - used - header.length;
    if (room <= 200) {
      truncated = true;
      break;
    }
    let body = d.text.slice(0, IMPACT_DOC_MAX_CHARS);
    if (body.length > room) {
      body = body.slice(0, room) + '\n[… dokumentet kapat]';
      truncated = true;
    } else if (d.text.length > IMPACT_DOC_MAX_CHARS) {
      body += '\n[… dokumentet kapat]';
      truncated = true;
    }
    out.push(header + body);
    used += header.length + body.length;
    names.push(d.name);
  }
  return { text: out.join('\n'), truncated, documentNames: names };
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
