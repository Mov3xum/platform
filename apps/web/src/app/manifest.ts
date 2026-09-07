import type { MetadataRoute } from 'next';

/**
 * Web App Manifest (CLAUDE.md § 35) — gör att plattformen kan läggas på
 * hemskärmen och köras som en app (standalone, utan webbläsar-krom).
 *
 * Serveras av Next på `/manifest.webmanifest`. Sökvägen är publik i
 * middleware:n eftersom webbläsare hämtar manifestet utan cookies.
 * Hemskärmsikonen är Movexum-wordmarken i vitt på svart; splash-bakgrund
 * och tema-färg är därför svarta så ikon, startskärm och fönsterram hänger
 * ihop (§ 35.4).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Movexum',
    short_name: 'Movexum',
    description: 'Movexums inkubatorplattform — chatt, bolag, aktiviteter och verktyg.',
    lang: 'sv',
    dir: 'ltr',
    start_url: '/chatt?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    background_color: '#000000',
    theme_color: '#000000',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts: [
      { name: 'Chatt', url: '/chatt', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Bolag', url: '/startups', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Min översikt', url: '/inkorg', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] }
    ]
  };
}
