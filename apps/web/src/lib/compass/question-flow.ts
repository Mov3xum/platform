import type { CompassQuestion } from './types';

function normalizeAnswer(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function choiceNextKey(question: CompassQuestion, answer: string | string[] | undefined): string | undefined {
  const answers = new Set(normalizeAnswer(answer));
  if (answers.size === 0) return undefined;

  for (const choice of question.choices || []) {
    if (!answers.has(choice.value)) continue;
    const nextKey = String(choice.next_key || '').trim();
    if (nextKey) return nextKey;
  }

  return undefined;
}

export function resolveNextQuestionIndex(
  questions: CompassQuestion[],
  currentIndex: number,
  answer: string | string[] | undefined
): number {
  const current = questions[currentIndex];
  if (!current) return questions.length;

  const nextKey = choiceNextKey(current, answer);
  if (nextKey) {
    const nextIndex = questions.findIndex((q, index) => index > currentIndex && q.key === nextKey);
    if (nextIndex !== -1) return nextIndex;
  }

  return currentIndex + 1;
}

export function buildChatQuestionGuide(questions: CompassQuestion[]): string {
  if (questions.length === 0) return '';

  const lines: string[] = [
    'Frågebank för modulen:',
    'Du ska använda frågorna som en flexibel intervjuguide.',
    'Ställ en fråga i taget, anpassa ordningen efter svaren och hoppa till choice.next_key när det finns ett angivet nästa steg.',
    'När du har tillräckligt underlag, sammanfatta kort och be om kontaktuppgifter om de saknas.'
  ];

  for (const question of questions) {
    lines.push('');
    lines.push(`- ${question.key}: ${question.prompt}`);
    lines.push(`  Typ: ${question.input_type}${question.required ? ' (obligatorisk)' : ''}`);
    if (question.help_text) {
      lines.push(`  Hjälp: ${question.help_text}`);
    }
    if (question.choices?.length) {
      lines.push('  Alternativ:');
      for (const choice of question.choices) {
        const next = choice.next_key ? ` -> ${choice.next_key}` : '';
        lines.push(`  - ${choice.value}: ${choice.label}${next}`);
      }
    }
  }

  return lines.join('\n');
}