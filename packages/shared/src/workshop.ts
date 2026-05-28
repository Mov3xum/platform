// Pure (React-free, server-free) helpers for the education/workshop builder.
// Kept dependency-free so they can be unit-tested with `node --test` and reused
// by the client builder, the upload route handler and the server actions alike.

import type {
  WorkshopBlock,
  WorkshopBlockOption,
  WorkshopBlockType,
  WorkshopModule
} from './index';

// ── Media upload limits ──────────────────────────────────────────────────────
// Stored as real PocketBase files (collection `workshop_media`), not base64 in
// the workshop JSON — so "rätt stora videos" no longer balloon the record.
export const MAX_WORKSHOP_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_WORKSHOP_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

export const WORKSHOP_IMAGE_MIME_PREFIX = 'image/';
export const WORKSHOP_VIDEO_MIME_PREFIX = 'video/';

export type WorkshopMediaKind = 'image' | 'video';

export interface MediaValidationInput {
  type: string;
  size: number;
}

export type MediaValidationResult = { ok: true } | { ok: false; error: string };

export function formatMbLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** True for the two block types that carry an uploaded media file. */
export function isMediaBlockType(type: WorkshopBlockType): boolean {
  return type === 'video' || type === 'image';
}

/**
 * Validate a media file (mime prefix + byte size) before upload. Shared by the
 * client builder (fast feedback) and the upload route handler (authoritative).
 */
export function validateWorkshopMediaFile(
  file: MediaValidationInput,
  kind: WorkshopMediaKind
): MediaValidationResult {
  const isImage = kind === 'image';
  const expectedPrefix = isImage ? WORKSHOP_IMAGE_MIME_PREFIX : WORKSHOP_VIDEO_MIME_PREFIX;
  const maxBytes = isImage ? MAX_WORKSHOP_IMAGE_BYTES : MAX_WORKSHOP_VIDEO_BYTES;
  const type = (file.type || '').toLowerCase();

  if (!type.startsWith(expectedPrefix)) {
    return {
      ok: false,
      error: isImage
        ? 'Välj en bildfil (PNG, JPG, WEBP, GIF).'
        : 'Välj en videofil (MP4, WebM m.fl.).'
    };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: 'Filen verkar vara tom.' };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      error: isImage
        ? `Bildfilen är för stor (max ${formatMbLimit(maxBytes)}).`
        : `Videofilen är för stor (max ${formatMbLimit(maxBytes)}).`
    };
  }
  return { ok: true };
}

// ── Block / module normalization ─────────────────────────────────────────────
// Coerces untrusted JSON (from the builder's hidden field) into typed blocks.
// Drops blocks/modules without a title; fills sane defaults for every field.

function normalizeOptions(value: unknown): WorkshopBlockOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item, oi) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const opt: WorkshopBlockOption = {
      id: String(o.id || `opt_${oi}`),
      text: String(o.text || ''),
      isCorrect: o.isCorrect === true
    };
    return opt;
  });
}

export function normalizeWorkshopBlocks(value: unknown): WorkshopBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      const block: WorkshopBlock = {
        id: String(obj.id || `block_${index + 1}`),
        type: (obj.type || 'exercise') as WorkshopBlockType,
        title: String(obj.title || `Moment ${index + 1}`),
        instructions: obj.instructions ? String(obj.instructions) : undefined,
        video_url: obj.video_url ? String(obj.video_url) : undefined,
        image_url: obj.image_url ? String(obj.image_url) : undefined,
        desired_result: obj.desired_result ? String(obj.desired_result) : undefined,
        question_type: obj.question_type === 'multiple' ? 'multiple' : 'single',
        options: normalizeOptions(obj.options),
        required: obj.required === true,
        // ai_pipeline config — must round-trip or pipeline blocks lose their setup.
        pipeline_system_prompt: obj.pipeline_system_prompt
          ? String(obj.pipeline_system_prompt)
          : undefined,
        pipeline_model: obj.pipeline_model ? String(obj.pipeline_model) : undefined,
        pipeline_output_key: obj.pipeline_output_key
          ? String(obj.pipeline_output_key)
          : undefined,
        pipeline_requires_key: obj.pipeline_requires_key
          ? String(obj.pipeline_requires_key)
          : undefined
      };
      return block;
    })
    .filter((b) => b.title.trim().length > 0);
}

export function normalizeWorkshopModules(value: unknown): WorkshopModule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      const mod: WorkshopModule = {
        id: String(obj.id || `module_${index + 1}`),
        title: String(obj.title || `Modul ${index + 1}`),
        description: obj.description ? String(obj.description) : undefined,
        blocks: normalizeWorkshopBlocks(obj.blocks)
      };
      return mod;
    })
    .filter((m) => m.title.trim().length > 0);
}
