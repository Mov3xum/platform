import type { CompassModule } from './types';

// Bygger URL:er till en moduls omslagsmedia (hero_image/hero_video).
//
// URL:erna pekar på den EGNA originen — proxyn i
// app/api/public/compass-media/[id]/[filename]/route.ts strömmar filen från
// PocketBase server-side. Tidigare byggdes en direkt PB-URL
// (getPublicPbUrl()): den fungerar bara om webbläsaren litar på PB-hostens
// certifikat och protokoll, vilket sslip.io-staging inte uppfyller
// (infra/SSL.md) — bilden blockerades tyst och reservgrafiken visades trots
// lyckad uppladdning. Relativa sökvägar fungerar lika bra i <img>/<video>
// och i editorns förhandsvisning. Returnerar null när fil saknas.

function moduleFileUrl(moduleId: string, filename?: string): string | null {
  if (!filename) return null;
  return `/api/public/compass-media/${encodeURIComponent(moduleId)}/${encodeURIComponent(filename)}`;
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
