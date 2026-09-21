import { getServerPb } from '@/lib/auth.server';
import { escFilter } from '@/lib/pb-filter';
import { hasRole } from '@/lib/rbac';
import { Chip } from '@/components/proto';
import { Icon } from '@/components/proto/Icon';
import { getInfraHealth, healthChipVariant, healthStateLabel } from '@/lib/health';
import { requireSettingsUser, SettingsSectionPage } from '../shared';

export const dynamic = 'force-dynamic';

interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  region?: string;
  status?: string;
}

interface TenantRow {
  tenant: TenantRecord;
  startups: number;
  users: number;
}

export default async function OrganisationPage() {
  const user = await requireSettingsUser();
  const pb = await getServerPb();
  const isAdmin = hasRole(user.roles, ['admin']);
  const infra = await getInfraHealth();

  // Admin ser alla tenants; incubator_lead bara den egna.
  let tenants: TenantRecord[] = [];
  try {
    const filter = isAdmin ? '' : `id = "${escFilter(user.tenant)}"`;
    const res = await pb.collection('tenants').getList<TenantRecord>(1, 50, { filter, sort: 'name' });
    tenants = res.items;
  } catch (error) {
    console.error('[installningar/organisation] failed to load tenants', {
      tenant: user.tenant,
      userId: user.id,
      error
    });
  }

  const rows: TenantRow[] = [];
  for (const t of tenants) {
    let startups = 0;
    let users = 0;
    try {
      const s = await pb.collection('startups').getList(1, 1, {
        filter: `tenant = "${escFilter(t.id)}"`,
        fields: 'id'
      });
      startups = s.totalItems;
    } catch {
      /* ignore */
    }
    try {
      const u = await pb.collection('users').getList(1, 1, {
        filter: `tenant = "${escFilter(t.id)}"`,
        fields: 'id'
      });
      users = u.totalItems;
    } catch {
      /* ignore */
    }
    rows.push({ tenant: t, startups, users });
  }

  const infraIssues = infra.filter((p) => p.state !== 'up').length;

  return (
    <SettingsSectionPage
      slug="organisation"
      roles={user.roles}
      intro="Tenants i plattformen, aktuell driftstatus för infrastrukturen och var datan bor. All drift sker inom EU (UpCloud Stockholm, backup Helsingfors)."
    >
      {/* ── Tenants ─────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-default bg-surface">
        <div className="flex items-center justify-between border-b border-default px-5 py-4">
          <div>
            <h3 className="font-heading text-[15px] font-semibold text-foreground">Tenants</h3>
            <p className="text-[12.5px] text-foreground-muted">
              {rows.length} {rows.length === 1 ? 'tenant' : 'tenants'}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-b-2xl">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-default bg-canvas-subtle text-[11px] uppercase tracking-[0.12em] text-foreground-subtle">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Tenant</th>
                <th className="px-5 py-2.5 font-semibold">Region</th>
                <th className="px-5 py-2.5 text-right font-semibold">Bolag</th>
                <th className="px-5 py-2.5 text-right font-semibold">Användare</th>
                <th className="px-5 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-[13px] text-foreground-muted">
                    Inga tenants hittades.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.tenant.id} className="border-b border-default last:border-b-0">
                    <td className="px-5 py-3 font-semibold text-foreground">{r.tenant.name}</td>
                    <td className="px-5 py-3 text-[11px] text-foreground-subtle">
                      {r.tenant.region || r.tenant.slug}
                    </td>
                    <td className="px-5 py-3 text-right mx-tnum text-foreground">{r.startups}</td>
                    <td className="px-5 py-3 text-right mx-tnum text-foreground">{r.users}</td>
                    <td className="px-5 py-3">
                      <Chip variant="active" mono>
                        {r.tenant.status || 'Drift'}
                      </Chip>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Infra + dataresidens ────────────────────────────────── */}
      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-2xl border border-default bg-surface p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-heading text-[15px] font-semibold text-foreground">Infra-status</h3>
            <Chip variant={infraIssues === 0 ? 'active' : 'yellow'} mono>
              {infraIssues === 0 ? 'Alla i drift' : `${infraIssues} avvikelse${infraIssues === 1 ? '' : 'r'}`}
            </Chip>
          </div>
          <ul className="divide-y divide-default">
            {infra.map((p) => (
              <li key={p.name} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-foreground">{p.name}</div>
                  {p.detail && (
                    <div className="truncate text-[11.5px] text-foreground-subtle">{p.detail}</div>
                  )}
                </div>
                <Chip variant={healthChipVariant(p.state)} mono>
                  {healthStateLabel(p.state)}
                </Chip>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-default bg-surface p-5">
          <h3 className="mb-3 font-heading text-[15px] font-semibold text-foreground">Dataresidens</h3>
          <ul className="space-y-3 text-[13px]">
            <li className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-movexum-pastell-gron text-movexum-morkgron dark:bg-[#152916] dark:text-[#88b48b]">
                <Icon name="globe" size={14} />
              </span>
              <div>
                <div className="font-medium text-foreground">EU-only</div>
                <div className="text-[12px] text-foreground-subtle">
                  UpCloud Stockholm · Helsingfors backup. AI via Mistral (Frankrike).
                </div>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-canvas-muted text-foreground-muted">
                <Icon name="shield" size={14} />
              </span>
              <div>
                <div className="font-medium text-foreground">Audit-logg</div>
                <div className="text-[12px] text-foreground-subtle">
                  Alla ändringar är granskningsbara per tenant i{' '}
                  <a href="/aktivitet?kind=log" className="text-link underline">
                    aktivitetsloggen
                  </a>
                  .
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </SettingsSectionPage>
  );
}
