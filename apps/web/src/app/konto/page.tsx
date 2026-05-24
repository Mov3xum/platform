import type { Metadata } from 'next';
import { LogOut } from 'lucide-react';
import { requireUser } from '@/lib/auth.server';
import { logoutAction } from '@/lib/actions/auth';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem, RailEmpty } from '@/components/PageRail';
import { ProfileForm, PasswordForm } from './AccountForms';

export const metadata: Metadata = {
  title: 'Mitt konto · Movexum'
};

const roleLabels: Record<string, string> = {
  admin: 'Administratör',
  incubator_lead: 'Inkubatorledning',
  coach: 'Coach',
  mentor: 'Mentor',
  startup_member: 'Founder',
  observer: 'Observatör',
  partner: 'Partner'
};

export default async function KontoPage() {
  const user = await requireUser();

  const rail = (
    <>
      <RailSection label="Roller">
        {user.roles.length === 0 ? (
          <RailEmpty>Inga roller tilldelade.</RailEmpty>
        ) : (
          user.roles.map((r) => (
            <RailItem key={r} icon="people" iconTone="brand" title={roleLabels[r] || r} />
          ))
        )}
      </RailSection>

      {user.linkedStartups.length > 0 && (
        <RailSection label="Kopplade bolag">
          {user.linkedStartups.slice(0, 6).map((id) => (
            <RailItem
              key={id}
              icon="target"
              iconTone="accent"
              title={id}
              href={`/startups/${id}`}
            />
          ))}
        </RailSection>
      )}

      <RailSection label="Tenant">
        <RailItem icon="globe" title={user.tenantName || user.tenant} meta="Aktiv tenant" />
      </RailSection>
    </>
  );

  return (
    <PageShell title="Mitt konto" rightPanel={rail}>
      <div className="mx-auto w-full max-w-2xl space-y-6 py-6">
        <ProfileForm name={user.name} email={user.email} avatarUrl={user.avatarUrl} />
        <PasswordForm />

        <section className="rounded-2xl border border-default bg-surface p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Logga ut</h2>
              <p className="mt-1 text-sm text-foreground-muted">
                Inloggad som <span className="font-medium text-foreground">{user.email}</span>
              </p>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-lg border border-default bg-surface px-4 py-2 text-sm font-medium text-foreground-muted transition hover:border-strong hover:bg-canvas-muted hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
                Logga ut
              </button>
            </form>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
