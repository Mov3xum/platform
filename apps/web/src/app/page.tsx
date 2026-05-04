export default function Home() {
  return (
    <main className="relative overflow-hidden bg-slate-50">
      <div className="absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top_left,_rgba(17,97,238,0.14),_transparent_35%),linear-gradient(180deg,_rgba(14,116,144,0.08),_transparent_70%)] pointer-events-none" />
      <div className="relative z-10">
        <section className="mx-auto flex min-h-[calc(100vh-80px)] max-w-7xl flex-col justify-center px-6 py-10 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-[1.1fr_minmax(280px,0.9fr)] lg:items-center">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm backdrop-blur">
                <span className="block h-2 w-2 rounded-full bg-cyan-500" />
                Plattformen är live — testa staging-merge direkt
              </div>
              <div className="space-y-6">
                <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
                  Hemmaplan för <span className="text-cyan-600">innovativa startups</span> i Gävleborg
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
                  En modern inkubatorplattform byggd för lokal tillväxt, modulär utveckling och snabb feedback. Körs i Coolify på UpCloud med PocketBase-backend.
                </p>
              </div>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <a
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:bg-slate-800"
                >
                  Öppna dashboard
                </a>
                <a href="/startups" className="inline-flex items-center justify-center rounded-full border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-100">
                  Utforska startups
                </a>
              </div>
            </div>
            <div className="relative isolate overflow-hidden rounded-[2rem] bg-gradient-to-br from-cyan-100 via-slate-50 to-white p-8 shadow-2xl shadow-cyan-200/20 ring-1 ring-slate-200/80">
              <div className="absolute -right-12 top-10 h-40 w-40 rounded-full bg-cyan-200/40 blur-3xl" />
              <div className="absolute left-8 top-24 h-24 w-24 rounded-[2rem] bg-slate-950/5 blur-xl" />
              <div className="relative flex h-full flex-col justify-between gap-6">
                <div className="space-y-4">
                  <p className="text-sm font-semibold uppercase tracking-[0.24em] text-cyan-700">Moveum</p>
                  <div className="space-y-3">
                    <h2 className="text-3xl font-semibold text-slate-950">Startups, mentorskap och genomslag.</h2>
                    <p className="text-sm leading-6 text-slate-600">
                      Plattformens vy för lokala innovationsprojekt, teamdata och milstolpar. Klart för merge och live-test i staging.
                    </p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    { label: "Moduler", value: "8+" },
                    { label: "Roller", value: "5" },
                    { label: "Data", value: "PocketBase" },
                    { label: "Hosting", value: "Coolify / UpCloud" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 shadow-sm shadow-slate-900/5">
                      <p className="text-sm font-medium text-slate-500">{item.label}</p>
                      <p className="mt-3 text-2xl font-semibold text-slate-950">{item.value}</p>
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
