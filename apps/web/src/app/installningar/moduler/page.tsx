import { getServerPb } from '@/lib/auth.server';
import { coreModules } from '@platform/shared';
import { HIDDEN_MODULE_IDS } from '@/lib/settings-constants';
import { AdminToggles, type ModuleToggleItem } from '../AdminToggles';
import { requireSettingsUser, SettingsSectionPage } from '../shared';

export const dynamic = 'force-dynamic';

export default async function ModulerPage() {
  const user = await requireSettingsUser();
  const pb = await getServerPb();

  let disabledModules: string[] = [];
  try {
    const t = await pb.collection('tenants').getOne<{ disabled_modules?: unknown }>(user.tenant);
    if (Array.isArray(t.disabled_modules)) {
      disabledModules = t.disabled_modules.filter((v): v is string => typeof v === 'string');
    }
  } catch {
    /* fältet saknas → alla moduler på */
  }

  const moduleItems: ModuleToggleItem[] = coreModules
    .filter((m) => !HIDDEN_MODULE_IDS.includes(m.id))
    .map((m) => ({
      id: m.id,
      name: m.title,
      description: m.description,
      defaultOn: !disabledModules.includes(m.id)
    }));
  const activeCount = moduleItems.filter((m) => m.defaultOn).length;

  return (
    <SettingsSectionPage
      slug="moduler"
      roles={user.roles}
      intro={`Slå på och av moduler för hela organisationen. ${activeCount} av ${moduleItems.length} är aktiva. Vill du begränsa åtkomst för en enskild person görs det per användare under Användare.`}
    >
      <AdminToggles modules={moduleItems} />
    </SettingsSectionPage>
  );
}
