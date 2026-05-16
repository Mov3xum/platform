import type { Metadata, Viewport } from 'next';
import { Navbar } from '@/components/Navbar';
import { ThemeScript } from '@/components/ThemeProvider';
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
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' }
  ]
};

export default async function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <html lang="sv" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-canvas text-foreground antialiased">
        {user ? (
          <AppShell user={user}>{children}</AppShell>
        ) : (
          <>
            <Navbar user={null} />
            {children}
          </>
        )}
      </body>
    </html>
  );
}
