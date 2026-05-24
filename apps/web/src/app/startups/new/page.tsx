import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { createStartupAction } from '@/lib/actions/startups';
import { StartupForm } from '@/components/StartupForm';

export default async function NewStartupPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach'])) {
    redirect('/startups');
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/startups" className="text-sm text-foreground-muted hover:text-foreground">
          ← Tillbaka till alla bolag
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Nytt bolag</h1>
        <p className="mt-2 text-sm text-foreground-muted">
          Registrera ett bolag i {user.tenantName || 'din tenant'}.
        </p>
      </header>

      <div className="rounded-3xl border border-default bg-surface p-8 shadow-sm shadow-movexum-svart/5">
        <StartupForm action={createStartupAction} submitLabel="Skapa bolag" />
      </div>
    </main>
  );
}
