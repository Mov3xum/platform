#!/usr/bin/env node
/**
 * Read-only diagnostik: jämför migrationsfilerna på disk mot vad som FAKTISKT
 * finns i en körande PocketBase-instans, och rapporterar vilka migrationer som
 * inte har applicerats (= deras kollektioner saknas).
 *
 * Bakgrund: plattformens schema kan provisioneras på två sätt (se
 * backend/pocketbase-schema/README.md):
 *   1. Custom Docker-image som bakar in migrationerna → PB auto-applicerar dem
 *      vid `serve` (auktoritativ väg).
 *   2. `setup-via-api.mjs` som skapar kollektioner via REST (bootstrap/sync).
 *
 * Om en instans bootstrappats via (2) men en kollektion BARA finns i en
 * migration (t.ex. `compass_*`), saknas den helt → varje skrivning 404:ar och
 * appen kastar 500. Det här skriptet gör den driften synlig INNAN den biter.
 *
 * Skriptet ÄNDRAR ingenting. Det:
 *   • listar migrationsfilerna i ./migrations
 *   • härleder vilka kollektioner varje create-migration skapar (`new Collection`)
 *   • jämför mot kollektionerna som finns i den körande instansen
 *   • försöker dessutom läsa PB:s `_migrations`-historik (om superusern når den)
 *   • skriver en sammanfattning + exit-kod 1 om något saknas (för CI-gating)
 *
 * Usage:
 *   PB_URL='https://your-pb-domain' \
 *   PB_SU_EMAIL='hampus@movexum.se' \
 *   PB_SU_PASSWORD='<superuser password>' \
 *   node backend/pocketbase-schema/scripts/diagnose-migrations.mjs
 */

import PocketBase from 'pocketbase';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PB_URL_RAW = process.env.PB_URL;
const SU_EMAIL = process.env.PB_SU_EMAIL;
const SU_PASSWORD = process.env.PB_SU_PASSWORD;

if (!PB_URL_RAW || !SU_EMAIL || !SU_PASSWORD) {
  console.error('Missing env vars. Required: PB_URL, PB_SU_EMAIL, PB_SU_PASSWORD');
  process.exit(1);
}

const log = (...a) => console.log('•', ...a);
const ok = (...a) => console.log('✓', ...a);
const warn = (...a) => console.log('!', ...a);

function normalizePbUrl(raw) {
  let url = String(raw).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  return url;
}

const PB_URL = normalizePbUrl(PB_URL_RAW);
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Härled vilka kollektioner en migrationsfil SKAPAR. Vi matchar
 * `new Collection({ ... name: '<x>' ... })` (skapande) — INTE
 * `findCollectionByNameOrId` (utökning av befintlig). Best-effort statisk
 * parsning, ingen exekvering av migrationskoden.
 */
function collectionsCreatedBy(source) {
  const created = new Set();
  // Hitta varje `new Collection(` och plocka närmaste efterföljande name:'...'.
  const re = /new\s+Collection\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const rest = source.slice(m.index, m.index + 800);
    const nameMatch = rest.match(/name:\s*['"]([a-zA-Z0-9_]+)['"]/);
    if (nameMatch) created.add(nameMatch[1]);
  }
  return [...created];
}

function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.*\.js$/.test(f))
    .sort();
}

async function readMigrationHistory(pb) {
  // PB v0.23 lagrar applicerade migrationer i systemtabellen `_migrations`.
  // Den exponeras inte garanterat via REST. Försök ett par vägar; faller
  // tillbaka på null (då härleder vi status från kollektionerna i stället).
  const attempts = [
    () => pb.collection('_migrations').getFullList({ batch: 1000, $autoCancel: false }),
    () => pb.send('/api/collections/_migrations/records?perPage=1000', { method: 'GET' }).then((r) => r?.items ?? r)
  ];
  for (const attempt of attempts) {
    try {
      const rows = await attempt();
      if (Array.isArray(rows)) {
        return rows.map((r) => r.file || r.name || r.id).filter(Boolean);
      }
    } catch {
      // try next
    }
  }
  return null;
}

async function main() {
  log(`PB: ${PB_URL}`);
  log(`Migrations: ${MIGRATIONS_DIR}`);

  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);

  try {
    await pb.collection('_superusers').authWithPassword(SU_EMAIL, SU_PASSWORD);
  } catch (err) {
    console.error(`✗ Superuser-auth misslyckades för ${SU_EMAIL}: ${err?.message || err}`);
    process.exit(1);
  }
  ok(`Autentiserad som superuser ${SU_EMAIL}`);

  // 1. Befintliga kollektioner i instansen.
  const liveCollections = await pb.collections.getFullList({ batch: 1000, $autoCancel: false });
  const liveNames = new Set(liveCollections.filter((c) => !c.system).map((c) => c.name));
  ok(`Hittade ${liveNames.size} icke-system-kollektioner i instansen`);

  // 2. Migrationsfiler + vilka kollektioner de skapar.
  const files = listMigrationFiles();
  ok(`Hittade ${files.length} migrationsfiler på disk`);

  // 3. PB:s migrationshistorik (om åtkomlig).
  const history = await readMigrationHistory(pb);
  if (history) {
    ok(`Läste _migrations-historik: ${history.length} applicerade poster`);
  } else {
    warn('Kunde inte läsa _migrations-historiken via REST — härleder status från kollektioner i stället.');
  }

  // 4. Per migration: vilka kollektioner skapas, finns de?
  const missingByFile = [];
  const allMissingCollections = new Set();
  for (const file of files) {
    const source = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const created = collectionsCreatedBy(source);
    if (created.length === 0) continue; // utökning/seed/rules — inget att verifiera här
    const missing = created.filter((name) => !liveNames.has(name));
    if (missing.length > 0) {
      missingByFile.push({ file, missing, created });
      missing.forEach((n) => allMissingCollections.add(n));
    }
  }

  console.log('\n=== Sammanfattning ===');
  if (history) {
    const historySet = new Set(history.map((h) => String(h).replace(/\.js$/, '')));
    const pending = files.filter((f) => !historySet.has(f) && !historySet.has(f.replace(/\.js$/, '')));
    console.log(`Migrationsfiler:            ${files.length}`);
    console.log(`Applicerade (_migrations):  ${history.length}`);
    console.log(`Ej i historiken (pending):  ${pending.length}`);
    if (pending.length > 0) {
      console.log('  Pending-filer:');
      for (const p of pending) console.log(`    - ${p}`);
    }
  }

  if (allMissingCollections.size === 0) {
    ok('Alla migrations-skapade kollektioner finns i instansen. Inget gap upptäckt.');
    console.log('======================\n');
    return;
  }

  console.log(`\n✗ SAKNADE kollektioner (create-migration har inte applicerats): ${allMissingCollections.size}`);
  for (const { file, missing } of missingByFile) {
    console.log(`  ${file} → saknar: ${missing.join(', ')}`);
  }
  console.log(
    '\nÅtgärd: kör de saknade create-migrationerna mot instansen (se README ' +
      '"Reconcile: applicera saknade migrationer"). Detta sker INTE av setup-via-api.mjs ' +
      'för migration-only-kollektioner (t.ex. compass_*).'
  );
  console.log('======================\n');
  process.exit(1);
}

main().catch((err) => {
  console.error('\n✗ Diagnostiken misslyckades');
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
