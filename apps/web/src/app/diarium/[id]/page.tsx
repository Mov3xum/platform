import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Chip } from '@/components/register/ui';
import { REGISTER_SOURCE_LABELS, canManageRegister, canRegisterManually, isRegisterSource, registerSourceHref } from '@platform/shared';
import { loadRecordPlan, loadRegisterCase } from '@/lib/register/data';
import { CaseWorkspace } from './CaseWorkspace';
import { CrumbLabels } from '@/components/proto/CrumbLabels';

export const dynamic = 'force-dynamic';

/** Ett ärende i diariet (CLAUDE.md § 60): handlingarna i nummerordning med åtgärder. */
export default async function RegisterCasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'diarium', user.enabledModules)) redirect('/hem');
  const { id } = await params;
  const pb = await getServerPb();
  const data = await loadRegisterCase(pb, user.tenant, id);
  if (!data) notFound();
  const plan = await loadRecordPlan(pb, user.tenant);
  const c = data.case;
  const sourceHref = c.sourceId ? registerSourceHref(c.sourceCollection, c.sourceId, c.startupId || null) : null;

  return (
    <PageShell
      title={`${c.number} · ${c.title}`}
      meta={
        <span className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
          <Chip tone={c.status === 'closed' ? 'neutral' : 'info'}>{c.status === 'closed' ? 'Avslutat' : 'Pågående'}</Chip>
          {c.process && <span>{c.process}</span>}
          {c.counterpart && <span>· {c.counterpart}</span>}
        </span>
      }
      actions={
        <div className="flex items-center gap-3 text-sm">
          {sourceHref && (
            <Link href={sourceHref} className="text-link hover:underline">
              Öppna i {isRegisterSource(c.sourceCollection) ? REGISTER_SOURCE_LABELS[c.sourceCollection] : 'källan'}
            </Link>
          )}
          <Link href="/diarium" className="text-link hover:underline">
            Till diariet
          </Link>
        </div>
      }
    >
      <CrumbLabels labels={{ [`/diarium/${c.id}`]: c.number }} />
      <CaseWorkspace
        registerCase={c}
        entries={data.entries}
        disclosures={data.disclosures}
        registerable={plan.types
          .filter((t) => t.active && t.handling === 'register')
          .map((t) => ({ key: t.key, label: t.label, secrecyPossible: t.secrecy_possible, secrecyBasis: t.secrecy_basis }))}
        canManage={canManageRegister(user.roles)}
        canRegister={canRegisterManually(user.roles)}
      />
    </PageShell>
  );
}
