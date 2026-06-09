import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Navbar } from '@/components/Navbar';
import { ThemeScript } from '@/components/ThemeProvider';
import { ChunkReloadListener } from '@/components/ChunkReloadListener';
import { AppShell } from '@/components/AppShell';
import { getCurrentUser } from '@/lib/auth.server';
import './globals.css';

export const metadata: Metadata = {
  title: 'Movexum Inkubatorplattform',
  description: 'Modulär plattform för Movexums inkubatorer'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' }
  ]
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

  let content: React.ReactNode;
  if (isPublicModule || isAuthPage) {
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
        {content}
      </body>
    </html>
  );
}
