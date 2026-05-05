export default function EducationPage() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-10 lg:px-8">
      <header className="mb-8">
        <p className="text-sm font-medium text-link">Utbildning</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
          Utbildningsplattform
        </h1>
        <p className="mt-2 text-base text-foreground-muted">
          Moduler för finansiering, hållbarhet, internationalisering och teamutveckling.
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <article className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
          <h2 className="text-lg font-semibold text-foreground">Finansiering</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            Kurser, checklistor och verktyg för kapital, pitch och investerarrelationer.
          </p>
        </article>
        <article className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
          <h2 className="text-lg font-semibold text-foreground">Hållbarhet</h2>
          <p className="mt-2 text-sm text-foreground-muted">
            Innehåll som hjälper startupbolag att bygga långsiktig hållbarhet i kärnverksamheten.
          </p>
        </article>
      </div>
    </main>
  );
}
