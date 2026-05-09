import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { ToolForm } from '../ToolForm';

export default async function NewToolPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) redirect('/toolbox');

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <a href="/toolbox" className="text-sm text-foreground-muted hover:text-foreground">
          ← Verktygslådan
        </a>
      </div>
      <h1 className="mb-8 text-3xl font-semibold tracking-tight text-foreground">Nytt verktyg</h1>
      <ToolForm mode="create" />
    </main>
  );
}
