// Klient-säkra hjälpare för inloggningssidans utseende (CLAUDE.md § 48).
// Ingen IO, ingen 'server-only' — importeras av både editorn (client) och
// server-loadern.

import type { LoginBranding } from '@platform/shared';

export const LOGIN_MEDIA_UPLOAD_ENDPOINT = '/api/installningar/login-media';

/**
 * URL till en tenants inloggningsmedia via samma-origin-proxyn
 * (app/api/public/login-media/[id]/[filename]/route.ts). Webbläsaren pratar
 * aldrig direkt med PocketBase (§ 23.7-läxan: otillförlitligt cert på
 * staging blockerade bilden tyst).
 */
export function loginMediaUrl(tenantId: string, filename: string | null): string | null {
  if (!filename) return null;
  return `/api/public/login-media/${encodeURIComponent(tenantId)}/${encodeURIComponent(filename)}`;
}

export interface LoginBrandingView extends Omit<LoginBranding, 'imageFilename' | 'videoFilename'> {
  imageUrl: string | null;
  videoUrl: string | null;
}

export function toLoginBrandingView(tenantId: string, branding: LoginBranding): LoginBrandingView {
  return {
    layout: branding.layout,
    accent: branding.accent,
    headline: branding.headline,
    tagline: branding.tagline,
    imageUrl: loginMediaUrl(tenantId, branding.imageFilename),
    videoUrl: loginMediaUrl(tenantId, branding.videoFilename)
  };
}
