import type { Metadata } from 'next';
import { LogOut } from 'lucide-react';
import { requireUser } from '@/lib/auth.server';
import { logoutAction } from '@/lib/actions/auth';
import { ProfileForm, PasswordForm } from './AccountForms';

export const metadata: Metadata = {
  title: 'Mitt konto · Movexum'
};

export default async function KontoPage() {
  const user = await requireUser();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10 lg:px-8">
      <header className="mb-8">
        <p className="text-sm font-medium text-link">Inställningar</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">Mitt konto</h1>
        <p className="mt-2 text-base text-foreground-muted">
          Hantera din profil, profilbild och lösenord.
        </p>
      </header>

      <div className="space-y-6">
        <ProfileForm
          name={user.name}
          email={user.email}
          avatarUrl={user.avatarUrl}
        />

        <PasswordForm />

        {/* Logout section */}
        <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Logga ut</h2>
              <p className="mt-1 text-sm text-foreground-muted">
                Du är inloggad som <span className="font-medium text-foreground">{user.email}</span>
              </p>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-full border border-default bg-surface px-5 py-2.5 text-sm font-medium text-foreground-muted transition hover:border-movexum-morkorange hover:bg-movexum-pastell-orange hover:text-movexum-morkorange"
              >
                <LogOut className="h-4 w-4" />
                Logga ut
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
