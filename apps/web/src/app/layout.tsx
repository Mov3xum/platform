import type { Metadata } from 'next';
import { Navbar } from '@/components/Navbar';
import { ThemeScript } from '@/components/ThemeProvider';
import { getCurrentUser } from '@/lib/auth.server';
import './globals.css';

export const metadata: Metadata = {
  title: 'Movexum Inkubatorplattform',
  description: 'Modulär plattform för Movexums inkubatorer'
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
        <Navbar user={user} />
        {children}
      </body>
    </html>
  );
}
