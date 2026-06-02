// Pure (React-free, server-free) helpers for the onboarding builder + runner.
// Kept dependency-free so they can be unit-tested with `node --test` and reused
// by the client builder, the runner and the server actions alike. Mirrors
// workshop.ts but for the simpler, AI-free onboarding flows (CLAUDE.md § 25).

import type {
  OnboardingBlock,
  OnboardingBlockOption,
  OnboardingBlockType,
  OnboardingModule
} from './index';

/** Block types som bär en uppladdad mediafil. */
export function isOnboardingMediaBlock(type: OnboardingBlockType): boolean {
  return type === 'video' || type === 'image';
}

function normalizeOptions(value: unknown): OnboardingBlockOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item, oi) => {
    const o = (item ?? {}) as Record<string, unknown>;
    return {
      id: String(o.id || `opt_${oi}`),
      text: String(o.text || ''),
      isCorrect: o.isCorrect === true
    } satisfies OnboardingBlockOption;
  });
}

export function normalizeOnboardingBlocks(value: unknown): OnboardingBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      const block: OnboardingBlock = {
        id: String(obj.id || `block_${index + 1}`),
        type: (obj.type || 'text') as OnboardingBlockType,
        title: String(obj.title || `Moment ${index + 1}`),
        body: obj.body ? String(obj.body) : undefined,
        video_url: obj.video_url ? String(obj.video_url) : undefined,
        image_url: obj.image_url ? String(obj.image_url) : undefined,
        question_type: obj.question_type === 'multiple' ? 'multiple' : 'single',
        options: normalizeOptions(obj.options),
        // acknowledge-block är till sin natur obligatoriska; övriga styrs av flaggan.
        required: obj.type === 'acknowledge' ? true : obj.required === true
      };
      return block;
    })
    .filter((b) => b.title.trim().length > 0);
}

export function normalizeOnboardingModules(value: unknown): OnboardingModule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      const mod: OnboardingModule = {
        id: String(obj.id || `module_${index + 1}`),
        title: String(obj.title || `Modul ${index + 1}`),
        description: obj.description ? String(obj.description) : undefined,
        blocks: normalizeOnboardingBlocks(obj.blocks)
      };
      return mod;
    })
    .filter((m) => m.title.trim().length > 0);
}

/** Alla block i alla moduler, i ordning. */
export function flattenOnboardingBlocks(modules: OnboardingModule[]): OnboardingBlock[] {
  return modules.flatMap((m) => m.blocks);
}

function answerArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value) return [value];
  return [];
}

/**
 * Är ett enskilt block slutfört givet bolagets sparade svar?
 * - quiz: minst ett valt alternativ
 * - question: icke-tom fritext
 * - text/video/image/acknowledge: bekräftelse-kryssruta (answers[id] === true)
 */
export function isOnboardingBlockComplete(
  block: OnboardingBlock,
  answers: Record<string, unknown>
): boolean {
  switch (block.type) {
    case 'quiz':
      return answerArray(answers[block.id]).length > 0;
    case 'question': {
      const v = answers[block.id];
      return typeof v === 'string' && v.trim().length > 0;
    }
    default:
      return answers[block.id] === true;
  }
}

/** Antal obligatoriska block som ännu inte är slutförda. */
export function onboardingRemainingRequired(
  modules: OnboardingModule[],
  answers: Record<string, unknown>
): number {
  return flattenOnboardingBlocks(modules).filter(
    (b) => b.required && !isOnboardingBlockComplete(b, answers)
  ).length;
}

/** True när alla obligatoriska block är slutförda (eller inga finns). */
export function isOnboardingComplete(
  modules: OnboardingModule[],
  answers: Record<string, unknown>
): boolean {
  return onboardingRemainingRequired(modules, answers) === 0;
}

/** Procent slutfört, räknat på obligatoriska block (0–100). */
export function onboardingProgressPct(
  modules: OnboardingModule[],
  answers: Record<string, unknown>
): number {
  const required = flattenOnboardingBlocks(modules).filter((b) => b.required);
  if (required.length === 0) return 100;
  const done = required.filter((b) => isOnboardingBlockComplete(b, answers)).length;
  return Math.round((done / required.length) * 100);
}

export const ONBOARDING_BLOCK_LABELS: Record<OnboardingBlockType, string> = {
  text: 'Text',
  video: 'Film',
  image: 'Bild',
  acknowledge: 'Bekräftelse',
  question: 'Fråga',
  quiz: 'Quiz'
};
