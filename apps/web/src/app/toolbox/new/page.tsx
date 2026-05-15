import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { ToolForm } from '../ToolForm';

export default async function NewToolPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) redirect('/toolbox');
  const canEditPrompt = hasRole(user.roles, ['admin']);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-8">
      <div className="mb-6">
        <a href="/toolbox" className="text-sm text-foreground-muted hover:text-foreground">
          ← Verktygslådan
        </a>
      </div>
      <h1 className="mb-8 text-3xl font-semibold tracking-tight text-foreground">Nytt verktyg</h1>
      {!canEditPrompt && (
        <div className="mb-6 rounded-2xl border border-default bg-movexum-pastell-lila p-4 text-sm text-movexum-morklila dark:bg-movexum-morklila/20 dark:text-movexum-ljuslila">
          <strong>OBS:</strong> Endast admin kan sätta systemprompten. Du kan skapa verktyget — men
          prompten lämnas tom och måste fyllas i av en admin innan agenten kan köras.
        </div>
      )}
      <ToolForm mode="create" canEditPrompt={canEditPrompt} />
    </main>
  );
}
