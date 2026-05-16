import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth.server';
import { Logo } from '@/components/Logo';
import { LoginForm } from './LoginForm';

export const metadata = {
  title: 'Logga in — Movexum'
};

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const next = params.next || '/dashboard';

  if (user) {
    redirect(next);
  }

  return (
    <main className="relative flex min-h-[100svh] items-center justify-center overflow-hidden bg-canvas px-4 py-6 sm:px-6">
      {/* Dot pattern overlay (dark mode only) */}
      <div
        className="pointer-events-none absolute inset-0 hidden dark:block"
        style={{
          backgroundImage: 'radial-gradient(rgba(141,111,214,0.07) 1px, transparent 1px)',
          backgroundSize: '28px 28px'
        }}
        aria-hidden="true"
      />
      {/* Lila radial glow behind the card (dark only) */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 hidden h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full dark:block"
        style={{
          background: 'radial-gradient(circle, rgba(97,56,181,0.18) 0%, transparent 65%)',
          filter: 'blur(40px)'
        }}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md rounded-3xl border border-default bg-surface p-6 shadow-2xl shadow-black/30 dark:border-[rgba(141,111,214,0.15)] dark:bg-[#0a0a0a] sm:p-8">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo href="/" className="mb-6" height={36} />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Logga in</h1>
          <p className="mt-2 text-sm text-foreground-muted">Movexum inkubatorplattform</p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
