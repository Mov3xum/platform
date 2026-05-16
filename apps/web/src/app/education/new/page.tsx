import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { WorkshopCreateForm } from '../WorkshopCreateForm';

export default async function NewWorkshopPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'education', user.disabledModules)) redirect('/dashboard');
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) {
    redirect('/education');
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <Link href="/education" className="text-sm text-foreground-muted hover:text-foreground">
          ← Till utbildning
        </Link>
      </div>
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Ny workshop</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Definiera mål, block, AI-systemprompt och outputkrav.
        </p>
      </header>
      <WorkshopCreateForm />
    </main>
  );
}
