export default function Home() {
  return (
    <main className="relative overflow-hidden bg-canvas">
      {/* Background dot pattern — dark mode only */}
      <div
        className="pointer-events-none absolute inset-0 hidden dark:block"
        style={{
          backgroundImage: 'radial-gradient(rgba(141,111,214,0.06) 1px, transparent 1px)',
          backgroundSize: '28px 28px'
        }}
        aria-hidden
      />
      {/* Radial glow anchors */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(ellipse_at_top_left,_rgba(97,56,181,0.15),_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_top_left,_rgba(142,111,214,0.22),_transparent_50%)]" aria-hidden />
      <div className="pointer-events-none absolute -right-40 top-20 hidden h-[500px] w-[500px] rounded-full dark:block" style={{ background: 'radial-gradient(circle, rgba(97,56,181,0.14) 0%, transparent 65%)', filter: 'blur(60px)' }} aria-hidden />

      <div className="relative z-10">
        <section className="mx-auto flex min-h-[calc(100svh-80px)] max-w-7xl flex-col justify-center px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          <div className="grid gap-8 sm:gap-12 lg:grid-cols-[1.1fr_minmax(280px,0.9fr)] lg:items-center">
            <div className="space-y-6 sm:space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-default bg-surface/80 px-3 py-1.5 text-xs font-medium text-foreground-muted shadow-sm backdrop-blur dark:border-[rgba(141,111,214,0.2)] dark:bg-[rgba(97,56,181,0.08)] sm:px-4 sm:py-2 sm:text-sm">
                <span className="block h-2 w-2 rounded-full bg-movexum-lila" style={{ boxShadow: '0 0 6px rgba(97,56,181,0.8)' }} />
                Plattformen är live — testa staging-merge direkt
              </div>
              <div className="space-y-4 sm:space-y-6">
                <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                  Hemmaplan för <span className="text-brand">innovativa startups</span> i Gävleborg
                </h1>
                <p className="max-w-2xl font-body text-base leading-7 text-foreground-muted sm:text-lg sm:leading-8 lg:text-xl">
                  En modern inkubatorplattform byggd för lokal tillväxt, modulär utveckling och snabb feedback. Körs i Coolify på UpCloud med PocketBase-backend.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <a
                  href="/idag"
                  className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground shadow-lg shadow-movexum-lila/25 transition hover:bg-brand-hover dark:shadow-movexum-lila/40"
                >
                  Öppna Movexum OS
                </a>
                <a
                  href="/startups"
                  className="inline-flex items-center justify-center rounded-full border border-default px-6 py-3 text-sm font-semibold text-foreground-muted transition hover:border-strong hover:bg-canvas-subtle dark:border-[rgba(255,255,255,0.1)] dark:hover:border-[rgba(141,111,214,0.35)]"
                >
                  Utforska startups
                </a>
              </div>
            </div>
            <div className="relative isolate overflow-hidden rounded-3xl border border-default bg-surface p-6 shadow-2xl shadow-movexum-lila/10 dark:border-[rgba(141,111,214,0.15)] dark:shadow-movexum-lila/30 sm:rounded-[2rem] sm:p-8">
              <div className="pointer-events-none absolute -right-12 top-10 h-48 w-48 rounded-full" style={{ background: 'radial-gradient(circle, rgba(141,111,214,0.3) 0%, transparent 65%)', filter: 'blur(30px)' }} aria-hidden />
              <div className="pointer-events-none absolute bottom-8 left-4 h-32 w-32 rounded-full" style={{ background: 'radial-gradient(circle, rgba(0,168,222,0.15) 0%, transparent 65%)', filter: 'blur(20px)' }} aria-hidden />
              <div className="relative flex h-full flex-col justify-between gap-6">
                <div className="space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-link sm:text-sm">Movexum</p>
                  <div className="space-y-3">
                    <h2 className="text-2xl font-semibold text-foreground sm:text-3xl">Startups, mentorskap och genomslag.</h2>
                    <p className="font-body text-sm leading-6 text-foreground-muted">
                      Plattformens vy för lokala innovationsprojekt, teamdata och milstolpar. Klart för merge och live-test i staging.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  {[
                    { label: 'Moduler', value: '8+' },
                    { label: 'Roller', value: '5' },
                    { label: 'Data', value: 'PocketBase' },
                    { label: 'Hosting', value: 'Coolify / UpCloud' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-2xl border border-default bg-surface/80 p-3 shadow-sm dark:border-[rgba(141,111,214,0.1)] sm:rounded-3xl sm:p-4"
                    >
                      <p className="text-xs font-medium text-foreground-subtle sm:text-sm">{item.label}</p>
                      <p className="mt-2 text-xl font-semibold text-foreground sm:mt-3 sm:text-2xl">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
