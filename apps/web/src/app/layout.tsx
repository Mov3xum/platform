import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Navbar } from '@/components/Navbar';
import { ThemeScript } from '@/components/ThemeProvider';
import { ChunkReloadListener } from '@/components/ChunkReloadListener';
import { AppShell } from '@/components/AppShell';
import { PwaRegister } from '@/components/pwa/PwaRegister';
import { getCurrentUser } from '@/lib/auth.server';
import './globals.css';

// Bumpa när favicon/app-ikonerna renderas om (cache-busting, se `icons` nedan).
const ICON_VERSION = 2;

export const metadata: Metadata = {
  title: 'Movexum Inkubatorplattform',
  description: 'Modulär plattform för Movexums inkubatorer',
  applicationName: 'Movexum',
  // PWA / hemskärm (CLAUDE.md § 35): manifest + iOS-specifika taggar. iOS
  // läser inte manifestets ikoner → apple-touch-icon krävs separat.
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Movexum',
    // Svart statusrad i hemskärmsläge — matchar ikonens och manifestets
    // svarta bakgrund.
    statusBarStyle: 'black'
  },
  formatDetection: { telephone: false },
  icons: {
    // Favicon = Movexum-wordmarken i vitt på svart (renderad av
    // scripts/render-pwa-icons.mjs). ICO:n bär 16/32/48 px för flikar och
    // bokmärken; PNG:erna används av Android/desktop-PWA. `?v=` är
    // cache-busting: webbläsare cachar favicons aggressivt, så bumpa
    // ICON_VERSION när ikonen byts, annars ligger den gamla kvar i fliken.
    icon: [
      { url: `/favicon.ico?v=${ICON_VERSION}`, sizes: '16x16 32x32 48x48', type: 'image/x-icon' },
      { url: `/icons/favicon-32.png?v=${ICON_VERSION}`, sizes: '32x32', type: 'image/png' },
      { url: `/icons/icon-192.png?v=${ICON_VERSION}`, sizes: '192x192', type: 'image/png' },
      { url: `/icons/icon-512.png?v=${ICON_VERSION}`, sizes: '512x512', type: 'image/png' }
    ],
    shortcut: [{ url: `/favicon.ico?v=${ICON_VERSION}` }],
    apple: [{ url: `/icons/apple-touch-icon.png?v=${ICON_VERSION}`, sizes: '180x180', type: 'image/png' }]
  }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  // Låt det virtuella tangentbordet krympa layouten (Chrome/Android) så att
  // chattens komposer och bottom-menyn aldrig hamnar bakom tangentbordet.
  interactiveWidget: 'resizes-content',
  // Svart webbläsarkrom (adressfält/flikrad på mobil, fönsterram i
  // desktop-PWA) i båda lägena — samma svarta yta som favicon/hemskärmsikon.
  themeColor: '#000000'
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const headerList = await headers();
  const nonce = headerList.get('x-nonce') ?? undefined;
  const pathname = headerList.get('x-pathname') ?? '';

  // Publika Startupkompass-moduler (/m/<slug>) är fristående, oinloggade
  // ytor. De ska ALDRIG visa systemets vänstermeny/AppShell — även om en
  // inloggad medarbetare öppnar den publika länken ska sidan se ut som den
  // gör för en anonym besökare (en ren, isolerad chatt-/formulär-yta).
  const isPublicModule = pathname === '/m' || pathname.startsWith('/m/');

  // Inloggningssidan är en fristående, helsides split-screen-yta (bild +
  // formulär) som bär sin egen branding — den ska aldrig visa den utloggade
  // toppnavigationen (Navbar). Samma princip som de publika modulerna ovan.
  const isAuthPage = pathname === '/login';

  // Årshjulets presentationsläge (§ 30) är en helskärmsyta för projektorn —
  // ingen rail, ingen sidmeny. Sidan kräver fortfarande inloggning + staff
  // (RBAC i page.tsx); bara ramen tas bort.
  const isPresentation = pathname === '/arshjul/presentation';

  // Offline-fallbacken (§ 35) förcachas av service workern. Den renderas
  // utan AppShell så att den cachade HTML:en aldrig innehåller inloggad
  // användares namn, bolagslista eller annan tenant-data.
  const isOffline = pathname === '/offline';

  let content: React.ReactNode;
  if (isPublicModule || isAuthPage || isPresentation || isOffline) {
    content = children;
  } else if (user) {
    content = <AppShell user={user}>{children}</AppShell>;
  } else {
    content = (
      <>
        <Navbar user={null} />
        {children}
      </>
    );
  }

  return (
    <html lang="sv" suppressHydrationWarning>
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body className="min-h-screen bg-canvas text-foreground antialiased">
        <ChunkReloadListener />
        <PwaRegister />
        {content}
      </body>
    </html>
  );
}
