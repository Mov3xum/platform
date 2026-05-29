// Pure (React-free, server-free) helpers for education documents — uploaded
// reference files (PDF/Excel/PowerPoint/Word) that staff assign to startups.
// Kept dependency-free so the client upload form (fast feedback) and the
// authoritative upload route handler share the exact same validation.

export type EducationDocumentKind = 'pdf' | 'excel' | 'powerpoint' | 'word' | 'other';

export const MAX_EDUCATION_DOCUMENT_BYTES = 50 * 1024 * 1024; // 50 MB

// Mime → doc_kind. Mirrors the whitelist in migration 1700000088.
const MIME_TO_KIND: Record<string, EducationDocumentKind> = {
  'application/pdf': 'pdf',
  'application/vnd.ms-excel': 'excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'excel',
  'application/vnd.ms-powerpoint': 'powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'powerpoint',
  'application/msword': 'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word'
};

// Fallback by file extension for browsers/OSes that report a generic mime
// (e.g. application/octet-stream) for Office files.
const EXT_TO_KIND: Record<string, EducationDocumentKind> = {
  pdf: 'pdf',
  xls: 'excel',
  xlsx: 'excel',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  doc: 'word',
  docx: 'word'
};

export interface DocumentValidationInput {
  type: string;
  size: number;
  name?: string;
}

export type DocumentValidationResult =
  | { ok: true; docKind: EducationDocumentKind }
  | { ok: false; error: string };

export function formatDocumentMbLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function extensionOf(name?: string): string {
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Resolve the doc_kind enum value from a mime type (+ filename fallback). */
export function resolveEducationDocumentKind(
  mime: string,
  name?: string
): EducationDocumentKind {
  const type = (mime || '').toLowerCase();
  if (MIME_TO_KIND[type]) return MIME_TO_KIND[type];
  const ext = extensionOf(name);
  if (EXT_TO_KIND[ext]) return EXT_TO_KIND[ext];
  return 'other';
}

/**
 * Validate an uploaded document (allowed type + byte size). Shared by the
 * client form and the upload route handler. Accepts a file only if it maps to
 * a known Office/PDF kind (mime OR extension) — `other` is rejected so we never
 * store an arbitrary binary.
 */
export function validateEducationDocumentFile(
  file: DocumentValidationInput
): DocumentValidationResult {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: 'Filen verkar vara tom.' };
  }
  if (file.size > MAX_EDUCATION_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: `Filen är för stor (max ${formatDocumentMbLimit(MAX_EDUCATION_DOCUMENT_BYTES)}).`
    };
  }
  const type = (file.type || '').toLowerCase();
  const ext = extensionOf(file.name);
  if (!MIME_TO_KIND[type] && !EXT_TO_KIND[ext]) {
    return {
      ok: false,
      error: 'Välj en PDF-, Excel-, PowerPoint- eller Word-fil.'
    };
  }
  return { ok: true, docKind: resolveEducationDocumentKind(type, file.name) };
}

export const educationDocumentKindLabels: Record<EducationDocumentKind, string> = {
  pdf: 'PDF',
  excel: 'Excel',
  powerpoint: 'PowerPoint',
  word: 'Word',
  other: 'Dokument'
};
