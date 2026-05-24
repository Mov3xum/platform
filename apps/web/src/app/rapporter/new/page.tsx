import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  createReportAction,
  type ReportActionState
} from '@/lib/actions/reports';
import { ReportCreateForm } from '@/components/ReportCreateForm';
import type { ReportRecipient } from '@platform/shared';

async function createReportAndRedirect(
  _prev: ReportActionState,
  formData: FormData
): Promise<ReportActionState> {
  'use server';
  const recipient = String(formData.get('recipient') || 'vinnova') as ReportRecipient;
  const result = await createReportAction({
    title: String(formData.get('title') || ''),
    recipient,
    period_label: String(formData.get('period_label') || ''),
    period_start: String(
      formData.get('period_start') || new Date().toISOString().slice(0, 10)
    ),
    period_end: String(formData.get('period_end') || new Date().toISOString().slice(0, 10)),
    accent:
      recipient === 'tillvaxtverket' ? 'copper' : recipient === 'region' ? 'green' : 'brown'
  });
  if (result.reportId) {
    redirect(`/rapporter/${result.reportId}`);
  }
  return result;
}

export default async function NewReportPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/rapporter');
  }

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

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <ReportCreateForm action={createReportAndRedirect} submitLabel="Skapa rapport" />
      </div>
    </main>
  );
}
