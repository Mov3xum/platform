import type { Metadata } from 'next';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import type { Role } from '@platform/shared';
import { LOGOUT_PATH } from '@/lib/auth-paths';
import { PageShell } from '@/components/PageShell';
import { loadMyCompetenceProfile } from '@/lib/team/my-competence-profile.server';
import { MinProfilForm } from '@/app/min-profil/MinProfilForm';
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

// Mitt konto — inloggningsuppgifter, lösenord och (för Movexum-personal) den
// egna KOMPETENSPROFILEN som teammatchningen läser (§ 29.7). Sidan använder
// hela innehållsbredden på desktop: kontouppgifter och lösenord sida vid sida,
// kompetensprofilen i två kolumner under. Kompetensprofilen visas med samma
// UI-kurering som "Min profil" i sidmenyn och delar formulär + läsväg med den.
//
// Movexum-personal (de som kan ingå i tvärfunktionella team) ser ALLTID
// kompetensprofilen här, oavsett vilka moduler som är ibockade i sidmenyn:
// ett konto vars sparade modullista saknar `min_profil` (migration 1700000180
// körs först när PB-imagen byggs om) dolde annars sektionen helt (2026-10).
const TEAM_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'mentor'];

export default async function KontoPage() {
  const user = await requireUser();
  const showCompetence =
    hasRole(user.roles, TEAM_ROLES) || canAccessModuleForUser(user.roles, 'min_profil', user.enabledModules);
  const pb = await getServerPb();
  const competence = showCompetence ? await loadMyCompetenceProfile(pb, user) : null;

  // Kopplade bolag med namn (användarens token → RLS § 21; fail-soft).
  let linkedStartups: Array<{ id: string; name: string }> = [];
  const linkedIds = user.linkedStartups.filter((id) => /^[a-zA-Z0-9_-]{1,64}$/.test(id)).slice(0, 6);
  if (linkedIds.length > 0) {
    try {
      const res = await pb.collection('startups').getList<{ id: string; name?: string }>(1, linkedIds.length, {
        filter: linkedIds.map((id) => pb.filter('id = {:id}', { id })).join(' || '),
        fields: 'id,name'
      });
      linkedStartups = res.items.map((r) => ({ id: r.id, name: r.name || 'Bolag' }));
    } catch {
      linkedStartups = linkedIds.map((id) => ({ id, name: 'Bolagskortet' }));
    }
  }

  return (
    <PageShell
      title="Mitt konto"
      actions={
        showCompetence ? (
          <a
            href="#kompetensprofil"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-semibold text-brand-foreground transition hover:bg-brand-hover"
          >
            Kompetenser &amp; hashtags
          </a>
        ) : undefined
      }
    >
      <div className="w-full space-y-8 py-6">
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-6">
            <ProfileForm name={user.name} email={user.email} avatarUrl={user.avatarUrl} />
            <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
              <h2 className="text-base font-semibold text-foreground">Konto</h2>
              <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-foreground-subtle">Roller</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {user.roles.length === 0 ? (
                      <span className="text-foreground-muted">Inga roller</span>
                    ) : (
                      user.roles.map((r) => (
                        <span
                          key={r}
                          className="rounded-full bg-canvas-muted px-2.5 py-0.5 text-[12px] font-medium text-foreground-muted"
                        >
                          {roleLabels[r] || r}
                        </span>
                      ))
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-foreground-subtle">Organisation</dt>
                  <dd className="mt-1 font-medium text-foreground">{user.tenantName || 'Movexum'}</dd>
                </div>
                {linkedStartups.length > 0 && (
                  <div>
                    <dt className="text-foreground-subtle">Kopplade bolag</dt>
                    <dd className="mt-1 flex flex-col gap-0.5">
                      {linkedStartups.map((s) => (
                        <Link key={s.id} href={`/startups/${s.id}`} className="text-link hover:underline">
                          {s.name}
                        </Link>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <PasswordForm />
            <section className="rounded-3xl border border-default bg-surface p-6 shadow-sm shadow-movexum-svart/5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-foreground">Logga ut</h2>
                  <p className="mt-1 text-sm text-foreground-muted">
                    Inloggad som <span className="font-medium text-foreground">{user.email}</span>
                  </p>
                </div>
                <form method="post" action={LOGOUT_PATH}>
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
        </div>

        {competence && (
          <section id="kompetensprofil" aria-labelledby="kompetensprofil-rubrik" className="scroll-mt-6">
            <div className="mb-4 border-t border-default pt-6">
              <h2 id="kompetensprofil-rubrik" className="font-heading text-xl font-semibold text-foreground">
                Kompetensprofil
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-foreground-muted">
                Dina kompetens-hashtags med nivå, vad du vill utvecklas inom och hur många team du
                redan ingår i. Det är det här som används när tvärfunktionella team sätts ihop — håll
                det aktuellt så att du föreslås till rätt team. Max {competence.teamCap} pågående
                team per person.
              </p>
            </div>
            <MinProfilForm
              initialTitle={competence.title}
              initialBio={competence.bio}
              initialTags={competence.tags}
              initialDevelopmentInterests={competence.developmentInterests}
              vocabulary={competence.vocabulary}
              load={competence.load}
              competenceUpdatedAt={competence.competenceUpdatedAt}
              teamCap={competence.teamCap}
              wide
            />
          </section>
        )}
      </div>
    </PageShell>
  );
}
