import { getPublicPbUrl } from '@/lib/pb-url';
import type { CompassModule } from './types';

// Bygger den publika URL:en till en moduls omslagsbild (hero_image). Filfältet
// är ICKE skyddat → serveras tokenlöst via PocketBase, precis som tenant-logos
// och workshop_media (CLAUDE.md § 18.2). Därför fungerar URL:en även för en
// anonym besökare på /m/<slug>. Returnerar null när modulen saknar bild.
export function moduleHeroImageUrl(
  module: Pick<CompassModule, 'id' | 'hero_image'>
): string | null {
  if (!module.hero_image) return null;
  const base = getPublicPbUrl().replace(/\/$/, '');
  return `${base}/api/files/compass_modules/${module.id}/${encodeURIComponent(module.hero_image)}`;
}
