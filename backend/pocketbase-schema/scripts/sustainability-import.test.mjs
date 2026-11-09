// CLAUDE.md § 56 — tester för den rena importlogiken (lib/sustainability-import.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  readPgDumpArchive,
  parseCopyData,
  unescapeCopyValue,
  sanitizeFreeText,
  mapEnum,
  mapPhase,
  toPbDate,
  plainTextToEditorHtml,
  buildImportPlan,
  summarizePlan,
  startupNameKey,
  SUSTAINABILITY_STATUSES,
  ASSESSMENT_STATUSES,
  ASSESSMENT_TYPES,
  GAP_SEVERITIES,
  GAP_STATUSES,
  UPLOAD_STAGES,
  EXTRACTION_STATUSES,
  AI_JOB_TYPES,
  AI_JOB_STATUSES
} from './lib/sustainability-import.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(join(here, '..', 'migrations', '1700000206_create_sustainability_analysis.js'), 'utf8');

// ─── Minimal skrivare för pg_dump custom-format (spegel av läsaren) ──────────
function buildArchive(tables, { version = [1, 16, 0], compress = true } = {}) {
  const parts = [];
  const byte = (b) => parts.push(Buffer.from([b]));
  const int = (v) => {
    const sign = v < 0 ? 1 : 0;
    const abs = Math.abs(v);
    const b = Buffer.alloc(5);
    b[0] = sign;
    b.writeUInt32LE(abs, 1);
    parts.push(b);
  };
  const str = (s) => {
    if (s === null) return int(-1);
    const b = Buffer.from(s, 'utf8');
    int(b.length);
    parts.push(b);
  };
  parts.push(Buffer.from('PGDMP', 'latin1'));
  byte(version[0]); byte(version[1]); byte(version[2]);
  byte(4); byte(8); byte(1);
  const vnum = version[0] * 10000 + version[1] * 100 + version[2];
  if (vnum >= 11500) byte(compress ? 1 : 0); else int(compress ? 1 : 0);
  for (let i = 0; i < 7; i++) int(0);
  str('testdb'); str('18.6'); str('18.6');
  int(tables.length);
  const dataOffsets = [];
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    int(100 + i); int(1); str('1259'); str('1000'); str(t.tag); str('TABLE DATA'); int(3);
    str(''); str(''); str(`COPY public."${t.tag}" (${t.columns.map((c) => `"${c}"`).join(', ')}) FROM stdin;\n`);
    str('public'); str(''); str('');
    if (vnum >= 11600) int(114);
    str('owner'); str('false');
    str(null);
    parts.push(Buffer.from([2]));
    const off = Buffer.alloc(8);
    dataOffsets.push({ idx: parts.length, off });
    parts.push(off);
  }
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const pos = Buffer.concat(parts).length;
    dataOffsets[i].off.writeBigUInt64LE(BigInt(pos));
    byte(1); int(100 + i);
    let data = Buffer.from(t.rows.map((r) => r.join('\t')).join('\n') + '\n\\.\n', 'utf8');
    if (compress) data = deflateSync(data);
    // två chunkar så att sammanfogningen testas
    const half = Math.ceil(data.length / 2);
    for (const chunk of [data.subarray(0, half), data.subarray(half)]) {
      if (chunk.length === 0) continue;
      int(chunk.length); parts.push(chunk);
    }
    int(0);
  }
  return Buffer.concat(parts);
}

const FIXTURE_TABLES = [
  { tag: 'User', columns: ['id', 'name', 'email', 'passwordHash', 'role', 'createdAt', 'updatedAt', 'clerkUserId'],
    rows: [['u1', 'Admin', 'Admin@Example.se', 'hash', 'ADMIN', '2026-06-23 13:41:38.973', '2026-06-23 13:41:38.973', '\\N'],
           ['u2', 'Coach', 'coach@example.se', '', 'COACH', '2026-06-23 13:41:38.973', '2026-06-23 13:41:38.973', 'user_x']] },
  { tag: 'Company', columns: ['id', 'name', 'phase', 'industry', 'journeyText', 'status', 'createdById', 'assignedToId', 'createdAt', 'updatedAt'],
    rows: [['c1', 'Tooly AB', 'SCREENING', 'Delningsekonomi', 'Rad ett.\\n\\nRad två med personnr 19900101-1234.', 'ANALYZED', 'u1', 'u2', '2026-08-11 09:08:12.183', '2026-08-11 09:08:12.183'],
           ['c2', 'Okänd fas AB', 'MYSTERY', 'Test', 'x', 'WEIRD', 'u1', '\\N', '2026-08-11 09:08:12', '2026-08-11 09:08:12']] },
  { tag: 'Assessment', columns: ['id', 'companyId', 'version', 'type', 'status', 'frameworkVersion', 'materialityJson', 'sufficiencyJson', 'dashboardJson', 'updateDeltaJson', 'informationQualityScore', 'modelName', 'promptVersion', 'inputHash', 'previousAssessmentId', 'createdById', 'createdAt', 'completedAt'],
    rows: [['a2', 'c1', '2', 'UPDATE', 'COMPLETE', 'movexum-v0.1', '\\N', '\\N', '{"risks": [], "impactLevel": {"level": "IMPACT_DRIVEN"}}', '{"newRisks": []}', '90', 'gpt-x', 'v3', 'abc', 'a1', 'u1', '2026-09-08 16:52:51.96', '2026-09-08 16:57:31.998'],
           ['a1', 'c1', '1', 'INITIAL', 'COMPLETE', 'movexum-v0.1', '{"warnings": ["w"]}', '{"readyForFinalAnalysis": true}', '\\N', '\\N', '62', 'gpt-x', 'v1', 'abc', '\\N', 'u1', '2026-08-11 09:08:12.183', '2026-08-11 09:18:16.794']] },
  { tag: 'GapQuestion', columns: ['id', 'assessmentId', 'aspectCode', 'question', 'missingInformation', 'severity', 'status', 'answerText', 'createdAt', 'updatedAt'],
    rows: [['g1', 'a1', 'OWN-GOV-01', 'Fråga?', 'Saknas', 'REQUIRED', 'OPEN', '\\N', '2026-08-11 09:18:16', '2026-08-11 09:18:16']] },
  { tag: 'MaterialityOverride', columns: ['id', 'assessmentId', 'aspectCode', 'originalStatus', 'newStatus', 'comment', 'createdById', 'createdAt'],
    rows: [['m1', 'a1', 'OWN-SOC-01', 'MATERIAL', 'NOT_MATERIAL', '', 'u1', '2026-08-13 07:40:00']] },
  { tag: 'UpdateEvent', columns: ['id', 'companyId', 'assessmentId', 'createdById', 'narrative', 'createdAt'],
    rows: [['e1', 'c1', 'a2', 'u1', 'Vi testade.', '2026-09-08 16:52:51.96']] },
  { tag: 'Document', columns: ['id', 'companyId', 'uploadedById', 'assessmentId', 'updateEventId', 'gapQuestionId', 'uploadStage', 'originalName', 'mimeType', 'sizeBytes', 'storagePath', 'extractedText', 'extractionStatus', 'extractionWarning', 'openaiFileId', 'createdAt'],
    rows: [['d1', 'c1', 'u1', 'a1', '\\N', '\\N', 'IDEA_DESCRIPTION', 'Idé.pdf', 'application/pdf', '12345', '/tmp/x.pdf', 'Text med 900101-1234 i.', 'COMPLETE', '\\N', 'file-openai-123', '2026-08-11 09:08:12.5']] },
  { tag: 'AIJob', columns: ['id', 'companyId', 'assessmentId', 'jobType', 'status', 'inputHash', 'modelName', 'promptVersion', 'outputJson', 'error', 'createdAt', 'completedAt'],
    rows: [['j1', 'c1', 'a1', 'MATERIALITY', 'COMPLETE', 'abc', 'gpt-x', 'v1', '{"a": 1}', '\\N', '2026-08-11 09:08:12', '2026-08-11 09:10:00'],
           ['j2', 'c1', 'a1', 'FINAL_ANALYSIS', 'FAILED', 'abc', 'gpt-x', 'v1', '\\N', 'Anropet tog för lång tid.', '2026-08-11 09:08:12', '\\N']] },
  { tag: 'Note', columns: ['id', 'companyId', 'userId', 'body', 'createdAt', 'updatedAt'],
    rows: [['n1', 'c1', 'u2', 'Träffade <bolaget> idag\\n& kul!', '2026-08-13 07:26:55.532', '2026-08-13 07:26:55.532']] }
];

test('unescapeCopyValue: \\N, kontrolltecken och bakstreck', () => {
  assert.equal(unescapeCopyValue('\\N'), null);
  assert.equal(unescapeCopyValue('a\\nb\\tc\\\\d'), 'a\nb\tc\\d');
  assert.equal(unescapeCopyValue('\\x41\\101'), 'AA');
});

test('parseCopyData: kolumner och rader', () => {
  const r = parseCopyData('COPY public."T" (id, "camelCase") FROM stdin;\n', 'x\t\\N\ny\tz\n\\.\n');
  assert.deepEqual(r.columns, ['id', 'camelCase']);
  assert.deepEqual(r.rows, [{ id: 'x', camelCase: null }, { id: 'y', camelCase: 'z' }]);
  assert.throws(() => parseCopyData('COPY public."T" (id) FROM stdin;', 'a\tb\n'), /väntade 1/);
});

test('readPgDumpArchive: läser header, TOC och komprimerad TABLE DATA', () => {
  const a = readPgDumpArchive(buildArchive(FIXTURE_TABLES));
  assert.deepEqual(a.version, [1, 16, 0]);
  assert.equal(a.dbname, 'testdb');
  assert.equal(a.compression, 1);
  assert.equal(a.tables.get('Company').rows.length, 2);
  assert.equal(a.tables.get('Company').rows[0].name, 'Tooly AB');
  assert.equal(a.tables.get('User').rows[0].clerkUserId, null);
});

test('readPgDumpArchive: okomprimerat 1.14-arkiv och felaktiga arkiv', () => {
  const a = readPgDumpArchive(buildArchive(FIXTURE_TABLES.slice(0, 1), { version: [1, 14, 0], compress: false }));
  assert.equal(a.tables.get('User').rows.length, 2);
  assert.throws(() => readPgDumpArchive(Buffer.from('NOPE12345')), /PGDMP/);
  assert.throws(() => readPgDumpArchive(buildArchive([], { version: [1, 11, 0] })), /stöds inte/);
});

test('sanitizeFreeText: personnummer maskas, styrtecken tas bort, längd kapas', () => {
  assert.equal(sanitizeFreeText('pnr 19900101-1234 och 900101+1234\u0007'), 'pnr [REDACTED] och [REDACTED]');
  assert.equal(sanitizeFreeText(null), '');
  assert.equal(sanitizeFreeText('abcdef', 3), 'abc');
});

test('mapEnum/mapPhase: källans versaler → gemener, okänt ⇒ null', () => {
  assert.equal(mapEnum('COMPLETE', ASSESSMENT_STATUSES), 'complete');
  assert.equal(mapEnum('WEIRD', ASSESSMENT_STATUSES), null);
  assert.equal(mapPhase('INKUBATOR'), 'incubation');
  assert.equal(mapPhase('EXIT'), 'alumni');
  assert.equal(mapPhase('nonsense'), null);
});

test('toPbDate: Postgres-tidsstämpel utan zon → PB-format i UTC', () => {
  assert.equal(toPbDate('2026-09-15 12:37:28.856'), '2026-09-15 12:37:28.856Z');
  assert.equal(toPbDate('2026-09-15 12:37:28'), '2026-09-15 12:37:28.000Z');
  assert.equal(toPbDate('2026-09-15 12:37:28.5'), '2026-09-15 12:37:28.500Z');
  assert.equal(toPbDate(null), '');
  assert.equal(toPbDate('igår'), '');
});

test('plainTextToEditorHtml: escapar och styckeindelar', () => {
  assert.equal(plainTextToEditorHtml('a <b>\nc\n\nd & e'), '<p>a &lt;b&gt;<br>c</p><p>d &amp; e</p>');
  assert.equal(plainTextToEditorHtml('   '), '');
});

test('buildImportPlan: mappar, sanerar och bär källans id:n — aldrig lösenord/Clerk', () => {
  const plan = buildImportPlan(readPgDumpArchive(buildArchive(FIXTURE_TABLES)).tables);
  assert.deepEqual(summarizePlan(plan), {
    users: 2, companies: 2, assessments: 2, gapQuestions: 1, overrides: 1, updateEvents: 1, documents: 1, aiJobs: 2, notes: 1, warnings: 2
  });
  assert.equal(plan.users.get('u1').email, 'admin@example.se');
  assert.equal(plan.users.get('u2').role, 'coach');
  assert.equal(JSON.stringify([...plan.users.values()]).includes('hash'), false);
  assert.equal(JSON.stringify([...plan.users.values()]).includes('user_x'), false);

  const [c1, c2] = plan.companies;
  assert.equal(c1.phase, 'lead');
  assert.equal(c1.sustainability_status, 'analyzed');
  assert.equal(c1.sustainability_assigned_to_source, 'u2');
  assert.equal(c1.sustainability_journey_text, 'Rad ett.\n\nRad två med personnr [REDACTED].');
  assert.equal(c2.phase, 'lead');
  assert.equal(c2.sustainability_status, null);
  assert.match(plan.warnings.join('\n'), /okänd fas "MYSTERY"/);

  // Analyser sorteras per bolag och version så previous_assessment finns före nästa.
  assert.deepEqual(plan.assessments.map((a) => a.version), [1, 2]);
  assert.equal(plan.assessments[1].previous_assessment_source, 'a1');
  assert.deepEqual(plan.assessments[1].dashboard.impactLevel, { level: 'IMPACT_DRIVEN' });
  assert.equal(plan.assessments[0].information_quality_score, 62);
  assert.equal(plan.assessments[1].completed_at, '2026-09-08 16:57:31.998Z');

  assert.equal(plan.overrides[0].new_status, 'not_material');
  assert.equal(plan.documents[0].extracted_text, 'Text med [REDACTED] i.');
  assert.equal('openai_file_id' in plan.documents[0], false);
  assert.equal(JSON.stringify(plan.documents).includes('file-openai-123'), false);
  assert.equal(plan.aiJobs[1].status, 'failed');
  assert.equal(plan.aiJobs[1].output, null);
  assert.equal(plan.notes[0].body, '<p>Träffade &lt;bolaget&gt; idag<br>&amp; kul!</p>');
});

test('startupNameKey: skiftläge och whitespace', () => {
  assert.equal(startupNameKey('  Tooly   AB '), 'tooly ab');
  assert.equal(startupNameKey('TOOLY AB'), startupNameKey('tooly ab'));
});

test('enum-vokabulären speglar migration 1700000206', () => {
  const expectList = (constName, values) => {
    const m = new RegExp(`const ${constName} = \\[([^\\]]*)\\]`).exec(MIGRATION);
    assert.ok(m, `${constName} saknas i migrationen`);
    const inMigration = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    assert.deepEqual(inMigration, values, `${constName} avviker från lib/sustainability-import.mjs`);
  };
  expectList('SUSTAINABILITY_STATUSES', SUSTAINABILITY_STATUSES);
  expectList('ASSESSMENT_TYPES', ASSESSMENT_TYPES);
  expectList('ASSESSMENT_STATUSES', ASSESSMENT_STATUSES);
  expectList('GAP_SEVERITIES', GAP_SEVERITIES);
  expectList('GAP_STATUSES', GAP_STATUSES);
  expectList('UPLOAD_STAGES', UPLOAD_STAGES);
  expectList('EXTRACTION_STATUSES', EXTRACTION_STATUSES);
  expectList('AI_JOB_TYPES', AI_JOB_TYPES);
  expectList('AI_JOB_STATUSES', AI_JOB_STATUSES);
});
