/**
 * Export Labs sidor per bolag (`/exportlab/<id>/…`) — ren modul, delad av
 * sidorna, Stepper, sidomenyn och länkar från bolagskortet.
 */

export type ExportPage = 'plan' | 'marknader' | 'analys' | 'dokument' | 'historik' | 'installningar';

export const EXPORT_PAGES: ReadonlyArray<{ id: ExportPage; label: string }> = [
  { id: 'plan', label: 'Exportplan' },
  { id: 'marknader', label: 'Exportprofil & marknader' },
  { id: 'analys', label: 'Informationsgap' },
  { id: 'dokument', label: 'Dokument' },
  { id: 'historik', label: 'Historik' },
  { id: 'installningar', label: 'Bolagsuppgifter' }
];

export function exportHref(startupId: string, page: ExportPage, query?: string): string {
  return `/exportlab/${startupId}/${page}${query ? `?${query}` : ''}`;
}

export const EXPORT_NEW_HREF = '/exportlab/ny';
export const EXPORT_DOCUMENTS_ENDPOINT = '/api/exportlab/documents';
export function exportReportHref(startupId: string): string {
  return `/api/exportlab/${startupId}/rapport`;
}
