#!/usr/bin/env node
/**
 * Seeds (or repairs) the two internationalisation workshops over the PocketBase
 * REST API — the same result as building them in the /education block builder,
 * but done from code. Use this when the JSVM migration (1700000097) hasn't taken
 * effect (e.g. the PocketBase image wasn't rebuilt, only restarted).
 *
 * What it does, idempotently and self-healing:
 *   1. Auths as superuser.
 *   2. Finds the Movexum tenant (slug=movexum).
 *   3. Find-or-creates the "Internationalisering" workshop_areas record.
 *   4. For each workshop (intl_grunden, intl_strategin): creates it if missing,
 *      otherwise UPDATES it so a half-seeded/unclassified record gets its area,
 *      modules, content_blocks, status and active flag fixed — i.e. it will
 *      move an existing workshop UNDER the Internationalisering area.
 *
 * Content comes from scripts/data/internationalization-workshops.json, which is
 * generated from the migration so it stays byte-identical.
 *
 * Usage (point at the SAME PB the staging web app talks to — POCKETBASE_URL_STAGING):
 *   PB_URL='https://<staging-pocketbase-host>' \
 *   PB_SU_EMAIL='<superuser email>' \
 *   PB_SU_PASSWORD='<superuser password>' \
 *   node scripts/seed-internationalization-workshops.mjs
 */

import PocketBase from 'pocketbase';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PB_URL = process.env.PB_URL;
const SU_EMAIL = process.env.PB_SU_EMAIL;
const SU_PASSWORD = process.env.PB_SU_PASSWORD;
const TENANT_SLUG = process.env.MOVEXUM_TENANT_SLUG || 'movexum';

if (!PB_URL || !SU_EMAIL || !SU_PASSWORD) {
  console.error('Missing env. Required: PB_URL, PB_SU_EMAIL, PB_SU_PASSWORD');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, 'data/internationalization-workshops.json'), 'utf8'));

const pb = new PocketBase(PB_URL.replace(/\/+$/, ''));
pb.autoCancellation(false);

const esc = (v) => String(v).replace(/"/g, '\\"');

async function main() {
  await pb.collection('_superusers').authWithPassword(SU_EMAIL, SU_PASSWORD);
  console.log('✓ authed as superuser');

  const tenant = await pb.collection('tenants').getFirstListItem(`slug = "${esc(TENANT_SLUG)}"`);
  console.log(`✓ tenant ${TENANT_SLUG} → ${tenant.id}`);

  // Find-or-create the area
  let area;
  try {
    area = await pb
      .collection('workshop_areas')
      .getFirstListItem(`tenant = "${tenant.id}" && name = "${esc(data.area)}"`);
    console.log(`✓ area "${data.area}" exists → ${area.id}`);
  } catch (e) {
    if (e?.status !== 404) throw e;
    area = await pb.collection('workshop_areas').create({ tenant: tenant.id, name: data.area });
    console.log(`✓ area "${data.area}" created → ${area.id}`);
  }

  for (const w of data.workshops) {
    const payload = {
      tenant: tenant.id,
      area: area.id,
      key: w.key,
      title: w.title,
      goal: w.goal || '',
      instructions: w.instructions || '',
      status: w.status || 'active',
      version: w.version || '1.0.0',
      audience_roles: w.audience_roles || [],
      ai_system_prompt: w.ai_system_prompt || '',
      output_requirements: w.output_requirements || '',
      modules: w.modules,
      content_blocks: w.content_blocks,
      active: w.active !== false
    };

    let existing = null;
    try {
      existing = await pb
        .collection('workshops')
        .getFirstListItem(`tenant = "${tenant.id}" && key = "${esc(w.key)}"`);
    } catch (e) {
      if (e?.status !== 404) throw e;
    }

    if (existing) {
      await pb.collection('workshops').update(existing.id, payload);
      console.log(`✓ updated "${w.title}" (${w.key}) → area set, ${w.modules.length} modules`);
    } else {
      const rec = await pb.collection('workshops').create(payload);
      console.log(`✓ created "${w.title}" (${w.key}) → ${rec.id}, ${w.modules.length} modules`);
    }
  }

  console.log('\nDone. Reload /education — both workshops should now sit under "Internationalisering".');
}

main().catch((err) => {
  console.error('✗ failed:', err?.status ? `status=${err.status}` : '', err?.message || err);
  if (err?.response) console.error('  response:', JSON.stringify(err.response));
  process.exit(1);
});
