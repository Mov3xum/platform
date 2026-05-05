export default function Home() {
  return (
    <main className="relative overflow-hidden bg-canvas">
      <div className="absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top_left,_rgba(97,56,181,0.18),_transparent_35%),linear-gradient(180deg,_rgba(0,168,222,0.1),_transparent_70%)] pointer-events-none dark:bg-[radial-gradient(circle_at_top_left,_rgba(142,111,214,0.25),_transparent_35%),linear-gradient(180deg,_rgba(0,168,222,0.12),_transparent_70%)]" />
      <div className="relative z-10">
        <section className="mx-auto flex min-h-[calc(100vh-80px)] max-w-7xl flex-col justify-center px-6 py-10 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_minmax(280px,0.9fr)] lg:items-center">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-default bg-surface/80 px-4 py-2 text-sm font-medium text-foreground-muted shadow-sm backdrop-blur">
                <span className="block h-2 w-2 rounded-full bg-movexum-bla" />
                Plattformen är live — testa staging-merge direkt
              </div>
              <div className="space-y-6">
                <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
                  Hemmaplan för <span className="text-brand">innovativa startups</span> i Gävleborg
                </h1>
                <p className="max-w-2xl font-body text-lg leading-8 text-foreground-muted sm:text-xl">
                  En modern inkubatorplattform byggd för lokal tillväxt, modulär utveckling och snabb feedback. Körs i Coolify på UpCloud med PocketBase-backend.
                </p>
              </div>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <a
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 text-sm font-semibold text-brand-foreground shadow-lg shadow-movexum-lila/20 transition hover:bg-brand-hover"
                >
                  Öppna dashboard
                </a>
                <a
                  href="/startups"
                  className="inline-flex items-center justify-center rounded-full border border-default px-6 py-3 text-sm font-semibold text-foreground-muted transition hover:border-strong hover:bg-canvas-subtle"
                >
                  Utforska startups
                </a>
              </div>
            </div>
            <div className="relative isolate overflow-hidden rounded-[2rem] bg-gradient-to-br from-movexum-pastell-lila via-canvas to-surface p-8 shadow-2xl shadow-movexum-lila/10 ring-1 ring-default dark:from-movexum-morklila/30 dark:via-canvas-subtle dark:to-surface dark:shadow-movexum-lila/30">
              <div className="absolute -right-12 top-10 h-40 w-40 rounded-full bg-movexum-ljuslila/40 blur-3xl" />
              <div className="absolute left-8 top-24 h-24 w-24 rounded-[2rem] bg-movexum-bla/20 blur-xl" />
              <div className="relative flex h-full flex-col justify-between gap-6">
                <div className="space-y-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-link">Movexum</p>
                  <div className="space-y-3">
                    <h2 className="text-3xl font-semibold text-foreground">Startups, mentorskap och genomslag.</h2>
                    <p className="font-body text-sm leading-6 text-foreground-muted">
                      Plattformens vy för lokala innovationsprojekt, teamdata och milstolpar. Klart för merge och live-test i staging.
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    { label: 'Moduler', value: '8+' },
                    { label: 'Roller', value: '5' },
                    { label: 'Data', value: 'PocketBase' },
                    { label: 'Hosting', value: 'Coolify / UpCloud' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-3xl border border-default bg-surface/80 p-4 shadow-sm shadow-movexum-svart/5"
                    >
                      <p className="text-sm font-medium text-foreground-subtle">{item.label}</p>
                      <p className="mt-3 text-2xl font-semibold text-foreground">{item.value}</p>
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
