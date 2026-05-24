// Seedar alltid minst en tenant och admin-user
// Körs via: node backend/pocketbase-schema/scripts/seed-tenant-admin.mjs

import PocketBase from 'pocketbase';

const PB_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const pb = new PocketBase(PB_URL);

const TENANT_SLUG = 'movexum';
const ADMIN_EMAIL = 'admin@movexum.se';
const ADMIN_PASS = 'movexum123'; // Byt i produktion!

async function ensureTenantAndAdmin() {
  // 1. Tenant
  let tenant = null;
  const tenants = await pb.collection('tenants').getFullList({ filter: `slug = "${TENANT_SLUG}"` });
  if (tenants.length > 0) {
    tenant = tenants[0];
    console.log('Tenant finns redan:', tenant.id);
  } else {
    tenant = await pb.collection('tenants').create({ name: 'Movexum', slug: TENANT_SLUG });
    console.log('Tenant skapad:', tenant.id);
  }

  // 2. Admin-user
  const users = await pb.collection('users').getFullList({ filter: `email = "${ADMIN_EMAIL}"` });
  if (users.length > 0) {
    console.log('Admin-user finns redan:', users[0].id);
    // Koppla tenant om saknas
    if (!users[0].tenant) {
      await pb.collection('users').update(users[0].id, { tenant: tenant.id, roles: ['admin'] });
      console.log('Admin kopplad till tenant.');
    }
  } else {
    const user = await pb.collection('users').create({
      email: ADMIN_EMAIL,
      emailVisibility: true,
      password: ADMIN_PASS,
      passwordConfirm: ADMIN_PASS,
      tenant: tenant.id,
      roles: ['admin'],
      display_name: 'Movexum Admin'
    });
    console.log('Admin-user skapad:', user.id);
  }
}

ensureTenantAndAdmin().then(() => {
  console.log('Seed klart!');
  process.exit(0);
}).catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
