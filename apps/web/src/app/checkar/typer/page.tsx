import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto';
import { listApplications, listCheckTypes } from '@/lib/support-checks/data';
import { listFundingProjects } from '@/lib/funding/data';
import { SUPPORT_CHECK_KIND_LABELS, type Role } from '@platform/shared';
import { BackLink, BasisChip, ExcellenceChip, btnGhost, btnPrimary, fmtSek } from '../ui';

export const dynamic = 'force-dynamic';

const LEAD_ROLES: Role[] = ['admin', 'incubator_lead'];

export default async function CheckTyperPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'checkar', user.enabledModules)) redirect('/hem');
  const canManage = hasRole(user.roles, LEAD_ROLES);
  const pb = await getServerPb();
  const [types, apps, projects] = await Promise.all([listCheckTypes(pb, user.tenant), listApplications(pb, user.tenant), listFundingProjects(pb, user.tenant)]);
  const projectName = new Map(projects.map((p) => [p.id, p.title]));

  return (
    <PageShell
      title="Checktyper"
      meta={<BackLink href="/checkar" label="Stödcheckar" />}
      actions={
        canManage ? (
          <Link href="/checkar/typer/ny" className={btnPrimary}>
            <Icon name="plus" size={13} /> Ny checktyp
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-foreground-muted">
          En checktyp beskriver vad bolagen kan söka (excellenscheck, resecheck, AI-verktygscheck …), tak per check, behörighetskrav, bedömningskriterier och vilket projekt/arbetspaket den som default belastar. {!canManage && 'Bara admin/incubator_lead kan ändra.'}
        </p>
        {types.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-sm text-foreground-muted">Inga checktyper än.</div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {types.map((t) => {
              const count = apps.filter((a) => a.check_type === t.id).length;
              return (
                <li key={t.id} className={`rounded-3xl border border-default bg-surface p-5 ${t.active === false ? 'opacity-70' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-foreground">{t.title}</h2>
                    <span className="text-xs text-foreground-subtle">{SUPPORT_CHECK_KIND_LABELS[t.kind]}</span>
                    {t.is_excellence_activity && <ExcellenceChip />}
                    {t.active === false && <span className="rounded-full bg-canvas-muted px-2 py-0.5 text-[11px] font-semibold text-foreground-muted">Stängd</span>}
                    <span className="flex-1" />
                    {canManage && (
                      <Link href={`/checkar/typer/${t.id}`} className={btnGhost}>
                        <Icon name="pencil" size={12} /> Redigera
                      </Link>
                    )}
                  </div>
                  {t.description && <p className="mt-2 line-clamp-3 text-sm text-foreground-muted">{t.description}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-foreground-subtle">
                    <span>Max {t.max_amount_sek ? fmtSek(t.max_amount_sek) : '–'}</span>
                    <span>· {count} ansökningar</span>
                    {t.funding_project && <span>· {projectName.get(t.funding_project) ?? 'Projekt'}</span>}
                    <BasisChip basis={t.default_state_aid_basis} />
                    {t.min_irl_level ? <span>· IRL ≥ {t.min_irl_level}</span> : null}
                  </div>
                  <div className="mt-3">
                    <Link href={`/checkar/ny?typ=${t.id}`} className="text-xs text-link hover:underline">
                      Skapa ansökan för ett bolag →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
