import 'server-only';
import type { SubmissionEntry } from './chat';
import { buildQuizResultPdf } from './result-pdf';

/* Chattsammanfattningen till besökaren (§ 23.10): lagringsform på
   konversationen (`extracted_data`), läsning av den, och PDF-renderingen —
   delad av /complete (mejlbilaga) och /summary-pdf (nedladdning). */

export interface SummaryAnswer {
  question: string;
  answer: string;
}

export interface StoredVisitorSummary {
  summary: string;
  answers: SummaryAnswer[];
}

export function summaryAnswersFromEntries(entries: SubmissionEntry[]): SummaryAnswer[] {
  return entries
    .filter((e) => e.question && e.answer)
    .slice(0, 40)
    .map((e) => ({ question: e.question.slice(0, 300), answer: e.answer.slice(0, 2000) }));
}

/** Läser det /complete sparade — tolerant mot äldre/okänd form. */
export function readStoredSummary(data: unknown): StoredVisitorSummary | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const summary = typeof obj.visitor_summary === 'string' ? obj.visitor_summary.trim() : '';
  if (!summary) return null;
  const raw = Array.isArray(obj.closing_answers) ? obj.closing_answers : [];
  const answers: SummaryAnswer[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.question === 'string' && typeof r.answer === 'string' && r.question && r.answer) {
      answers.push({ question: r.question.slice(0, 300), answer: r.answer.slice(0, 2000) });
    }
  }
  return { summary: summary.slice(0, 6000), answers };
}

export async function buildChatSummaryPdf(input: {
  moduleName: string;
  summary: string;
  answers: SummaryAnswer[];
  accent?: string;
}): Promise<Buffer> {
  return buildQuizResultPdf({
    title: 'Sammanfattning av ditt samtal',
    body: input.summary,
    moduleName: input.moduleName,
    accent: input.accent,
    eyebrow: 'Movexum · Startupkompassen',
    sections:
      input.answers.length > 0
        ? [{ heading: 'Dina uppgifter', items: input.answers.map((a) => `${a.question}: ${a.answer}`) }]
        : [],
    disclaimer:
      'Sammanfattningen är genererad av AI utifrån det du själv berättade – verifiera innan du delar den. Dina uppgifter hanteras inom EU.'
  });
}
