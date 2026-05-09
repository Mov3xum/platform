import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { ConfirmResetForm } from './ConfirmResetForm';

export const metadata = {
  title: 'Nytt lösenord — Movexum'
};

export default async function ConfirmResetPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token || '';

  if (!token) {
    redirect('/reset-password');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-md rounded-3xl border border-default bg-surface p-8 shadow-xl shadow-movexum-svart/5">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo href="/" className="mb-6" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Nytt lösenord</h1>
          <p className="mt-2 text-sm text-foreground-muted">Välj ett nytt lösenord för ditt konto.</p>
        </div>
        <ConfirmResetForm token={token} />
      </div>
    </main>
  );
}
