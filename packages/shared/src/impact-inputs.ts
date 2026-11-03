/**
 * Impact Navigator (CLAUDE.md § 56) — det DYNAMISKA underlaget till varje
 * AI-steg, porterat från originalets `documents/chunking.ts` + `ai/inputs.ts`:
 * dokumentevidens med exakt deduplicering och teckentak (60 000), och
 * state-plus-delta-principen — tillräcklighet och uppdatering skickar inte om
 * originaldokumenten utan bara det som är nytt. Ren modul utan IO;
 * enhetstestad i impact-inputs.test.ts. Allt som skickas hit ska redan vara
 * personnummer-sanerat på skrivvägen.
 */

import {
  toAnalysisCategory,
  type ImpactAspect,
  type ImpactCategory,
  type ImpactConfidence,
  type ImpactDashboard,
  type ImpactGapStatus,
  type ImpactInformationStatus,
  type ImpactMateriality,
  type ImpactPhase,
  type ImpactSufficiency
} from './impact-navigator';

export const IMPACT_DOCUMENT_TEXT_LIMIT = 60_000;

export interface ImpactDocumentTextSource {
  originalName: string;
  extractedText: string | null;
}

export interface ImpactTextEvidence {
  sourceLabel: string;
  text: string;
}

export function normalizeImpactDocumentText(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

/**
 * Dokument → evidensblock: dubbletter (exakt samma text) hoppas över,
 * `excludeTexts` räknas som redan kända, och den samlade längden cappas —
 * ett dokument som inte ryms kapas, resten utelämnas.
 */
export function buildImpactDocumentEvidence(
  documents: readonly ImpactDocumentTextSource[],
  options: { excludeTexts?: readonly string[]; maxCharacters?: number } = {}
): ImpactTextEvidence[] {
  const maxCharacters = Math.max(0, options.maxCharacters ?? IMPACT_DOCUMENT_TEXT_LIMIT);
  const seen = new Set((options.excludeTexts ?? []).map(normalizeImpactDocumentText).filter(Boolean));
  const evidence: ImpactTextEvidence[] = [];
  let used = 0;
  for (const document of documents) {
    if (!document.extractedText) continue;
    const text = normalizeImpactDocumentText(document.extractedText);
    if (!text || seen.has(text)) continue;
    const sourceLabel = `Dokument: ${document.originalName.trim() || 'Namnlöst dokument'}`;
    const remaining = maxCharacters - used - sourceLabel.length;
    if (remaining <= 0) break;
    evidence.push({ sourceLabel, text: text.slice(0, remaining) });
    seen.add(text);
    used += sourceLabel.length + Math.min(text.length, remaining);
    if (text.length > remaining) break;
  }
  return evidence;
}

export interface ImpactCompanyAnalysisContext {
  name: string;
  phase: ImpactPhase;
  industry: string;
}

export interface ImpactMaterialityAIInput {
  company: ImpactCompanyAnalysisContext & { businessDescription: string };
  initialEvidence: ImpactTextEvidence[];
  referenceMaterialityAreas?: Array<{ code?: string; name: string; category?: string; description?: string }>;
}

interface MaterialityAnalysisContext {
  companySummary: string;
  sustainabilityPerspectiveSummary: string;
  selectedAspects: Array<Omit<ImpactAspect, 'category'> & { category: ImpactCategory }>;
  assumptions: string[];
}

export interface ImpactSufficiencyAIInput {
  phase: ImpactPhase;
  materiality: MaterialityAnalysisContext;
  newEvidence: ImpactTextEvidence[];
}

export interface ImpactGapResponseInput {
  areaCode: string;
  question: string;
  status: ImpactGapStatus;
  answerText: string | null;
  documents: readonly ImpactDocumentTextSource[];
}

export interface ImpactFinalAnalysisAIInput {
  company: ImpactCompanyAnalysisContext;
  materiality: MaterialityAnalysisContext;
  informationStatus: {
    readyForFinalAnalysis: boolean;
    overallInformationQuality: number;
    generalComment: string;
    aspectChecks: Array<{
      code: string;
      informationStatus: ImpactInformationStatus;
      whatWeKnow: string[];
      missingInformation: string[];
      confidence: ImpactConfidence;
    }>;
    generalMissingInformation: string[];
  };
  gapResponses: Array<{
    areaCode: string;
    question: string;
    status: 'ANSWERED' | 'OPEN' | 'NOT_AVAILABLE';
    answer: string | null;
    hasReadableDocumentEvidence: boolean;
    evidence: ImpactTextEvidence[];
  }>;
}

export interface ImpactUpdateAnalysisAIInput {
  company: Pick<ImpactCompanyAnalysisContext, 'name' | 'phase'>;
  currentAnalysis: Omit<ImpactDashboard, 'scores' | 'scoreRationale' | 'informationQualityScore' | 'informationQualityRationale' | 'discussionQuestions'> & {
    discussionQuestions: Array<{ question: string; whyImportant: string; suggestedOwnerRole: string | null; aspectCode: string | null }>;
  };
  areaContext: Array<{
    code: string;
    name: string;
    category: ImpactCategory;
    informationStatus: ImpactInformationStatus | 'UNKNOWN';
    remainingUncertainties: string[];
  }>;
  newEvidence: { narrative: string | null; documents: ImpactTextEvidence[] };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function materialityContext(materiality: ImpactMateriality): MaterialityAnalysisContext {
  const hasLegacy = materiality.selectedAspects.some((a) => a.category === 'CUSTOM');
  return {
    companySummary: materiality.companySummary,
    sustainabilityPerspectiveSummary: materiality.sustainabilityPerspectiveSummary,
    selectedAspects: materiality.selectedAspects.map((aspect) => ({
      ...aspect,
      category: toAnalysisCategory(aspect.category, aspect.code),
      uncertaintyNotes: uniqueStrings([
        ...aspect.uncertaintyNotes,
        ...(aspect.category === 'CUSTOM' ? ['Områdets äldre CUSTOM-kategori har normaliserats till den nuvarande ENV-, SOC- eller GOV-modellen.'] : [])
      ])
    })),
    assumptions: uniqueStrings([...materiality.assumptions, ...(hasLegacy ? ['Minst ett äldre område har fått en modern huvudkategori inför analyssteget.'] : [])])
  };
}

export function buildImpactMaterialityAIInput(input: {
  name: string;
  phase: ImpactPhase;
  industry: string;
  journeyText: string;
  documents: readonly ImpactDocumentTextSource[];
  referenceMaterialityAreas?: ImpactMaterialityAIInput['referenceMaterialityAreas'];
}): ImpactMaterialityAIInput {
  const businessDescription = normalizeImpactDocumentText(input.journeyText);
  return {
    company: { name: input.name.trim(), phase: input.phase, industry: input.industry.trim(), businessDescription },
    initialEvidence: buildImpactDocumentEvidence(input.documents, { excludeTexts: [businessDescription] }),
    ...(input.referenceMaterialityAreas?.length
      ? {
          referenceMaterialityAreas: input.referenceMaterialityAreas.map((area) => ({
            ...(area.code ? { code: area.code } : {}),
            name: area.name,
            ...(area.category ? { category: area.category } : {}),
            ...(area.description ? { description: area.description } : {})
          }))
        }
      : {})
  };
}

export function buildImpactSufficiencyAIInput(input: {
  phase: ImpactPhase;
  materiality: ImpactMateriality;
  newDocuments?: readonly ImpactDocumentTextSource[];
  knownEvidenceTexts?: readonly string[];
}): ImpactSufficiencyAIInput {
  return {
    phase: input.phase,
    materiality: materialityContext(input.materiality),
    newEvidence: buildImpactDocumentEvidence(input.newDocuments ?? [], { excludeTexts: input.knownEvidenceTexts })
  };
}

export function buildImpactFinalAnalysisAIInput(input: {
  companyName: string;
  phase: ImpactPhase;
  industry: string;
  materiality: ImpactMateriality;
  sufficiency: ImpactSufficiency;
  gapResponses: readonly ImpactGapResponseInput[];
  knownEvidenceTexts?: readonly string[];
}): ImpactFinalAnalysisAIInput {
  const seen = [...(input.knownEvidenceTexts ?? [])];
  let remaining = IMPACT_DOCUMENT_TEXT_LIMIT;
  const gapResponses = input.gapResponses.map((response) => {
    const answer = normalizeImpactDocumentText(response.answerText ?? '') || null;
    const hasReadableDocumentEvidence = response.documents.some((d) => Boolean(normalizeImpactDocumentText(d.extractedText ?? '')));
    const evidence = buildImpactDocumentEvidence(response.documents, {
      excludeTexts: [...seen, ...(answer ? [answer] : [])],
      maxCharacters: remaining
    });
    if (answer) seen.push(answer);
    for (const item of evidence) {
      seen.push(item.text);
      remaining -= item.sourceLabel.length + item.text.length;
    }
    // Statusen följer det som faktiskt lämnades (originalets getGapResponseStatus).
    const status: 'ANSWERED' | 'OPEN' | 'NOT_AVAILABLE' =
      response.status === 'not_available' ? 'NOT_AVAILABLE' : answer || hasReadableDocumentEvidence ? 'ANSWERED' : 'OPEN';
    return { areaCode: response.areaCode, question: response.question, status, answer, hasReadableDocumentEvidence, evidence };
  });

  return {
    company: { name: input.companyName.trim(), phase: input.phase, industry: input.industry.trim() },
    materiality: materialityContext(input.materiality),
    informationStatus: {
      readyForFinalAnalysis: input.sufficiency.readyForFinalAnalysis,
      overallInformationQuality: input.sufficiency.overallInformationQuality,
      generalComment: input.sufficiency.generalComment,
      aspectChecks: input.sufficiency.aspectChecks.map((check) => ({
        code: check.code,
        informationStatus: check.informationStatus,
        whatWeKnow: check.whatWeKnow,
        missingInformation: check.missingInformation,
        confidence: check.confidence
      })),
      generalMissingInformation: input.sufficiency.generalMissingInformation
    },
    gapResponses
  };
}

export function buildImpactUpdateAnalysisAIInput(input: {
  companyName: string;
  phase: ImpactPhase;
  previousDashboard: ImpactDashboard;
  materiality: ImpactMateriality;
  sufficiency: ImpactSufficiency | null;
  narrative: string;
  documents: readonly ImpactDocumentTextSource[];
  knownEvidenceTexts?: readonly string[];
}): ImpactUpdateAnalysisAIInput {
  const narrative = normalizeImpactDocumentText(input.narrative) || null;
  const sufficiencyByCode = new Map((input.sufficiency?.aspectChecks ?? []).map((c) => [c.code, c] as const));
  const categoryOf = (category: string, code: string): ImpactCategory => {
    if (category === 'ENVIRONMENT' || category === 'SOCIAL' || category === 'GOVERNANCE') return category;
    const fromMateriality = input.materiality.selectedAspects.find((a) => a.code === code)?.category;
    if (fromMateriality && fromMateriality !== 'CUSTOM') return fromMateriality;
    return toAnalysisCategory('CUSTOM', code);
  };
  const hadLegacy = [...input.previousDashboard.risks, ...input.previousDashboard.opportunities, ...input.materiality.selectedAspects].some(
    (item) => item.category === 'CUSTOM'
  );
  const prev = input.previousDashboard;
  return {
    company: { name: input.companyName.trim(), phase: input.phase },
    currentAnalysis: {
      executiveSummary: prev.executiveSummary,
      companySustainabilityDescription: prev.companySustainabilityDescription,
      businessModelCompatibility: prev.businessModelCompatibility,
      impactLevel: prev.impactLevel,
      areaAssessments: prev.areaAssessments,
      informationQualityComment: prev.informationQualityComment,
      whatCompanyNeedsToWorkOn: prev.whatCompanyNeedsToWorkOn,
      risks: prev.risks.map((r) => ({ ...r, category: categoryOf(r.category, r.aspectCode) })),
      opportunities: prev.opportunities.map((o) => ({ ...o, category: categoryOf(o.category, o.aspectCode) })),
      discussionQuestions: prev.discussionQuestions.map((q) => ({
        question: q.question,
        whyImportant: q.whyImportant,
        suggestedOwnerRole: q.suggestedOwnerRole ?? null,
        aspectCode: q.aspectCode ?? null
      })),
      greenwashingRisks: prev.greenwashingRisks,
      assumptions: prev.assumptions,
      limitations: uniqueStrings([
        ...prev.limitations,
        ...(hadLegacy ? ['En äldre kategorietikett har normaliserats till ENVIRONMENT, SOCIAL eller GOVERNANCE inför uppdateringen.'] : [])
      ]),
      disclaimer: prev.disclaimer
    },
    areaContext: input.materiality.selectedAspects.map((aspect) => {
      const info = sufficiencyByCode.get(aspect.code);
      return {
        code: aspect.code,
        name: aspect.name,
        category: toAnalysisCategory(aspect.category, aspect.code),
        informationStatus: info?.informationStatus ?? 'UNKNOWN',
        remainingUncertainties: uniqueStrings([...aspect.uncertaintyNotes, ...(info?.missingInformation ?? [])])
      };
    }),
    newEvidence: {
      narrative,
      documents: buildImpactDocumentEvidence(input.documents, { excludeTexts: [...(input.knownEvidenceTexts ?? []), ...(narrative ? [narrative] : [])] })
    }
  };
}
