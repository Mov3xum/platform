// CLAUDE.md § 56 — REN logik för importen av Hållbarhetsanalysens Postgres-dump
// (pg_dump custom-format, "movexum.dump") till PocketBase. Ingen IO, inga
// beroenden utöver node:zlib. Enhetstestad i ../sustainability-import.test.mjs.
//
// Enum-värdena nedan MÅSTE spegla migration 1700000206.

import { inflateSync } from 'node:zlib';

export const SUSTAINABILITY_STATUSES = ['draft', 'materiality_review', 'info_collection', 'needs_more_info', 'analyzed'];
export const ASSESSMENT_TYPES = ['initial', 'update'];
export const ASSESSMENT_STATUSES = [
  'materiality_pending',
  'materiality_review',
  'info_pending',
  'needs_more_info',
  'final_pending',
  'complete',
  'failed'
];
export const GAP_SEVERITIES = ['required', 'recommended'];
export const GAP_STATUSES = ['open', 'answered', 'not_available'];
export const UPLOAD_STAGES = ['idea_description', 'full_information', 'gap_response', 'update'];
export const EXTRACTION_STATUSES = ['pending', 'complete', 'failed'];
export const AI_JOB_TYPES = ['materiality', 'sufficiency', 'final_analysis', 'update_analysis'];
export const AI_JOB_STATUSES = ['pending', 'running', 'complete', 'failed'];

/** Källans CompanyPhase → startups.phase (migration 1700000043). */
export const PHASE_MAP = {
  SCREENING: 'lead',
  BOOST_CHAMBER: 'boost_chamber',
  INKUBATOR: 'incubation',
  ACCELERATOR: 'acceleration',
  ALUMNI: 'alumni',
  EXIT: 'alumni'
};

/** Källans UserRole → roll i `users.roles` (bara som förslag vid rapportering — importen skapar inga konton). */
export const ROLE_MAP = {
  ADMIN: 'admin',
  INFLOW: 'incubator_lead',
  COACH: 'coach',
  BUSINESS_DEVELOPER: 'mentor'
};

// Samma regex som CRM-importen (§ 15.6) och övriga importvägar.
const PERSONNUMMER = /\d{6,8}[-+]?\d{4}/g;

export function sanitizeFreeText(value, max = Infinity) {
  if (value === null || value === undefined) return '';
  let s = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(PERSONNUMMER, '[REDACTED]');
  if (s.length > max) s = s.slice(0, max);
  return s;
}

/** Enum i källan (VERSALER) → gemener; okänt värde ⇒ null (aldrig en gissning). */
export function mapEnum(value, allowed) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim().toLowerCase();
  return allowed.includes(v) ? v : null;
}

export function mapPhase(value) {
  return PHASE_MAP[String(value || '').toUpperCase()] || null;
}

/** "2026-09-15 12:37:28.856" (UTC, timestamp without time zone) → PocketBase-datum. */
export function toPbDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,6})?$/.exec(s);
  if (!m) return '';
  const ms = m[3] ? (m[3] + '000').slice(0, 4) : '.000';
  return `${m[1]} ${m[2]}${ms}Z`;
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Klartext → notes.body (editor/HTML): ett <p> per stycke, escapad. */
export function plainTextToEditorHtml(text) {
  const paragraphs = String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return '';
  return paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

// ─── COPY-text ───────────────────────────────────────────────────────────────

/** Avkodar ett värde i PostgreSQL COPY-textformat (\N = NULL). */
export function unescapeCopyValue(raw) {
  if (raw === '\\N') return null;
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = raw[++i];
    switch (n) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'v': out += '\v'; break;
      case '\\': out += '\\'; break;
      case 'x': {
        const hex = /^[0-9a-fA-F]{1,2}/.exec(raw.slice(i + 1));
        if (hex) { out += String.fromCharCode(parseInt(hex[0], 16)); i += hex[0].length; } else out += 'x';
        break;
      }
      default:
        if (n >= '0' && n <= '7') {
          const oct = /^[0-7]{1,3}/.exec(raw.slice(i));
          out += String.fromCharCode(parseInt(oct[0], 8));
          i += oct[0].length - 1;
        } else if (n !== undefined) {
          out += n;
        }
    }
  }
  return out;
}

/** `COPY public."Company" (id, name, …) FROM stdin;` + rader → { columns, rows[] }. */
export function parseCopyData(copyStmt, dataText) {
  const m = /COPY\s+\S+\s*\(([^)]*)\)\s+FROM\s+stdin/i.exec(copyStmt);
  if (!m) throw new Error('Oväntad COPY-sats i arkivet');
  const columns = m[1].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (const line of String(dataText).split('\n')) {
    if (line === '' || line === '\\.') continue;
    const parts = line.split('\t');
    if (parts.length !== columns.length) throw new Error(`COPY-rad med ${parts.length} fält, väntade ${columns.length}`);
    const row = {};
    columns.forEach((col, i) => { row[col] = unescapeCopyValue(parts[i]); });
    rows.push(row);
  }
  return { columns, rows };
}

// ─── pg_dump custom-format ──────────────────────────────────────────────────

class Reader {
  constructor(buf) { this.buf = buf; this.pos = 0; this.intSize = 4; this.offSize = 8; }
  byte() { return this.buf[this.pos++]; }
  raw(n) { const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  int() {
    const sign = this.byte();
    let v = 0;
    for (let i = 0; i < this.intSize; i++) v += this.buf[this.pos + i] * 2 ** (8 * i);
    this.pos += this.intSize;
    return sign ? -v : v;
  }
  str() { const n = this.int(); if (n < 0) return null; return this.raw(n).toString('utf8'); }
  offset() {
    const flag = this.byte();
    let v = 0;
    for (let i = 0; i < this.offSize; i++) v += this.buf[this.pos + i] * 2 ** (8 * i);
    this.pos += this.offSize;
    return { flag, value: v };
  }
}

const COMPRESSION_NONE = 0;
const COMPRESSION_GZIP = 1;

/**
 * Läser ett pg_dump custom-format-arkiv (format 1 "custom", version 1.12–1.16)
 * utan pg_restore. Returnerar header, TOC och TABLE DATA per tabell.
 */
export function readPgDumpArchive(buffer) {
  const r = new Reader(buffer);
  if (r.raw(5).toString('latin1') !== 'PGDMP') throw new Error('Inte ett pg_dump-arkiv (saknar PGDMP-signatur)');
  const version = [r.byte(), r.byte(), r.byte()];
  const vnum = version[0] * 10000 + version[1] * 100 + version[2];
  if (vnum < 11200 || vnum > 11699) throw new Error(`Arkivversion ${version.join('.')} stöds inte (1.12–1.16)`);
  r.intSize = r.byte();
  r.offSize = r.byte();
  const format = r.byte();
  if (format !== 1) throw new Error(`Arkivformat ${format} stöds inte (bara custom)`);
  const compression = vnum >= 11500 ? r.byte() : r.int();
  if (compression !== COMPRESSION_NONE && compression !== COMPRESSION_GZIP) {
    throw new Error(`Komprimering ${compression} stöds inte (bara ingen/gzip)`);
  }
  for (let i = 0; i < 7; i++) r.int(); // crtm_* (skapandetid)
  const dbname = r.str();
  const serverVersion = r.str();
  const pgDumpVersion = r.str();

  const tocCount = r.int();
  const entries = [];
  for (let i = 0; i < tocCount; i++) {
    const e = {};
    e.dumpId = r.int();
    e.hadDumper = r.int();
    e.tableoid = r.str();
    e.oid = r.str();
    e.tag = r.str();
    e.desc = r.str();
    e.section = r.int();
    e.defn = r.str();
    e.dropStmt = r.str();
    e.copyStmt = r.str();
    e.namespace = r.str();
    e.tablespace = r.str();
    if (vnum >= 11400) e.tableam = r.str();
    if (vnum >= 11600) e.relkind = r.int();
    e.owner = r.str();
    r.str(); // "with oids"
    e.deps = [];
    for (;;) {
      const d = r.str();
      if (d === null) break;
      e.deps.push(Number(d));
    }
    const off = r.offset();
    e.dataFlag = off.flag;
    e.dataPos = off.value;
    entries.push(e);
  }

  const tables = new Map();
  for (const e of entries) {
    if (e.desc !== 'TABLE DATA' || e.dataFlag !== 2) continue;
    r.pos = e.dataPos;
    const blockType = r.byte();
    const dumpId = r.int();
    if (blockType !== 1 || dumpId !== e.dumpId) throw new Error(`Datablock för ${e.tag} matchar inte TOC`);
    const chunks = [];
    for (;;) {
      const n = r.int();
      if (n === 0) break;
      chunks.push(Buffer.from(r.raw(n)));
    }
    let data = Buffer.concat(chunks);
    if (compression === COMPRESSION_GZIP) data = inflateSync(data);
    tables.set(e.tag, parseCopyData(e.copyStmt, data.toString('utf8')));
  }
  return { version, dbname, serverVersion, pgDumpVersion, compression, entries, tables };
}

// ─── Normalisering till PocketBase-poster ───────────────────────────────────

function jsonOrNull(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function tableRows(tables, name) {
  const t = tables.get(name);
  return t ? t.rows : [];
}

/**
 * Bygger en ren importplan ur arkivets tabeller. Alla relationer uttrycks med
 * KÄLLANS id:n (`*_source`); CLI:t byter dem mot PocketBase-id:n i
 * beroendeordning. Inga användar-e-postadresser, lösenordshashar eller
 * Clerk-id:n följer med — bara en PII-fri tabell `users` med källans id → e-post
 * i gemener (används enbart för uppslag mot `users` och loggas aldrig).
 */
export function buildImportPlan(tables) {
  const warnings = [];
  const users = new Map();
  for (const u of tableRows(tables, 'User')) {
    users.set(u.id, { email: String(u.email || '').trim().toLowerCase(), role: ROLE_MAP[u.role] || null });
  }

  const companies = tableRows(tables, 'Company').map((c) => {
    const phase = mapPhase(c.phase);
    if (!phase) warnings.push(`Company ${c.id}: okänd fas "${c.phase}" — bolaget skapas med fasen "lead"`);
    const status = mapEnum(c.status, SUSTAINABILITY_STATUSES);
    if (!status) warnings.push(`Company ${c.id}: okänd status "${c.status}" — lämnas tom`);
    return {
      source_id: c.id,
      name: sanitizeFreeText(c.name, 200).trim(),
      phase: phase || 'lead',
      industri: sanitizeFreeText(c.industry, 200).trim(),
      sustainability_journey_text: sanitizeFreeText(c.journeyText, 20000),
      sustainability_status: status,
      sustainability_assigned_to_source: c.assignedToId || null,
      created_by_source: c.createdById || null,
      source_created_at: toPbDate(c.createdAt)
    };
  });

  const assessments = tableRows(tables, 'Assessment')
    .map((a) => {
      const type = mapEnum(a.type, ASSESSMENT_TYPES);
      const status = mapEnum(a.status, ASSESSMENT_STATUSES);
      if (!type || !status) {
        warnings.push(`Assessment ${a.id}: okänd typ/status "${a.type}"/"${a.status}" — hoppas över`);
        return null;
      }
      const score = a.informationQualityScore === null ? null : Number(a.informationQualityScore);
      return {
        external_id: a.id,
        startup_source: a.companyId,
        version: Number(a.version),
        type,
        status,
        framework_version: sanitizeFreeText(a.frameworkVersion, 60) || 'unknown',
        materiality: jsonOrNull(a.materialityJson),
        sufficiency: jsonOrNull(a.sufficiencyJson),
        dashboard: jsonOrNull(a.dashboardJson),
        update_delta: jsonOrNull(a.updateDeltaJson),
        information_quality_score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
        model_name: sanitizeFreeText(a.modelName, 80),
        prompt_version: sanitizeFreeText(a.promptVersion, 60),
        input_hash: sanitizeFreeText(a.inputHash, 128),
        previous_assessment_source: a.previousAssessmentId || null,
        created_by_source: a.createdById || null,
        completed_at: toPbDate(a.completedAt),
        source_created_at: toPbDate(a.createdAt)
      };
    })
    .filter(Boolean)
    // Föregående version måste finnas innan nästa skrivs (self-relation).
    .sort((x, y) => (x.startup_source < y.startup_source ? -1 : x.startup_source > y.startup_source ? 1 : x.version - y.version));

  const gapQuestions = tableRows(tables, 'GapQuestion')
    .map((g) => {
      const severity = mapEnum(g.severity, GAP_SEVERITIES);
      const status = mapEnum(g.status, GAP_STATUSES);
      if (!severity || !status) {
        warnings.push(`GapQuestion ${g.id}: okänd severity/status — hoppas över`);
        return null;
      }
      return {
        external_id: g.id,
        assessment_source: g.assessmentId,
        aspect_code: sanitizeFreeText(g.aspectCode, 40),
        question: sanitizeFreeText(g.question, 2000),
        missing_information: sanitizeFreeText(g.missingInformation, 2000),
        severity,
        status,
        answer_text: sanitizeFreeText(g.answerText, 10000),
        source_created_at: toPbDate(g.createdAt)
      };
    })
    .filter(Boolean);

  const overrides = tableRows(tables, 'MaterialityOverride').map((o) => ({
    external_id: o.id,
    assessment_source: o.assessmentId,
    aspect_code: sanitizeFreeText(o.aspectCode, 40),
    original_status: sanitizeFreeText(o.originalStatus, 40).toLowerCase(),
    new_status: sanitizeFreeText(o.newStatus, 40).toLowerCase(),
    comment: sanitizeFreeText(o.comment, 5000),
    created_by_source: o.createdById || null,
    source_created_at: toPbDate(o.createdAt)
  }));

  const updateEvents = tableRows(tables, 'UpdateEvent').map((u) => ({
    external_id: u.id,
    startup_source: u.companyId,
    assessment_source: u.assessmentId || null,
    created_by_source: u.createdById || null,
    narrative: sanitizeFreeText(u.narrative, 20000),
    source_created_at: toPbDate(u.createdAt)
  }));

  const documents = tableRows(tables, 'Document')
    .map((d) => {
      const stage = mapEnum(d.uploadStage, UPLOAD_STAGES);
      if (!stage) {
        warnings.push(`Document ${d.id}: okänt uploadStage "${d.uploadStage}" — hoppas över`);
        return null;
      }
      return {
        external_id: d.id,
        startup_source: d.companyId,
        assessment_source: d.assessmentId || null,
        update_event_source: d.updateEventId || null,
        gap_question_source: d.gapQuestionId || null,
        uploaded_by_source: d.uploadedById || null,
        upload_stage: stage,
        original_name: sanitizeFreeText(d.originalName, 300) || 'dokument',
        mime: sanitizeFreeText(d.mimeType, 150),
        size_bytes: Number.isFinite(Number(d.sizeBytes)) ? Number(d.sizeBytes) : null,
        storage_path: sanitizeFreeText(d.storagePath, 500),
        extracted_text: sanitizeFreeText(d.extractedText, 300000),
        extraction_status: mapEnum(d.extractionStatus, EXTRACTION_STATUSES),
        extraction_warning: sanitizeFreeText(d.extractionWarning, 500),
        // openaiFileId importeras MEDVETET inte (referens till US-leverantör, § 10.2).
        source_created_at: toPbDate(d.createdAt)
      };
    })
    .filter(Boolean);

  const aiJobs = tableRows(tables, 'AIJob')
    .map((j) => {
      const jobType = mapEnum(j.jobType, AI_JOB_TYPES);
      const status = mapEnum(j.status, AI_JOB_STATUSES);
      if (!jobType || !status) {
        warnings.push(`AIJob ${j.id}: okänd typ/status — hoppas över`);
        return null;
      }
      return {
        external_id: j.id,
        startup_source: j.companyId,
        assessment_source: j.assessmentId || null,
        job_type: jobType,
        status,
        input_hash: sanitizeFreeText(j.inputHash, 128),
        model_name: sanitizeFreeText(j.modelName, 80),
        prompt_version: sanitizeFreeText(j.promptVersion, 60),
        output: jsonOrNull(j.outputJson),
        error: sanitizeFreeText(j.error, 2000),
        completed_at: toPbDate(j.completedAt),
        source_created_at: toPbDate(j.createdAt)
      };
    })
    .filter(Boolean);

  const notes = tableRows(tables, 'Note').map((n) => ({
    source_id: n.id,
    startup_source: n.companyId,
    author_source: n.userId,
    body: plainTextToEditorHtml(sanitizeFreeText(n.body, 20000)),
    source_created_at: toPbDate(n.createdAt)
  }));

  return { users, companies, assessments, gapQuestions, overrides, updateEvents, documents, aiJobs, notes, warnings };
}

/** PII-fri sammanfattning av en plan (antal per tabell). */
export function summarizePlan(plan) {
  return {
    users: plan.users.size,
    companies: plan.companies.length,
    assessments: plan.assessments.length,
    gapQuestions: plan.gapQuestions.length,
    overrides: plan.overrides.length,
    updateEvents: plan.updateEvents.length,
    documents: plan.documents.length,
    aiJobs: plan.aiJobs.length,
    notes: plan.notes.length,
    warnings: plan.warnings.length
  };
}

/** Case-/whitespace-okänslig nyckel för att matcha Company.name mot startups.name. */
export function startupNameKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
