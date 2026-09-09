import { getServerPb } from '@/lib/auth.server';
import { escFilter } from '@/lib/pb-filter';
import { hasRole } from '@/lib/rbac';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { coreModules, type Role } from '@platform/shared';
import { assignableRolesFor } from '@/lib/users/validate';
import { HIDDEN_MODULE_IDS } from '@/lib/settings-constants';
import type { ModuleToggleItem } from '../AdminToggles';
import { requireSettingsUser, SettingsSectionPage } from '../shared';
import { UsersAdmin, type ManagedUser } from './UsersAdmin';
import type { StartupOption } from './UserForm';

export const dynamic = 'force-dynamic';

interface MemberRow {
  id: string;
  email: string;
  display_name?: string;
  roles?: Role[];
  verified?: boolean;
  disabled_modules?: unknown;
  created?: string;
  expand?: { linked_startups?: { id: string; name: string }[] };
}

/**
 * Inställningar → Användare. Hela tenantens användare med sök/filter och
 * administration per konto (roller, bolagskoppling, modulåtkomst, lösenord,
 * radering). Läsning via användarens token (RLS), skrivning via server-actions
 * i `lib/actions/users.ts` / `lib/actions/settings.ts` (RBAC + tenant-check).
 */
export default async function AnvandarePage() {
  const user = await requireSettingsUser();
  const pb = await getServerPb();
  const isAdmin = hasRole(user.roles, ['admin']);
  const assignableRoles = assignableRolesFor(user.roles as Role[]);

  let startups: StartupOption[] = [];
  try {
    const res = await pb.collection('startups').getFullList<{ id: string; name: string }>({
      filter: `tenant = "${escFilter(user.tenant)}"`,
      sort: 'name',
      fields: 'id,name'
    });
    startups = res.map((s) => ({ id: s.id, name: s.name }));
  } catch (error) {
    console.error('[installningar/anvandare] failed to load startups', { tenant: user.tenant, error });
  }

  // Användarlistan läses via superuser: PocketBase döljer andra användares
  // `email` för vanliga tokens (emailVisibility), och adressen behövs för
  // administration (identifiera konto, bekräfta radering). Tenant-filtret
  // sätts server-side från den inloggade — aldrig från klienten. Faller
  // tillbaka på användarens token (RLS) om superuser saknas.
  const su = await getSuperuserPb();
  const listPb = su.ok ? su.pb : pb;
  let users: ManagedUser[] = [];
  try {
    const res = await listPb.collection('users').getList<MemberRow>(1, 500, {
      filter: `tenant = "${escFilter(user.tenant)}"`,
      sort: 'display_name,email',
      fields:
        'id,email,display_name,roles,verified,disabled_modules,created,expand.linked_startups.id,expand.linked_startups.name',
      expand: 'linked_startups'
    });
    users = res.items.map((m) => ({
      id: m.id,
      name: m.display_name?.trim() || m.email,
      email: m.email ?? '',
      roles: Array.isArray(m.roles) ? m.roles.filter((r): r is Role => typeof r === 'string') : [],
      verified: m.verified !== false,
      linkedStartups: m.expand?.linked_startups ?? [],
      disabledModules: Array.isArray(m.disabled_modules)
        ? m.disabled_modules.filter((v): v is string => typeof v === 'string')
        : [],
      createdAt: m.created ?? ''
    }));
  } catch (error) {
    console.error('[installningar/anvandare] failed to load users', { tenant: user.tenant, error });
  }

  // Modulåtkomst per användare (admin-only, samma lista som tenant-togglarna).
  const modules: ModuleToggleItem[] = isAdmin
    ? coreModules
        .filter((m) => !HIDDEN_MODULE_IDS.includes(m.id))
        .map((m) => ({ id: m.id, name: m.title, description: m.description, defaultOn: true }))
    : [];

  return (
    <SettingsSectionPage
      slug="anvandare"
      roles={user.roles}
      intro="Alla konton i din organisation. Öppna en användare för att ändra roller, koppla bolag, styra modulåtkomst, sätta nytt lösenord eller radera kontot. Bolagsmedlemmar ser bara sitt eget bolags data."
    >
      <UsersAdmin
        users={users}
        startups={startups}
        modules={modules}
        assignableRoles={assignableRoles}
        actorId={user.id}
        isAdmin={isAdmin}
      />
    </SettingsSectionPage>
  );
}
