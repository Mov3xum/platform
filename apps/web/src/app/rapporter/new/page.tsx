import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { createReportAndRedirectAction } from '@/lib/actions/reports';

const RECIPIENTS = [
  { value: 'vinnova', label: 'Vinnova' },
  { value: 'tillvaxtverket', label: 'Tillväxtverket' },
  { value: 'region', label: 'Region' },
  { value: 'kommun', label: 'Kommun' },
  { value: 'other', label: 'Annan' }
];

export default async function NewReportPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/rapporter');
  }

  const inputClass =
    'block w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/rapporter" className="text-sm text-foreground-muted hover:text-foreground">
          ← Alla rapporter
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Ny rapport</h1>
        <p className="mt-2 text-sm text-foreground-muted">
          Skapa ett rapportskelett. Du kan generera AI-utkast efter att rapporten är skapad.
        </p>
      </header>

      <form
        action={createReportAndRedirectAction}
        className="space-y-5 rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5"
      >
        <div>
          <label className="block text-sm font-medium text-foreground-muted">Titel</label>
          <input name="title" required className={`mt-1 ${inputClass}`} placeholder="Q2 2026" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-foreground-muted">Mottagare</label>
            <select name="recipient" defaultValue="vinnova" className={`mt-1 ${inputClass}`}>
              {RECIPIENTS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground-muted">Periodetikett</label>
            <input
              name="period_label"
              required
              defaultValue={`Q${Math.floor(new Date().getMonth() / 3) + 1} ${new Date().getFullYear()}`}
              className={`mt-1 ${inputClass}`}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-foreground-muted">Period start</label>
            <input type="date" name="period_start" required defaultValue={today} className={`mt-1 ${inputClass}`} />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground-muted">Period slut</label>
            <input type="date" name="period_end" required defaultValue={today} className={`mt-1 ${inputClass}`} />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
          >
            Skapa rapport
          </button>
        </div>
      </form>
    </main>
  );
}
