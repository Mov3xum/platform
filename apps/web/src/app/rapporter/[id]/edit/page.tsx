import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  updateReportFormAction,
  deleteReportFormAction
} from '@/lib/actions/reports';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { IncubatorReport } from '@platform/shared';

export default async function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect(`/rapporter/${id}`);
  }

  const pb = await getServerPb();
  let report: IncubatorReport;
  try {
    report = await pb.collection(PB_COLLECTIONS.reports).getOne<IncubatorReport>(id);
  } catch {
    notFound();
  }
  if (report.tenant !== user.tenant) redirect('/rapporter');

  const inputClass =
    'block w-full rounded-xl border border-default bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-movexum-pastell-lila dark:focus:ring-movexum-morklila';

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href={`/rapporter/${id}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← Tillbaka till {report.title}
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Redigera rapport</h1>
      </header>

      <form
        action={updateReportFormAction}
        className="space-y-5 rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5"
      >
        <input type="hidden" name="report_id" value={id} />

        <div>
          <label className="block text-sm font-medium text-foreground-muted">Titel</label>
          <input name="title" required defaultValue={report.title} className={`mt-1 ${inputClass}`} />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground-muted">Periodetikett</label>
          <input
            name="period_label"
            required
            defaultValue={report.period_label}
            className={`mt-1 ${inputClass}`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-foreground-muted">Period start</label>
            <input
              type="date"
              name="period_start"
              required
              defaultValue={report.period_start?.slice(0, 10) ?? ''}
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground-muted">Period slut</label>
            <input
              type="date"
              name="period_end"
              required
              defaultValue={report.period_end?.slice(0, 10) ?? ''}
              className={`mt-1 ${inputClass}`}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground-muted">Deadline</label>
          <input
            type="date"
            name="due_date"
            defaultValue={report.due_date?.slice(0, 10) ?? ''}
            className={`mt-1 ${inputClass}`}
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
          >
            Spara ändringar
          </button>
        </div>
      </form>

      <div className="mt-8 rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
        <h2 className="text-base font-semibold text-foreground">Farozon</h2>
        <p className="mt-1 text-sm text-foreground-muted">Raderar rapporten permanent.</p>
        <div className="mt-4">
          <ConfirmDeleteButton
            action={deleteReportFormAction}
            hiddenField={{ name: 'report_id', value: id }}
            label="Radera rapport"
            description={`Du raderar "${report.title}". Detta går inte att ångra.`}
          />
        </div>
      </div>
    </main>
  );
}
