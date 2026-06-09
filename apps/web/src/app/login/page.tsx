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

  // Helsides split-screen. Systemets "Aurora-pärlemor"-gradient ligger på
  // <body> och lyser igenom — formulärsidan är inline mot bakgrunden utan
  // egen kort-/modulyta. Bildpanelen till vänster har rundade kanter.
  return (
    <main className="flex min-h-[100svh] w-full items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="grid w-full max-w-6xl items-stretch gap-6 lg:grid-cols-2 lg:gap-12">
        {/* Vänster: bildpanel (rundade kanter, döljs på små skärmar) */}
        <div className="relative hidden min-h-[660px] overflow-hidden rounded-[2rem] shadow-2xl shadow-movexum-svart/15 lg:block">
          {/* Hjältebild */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/AdobeStock_1604728058.jpeg"
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            aria-hidden="true"
          />
          {/* Mjuk topp-skugga så den vita logotypen läser mot ljusa partier */}
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-movexum-svart/45 to-transparent" />

          {/* Riktiga uppladdade logotypen (vit wordmark) — uppe till vänster */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/movexum-wordmark-dark.svg"
            alt="Movexum"
            width={150}
            height={35}
            className="absolute left-10 top-10 h-[34px] w-auto"
          />
        </div>

        {/* Höger: inloggning inline mot bakgrunden (ingen kortyta) */}
        <div className="flex items-center justify-center">
          <div className="w-full max-w-sm">
            <div className="mb-8 lg:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/movexum-wordmark-light.svg"
                alt="Movexum"
                width={150}
                height={35}
                className="h-[34px] w-auto dark:hidden"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/movexum-wordmark-dark.svg"
                alt="Movexum"
                width={150}
                height={35}
                className="hidden h-[34px] w-auto dark:block"
              />
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
