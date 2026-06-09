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

  // Helsides split-screen. Systemets "Aurora-pärlemor"-gradient ligger på
  // <body> och lyser igenom — formulärsidan är inline mot bakgrunden utan
  // egen kort-/modulyta. Bildpanelen till vänster har rundade kanter och
  // faller graciöst tillbaka på en brand-gradient om hjältebilden saknas.
  return (
    <main className="flex min-h-[100svh] w-full items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="grid w-full max-w-6xl items-stretch gap-6 lg:grid-cols-2 lg:gap-12">
        {/* Vänster: bildpanel (rundade kanter, döljs på små skärmar) */}
        <div className="relative hidden min-h-[660px] overflow-hidden rounded-[2rem] bg-gradient-to-br from-movexum-bla via-movexum-lila to-movexum-morkbla shadow-2xl shadow-movexum-svart/15 lg:block">
          {/* Hjältebild — lägg filen på public/brand/login-hero.jpg */}
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: 'url(/brand/login-hero.jpg)' }}
            aria-hidden="true"
          />
          {/* Läsbarhetsskugga underifrån för wordmark + rubrik */}
          <div className="absolute inset-0 bg-gradient-to-t from-movexum-svart/70 via-movexum-svart/15 to-transparent" />

          <div className="relative flex h-full flex-col justify-between p-10 xl:p-12">
            <Logo variant="dark" href="/" width={150} height={34} />

            <div>
              <h2 className="font-heading text-4xl font-bold leading-tight text-movexum-vit xl:text-[2.75rem]">
                Där idéer
                <br />
                blir bolag.
              </h2>
              <p className="mt-4 max-w-sm text-base leading-relaxed text-movexum-vit/80">
                Movexums inkubatorplattform samlar coaching, verktyg och
                uppföljning på ett ställe — byggt i EU, för bolag som vill växa.
              </p>
            </div>
          </div>
        </div>

        {/* Höger: inloggning inline mot bakgrunden (ingen kortyta) */}
        <div className="flex items-center justify-center">
          <div className="w-full max-w-sm">
            <div className="mb-8 lg:hidden">
              <Logo variant="auto" width={150} height={34} />
            </div>

            <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
              Välkommen tillbaka
            </h1>
            <p className="mt-2 text-sm text-foreground-muted">
              Logga in för att fortsätta till din arbetsyta.
            </p>

            <div className="mt-8">
              <LoginForm next={next} />
            </div>

            <p className="mt-10 text-center text-xs text-foreground-subtle">
              Drivs av Movexum · EU-suverän plattform
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
