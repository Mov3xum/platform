import type { Metadata } from 'next';
import { Navbar } from '@/components/Navbar';
import { getCurrentUser } from '@/lib/auth.server';
import './globals.css';

export const metadata: Metadata = {
  title: 'Moveum Incubator Platform',
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
      <body className="min-h-screen bg-slate-50 text-slate-950 antialiased">
        <Navbar user={user} />
        {children}
      </body>
    </html>
  );
}
