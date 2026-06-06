#!/usr/bin/env node
/**
 * Engångsimport av det historiska CRM-arket "Kapital" (capital_id-listan) →
 * `capital_rounds` (alla rader) + `de_minimis_stod` (endast Typ="De minimis").
 *
 * AVSIKTLIGT inte en migration — migrationer kör i ALLA miljöer inkl. prod
 * (CLAUDE.md §10.3 A.8.32). Detta är historisk data som körs manuellt mot rätt
 * miljö, precis som `seed-test-data.mjs`.
 *
 * Bolagsmatchning sker på NAMN (arket saknar org-nr och dess gamla Excel-hex-id
 * finns inte i nya DB:n). Omatchade rader skippas och listas i rapporten.
 *
 * Idempotent: upserts på naturliga nycklar (se DEDUP nedan) → omkörning skapar
 * 0 nya rader. `kanBevilja`-taket körs INTE för de minimis — detta är historisk
 * registrering, inte ett nytt stödbeslut (taket får överskridas historiskt).
 *
 * Användning:
 *   cd backend/pocketbase-schema/scripts && npm install   # en gång (pocketbase-SDK)
 *   export POCKETBASE_URL=https://din-pb-domän
 *   export POCKETBASE_SUPERUSER_EMAIL=...     # _superusers-konto
 *   export POCKETBASE_SUPERUSER_PASSWORD=...
 *   export TENANT_SLUG=movexum                # valfritt (default: movexum)
 *   # valfri egen datafil (default: ./data/capital-stod.tsv):
 *   export CAPITAL_STOD_TSV=/path/till/export.tsv
 *
 *   node import-capital-stod.mjs            # DRY RUN — inga writes, bara rapport
 *   node import-capital-stod.mjs --commit   # skriver till PocketBase
 *
 * TSV-format (tab-separerat, en post per rad, header på rad 1). Kolumner som
 * används: Företagsnamn, Typ, Finansiär, Belopp, Mottaget datum, Anteckning.
 * Övriga kolumner ignoreras. Anteckningar med radbrytningar plattas till en rad.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PocketBase from 'pocketbase';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Env ────────────────────────────────────────────────────────────
const PB_URL = process.env.POCKETBASE_URL || process.env.PB_URL || 'http://localhost:8080';
const SU_EMAIL = process.env.POCKETBASE_SUPERUSER_EMAIL || process.env.PB_SU_EMAIL;
const SU_PASSWORD = process.env.POCKETBASE_SUPERUSER_PASSWORD || process.env.PB_SU_PASSWORD;
const TENANT_SLUG = process.env.TENANT_SLUG || 'movexum';
const TSV_PATH =
  process.env.CAPITAL_STOD_TSV || path.join(__dirname, 'data', 'capital-stod.tsv');
const COMMIT = process.argv.includes('--commit');

const DEFAULT_VAXELKURS_SEK_PER_EUR = 11.3; // speglar packages/shared/src/de-minimis.ts

if (!SU_EMAIL || !SU_PASSWORD) {
  console.error('Saknar env: POCKETBASE_SUPERUSER_EMAIL + POCKETBASE_SUPERUSER_PASSWORD.');
  process.exit(1);
}

const log = (...a) => console.log('•', ...a);
const ok = (...a) => console.log('✓', ...a);
const warn = (...a) => console.log('!', ...a);

// ── Hjälpare (replikerade — skriptet kan inte importera TS/@-alias) ──

// Personnummer-sanering (samma regex som apps/web/src/lib/import/crm-excel.ts).
const PERSONNUMMER_RE = /\b\d{6,8}[-+]?\d{4}\b/g;
const sanitizePersonnummer = (text) => String(text).replace(PERSONNUMMER_RE, '[REDACTED]');

// Typ → capital_rounds.type (samma som CAPITAL_TYPE_MAP i crm-excel.ts).
const CAPITAL_TYPE_MAP = {
  bidrag: 'grant',
  grant: 'grant',
  equity: 'equity',
  ägarkapital: 'equity',
  aktiekapital: 'equity',
  lån: 'loan',
  loan: 'loan',
  'mjukt kapital': 'soft_funding',
  soft_funding: 'soft_funding',
  innovationscheck: 'soft_funding',
  konvertibel: 'convertible',
  convertible: 'convertible',
  konvertibelt: 'convertible'
};
const normLower = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const mapCapitalType = (raw) => CAPITAL_TYPE_MAP[normLower(raw)] ?? 'other';
const isDeMinimis = (raw) => normLower(raw) === 'de minimis';

// "2026-03-31 00:00" / "2024-04-22 22:00" → "2026-03-31".
function parseDate(raw) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseAmount(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/[^\d.,-]/g, '').replace(/\s/g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Bolagsnamn-normalisering för matchning.
function normalizeName(raw) {
  let s = String(raw ?? '').trim().toLowerCase();
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*\baktiebolag\b/g, ' ab');
  s = s.replace(/[.'"`’]/g, '');
  s = s.replace(/\s*\bab\b\s*$/g, '').trim(); // ta bort trailing "ab"
  return s;
}

// Plockar ut parentes-innehåll ("Intrest (Linkapp AB)" → "Linkapp AB").
function parenInner(raw) {
  const m = /\(([^)]+)\)/.exec(String(raw ?? ''));
  return m ? m[1] : null;
}
function stripParen(raw) {
  return String(raw ?? '').replace(/\([^)]*\)/g, ' ').trim();
}

// Explicit alias-override: arknamn (lowercase, trim) → exakt startups.name.
// Fylls i efter första dry-run om rapporten listar bolag som borde matcha.
const NAME_ALIASES = {
  // 'arknamn i lowercase': 'Exakt startups.name'
};

// ── TSV-parser (en post per rad) ─────────────────────────────────────
function parseTsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0].split('\t').map((h) => h.trim());
  const idx = (name) => header.findIndex((h) => normLower(h) === normLower(name));
  const col = {
    name: idx('Företagsnamn'),
    typ: idx('Typ'),
    finansiar: idx('Finansiär'),
    belopp: idx('Belopp'),
    datum: idx('Mottaget datum'),
    note: idx('Anteckning')
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split('\t');
    const get = (k) => (col[k] >= 0 ? (c[col[k]] ?? '').trim() : '');
    rows.push({
      name: get('name'),
      typ: get('typ'),
      finansiar: get('finansiar'),
      belopp: parseAmount(get('belopp')),
      datum: parseDate(get('datum')),
      note: get('note')
    });
  }
  return { header, rows, col };
}

// ── PocketBase ───────────────────────────────────────────────────────
function esc(v) {
  return String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function main() {
  console.log(`\n=== Import kapital & de minimis (${COMMIT ? 'COMMIT' : 'DRY RUN'}) ===`);
  console.log(`PB: ${PB_URL}  tenant-slug: ${TENANT_SLUG}  fil: ${TSV_PATH}\n`);

  if (!fs.existsSync(TSV_PATH)) {
    console.error(`Datafil saknas: ${TSV_PATH}`);
    process.exit(1);
  }
  const { header, rows } = parseTsv(fs.readFileSync(TSV_PATH, 'utf8'));
  log(`Läste ${rows.length} rader (header: ${header.join(', ')})`);

  const pb = new PocketBase(PB_URL);
  pb.autoCancellation(false);
  await pb.collection('_superusers').authWithPassword(SU_EMAIL, SU_PASSWORD);
  ok('Superuser autentiserad');

  // Resolva tenant.
  let tenant;
  try {
    const t = await pb.collection('tenants').getFirstListItem(`slug = "${esc(TENANT_SLUG)}"`);
    tenant = t.id;
  } catch {
    console.error(`Hittade ingen tenant med slug "${TENANT_SLUG}".`);
    process.exit(1);
  }
  ok(`Tenant: ${tenant}`);

  // Indexera bolag (namn → id). Bygg flera normaliserade nycklar per bolag.
  const startups = await pb.collection('startups').getFullList({ filter: `tenant = "${tenant}"` });
  const nameIndex = new Map(); // normaliserad nyckel → startupId
  const addKey = (key, id) => {
    if (key && !nameIndex.has(key)) nameIndex.set(key, id);
  };
  for (const s of startups) {
    const raw = String(s.name ?? '');
    addKey(normalizeName(raw), s.id);
    const inner = parenInner(raw);
    if (inner) addKey(normalizeName(inner), s.id);
    const outer = stripParen(raw);
    if (outer && outer !== raw) addKey(normalizeName(outer), s.id);
  }
  ok(`Indexerade ${startups.length} bolag (${nameIndex.size} namnnycklar)`);

  const matchStartup = (rawName) => {
    const aliasTarget = NAME_ALIASES[normLower(rawName)];
    const candidates = aliasTarget
      ? [normalizeName(aliasTarget)]
      : [normalizeName(rawName), normalizeName(parenInner(rawName) || ''), normalizeName(stripParen(rawName))];
    for (const k of candidates) {
      if (k && nameIndex.has(k)) return nameIndex.get(k);
    }
    return null;
  };

  // Lazy de minimis-unit per bolag (speglar resolveOrCreateUnit i de-minimis.ts).
  const unitCache = new Map(); // startupId → unitId
  async function resolveUnit(startupId, startupName) {
    if (unitCache.has(startupId)) return unitCache.get(startupId);
    let unitId = null;
    try {
      const u = await pb
        .collection('de_minimis_units')
        .getFirstListItem(`startup = "${esc(startupId)}"`, { sort: 'created' });
      unitId = u.id;
    } catch {
      unitId = null;
    }
    if (!unitId && COMMIT) {
      const created = await pb.collection('de_minimis_units').create({
        tenant,
        startup: startupId,
        namn: startupName || 'De minimis'
      });
      unitId = created.id;
    }
    unitCache.set(startupId, unitId);
    return unitId;
  }

  async function upsert(collection, filter, payload) {
    let existing = null;
    try {
      existing = await pb.collection(collection).getFirstListItem(filter);
    } catch {
      existing = null;
    }
    if (!COMMIT) return existing ? 'updated' : 'created';
    if (existing) {
      await pb.collection(collection).update(existing.id, payload);
      return 'updated';
    }
    await pb.collection(collection).create(payload);
    return 'created';
  }

  // ── Loop ───────────────────────────────────────────────────────────
  const stats = {
    capital: { created: 0, updated: 0 },
    deMinimis: { created: 0, updated: 0 },
    skippedJunk: 0,
    skippedNoAmountOrDate: 0,
    skippedUnmatched: 0,
    errors: 0
  };
  const unmatched = new Map(); // rawName → antal rader

  for (const row of rows) {
    if (!row.name) {
      stats.skippedJunk++;
      continue;
    }
    if (row.belopp === null || row.belopp <= 0 || !row.datum) {
      stats.skippedNoAmountOrDate++;
      continue;
    }
    const startupId = matchStartup(row.name);
    if (!startupId) {
      stats.skippedUnmatched++;
      unmatched.set(row.name, (unmatched.get(row.name) ?? 0) + 1);
      continue;
    }
    const source = row.finansiar || '(okänd finansiär)';
    const note = row.note ? sanitizePersonnummer(row.note) : '';

    try {
      // 1) capital_rounds — alla rader.
      const capFilter =
        `startup = "${esc(startupId)}" && source = "${esc(source)}" && amount_sek = ${row.belopp} ` +
        `&& received_at >= "${row.datum} 00:00:00" && received_at <= "${row.datum} 23:59:59"`;
      const capPayload = {
        tenant,
        startup: startupId,
        type: mapCapitalType(row.typ),
        source,
        amount_sek: row.belopp,
        received_at: row.datum
      };
      if (note) capPayload.notes = note;
      const capRes = await upsert('capital_rounds', capFilter, capPayload);
      stats.capital[capRes]++;

      // 2) de_minimis_stod — endast Typ="De minimis".
      if (isDeMinimis(row.typ)) {
        const unitId = await resolveUnit(startupId, row.name);
        if (!unitId && !COMMIT) {
          // Dry-run utan befintlig unit: räkna ändå som "skulle skapas".
          stats.deMinimis.created++;
        } else if (unitId) {
          const dmFilter =
            `unit = "${esc(unitId)}" && stodgivare = "${esc(source)}" && belopp_sek = ${row.belopp} ` +
            `&& beslutsdatum >= "${row.datum} 00:00:00" && beslutsdatum <= "${row.datum} 23:59:59"`;
          const beloppEur = Math.round((row.belopp / DEFAULT_VAXELKURS_SEK_PER_EUR) * 100) / 100;
          const dmPayload = {
            tenant,
            startup: startupId,
            unit: unitId,
            forordning: 'ALLMAN',
            stodgivare: source,
            beslutsdatum: row.datum,
            belopp_sek: row.belopp,
            valutakurs: DEFAULT_VAXELKURS_SEK_PER_EUR,
            belopp_eur: beloppEur
          };
          if (note) dmPayload.syfte = note.slice(0, 500);
          const dmRes = await upsert('de_minimis_stod', dmFilter, dmPayload);
          stats.deMinimis[dmRes]++;
        }
      }
    } catch (err) {
      stats.errors++;
      console.error('  [fel] rad', { name: row.name, typ: row.typ, datum: row.datum }, err?.message || err);
    }
  }

  // ── Rapport ──────────────────────────────────────────────────────────
  console.log('\n──────── Rapport ────────');
  console.log(`capital_rounds:   ${stats.capital.created} skapade, ${stats.capital.updated} uppdaterade`);
  console.log(`de_minimis_stod:  ${stats.deMinimis.created} skapade, ${stats.deMinimis.updated} uppdaterade`);
  console.log(`Skippade (skräp/tomt namn):     ${stats.skippedJunk}`);
  console.log(`Skippade (saknat belopp/datum): ${stats.skippedNoAmountOrDate}`);
  console.log(`Skippade (omatchat bolag):      ${stats.skippedUnmatched}`);
  console.log(`Fel:                            ${stats.errors}`);

  if (unmatched.size) {
    console.log('\nOmatchade bolagsnamn (lägg ev. i NAME_ALIASES):');
    for (const [name, n] of [...unmatched.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${n}×  "${name}"`);
    }
  }

  if (!COMMIT) {
    warn('\nDRY RUN — inga writes gjordes. Kör med --commit för att skriva.');
  } else {
    ok('\nKlart.');
  }
}

main().catch((err) => {
  console.error('Import misslyckades:', err?.message || err);
  process.exit(1);
});
