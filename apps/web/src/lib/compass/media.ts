import { getPublicPbUrl } from '@/lib/pb-url';
import type { CompassModule } from './types';

// Bygger publika URL:er till en moduls omslagsmedia (hero_image/hero_video).
// Filfälten är ICKE skyddade → serveras tokenlöst via PocketBase, precis som
// tenant-logos och workshop_media (CLAUDE.md § 18.2). Därför fungerar URL:erna
// även för en anonym besökare på /m/<slug>. Returnerar null när fil saknas.

function moduleFileUrl(moduleId: string, filename?: string): string | null {
  if (!filename) return null;
  const base = getPublicPbUrl().replace(/\/$/, '');
  return `${base}/api/files/compass_modules/${moduleId}/${encodeURIComponent(filename)}`;
}

export function moduleHeroImageUrl(
  module: Pick<CompassModule, 'id' | 'hero_image'>
): string | null {
  return moduleFileUrl(module.id, module.hero_image);
}

export function moduleHeroVideoUrl(
  module: Pick<CompassModule, 'id' | 'hero_video'>
): string | null {
  return moduleFileUrl(module.id, module.hero_video);
}
