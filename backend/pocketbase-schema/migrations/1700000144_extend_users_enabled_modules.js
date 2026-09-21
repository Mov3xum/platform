/// <reference path="../pb_data/types.d.ts" />

// CLAUDE.md § 36.3 — Modulåtkomst per användare (allow-lista).
//
//   users.enabled_modules ← JSON-array med modul-id:n som ska synas i
//                           sidofältet för just den här personen.
//
// Ersätter den globala tenant-togglingen (`tenants.disabled_modules`, som
// lämnas orörd men inte längre läses) och den per-användar-deny-listan
// (`users.disabled_modules`, som bara används som fallback när
// `enabled_modules` saknas). Fältet lämnas medvetet TOMT (null) för
// befintliga konton: appen tolkar null som "rollens standardmoduler minus ev.
// legacy disabled_modules" (packages/shared/src/module-access.ts), så ingen
// ser mindre än sin rollstandard efter deployen. Första gången admin sparar
// en användares moduler skrivs en explicit lista.
//
// GDPR: ingen personuppgift — bara modul-id:n (UI-preferens/åtkomstkurering).
// Rollen (`rolesAllowed`) + PB-RLS är fortsatt den hårda gränsen.

migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    if (!users.fields.getByName('enabled_modules')) {
      users.fields.add(
        new Field({
          name: 'enabled_modules',
          type: 'json',
          required: false,
          maxSize: 4000
        })
      );
    }

    return app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const f = users.fields.getByName('enabled_modules');
    if (f) users.fields.remove(f);
    return app.save(users);
  }
);
