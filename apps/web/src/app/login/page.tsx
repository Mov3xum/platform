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
    <main className="flex min-h-[100svh] items-center justify-center bg-canvas px-4 py-6 sm:px-6">
      <div className="w-full max-w-md rounded-3xl border border-default bg-surface p-6 shadow-xl shadow-movexum-svart/5 sm:p-8">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo href="/" className="mb-6" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Logga in</h1>
          <p className="mt-2 text-sm text-foreground-muted">Movexum inkubatorplattform</p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
