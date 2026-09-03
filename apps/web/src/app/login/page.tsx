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

  // Minimalistisk helsida. Systemets "Aurora-pärlemor"-gradient ligger på
  // <body> (prototype.css) och lyser igenom — samma bakgrund som inne i
  // plattformen. Inloggningsrutan är ett centrerat kort på gradienten och
  // logotypen sitter uppe till vänster, med samma avstånd till topp- och
  // vänsterkant.
  return (
    <main className="relative flex min-h-[100svh] w-full items-center justify-center px-4 py-24 sm:px-6">
      <div className="absolute left-6 top-6 sm:left-8 sm:top-8">
        <Logo width={140} height={30} />
      </div>

      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-default bg-surface p-8 shadow-xl shadow-movexum-svart/5 sm:p-10">
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
            Välkommen tillbaka
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            Logga in för att fortsätta till din arbetsyta.
          </p>

          <div className="mt-8">
            <LoginForm next={next} />
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-foreground-subtle">
          Drivs av Movexum · EU-suverän plattform
        </p>
      </div>
    </main>
  );
}
