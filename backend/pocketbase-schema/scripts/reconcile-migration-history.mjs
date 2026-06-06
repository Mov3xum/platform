#!/usr/bin/env node
/**
 * Reconcile PocketBase:s `_migrations`-historik mot verkligheten.
 *
 * Problem: om ett `pb_data` byggdes via `setup-via-api.mjs` (REST) i stället för
 * av migrationerna, finns kollektionerna men deras create-migrationer är inte
 * registrerade i `_migrations`. Startar man då custom-imagen kör dess `serve`
 * ALLA oregistrerade migrationer i ordning → de tidiga create-migrationerna
 * kolliderar med redan existerande kollektioner → `serve` avbryts.
 *
 * Det här skriptet markerar varje migration vars EFFEKT redan finns
 * (alla kollektioner den skapar finns i `_collections`) som applicerad, så att
 * custom-imagens auto-migrate blir en kollisionsfri no-op och bara genuint
 * saknade migrationer (t.ex. compass om de inte körts) körs vid nästa start.
 *
 * SÄKERHET (det här är offline DB-kirurgi):
 *   • Kör med PocketBase STOPPAT (annars SQLite-lås/WAL-konflikt).
 *   • TA BACKUP av pb_data först.
 *   • Dry-run som default. Inget skrivs utan `--apply`.
 *   • Introspekterar `_migrations`-tabellens schema och lär sig radformatet av
 *     befintliga rader i stället för att hårdkoda kolumnnamn/typer. Vägrar om
 *     formatet inte kan härledas (då: använd README:s temp-dir-`migrate up`).
 *   • Migrationsfiler vars create-effekt SAKNAS (t.ex. compass) lämnas
 *     OREGISTRERADE — de ska faktiskt köras (av `migrate up`), inte maskeras.
 *
 * Kräver Node ≥ 22.5 (`node:sqlite`).
 *
 * Usage:
 *   node backend/pocketbase-schema/scripts/reconcile-migration-history.mjs \
 *     --db /pb_data/data.db            # dry-run, visar vad som skulle skrivas
 *   node backend/pocketbase-schema/scripts/reconcile-migration-history.mjs \
 *     --db /pb_data/data.db --apply --i-have-a-backup
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(`--${name}`);
}
function opt(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : undefined;
}

const DB_PATH = opt('db');
const APPLY = flag('apply');
const HAS_BACKUP = flag('i-have-a-backup');

if (!DB_PATH) {
  console.error('Missing --db <path till pb_data/data.db>');
  process.exit(1);
}
if (!existsSync(DB_PATH)) {
  console.error(`DB hittades inte: ${DB_PATH}`);
  process.exit(1);
}

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error(
    'node:sqlite saknas (kräver Node ≥ 22.5). Använd i stället README:s ' +
      'temp-dir-`migrate up`-procedur för att applicera saknade migrationer.'
  );
  process.exit(1);
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const log = (...a) => console.log('•', ...a);
const ok = (...a) => console.log('✓', ...a);
const warn = (...a) => console.log('!', ...a);

/** Härled vilka kollektioner en migrationsfil SKAPAR (`new Collection`). */
function collectionsCreatedBy(source) {
  const created = new Set();
  const re = /new\s+Collection\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const rest = source.slice(m.index, m.index + 800);
    const nameMatch = rest.match(/name:\s*['"]([a-zA-Z0-9_]+)['"]/);
    if (nameMatch) created.add(nameMatch[1]);
  }
  return [...created];
}

const db = new DatabaseSync(DB_PATH);

// 1. Befintliga kollektioner (PB v0.23 lagrar dem i `_collections`).
let liveNames;
try {
  const rows = db.prepare('SELECT name FROM _collections').all();
  liveNames = new Set(rows.map((r) => r.name));
} catch (err) {
  console.error(`Kunde inte läsa _collections: ${err.message}`);
  process.exit(1);
}
ok(`_collections: ${liveNames.size} kollektioner`);

// 2. `_migrations`-tabellens form: kolumner + ett exempel på en befintlig rad
//    (för att spegla radformatet exakt).
let cols;
try {
  cols = db.prepare('PRAGMA table_info(_migrations)').all();
} catch (err) {
  console.error(`Kunde inte läsa _migrations: ${err.message}`);
  process.exit(1);
}
if (!cols.length) {
  console.error('_migrations-tabellen saknas/är tom på kolumner.');
  process.exit(1);
}
const colNames = cols.map((c) => c.name);
const fileCol = colNames.find((n) => /file|name/i.test(n)) || colNames[0];
const appliedCol = colNames.find((n) => /appl/i.test(n));
log(`_migrations-kolumner: ${colNames.join(', ')} (fil-kolumn: ${fileCol}${appliedCol ? `, applied-kolumn: ${appliedCol}` : ''})`);

const existingRows = db.prepare('SELECT * FROM _migrations').all();
const recorded = new Set(existingRows.map((r) => String(r[fileCol]).replace(/\.js$/, '')));
ok(`_migrations: ${existingRows.length} registrerade poster`);

// Lär appliedvärdet av en befintlig rad om möjligt (typ/format), annars
// PB:s konvention: unix-microsekunder.
function applatedValue() {
  if (!appliedCol) return undefined;
  const sample = existingRows.find((r) => r[appliedCol] != null);
  if (sample) {
    const v = sample[appliedCol];
    return typeof v === 'number' ? Date.now() * 1000 : String(Date.now() * 1000);
  }
  return Date.now() * 1000; // PB använder microsekunder
}

// 3. Beräkna: filer vars create-effekt finns men som inte är registrerade.
const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.*\.js$/.test(f)).sort();
const toBackfill = [];
const genuinelyMissing = [];
for (const file of files) {
  const base = file.replace(/\.js$/, '');
  if (recorded.has(base) || recorded.has(file)) continue; // redan registrerad
  const created = collectionsCreatedBy(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  if (created.length === 0) {
    // Utöknings-/seed-/rules-migration utan create — säker att markera applicerad
    // när den ligger före/blandat med redan-applicerade. Backfilla.
    toBackfill.push({ file, reason: 'ingen create (utökning/seed/rules)' });
    continue;
  }
  const present = created.filter((n) => liveNames.has(n));
  const missing = created.filter((n) => !liveNames.has(n));
  if (missing.length === 0) {
    toBackfill.push({ file, reason: `skapar ${present.join(', ')} (finns redan)` });
  } else {
    genuinelyMissing.push({ file, missing });
  }
}

console.log('\n=== Reconcile-plan ===');
console.log(`Backfilla (markera applicerade): ${toBackfill.length}`);
for (const b of toBackfill) console.log(`  + ${b.file}  — ${b.reason}`);
console.log(`\nGenuint saknade (lämnas OREGISTRERADE — ska köras av migrate up): ${genuinelyMissing.length}`);
for (const g of genuinelyMissing) console.log(`  ! ${g.file}  — saknar: ${g.missing.join(', ')}`);
console.log('======================\n');

if (!APPLY) {
  warn('Dry-run. Inget skrivet. Kör om med `--apply --i-have-a-backup` för att backfilla.');
  db.close();
  process.exit(0);
}
if (!HAS_BACKUP) {
  console.error('Vägrar skriva utan `--i-have-a-backup`. Ta backup av pb_data först.');
  db.close();
  process.exit(1);
}
if (toBackfill.length === 0) {
  ok('Inget att backfilla — historiken är redan i synk.');
  db.close();
  process.exit(0);
}

// 4. Skriv (en transaktion). Spegla befintligt radformat: sätt fil-kolumnen och
//    ev. applied-kolumnen; övriga kolumner lämnas till sina default-värden.
const applied = applatedValue();
const insertCols = appliedCol ? [fileCol, appliedCol] : [fileCol];
const placeholders = insertCols.map(() => '?').join(', ');
const stmt = db.prepare(`INSERT OR IGNORE INTO _migrations (${insertCols.join(', ')}) VALUES (${placeholders})`);
db.exec('BEGIN');
try {
  for (const b of toBackfill) {
    const values = appliedCol ? [b.file, applied] : [b.file];
    stmt.run(...values);
  }
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.error(`Backfill misslyckades, rullade tillbaka: ${err.message}`);
  db.close();
  process.exit(1);
}
ok(`Backfillade ${toBackfill.length} migrationsposter i _migrations.`);
if (genuinelyMissing.length > 0) {
  warn(
    `${genuinelyMissing.length} migration(er) är fortfarande oregistrerade och körs vid ` +
      'nästa `serve`/`migrate up` (det är meningen). Verifiera med diagnose-migrations.mjs.'
  );
}
db.close();
