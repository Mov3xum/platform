import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import { PageHead, Card, Chip, SectionHead, Icon } from '@/components/proto';
import { coreModules } from '@platform/shared';
import { AdminToggles, type ModuleToggleItem } from './AdminToggles';
import { UserModuleToggles } from './UserModuleToggles';

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

interface InfraCard {
  name: string;
  sub: string;
  state: string;
  accent: 'cyan' | 'green' | 'purple' | 'brown';
}

const INFRA: InfraCard[] = [
  {
    name: 'UpCloud',
    sub: 'Stockholm primär · Helsingfors backup',
    state: 'Drift',
    accent: 'cyan'
  },
  {
    name: 'PocketBase',
    sub: 'Multi-tenant DB · auth · realtime',
    state: 'Drift',
    accent: 'green'
  },
  {
    name: 'Coolify',
    sub: 'Self-hosted PaaS',
    state: 'Drift',
    accent: 'purple'
  },
  {
    name: 'Mistral Le Chat',
    sub: 'EU-suverän LLM',
    state: 'Drift',
    accent: 'brown'
  }
];

export default async function InstallningarPage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/idag');
  }
  const pb = await getServerPb();

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
        roles: Array.isArray(u.roles) ? u.roles.filter((role): role is string => typeof role === 'string') : [],
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

  return (
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb="Hemmaplan / Inställningar"
        title="Inställningar"
        subtitle="Moduler, tenants, integrationer och infrastruktur."
      />

      {/* ── Infrastruktur ─────────────────────────────────────── */}
      <SectionHead title="Infrastruktur" label="EU-suverän stack" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12
        }}
      >
        {INFRA.map((p) => (
          <Card key={p.name} style={{ padding: 14 }}>
            <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
              <Chip variant={p.accent} mono>
                EU
              </Chip>
              <span className="mx-grow" />
              <Chip variant="active" mono dot>
                {p.state}
              </Chip>
            </div>
            <div className="mx-disp mx-fw-6 mx-t-13 mx-mb-1">{p.name}</div>
            <div className="mx-t-12 mx-muted">{p.sub}</div>
          </Card>
        ))}
      </div>

      {/* ── GDPR / CLOUD Act-banner ───────────────────────────── */}
      <Card
        className="mx-mt-6"
        style={{
          padding: 18,
          background: 'var(--mx-green-tint)',
          borderColor: 'transparent'
        }}
      >
        <div className="mx-flex mx-items-c mx-gap-3">
          <Icon name="shield" size={20} style={{ color: 'var(--mx-green)' }} />
          <div style={{ flex: 1 }}>
            <div
              className="mx-disp mx-fw-6 mx-t-15"
              style={{ color: 'var(--mx-green-ink)' }}
            >
              Fri från US CLOUD Act. GDPR by design.
            </div>
            <div
              className="mx-t-12"
              style={{
                color: 'var(--mx-green-ink)',
                opacity: 0.8,
                marginTop: 2
              }}
            >
              All data lagras inom EU. Inga tredjelandsöverföringar.
              Granskningsbart audit-log per tenant.
            </div>
          </div>
          <button className="mx-btn" type="button">
            Audit-log →
          </button>
        </div>
      </Card>

      {/* ── Moduler ───────────────────────────────────────────── */}
      <div className="mx-mt-6">
        <SectionHead title="Moduler" label="Aktivera per tenant" />
        <AdminToggles modules={moduleItems} />
      </div>

      {isAdmin && (
        <div className="mx-mt-6">
          <SectionHead title="Användarspecifika moduler" label="Admin kan toggla per användare" />
          {userModuleRows.length > 0 ? (
            <UserModuleToggles users={userModuleRows} modules={moduleItems} />
          ) : (
            <Card className="p-4">
              <div className="mx-t-13 mx-muted">Inga användare hittades för din tenant.</div>
            </Card>
          )}
        </div>
      )}

      {/* ── Tenants ──────────────────────────────────────────── */}
      <div className="mx-mt-6">
        <SectionHead
          title="Tenants"
          label={`${rows.length} ${rows.length === 1 ? 'tenant' : 'tenants'}`}
        />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table className="mx-tbl">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Region</th>
                <th style={{ textAlign: 'right' }}>Bolag</th>
                <th style={{ textAlign: 'right' }}>Användare</th>
                <th>Status</th>
                <th style={{ width: 60 }} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="mx-muted mx-t-13" style={{ padding: 18 }}>
                    Inga tenants hittades.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.tenant.id}>
                    <td className="mx-fw-6">{r.tenant.name}</td>
                    <td className="mx-muted mx-mono mx-t-xs">
                      {r.tenant.region || r.tenant.slug}
                    </td>
                    <td className="mx-mono mx-tnum" style={{ textAlign: 'right' }}>
                      {r.startups}
                    </td>
                    <td className="mx-mono mx-tnum" style={{ textAlign: 'right' }}>
                      {r.users}
                    </td>
                    <td>
                      <Chip variant="active" mono>
                        {r.tenant.status || 'Drift'}
                      </Chip>
                    </td>
                    <td>
                      <button className="mx-btn mx-sm" type="button">
                        →
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
