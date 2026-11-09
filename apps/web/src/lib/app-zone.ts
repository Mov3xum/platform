/**
 * Visuella zoner i appskalet (ren modul, enhetstestad).
 *
 * Hela plattformen delar aurora-gradienten (`--mx-app-gradient`,
 * prototype.css). En zon byter gradientens TONER — aldrig kompositionen —
 * så en modul kan kännas som "samma system, egen del". Impact Navigator
 * (§ 56) är hållbarhetsdelen och bär Movexums gröna toner; Export Lab (§ 58)
 * är internationaliseringsdelen i Movexums blå toner. Zonen sätts som
 * `data-zone` på `.mx-main-col` av `MainColumn` och läses av CSS:en.
 */
export type AppZone = 'impact' | 'export';

const ZONE_PREFIXES: ReadonlyArray<{ zone: AppZone; prefix: string }> = [
  { zone: 'impact', prefix: '/impactnavigator' },
  // Export Lab (§ 58) = internationaliseringsdelen i Movexums blå toner.
  { zone: 'export', prefix: '/exportlab' }
];

export function appZoneForPath(pathname: string): AppZone | null {
  for (const { zone, prefix } of ZONE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return zone;
  }
  return null;
}
