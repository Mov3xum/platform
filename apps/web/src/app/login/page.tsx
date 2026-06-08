import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth.server';
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

  // Systemets gradient ("Aurora-pärlemor") ligger redan på <body> och lyser
  // igenom — main är transparent så login matchar appens inre bakgrund exakt.
  return (
    <main className="flex min-h-[100svh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-default bg-surface/80 p-8 shadow-xl shadow-movexum-svart/5 backdrop-blur-md sm:p-10">
        <LoginForm next={next} />
      </div>
    </main>
  );
}
