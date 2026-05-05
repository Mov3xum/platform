/// <reference path="../pb_data/types.d.ts" />

// Seedar app-admin (hampus@movexum.se) i users-collectionen som admin för
// movexum-tenant. PB instance superuser hanteras separat via /_/-UI:t — denna
// migration skapar endast app-användaren som loggar in i Next.js-appen.
//
// Lösenordet läses från env-var APP_ADMIN_INITIAL_PASSWORD (Coolify secret).
// Migrationen är idempotent: om kontot redan finns hoppar den över.
migrate(
  (app) => {
    const email = 'hampus@movexum.se';
    const password = $os.getenv('APP_ADMIN_INITIAL_PASSWORD');
    if (!password) {
      console.log('APP_ADMIN_INITIAL_PASSWORD ej satt — hoppar över app-admin-seed');
      return;
    }

    try {
      app.findFirstRecordByFilter('users', `email = "${email}"`);
      console.log(`app-admin ${email} finns redan — hoppar över seed`);
      return;
    } catch (e) {
      // not found — fortsätt
    }

    let tenant;
    try {
      tenant = app.findFirstRecordByFilter('tenants', 'slug = "movexum"');
    } catch (e) {
      throw new Error('movexum-tenant saknas — kontrollera att tenant-seed körts');
    }

    const usersCol = app.findCollectionByNameOrId('users');
    const user = new Record(usersCol);
    user.set('email', email);
    user.set('verified', true);
    user.set('emailVisibility', true);
    user.setPassword(password);
    user.set('tenant', tenant.id);
    user.set('roles', ['admin']);
    user.set('display_name', 'Hampus Granström');

    return app.save(user);
  },
  (app) => {
    try {
      const user = app.findFirstRecordByFilter('users', 'email = "hampus@movexum.se"');
      if (user) app.delete(user);
    } catch (e) {
      // ignore
    }
  }
);
