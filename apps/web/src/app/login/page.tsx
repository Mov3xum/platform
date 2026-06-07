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
    <main className="flex min-h-[100svh] bg-canvas p-3 sm:p-4 lg:p-5">
      <div className="flex w-full overflow-hidden rounded-[2rem] border border-default bg-surface shadow-2xl shadow-movexum-svart/10 dark:shadow-movexum-svart/40">
        {/* ── Vänster panel: flytande Movexum-aurora ── */}
        <section className="relative hidden w-[46%] shrink-0 overflow-hidden rounded-[1.6rem] lg:block">
          {/* Bas-gradient (Movexum mörkblå → mörklila) */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(150deg, var(--movexum-morkbla) 0%, var(--movexum-morklila) 55%, var(--movexum-morkbla) 100%)'
            }}
            aria-hidden="true"
          />
          {/* Flytande aurora-orbar i brand-färger */}
          <div
            className="mx-orb pointer-events-none absolute -left-24 -top-16 h-[28rem] w-[28rem] rounded-full"
            style={{
              background:
                'radial-gradient(circle, var(--movexum-lila) 0%, transparent 68%)',
              opacity: 0.85,
              filter: 'blur(8px)'
            }}
            aria-hidden="true"
          />
          <div
            className="mx-orb-slow pointer-events-none absolute right-[-6rem] top-12 h-[24rem] w-[24rem] rounded-full"
            style={{
              background:
                'radial-gradient(circle, var(--movexum-bla) 0%, transparent 65%)',
              opacity: 0.75,
              filter: 'blur(10px)'
            }}
            aria-hidden="true"
          />
          <div
            className="mx-orb pointer-events-none absolute bottom-[-8rem] left-1/3 h-[30rem] w-[30rem] rounded-full"
            style={{
              background:
                'radial-gradient(circle, var(--movexum-ljuslila) 0%, transparent 70%)',
              opacity: 0.7,
              filter: 'blur(14px)',
              animationDelay: '-6s'
            }}
            aria-hidden="true"
          />
          <div
            className="mx-orb-slow pointer-events-none absolute bottom-4 right-[-4rem] h-[20rem] w-[20rem] rounded-full"
            style={{
              background:
                'radial-gradient(circle, var(--movexum-djupbla) 0%, transparent 60%)',
              opacity: 0.85,
              filter: 'blur(10px)',
              animationDelay: '-10s'
            }}
            aria-hidden="true"
          />
          {/* Subtil prick-textur för djup */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(rgba(242,242,242,0.08) 1px, transparent 1px)',
              backgroundSize: '26px 26px'
            }}
            aria-hidden="true"
          />
          {/* Mörkning i nederkant så texten alltid läses */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
            style={{
              background:
                'linear-gradient(to top, rgba(0,44,64,0.78) 0%, transparent 100%)'
            }}
            aria-hidden="true"
          />

          {/* Innehåll på panelen */}
          <div className="relative flex h-full flex-col justify-between p-10 xl:p-12">
            <div className="flex items-center gap-4">
              <Logo href="/" variant="dark" height={34} />
              <span className="h-4 w-px bg-movexum-vit/25" aria-hidden="true" />
              <span className="text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-movexum-vit/70">
                Inkubatorplattform
              </span>
            </div>

            <div className="max-w-md">
              <p className="mb-5 flex items-center gap-3 text-[0.7rem] font-semibold uppercase tracking-[0.28em] text-movexum-vit/70">
                En vis tanke
                <span className="h-px w-12 bg-movexum-vit/40" aria-hidden="true" />
              </p>
              <h2 className="font-heading text-4xl font-bold leading-[1.08] text-movexum-vit xl:text-5xl">
                Bygg något
                <br />
                som betyder
                <br />
                något.
              </h2>
              <p className="mt-6 max-w-sm text-sm leading-relaxed text-movexum-vit/75">
                Du kan nå allt du vill om du jobbar hårt, litar på processen och
                håller dig till planen. Vi bygger framtidens bolag tillsammans.
              </p>
            </div>
          </div>
        </section>

        {/* ── Höger panel: formulär ── */}
        <section className="flex w-full flex-col px-6 py-8 sm:px-10 lg:w-[54%] lg:px-14 lg:py-10">
          {/* Logo top-left för mobil/tablet (vänsterpanelen är dold där) */}
          <div className="mb-10 lg:hidden">
            <Logo href="/" height={32} />
          </div>

          <div className="flex flex-1 flex-col justify-center">
            <div className="mx-auto w-full max-w-sm">
              <div className="mb-8">
                <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  Välkommen tillbaka
                </h1>
                <p className="mt-3 text-sm text-foreground-muted">
                  Ange din e-post och ditt lösenord för att logga in på ditt konto.
                </p>
              </div>

              <LoginForm next={next} />
            </div>
          </div>

          <p className="mx-auto mt-8 w-full max-w-sm text-center text-sm text-foreground-subtle">
            Saknar du konto?{' '}
            <span className="font-semibold text-foreground-muted">
              Kontakta en administratör
            </span>{' '}
            — konton skapas internt.
          </p>
        </section>
      </div>
    </main>
  );
}
