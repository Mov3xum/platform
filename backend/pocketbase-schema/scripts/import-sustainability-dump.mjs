#!/usr/bin/env node
// CLAUDE.md § 56 — Importerar Hållbarhetsanalysens Postgres-dump (pg_dump
// custom-format, "movexum.dump") till PocketBase: bolag → startups (matchas på
// namn, skapas annars), anteckningar → notes, resten → sustainability_*.
//
//   PB_URL=… PB_SU_EMAIL=… PB_SU_PASSWORD=… \
//   node backend/pocketbase-schema/scripts/import-sustainability-dump.mjs \
//     --dump ./movexum.dump [--tenant movexum] [--fallback-user e-post] [--dry-run]
//
// Idempotent: varje post slås upp på (tenant, external_id) och uppdateras i
// stället för att dubbleras; startups matchas på namn; notes på
// startup + författare + text. Källans användare matchas på e-post mot `users`
// i tenanten — konton skapas aldrig, lösenordshashar och Clerk-id:n läses
// aldrig. Saknas en match används --fallback-user (annars avbryts importen).
// Loggen innehåller bara antal och bolagsnamn — aldrig e-post eller
// anteckningstext. Personnummer saneras i all fritext (§ 15.6).
//
// Kör ALLTID --dry-run först. Importen kräver att migration 1700000206 är
// applicerad (kontrolleras innan något skrivs).

import { readFileSync } from 'node:fs';
import PocketBase from 'pocketbase';
import { authenticateSuperuserWithRetry } from './lib/pb-auth-retry.mjs';
import { readPgDumpArchive, buildImportPlan, summarizePlan, startupNameKey } from './lib/sustainability-import.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const DRY_RUN = args.includes('--dry-run');
const DUMP_PATH = opt('dump');
const TENANT_SLUG = opt('tenant', 'movexum');
const FALLBACK_USER = (opt('fallback-user', '') || '').trim().toLowerCase();

if (!DUMP_PATH) {
  console.error('Användning: --dump <movexum.dump> [--tenant slug] [--fallback-user e-post] [--dry-run]');
  process.exit(1);
}

const log = (...a) => console.log('•', ...a);
const ok = (...a) => console.log('✓', ...a);
const warn = (...a) => console.log('!', ...a);
const maskEmail = (e) => String(e || '').replace(/^(.).*@/, '$1***@');

const archive = readPgDumpArchive(readFileSync(DUMP_PATH));
log(`arkiv: ${archive.dbname} (pg_dump ${archive.pgDumpVersion}, format ${archive.version.join('.')})`);
const plan = buildImportPlan(archive.tables);
log('plan:', JSON.stringify(summarizePlan(plan)));
for (const w of plan.warnings) warn(w);

if (DRY_RUN && (!process.env.PB_URL || !process.env.PB_SU_EMAIL || !process.env.PB_SU_PASSWORD)) {
  ok('dry-run utan PB-anslutning: arkivet tolkades och planen ovan skulle importeras.');
  process.exit(0);
}
if (!process.env.PB_URL || !process.env.PB_SU_EMAIL || !process.env.PB_SU_PASSWORD) {
  console.error('Saknar env: PB_URL, PB_SU_EMAIL, PB_SU_PASSWORD');
  process.exit(1);
}

const pb = new PocketBase(process.env.PB_URL.replace(/\/+$/, ''));
pb.autoCancellation(false);
await authenticateSuperuserWithRetry(pb, process.env.PB_SU_EMAIL, process.env.PB_SU_PASSWORD);

// ─── Schemakontroll (PB släpper okända fält tyst, § 24.4) ───────────────────
const REQUIRED = {
  startups: ['sustainability_journey_text', 'sustainability_status', 'sustainability_assigned_to'],
  sustainability_assessments: ['external_id', 'source_created_at', 'previous_assessment', 'dashboard'],
  sustainability_gap_questions: ['external_id', 'source_created_at'],
  sustainability_materiality_overrides: ['external_id', 'source_created_at'],
  sustainability_update_events: ['external_id', 'source_created_at'],
  sustainability_documents: ['external_id', 'source_created_at', 'extracted_text'],
  sustainability_ai_jobs: ['external_id', 'source_created_at', 'output']
};
const collections = new Map((await pb.collections.getFullList()).map((c) => [c.name, c]));
for (const [name, fields] of Object.entries(REQUIRED)) {
  const col = collections.get(name);
  if (!col) {
    console.error(`Collection "${name}" saknas — kör migration 1700000206 (eller setup-via-api.mjs) först.`);
    process.exit(1);
  }
  const present = new Set((col.fields || []).map((f) => f.name));
  const missing = fields.filter((f) => !present.has(f));
  if (missing.length) {
    console.error(`Collection "${name}" saknar fält ${missing.join(', ')} — kör migration 1700000206 först.`);
    process.exit(1);
  }
}
ok('schema verifierat');

// ─── Tenant + användare ─────────────────────────────────────────────────────
const tenant = await pb.collection('tenants').getFirstListItem(pb.filter('slug = {:s}', { s: TENANT_SLUG }));
ok(`tenant: ${tenant.name || tenant.slug} (${tenant.id})`);

const tenantUsers = await pb.collection('users').getFullList({ filter: pb.filter('tenant = {:t}', { t: tenant.id }) });
const userIdByEmail = new Map(tenantUsers.map((u) => [String(u.email || '').toLowerCase(), u.id]));
const fallbackUserId = FALLBACK_USER ? userIdByEmail.get(FALLBACK_USER) : null;
if (FALLBACK_USER && !fallbackUserId) {
  console.error('--fallback-user finns inte som användare i tenanten.');
  process.exit(1);
}
const sourceUserToPb = new Map();
const unmatched = [];
for (const [sourceId, u] of plan.users) {
  const id = userIdByEmail.get(u.email);
  if (id) sourceUserToPb.set(sourceId, id);
  else unmatched.push(u);
}
if (unmatched.length) {
  warn(`${unmatched.length} av ${plan.users.size} källanvändare saknar konto i tenanten: ${unmatched.map((u) => `${maskEmail(u.email)} (förslag roll: ${u.role || 'okänd'})`).join(', ')}`);
  if (!fallbackUserId) {
    console.error('Skapa kontona under Inställningar → Användare, eller ange --fallback-user <e-post> för att tillskriva deras poster en befintlig användare.');
    process.exit(1);
  }
  warn('deras poster tillskrivs --fallback-user');
}
const userRef = (sourceId) => (sourceId ? sourceUserToPb.get(sourceId) || fallbackUserId || '' : '');

// ─── Hjälpare ───────────────────────────────────────────────────────────────
const counts = {};
const bump = (key) => { counts[key] = (counts[key] || 0) + 1; };

async function upsertByExternalId(collection, externalId, data) {
  let existing = null;
  try {
    existing = await pb.collection(collection).getFirstListItem(
      pb.filter('tenant = {:t} && external_id = {:e}', { t: tenant.id, e: externalId })
    );
  } catch (err) {
    if (err?.status !== 404) throw err;
  }
  if (DRY_RUN) {
    bump(`${collection}:${existing ? 'uppdateras' : 'skapas'}`);
    return existing?.id || `dry:${externalId}`;
  }
  if (existing) {
    await pb.collection(collection).update(existing.id, data);
    bump(`${collection}:uppdaterade`);
    return existing.id;
  }
  const created = await pb.collection(collection).create({ ...data, tenant: tenant.id, external_id: externalId });
  bump(`${collection}:skapade`);
  return created.id;
}

// ─── Bolag → startups ───────────────────────────────────────────────────────
const startups = await pb.collection('startups').getFullList({ filter: pb.filter('tenant = {:t}', { t: tenant.id }), fields: 'id,name' });
const startupByName = new Map(startups.map((s) => [startupNameKey(s.name), s.id]));
const startupBySource = new Map();
for (const c of plan.companies) {
  const sustainability = {
    sustainability_journey_text: c.sustainability_journey_text,
    sustainability_status: c.sustainability_status || '',
    sustainability_assigned_to: userRef(c.sustainability_assigned_to_source)
  };
  const existingId = startupByName.get(startupNameKey(c.name));
  if (existingId) {
    if (!DRY_RUN) await pb.collection('startups').update(existingId, sustainability);
    startupBySource.set(c.source_id, existingId);
    bump('startups:befintliga (hållbarhetsfält satta)');
    log(`bolag "${c.name}" finns — hållbarhetsfält ${DRY_RUN ? 'skulle sättas' : 'satta'}`);
    continue;
  }
  if (DRY_RUN) {
    startupBySource.set(c.source_id, `dry:${c.source_id}`);
    bump('startups:skapas');
    log(`bolag "${c.name}" skulle skapas (fas ${c.phase})`);
    continue;
  }
  const created = await pb.collection('startups').create({
    tenant: tenant.id,
    name: c.name,
    phase: c.phase,
    status: 'active',
    industri: c.industri,
    owner: userRef(c.created_by_source),
    ...sustainability
  });
  startupBySource.set(c.source_id, created.id);
  startupByName.set(startupNameKey(c.name), created.id);
  bump('startups:skapade');
  log(`bolag "${c.name}" skapat (fas ${c.phase})`);
}
const startupRef = (sourceId) => {
  const id = startupBySource.get(sourceId);
  if (!id) throw new Error(`Post refererar bolag ${sourceId} som inte finns i dumpen`);
  return id;
};

// ─── Analyser (version i ordning så previous_assessment finns) ──────────────
const assessmentBySource = new Map();
for (const a of plan.assessments) {
  const prev = a.previous_assessment_source ? assessmentBySource.get(a.previous_assessment_source) : null;
  if (a.previous_assessment_source && !prev) warn(`analys ${a.external_id}: föregående version saknas — kopplingen lämnas tom`);
  const id = await upsertByExternalId('sustainability_assessments', a.external_id, {
    startup: startupRef(a.startup_source),
    version: a.version,
    type: a.type,
    status: a.status,
    framework_version: a.framework_version,
    materiality: a.materiality,
    sufficiency: a.sufficiency,
    dashboard: a.dashboard,
    update_delta: a.update_delta,
    information_quality_score: a.information_quality_score,
    model_name: a.model_name,
    prompt_version: a.prompt_version,
    input_hash: a.input_hash,
    previous_assessment: prev || '',
    created_by: userRef(a.created_by_source),
    completed_at: a.completed_at,
    source_created_at: a.source_created_at
  });
  assessmentBySource.set(a.external_id, id);
}
const assessmentRef = (sourceId) => (sourceId ? assessmentBySource.get(sourceId) || '' : '');

// ─── Uppdateringshändelser ──────────────────────────────────────────────────
const updateEventBySource = new Map();
for (const u of plan.updateEvents) {
  const id = await upsertByExternalId('sustainability_update_events', u.external_id, {
    startup: startupRef(u.startup_source),
    assessment: assessmentRef(u.assessment_source),
    created_by: userRef(u.created_by_source),
    narrative: u.narrative,
    source_created_at: u.source_created_at
  });
  updateEventBySource.set(u.external_id, id);
}

// ─── Kompletteringsfrågor + väsentlighetsjusteringar ───────────────────────
const gapBySource = new Map();
for (const g of plan.gapQuestions) {
  const assessment = assessmentRef(g.assessment_source);
  if (!assessment) { warn(`fråga ${g.external_id}: analysen saknas — hoppas över`); continue; }
  const id = await upsertByExternalId('sustainability_gap_questions', g.external_id, {
    assessment,
    aspect_code: g.aspect_code,
    question: g.question,
    missing_information: g.missing_information,
    severity: g.severity,
    status: g.status,
    answer_text: g.answer_text,
    source_created_at: g.source_created_at
  });
  gapBySource.set(g.external_id, id);
}
for (const o of plan.overrides) {
  const assessment = assessmentRef(o.assessment_source);
  if (!assessment) { warn(`justering ${o.external_id}: analysen saknas — hoppas över`); continue; }
  await upsertByExternalId('sustainability_materiality_overrides', o.external_id, {
    assessment,
    aspect_code: o.aspect_code,
    original_status: o.original_status,
    new_status: o.new_status,
    comment: o.comment,
    created_by: userRef(o.created_by_source),
    source_created_at: o.source_created_at
  });
}

// ─── Dokument (metadata + extraherad text; originalfilen ingår inte i dumpen) ─
for (const d of plan.documents) {
  await upsertByExternalId('sustainability_documents', d.external_id, {
    startup: startupRef(d.startup_source),
    assessment: assessmentRef(d.assessment_source),
    update_event: d.update_event_source ? updateEventBySource.get(d.update_event_source) || '' : '',
    gap_question: d.gap_question_source ? gapBySource.get(d.gap_question_source) || '' : '',
    uploaded_by: userRef(d.uploaded_by_source),
    upload_stage: d.upload_stage,
    original_name: d.original_name,
    mime: d.mime,
    size_bytes: d.size_bytes,
    storage_path: d.storage_path,
    extracted_text: d.extracted_text,
    extraction_status: d.extraction_status || '',
    extraction_warning: d.extraction_warning,
    source_created_at: d.source_created_at
  });
}

// ─── AI-körningar (audit) ───────────────────────────────────────────────────
for (const j of plan.aiJobs) {
  await upsertByExternalId('sustainability_ai_jobs', j.external_id, {
    startup: startupRef(j.startup_source),
    assessment: assessmentRef(j.assessment_source),
    job_type: j.job_type,
    status: j.status,
    input_hash: j.input_hash,
    model_name: j.model_name,
    prompt_version: j.prompt_version,
    output: j.output,
    error: j.error,
    completed_at: j.completed_at,
    source_created_at: j.source_created_at
  });
}

// ─── Anteckningar → notes (ingen external_id: dedupe på bolag + författare + text) ─
for (const n of plan.notes) {
  const startup = startupRef(n.startup_source);
  const author = userRef(n.author_source);
  if (!author) { warn('anteckning utan matchad författare — hoppas över'); continue; }
  if (!n.body) { bump('notes:tomma (hoppade över)'); continue; }
  if (startup.startsWith('dry:')) { bump('notes:skapas'); continue; }
  let existing = null;
  try {
    existing = await pb.collection('notes').getFirstListItem(
      pb.filter('startup = {:s} && author = {:a} && body = {:b}', { s: startup, a: author, b: n.body })
    );
  } catch (err) {
    if (err?.status !== 404) throw err;
  }
  if (existing) { bump('notes:fanns redan'); continue; }
  if (DRY_RUN) { bump('notes:skapas'); continue; }
  await pb.collection('notes').create({ startup, author, body: n.body, confidential: false });
  bump('notes:skapade');
}

console.log(`\n${DRY_RUN ? 'DRY-RUN — inget skrevs.' : 'Import klar.'}`);
for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
console.log('\nOBS: originalfilerna (Vercel Blob) ingår inte i dumpen — sustainability_documents.file är tomt; storage_path är bara referens.');
