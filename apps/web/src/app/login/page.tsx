import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth.server';
import { LoginForm } from './LoginForm';

export const metadata = {
  title: 'Logga in — Moveum'
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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-900/5">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-600 text-lg font-semibold text-white">
            M
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Logga in</h1>
          <p className="mt-2 text-sm text-slate-600">Moveum inkubatorplattform</p>
        </div>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
