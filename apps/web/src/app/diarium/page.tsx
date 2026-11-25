import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser } from '@/lib/rbac';
import { PageShell } from '@/components/PageShell';
import { Notice } from '@/components/register/ui';
import { canManageRegister, canRegisterManually, summarizeAudit } from '@platform/shared';
import { listDisclosures, listRegisterEntries, loadArchiveWorkspace, loadRecordPlan, loadRegisterAudit } from '@/lib/register/data';
import { REGISTER_VIEWS, parseRegisterView, registerViewHref } from './views';
import { RegisterList } from './RegisterList';
import { PlanEditor } from './PlanEditor';
import { ArchiveView } from './ArchiveView';
import { DisclosureLog } from './DisclosureLog';
import { AuditView } from './AuditView';

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '');

/**
 * Diarium & arkiv (CLAUDE.md § 60). Läser med användarens token (RLS:
 * Movexum-personal + observer). Roll-flaggorna är UI-kurering — gränsen
 * ligger i skrivlagret.
 */
export default async function DiariumPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'diarium', user.enabledModules)) redirect('/hem');
  const sp = await searchParams;
  const view = parseRegisterView(one(sp.vy));
  const pb = await getServerPb();
  const canManage = canManageRegister(user.roles);
  const plan = await loadRecordPlan(pb, user.tenant);
  const registerable = plan.types.filter((t) => t.active && t.handling === 'register');

  let body: React.ReactNode = null;
  let meta: React.ReactNode = null;

  if (view === 'diarium') {
    const filter = {
      q: one(sp.q),
      year: one(sp.ar),
      type: one(sp.typ),
      direction: one(sp.riktning),
      secrecy: one(sp.sekretess) === '1',
      page: Number(one(sp.sida)) || 1
    };
    const list = await listRegisterEntries(pb, user.tenant, filter);
    meta = <span className="text-sm text-foreground-muted">{list.total} handlingar</span>;
    body = (
      <RegisterList
        entries={list.items}
        total={list.total}
        page={list.page}
        pages={list.pages}
        filter={{ q: filter.q, year: filter.year, type: filter.type, direction: filter.direction, secrecy: filter.secrecy }}
        types={plan.types.map((t) => ({ key: t.key, label: t.label }))}
        registerable={registerable.map((t) => ({ key: t.key, label: t.label, secrecyPossible: t.secrecy_possible, secrecyBasis: t.secrecy_basis }))}
        canRegister={canRegisterManually(user.roles)}
        readError={list.error}
      />
    );
  } else if (view === 'plan') {
    const unconfirmed = plan.types.filter((t) => t.active && !t.confirmed).length;
    meta = <span className="text-sm text-foreground-muted">{plan.types.length} handlingstyper · {unconfirmed} obekräftade</span>;
    body = <PlanEditor types={plan.types} canManage={canManage} />;
  } else if (view === 'forteckning') {
    const archive = await loadArchiveWorkspace(pb, user.tenant, plan.types);
    meta = <span className="text-sm text-foreground-muted">{archive.versions[0] ? `Version ${archive.versions[0].version} fastställd` : 'Ingen version fastställd'}</span>;
    body = <ArchiveView archive={archive} canManage={canManage} />;
  } else if (view === 'utlamnanden') {
    const log = await listDisclosures(pb, user.tenant);
    meta = <span className="text-sm text-foreground-muted">{log.items.length} loggade</span>;
    body = <DisclosureLog items={log.items} canManage={canManage} readError={log.error} />;
  } else {
    const audit = await loadRegisterAudit(pb, user.tenant, plan.types);
    const sum = summarizeAudit(audit.checks);
    meta = <span className="text-sm text-foreground-muted">{sum.ok} i ordning · {sum.warn} varningar · {sum.fail} brister</span>;
    body = <AuditView checks={audit.checks} coverage={audit.coverage} canManage={canManage} readError={audit.error} />;
  }

  return (
    <PageShell
      title="Diarium & arkiv"
      meta={meta}
      tabs={REGISTER_VIEWS.map((v) => ({ id: v.id, label: v.label, href: registerViewHref(v.id) }))}
      activeTabId={view}
    >
      <div className="space-y-5">
        {plan.error && <Notice tone="bad">{plan.error}</Notice>}
        {body}
      </div>
    </PageShell>
  );
}
