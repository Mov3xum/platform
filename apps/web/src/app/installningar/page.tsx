import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import { Chip } from '@/components/proto';
import { coreModules } from '@platform/shared';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailItem, RailStat, RailNote } from '@/components/PageRail';
import { AdminToggles, type ModuleToggleItem } from './AdminToggles';
import { UserModuleToggles } from './UserModuleToggles';
import { TenantLogoUpload } from './TenantLogoUpload';
import { getInfraHealth, healthStateLabel, type HealthState } from '@/lib/health';

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

interface UserRecord {
  id: string;
  email: string;
  display_name?: string;
  roles?: string[];
  tenant?: string;
  disabled_modules?: unknown;
}

function healthIconTone(state: HealthState): 'success' | 'warning' | 'neutral' {
  if (state === 'up') return 'success';
  if (state === 'down' || state === 'unconfigured') return 'warning';
  return 'neutral';
}

export default async function InstallningarPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/chatt');
  }
  const pb = await getServerPb();

  // ── Hämta verklig infra-status ─────────────────────────────────
  const infra = await getInfraHealth();

  // ── Hämta tenants ───────────────────────────────────────────────
  // Admin-användare kan se alla tenants; incubator_lead ser bara den egna.
  const isAdmin = hasRole(user.roles, ['admin']);
  let tenants: TenantRecord[] = [];
  try {
    const filter = isAdmin ? '' : `id = "${user.tenant}"`;
    const res = await pb.collection('tenants').getList<TenantRecord>(1, 50, {
      filter,
      sort: 'name'
    });
    tenants = res.items;
  } catch (error) {
    console.error('[installningar] failed to load tenants', {
      tenant: user.tenant,
      userId: user.id,
      error
    });
  }

  // ── Räkna startups + användare per tenant ─────────────────────
  const rows: TenantRow[] = [];
  for (const t of tenants) {
    let startupCount = 0;
    let userCount = 0;
    try {
      const s = await pb.collection('startups').getList(1, 1, {
        filter: `tenant = "${t.id}"`,
        fields: 'id'
      });
      startupCount = s.totalItems;
    } catch {
      /* ignore */
    }
    try {
      const u = await pb.collection('users').getList(1, 1, {
        filter: `tenant = "${t.id}"`,
        fields: 'id'
      });
      userCount = u.totalItems;
    } catch {
      /* ignore */
    }
    rows.push({ tenant: t, startups: startupCount, users: userCount });
  }

  // ── Modules-list för toggles ─────────────────────────────────
  // Hämta aktuellt sparade disabled_modules för tenanten
  let disabledModules: string[] = [];
  try {
    const tenantRecord = await pb.collection('tenants').getOne<{ disabled_modules?: unknown }>(
      user.tenant
    );
    const raw = tenantRecord.disabled_modules;
    if (Array.isArray(raw)) {
      disabledModules = raw.filter((v): v is string => typeof v === 'string');
    }
  } catch {
    // Om fältet ännu inte finns eller annan fel — visa alla moduler
  }

  // Filtrera bort legacy/dolda moduler som inte ska hanteras manuellt
  const HIDDEN_MODULE_IDS = ['dashboard', 'toolbox', 'onboarding', 'activity_feed', 'partners'];

  const moduleItems: ModuleToggleItem[] = coreModules
    .filter((m) => !HIDDEN_MODULE_IDS.includes(m.id))
    .map((m) => ({
      id: m.id,
      name: m.title,
      description: m.description,
      defaultOn: !disabledModules.includes(m.id)
    }));

  let userModuleRows: Array<{
    id: string;
    name: string;
    email: string;
    roles: string[];
    disabledModules: string[];
  }> = [];

  if (isAdmin) {
    try {
      const usersRes = await pb.collection('users').getList<UserRecord>(1, 200, {
        filter: `tenant = "${user.tenant}"`,
        sort: 'email',
        fields: 'id,email,display_name,roles,disabled_modules,tenant'
      });
      userModuleRows = usersRes.items.map((u) => ({
        id: u.id,
        name: u.display_name?.trim() || u.email,
        email: u.email,
        roles: Array.isArray(u.roles)
          ? u.roles.filter((role): role is string => typeof role === 'string')
          : [],
        disabledModules: Array.isArray(u.disabled_modules)
          ? u.disabled_modules.filter((m): m is string => typeof m === 'string')
          : []
      }));
    } catch (error) {
      console.error('[installningar] failed to load tenant users for module toggles', {
        tenant: user.tenant,
        userId: user.id,
        error
      });
    }
  }

  // ── Härledda värden för rail ─────────────────────────────────
  const totalStartups = rows.reduce((sum, r) => sum + r.startups, 0);
  const totalUsers = rows.reduce((sum, r) => sum + r.users, 0);
  const activeModules = moduleItems.filter((m) => m.defaultOn).length;
  const infraIssues = infra.filter((p) => p.state !== 'up').length;

  const rail = (
    <>
      <RailSection label="Översikt">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Tenants" value={rows.length} />
          <RailStat
            label="Moduler"
            value={activeModules}
            hint={`av ${moduleItems.length} aktiva`}
          />
          <RailStat label="Användare" value={totalUsers} />
          <RailStat label="Bolag" value={totalStartups} />
        </div>
      </RailSection>

      <RailSection label="Infra-status">
        {infra.map((p) => (
          <RailItem
            key={p.name}
            icon={p.state === 'up' ? 'shield' : 'alert'}
            iconTone={healthIconTone(p.state)}
            title={p.name}
            meta={p.detail ? `${healthStateLabel(p.state)} · ${p.detail}` : healthStateLabel(p.state)}
          />
        ))}
        {infraIssues === 0 && (
          <RailNote>Alla tjänster i drift inom EU.</RailNote>
        )}
      </RailSection>

      <RailSection label="Dataresidens">
        <RailItem
          icon="globe"
          iconTone="success"
          title="EU-only"
          meta="UpCloud Stockholm · Helsingfors backup"
        />
        <RailItem
          icon="link"
          iconTone="neutral"
          title="Audit-log"
          meta="Granskningsbart per tenant"
          href="/aktivitet"
        />
      </RailSection>
    </>
  );

  return (
    <PageShell title="Inställningar" rightPanel={rail}>
      <div className="space-y-6 py-6">
        {/* ── Logotyp ──────────────────────────────────────────── */}
        <section className="rounded-2xl border border-default bg-surface p-5">
          <div className="mb-4">
            <h2 className="font-heading text-[15px] font-semibold text-foreground">
              Logotyp
            </h2>
            <p className="text-[12.5px] text-foreground-muted">
              Ladda upp din logotyp för light och dark mode.
            </p>
          </div>
          <TenantLogoUpload
            logoLightUrl={user.tenantLogoLightUrl}
            logoDarkUrl={user.tenantLogoDarkUrl}
          />
        </section>

        {/* ── Moduler ──────────────────────────────────────────── */}
        <section className="rounded-2xl border border-default bg-surface p-5">
          <div className="mb-4">
            <h2 className="font-heading text-[15px] font-semibold text-foreground">
              Moduler
            </h2>
            <p className="text-[12.5px] text-foreground-muted">
              Aktivera per tenant.
            </p>
          </div>
          <AdminToggles modules={moduleItems} />
        </section>

        {isAdmin && (
          <section className="rounded-2xl border border-default bg-surface p-5">
            <div className="mb-4">
              <h2 className="font-heading text-[15px] font-semibold text-foreground">
                Användarspecifika moduler
              </h2>
              <p className="text-[12.5px] text-foreground-muted">
                Admin kan toggla per användare.
              </p>
            </div>
            {userModuleRows.length > 0 ? (
              <UserModuleToggles users={userModuleRows} modules={moduleItems} />
            ) : (
              <div className="rounded-xl border border-default bg-canvas-subtle p-4 text-[13px] text-foreground-muted">
                Inga användare hittades för din tenant.
              </div>
            )}
          </section>
        )}

        {/* ── Tenants ──────────────────────────────────────────── */}
        <section className="rounded-2xl border border-default bg-surface">
          <div className="flex items-center justify-between border-b border-default px-5 py-4">
            <div>
              <h2 className="font-heading text-[15px] font-semibold text-foreground">
                Tenants
              </h2>
              <p className="text-[12.5px] text-foreground-muted">
                {rows.length} {rows.length === 1 ? 'tenant' : 'tenants'}
              </p>
            </div>
          </div>
          <div className="overflow-hidden rounded-b-2xl">
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
                    <td
                      colSpan={5}
                      className="px-5 py-6 text-[13px] text-foreground-muted"
                    >
                      Inga tenants hittades.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.tenant.id} className="border-b border-default last:border-b-0">
                      <td className="px-5 py-3 font-semibold text-foreground">
                        {r.tenant.name}
                      </td>
                      <td className="px-5 py-3 font-mono text-[11px] text-foreground-subtle">
                        {r.tenant.region || r.tenant.slug}
                      </td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums text-foreground">
                        {r.startups}
                      </td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums text-foreground">
                        {r.users}
                      </td>
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
      </div>
    </PageShell>
  );
}
