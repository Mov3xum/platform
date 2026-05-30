import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { canAccessModuleForUser, hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { PageShell } from '@/components/PageShell';
import { Icon } from '@/components/proto/Icon';
import {
  SAMLAT_TAK_EUR,
  samladSumma,
  warningLevel,
  type DeMinimisStod,
  type DeMinimisStodCalc,
  type WarningLevel
} from '@platform/shared';

export const dynamic = 'force-dynamic';

const chipClass: Record<WarningLevel, string> = {
  ok: 'bg-movexum-pastell-gron text-movexum-morkgron dark:bg-movexum-morkgron/40 dark:text-movexum-pastell-gron',
  warn: 'bg-movexum-pastell-gul text-movexum-morkgul dark:bg-movexum-morkgul/40 dark:text-movexum-pastell-gul',
  critical: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange',
  over: 'bg-movexum-pastell-orange text-movexum-morkorange dark:bg-movexum-morkorange/40 dark:text-movexum-pastell-orange'
};

function eur(n: number): string {
  return `${Math.round(n).toLocaleString('sv-SE')} EUR`;
}

interface StartupRow {
  id: string;
  name: string;
  status?: string;
}

export default async function DeMinimisIndexPage() {
  const user = await requireUser();
  if (!canAccessModuleForUser(user.roles, 'de_minimis', user.disabledModules)) redirect('/chatt');

  const pb = await getServerPb();
  const isStaffOrObserver = hasRole(user.roles, [
    'admin',
    'incubator_lead',
    'coach',
    'mentor',
    'observer'
  ]);
  const isMemberOnly = !isStaffOrObserver && hasRole(user.roles, ['startup_member']);

  let startups: StartupRow[] = [];
  try {
    let filter = `tenant = "${user.tenant}"`;
    if (isMemberOnly) {
      if (user.linkedStartups.length === 0) {
        return (
          <PageShell title="De minimis">
            <div className="rounded-2xl border border-dashed border-default p-12 text-center text-[13px] text-foreground-muted">
              Du är inte kopplad till något bolag ännu.
            </div>
          </PageShell>
        );
      }
      filter += ` && (${user.linkedStartups.map((id) => `id = "${id}"`).join(' || ')})`;
    }
    startups = (
      await pb.collection('startups').getList<StartupRow>(1, 300, {
        filter,
        sort: 'name',
        fields: 'id,name,status'
      })
    ).items;
  } catch (error) {
    console.error('[de-minimis] failed to load startups', { tenant: user.tenant, error });
  }

  // Aggregera samlad summa per bolag (rullande 3 år).
  const byStartup = new Map<string, DeMinimisStodCalc[]>();
  try {
    const allStod = await pb
      .collection(PB_COLLECTIONS.deMinimisStod)
      .getFullList<DeMinimisStod>({ filter: `tenant = "${user.tenant}"` });
    for (const s of allStod) {
      const key = String(s.startup);
      if (!byStartup.has(key)) byStartup.set(key, []);
      byStartup.get(key)!.push({
        forordning: s.forordning,
        belopp_eur: s.belopp_eur,
        beslutsdatum: s.beslutsdatum
      });
    }
  } catch (error) {
    console.error('[de-minimis] failed to load stöd', { tenant: user.tenant, error });
  }

  const now = new Date();

  return (
    <PageShell title="De minimis">
      <div className="space-y-6 py-6">
        <div className="rounded-2xl border border-default bg-canvas-subtle p-4 text-[13px] text-foreground-muted">
          <p className="font-medium text-foreground">Stöd av mindre betydelse (de minimis)</p>
          <p className="mt-1">
            Håll koll på varje bolags rullande treårssumma mot takbeloppen och generera en
            försäkran inför ny stödansökan. Det finns ingen central uppslagstjänst — ansvaret
            ligger på företaget. Detta är ett internt stödverktyg; slutlig prövning görs av
            stödgivaren.
          </p>
        </div>

        {startups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-default p-12 text-center text-[13px] text-foreground-muted">
            Inga bolag att visa.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {startups.map((s) => {
              const rows = byStartup.get(s.id) ?? [];
              const used = samladSumma(rows, now);
              const level = warningLevel(used, SAMLAT_TAK_EUR);
              return (
                <Link
                  key={s.id}
                  href={`/de-minimis/${s.id}`}
                  className="group flex flex-col gap-3 rounded-2xl border border-default bg-surface p-5 shadow-sm shadow-movexum-svart/5 transition hover:border-strong hover:bg-canvas-subtle"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-canvas-muted text-foreground-subtle">
                      <Icon name="shield" size={20} />
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${chipClass[level]}`}
                    >
                      {eur(used)}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-foreground group-hover:text-brand">
                      {s.name}
                    </h3>
                    <p className="mt-0.5 text-xs text-foreground-subtle">
                      Samlat av {eur(SAMLAT_TAK_EUR)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
