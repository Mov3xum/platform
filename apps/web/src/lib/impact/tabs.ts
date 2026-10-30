/**
 * Impact Navigators sidor per bolag (`/impactnavigator/<id>/…`) — originalets
 * sidomeny (Dashboard, Bolagsuppgifter, Väsentliga områden, Dokument,
 * Historik, Jämförelser, Anteckningar) som plattformens flikar. Ren modul,
 * delad av sidorna, Stepper och länkar från bolagskortet.
 */

export type ImpactPage = 'dashboard' | 'vasentlighet' | 'analys' | 'dokument' | 'historik' | 'anteckningar' | 'installningar';

export const IMPACT_PAGES: ReadonlyArray<{ id: ImpactPage; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'vasentlighet', label: 'Väsentliga områden' },
  { id: 'analys', label: 'Informationsgap' },
  { id: 'dokument', label: 'Dokument' },
  { id: 'historik', label: 'Historik' },
  { id: 'anteckningar', label: 'Anteckningar' },
  { id: 'installningar', label: 'Bolagsuppgifter' }
];

export function impactHref(startupId: string, page: ImpactPage, query?: string): string {
  return `/impactnavigator/${startupId}/${page}${query ? `?${query}` : ''}`;
}

export function impactTabs(startupId: string) {
  return IMPACT_PAGES.map((p) => ({ id: p.id, label: p.label, href: impactHref(startupId, p.id) }));
}

export const IMPACT_COMPARE_HREF = '/impactnavigator/jamfor';
export const IMPACT_NEW_HREF = '/impactnavigator/ny';
export function impactReportHref(startupId: string): string {
  return `/api/impactnavigator/${startupId}/rapport`;
}
