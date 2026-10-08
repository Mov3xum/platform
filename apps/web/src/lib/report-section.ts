/**
 * Validering av en sektionsuppdatering i inkubatorrapporter (/rapporter).
 * Ren logik (enhetstestad i report-section.test.ts): bara vitlistade fält får
 * slås ihop i `sections_json` — aldrig godtyckliga klientnycklar (SOC 2
 * processing integrity, § 10.4). `id` och `auto` är systemdefinierade.
 */
import type { ReportSection } from '@platform/shared';

export const REPORT_SECTION_STATES = ['pending', 'auto', 'review', 'done'] as const;
export const REPORT_SECTION_NAME_MAX = 200;
export const REPORT_SECTION_CONTENT_MAX = 50_000;

export type ReportSectionPatch = Partial<Pick<ReportSection, 'name' | 'state' | 'content_md'>>;

export function sanitizeReportSectionPatch(
  input: unknown
): { ok: true; patch: ReportSectionPatch } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Ogiltig sektionsuppdatering.' };
  }
  const raw = input as Record<string, unknown>;
  const patch: ReportSectionPatch = {};

  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string') return { ok: false, error: 'Sektionsnamnet måste vara text.' };
    const name = raw.name.trim();
    if (!name) return { ok: false, error: 'Sektionsnamnet får inte vara tomt.' };
    if (name.length > REPORT_SECTION_NAME_MAX) {
      return { ok: false, error: `Sektionsnamnet får vara högst ${REPORT_SECTION_NAME_MAX} tecken.` };
    }
    patch.name = name;
  }
  if (raw.state !== undefined) {
    if (typeof raw.state !== 'string' || !(REPORT_SECTION_STATES as readonly string[]).includes(raw.state)) {
      return { ok: false, error: 'Ogiltig sektionsstatus.' };
    }
    patch.state = raw.state as ReportSection['state'];
  }
  if (raw.content_md !== undefined) {
    if (typeof raw.content_md !== 'string') return { ok: false, error: 'Sektionsinnehållet måste vara text.' };
    if (raw.content_md.length > REPORT_SECTION_CONTENT_MAX) {
      return { ok: false, error: `Sektionsinnehållet får vara högst ${REPORT_SECTION_CONTENT_MAX} tecken.` };
    }
    patch.content_md = raw.content_md;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'Inget att uppdatera.' };
  return { ok: true, patch };
}
