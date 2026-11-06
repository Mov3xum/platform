/**
 * Export Lab (CLAUDE.md § 58) — det DYNAMISKA underlaget till varje AI-steg.
 * Återanvänder Impact Navigators dokumentevidens (dedupe + teckentak 60 000,
 * `impact-inputs.ts`) och följer samma state-plus-delta-princip: tillräcklighet
 * och uppdatering skickar bara det som är nytt. IRL-profilen och de
 * deterministiska grindarna följer med som `irl`. Ren modul utan IO;
 * enhetstestad. Allt som skickas hit ska redan vara personnummer-sanerat.
 */

import { buildImpactDocumentEvidence, normalizeImpactDocumentText, type ImpactDocumentTextSource, type ImpactTextEvidence } from './impact-inputs';
import {
  evaluateExportIrlGates,
  suggestExportReadinessFromIrl,
  type ExportGapStatus,
  type ExportIrlGateResult,
  type ExportPhase,
  type ExportPlan,
  type ExportProfile,
  type ExportReadinessLevel,
  type ExportSufficiency
} from './export-lab';
import type { IrlAxisNotes, IrlProfile } from './kth-irl';

export type ExportDocumentTextSource = ImpactDocumentTextSource;
export type ExportTextEvidence = ImpactTextEvidence;
export const EXPORT_DOCUMENT_TEXT_LIMIT = 60_000;

export interface ExportIrlContext {
  assessed: boolean;
  assessedAt: string | null;
  profile: IrlProfile;
  axisNotes: Partial<Record<string, string>>;
  gates: ExportIrlGateResult[];
  suggestedLevel: ExportReadinessLevel | null;
}

export interface ExportIrlSource {
  profile: IrlProfile;
  axisNotes?: IrlAxisNotes;
  assessedAt?: string;
}

export function buildExportIrlContext(irl: ExportIrlSource | null | undefined): ExportIrlContext {
  const profile = irl?.profile ?? {};
  const assessed = Object.keys(profile).length > 0;
  const notes: Partial<Record<string, string>> = {};
  for (const [k, v] of Object.entries(irl?.axisNotes ?? {})) if (typeof v === 'string' && v.trim()) notes[k] = v.trim().slice(0, 500);
  return {
    assessed,
    assessedAt: irl?.assessedAt ?? null,
    profile,
    axisNotes: notes,
    gates: evaluateExportIrlGates(profile),
    suggestedLevel: suggestExportReadinessFromIrl(profile)
  };
}

export interface ExportCompanyAnalysisContext {
  name: string;
  phase: ExportPhase;
  industry: string;
  /** Plattformens bolagsfält som är whitelistade för AI (§ 9.3) och relevanta för export. */
  city: string;
  website: string;
}

export interface ExportProfileAIInput {
  company: ExportCompanyAnalysisContext & { innovationAndAmbition: string; desiredMarkets: string[] };
  irl: ExportIrlContext;
  initialEvidence: ExportTextEvidence[];
}

export interface ExportSufficiencyAIInput {
  phase: ExportPhase;
  irl: ExportIrlContext;
  profile: ExportProfile;
  newEvidence: ExportTextEvidence[];
}

export interface ExportGapResponseInput {
  code: string;
  question: string;
  status: ExportGapStatus;
  answerText: string | null;
  documents: readonly ExportDocumentTextSource[];
}

export interface ExportPlanAIInput {
  company: ExportCompanyAnalysisContext;
  irl: ExportIrlContext;
  profile: ExportProfile;
  informationStatus: {
    readyForPlan: boolean;
    overallInformationQuality: number;
    generalComment: string;
    checks: Array<{ code: string; kind: 'MARKET' | 'DIMENSION'; informationStatus: string; whatWeKnow: string[]; missingInformation: string[]; confidence: string }>;
    generalMissingInformation: string[];
  };
  gapResponses: Array<{
    code: string;
    question: string;
    status: 'ANSWERED' | 'OPEN' | 'NOT_AVAILABLE';
    answer: string | null;
    hasReadableDocumentEvidence: boolean;
    evidence: ExportTextEvidence[];
  }>;
}

export interface ExportUpdateAIInput {
  company: Pick<ExportCompanyAnalysisContext, 'name' | 'phase' | 'industry'>;
  irl: ExportIrlContext;
  currentPlan: ExportPlan;
  marketContext: Array<{ code: string; country: string; priority: string; remainingUncertainties: string[] }>;
  newEvidence: { narrative: string | null; documents: ExportTextEvidence[] };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export function parseDesiredMarkets(text: string): string[] {
  return uniqueStrings(text.split(/[,;\n]/).map((s) => s.trim().slice(0, 80))).slice(0, 12);
}

export function buildExportProfileAIInput(input: {
  name: string;
  phase: ExportPhase;
  industry: string;
  city?: string;
  website?: string;
  ambitionText: string;
  desiredMarkets: string;
  irl: ExportIrlSource | null;
  documents: readonly ExportDocumentTextSource[];
}): ExportProfileAIInput {
  const innovationAndAmbition = normalizeImpactDocumentText(input.ambitionText);
  return {
    company: {
      name: input.name.trim(),
      phase: input.phase,
      industry: input.industry.trim(),
      city: (input.city ?? '').trim(),
      website: (input.website ?? '').trim(),
      innovationAndAmbition,
      desiredMarkets: parseDesiredMarkets(input.desiredMarkets)
    },
    irl: buildExportIrlContext(input.irl),
    initialEvidence: buildImpactDocumentEvidence(input.documents, { excludeTexts: [innovationAndAmbition] })
  };
}

export function buildExportSufficiencyAIInput(input: {
  phase: ExportPhase;
  irl: ExportIrlSource | null;
  profile: ExportProfile;
  newDocuments?: readonly ExportDocumentTextSource[];
  knownEvidenceTexts?: readonly string[];
}): ExportSufficiencyAIInput {
  return {
    phase: input.phase,
    irl: buildExportIrlContext(input.irl),
    profile: input.profile,
    newEvidence: buildImpactDocumentEvidence(input.newDocuments ?? [], { excludeTexts: input.knownEvidenceTexts })
  };
}

export function buildExportPlanAIInput(input: {
  company: ExportCompanyAnalysisContext;
  irl: ExportIrlSource | null;
  profile: ExportProfile;
  sufficiency: ExportSufficiency;
  gapResponses: readonly ExportGapResponseInput[];
  knownEvidenceTexts?: readonly string[];
}): ExportPlanAIInput {
  const seen = [...(input.knownEvidenceTexts ?? [])];
  let remaining = EXPORT_DOCUMENT_TEXT_LIMIT;
  const gapResponses = input.gapResponses.map((response) => {
    const answer = normalizeImpactDocumentText(response.answerText ?? '') || null;
    const hasReadableDocumentEvidence = response.documents.some((d) => Boolean(normalizeImpactDocumentText(d.extractedText ?? '')));
    const evidence = buildImpactDocumentEvidence(response.documents, { excludeTexts: [...seen, ...(answer ? [answer] : [])], maxCharacters: remaining });
    if (answer) seen.push(answer);
    for (const item of evidence) {
      seen.push(item.text);
      remaining -= item.sourceLabel.length + item.text.length;
    }
    const status: 'ANSWERED' | 'OPEN' | 'NOT_AVAILABLE' = response.status === 'not_available' ? 'NOT_AVAILABLE' : answer || hasReadableDocumentEvidence ? 'ANSWERED' : 'OPEN';
    return { code: response.code, question: response.question, status, answer, hasReadableDocumentEvidence, evidence };
  });
  return {
    company: { ...input.company, name: input.company.name.trim(), industry: input.company.industry.trim() },
    irl: buildExportIrlContext(input.irl),
    profile: input.profile,
    informationStatus: {
      readyForPlan: input.sufficiency.readyForPlan,
      overallInformationQuality: input.sufficiency.overallInformationQuality,
      generalComment: input.sufficiency.generalComment,
      checks: input.sufficiency.checks.map((c) => ({ code: c.code, kind: c.kind, informationStatus: c.informationStatus, whatWeKnow: c.whatWeKnow, missingInformation: c.missingInformation, confidence: c.confidence })),
      generalMissingInformation: input.sufficiency.generalMissingInformation
    },
    gapResponses
  };
}

export function buildExportUpdateAIInput(input: {
  companyName: string;
  phase: ExportPhase;
  industry: string;
  irl: ExportIrlSource | null;
  previousPlan: ExportPlan;
  profile: ExportProfile;
  sufficiency: ExportSufficiency | null;
  narrative: string;
  documents: readonly ExportDocumentTextSource[];
  knownEvidenceTexts?: readonly string[];
}): ExportUpdateAIInput {
  const narrative = normalizeImpactDocumentText(input.narrative) || null;
  const byCode = new Map((input.sufficiency?.checks ?? []).map((c) => [c.code, c] as const));
  return {
    company: { name: input.companyName.trim(), phase: input.phase, industry: input.industry.trim() },
    irl: buildExportIrlContext(input.irl),
    currentPlan: input.previousPlan,
    marketContext: input.profile.candidateMarkets.map((m) => {
      const info = byCode.get(m.code);
      return { code: m.code, country: m.country, priority: m.priority, remainingUncertainties: uniqueStrings([...m.uncertaintyNotes, ...(info?.missingInformation ?? [])]) };
    }),
    newEvidence: {
      narrative,
      documents: buildImpactDocumentEvidence(input.documents, { excludeTexts: [...(input.knownEvidenceTexts ?? []), ...(narrative ? [narrative] : [])] })
    }
  };
}
