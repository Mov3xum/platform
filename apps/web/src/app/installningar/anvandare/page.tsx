import { getServerPb } from '@/lib/auth.server';
import { escFilter } from '@/lib/pb-filter';
import { hasRole } from '@/lib/rbac';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { resolveUserModules, type Role } from '@platform/shared';
import { assignableRolesFor } from '@/lib/users/validate';
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
  enabled_modules?: unknown;
  created?: string;
  last_login_at?: string;
  last_active_at?: string;
  login_count?: unknown;
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
        'id,email,display_name,roles,verified,disabled_modules,enabled_modules,created,last_login_at,last_active_at,login_count,expand.linked_startups.id,expand.linked_startups.name',
      expand: 'linked_startups'
    });
    users = res.items.map((m) => {
      const roles = Array.isArray(m.roles) ? m.roles.filter((r): r is Role => typeof r === 'string') : [];
      return {
        id: m.id,
        name: m.display_name?.trim() || m.email,
        email: m.email ?? '',
        roles,
        verified: m.verified !== false,
        linkedStartups: m.expand?.linked_startups ?? [],
        // Samma upplösning som sessionen (§ 36.3): lagrad allow-lista, annars
        // allt rollen tillåter minus ev. legacy disabled_modules.
        enabledModules: resolveUserModules({
          roles,
          stored: m.enabled_modules,
          legacyDisabled: m.disabled_modules
        }),
        createdAt: m.created ?? '',
        // Användarlogg (§ 36.4): stämplas av servern (hjärtslag + inloggning).
        lastActiveAt: m.last_active_at?.trim() ? m.last_active_at : null,
        lastLoginAt: m.last_login_at?.trim() ? m.last_login_at : null,
        loginCount: typeof m.login_count === 'number' ? m.login_count : 0
      };
    });
  } catch (error) {
    console.error('[installningar/anvandare] failed to load users', { tenant: user.tenant, error });
  }

  return (
    <SettingsSectionPage
      slug="anvandare"
      roles={user.roles}
      intro="Alla konton i din organisation med när de senast var aktiva. Öppna en användare för att se inloggningshistorik och vad personen gjort i plattformen, ändra roller, koppla bolag, välja vilka moduler som visas i personens sidofält, sätta nytt lösenord eller radera kontot. Bolagsmedlemmar ser bara sitt eget bolags data."
    >
      <UsersAdmin
        users={users}
        startups={startups}
        assignableRoles={assignableRoles}
        actorId={user.id}
        isAdmin={isAdmin}
      />
    </SettingsSectionPage>
  );
}
