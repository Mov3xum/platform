'use server';

import { requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import { parseXlsx, type Row } from '@/lib/import/xlsx';
import { sanitizePersonnummer } from '@/lib/import/crm-excel';
import { escFilter as esc } from '@/lib/pb-filter';
import { recordActivity } from './record-activity';
import {
  listImportableCollections,
  type ImportCollection,
  type ImportField
} from '@/lib/import/importable';
import {
  coerceScalar,
  isTextField,
  type AnalyzedSheet,
  type ImportConfig,
  type SheetHeader,
  type SheetMapping
} from '@/lib/import/mapping';

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_ISSUES_PER_SHEET = 50;
const ALLOWED_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream'
]);

// ── Resultattyper ──────────────────────────────────────────────────
export type AnalyzeState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'ok'; sheets: AnalyzedSheet[]; collections: ImportCollection[] };

export interface SheetOutcome {
  sheet: string;
  collection: string;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  /** Kolumner som inte mappades — kommer INTE med i importen. */
  unmappedColumns: string[];
  mappedFields: string[];
  issues: string[];
}

export type RunState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'ok';
      dryRun: boolean;
      sheets: SheetOutcome[];
      totals: { created: number; updated: number; skipped: number };
    };

// ── Filinläsning ───────────────────────────────────────────────────
function isZipMagic(buf: Buffer): boolean {
  return (
    buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)
  );
}

async function readUploadedFile(
  formData: FormData
): Promise<{ ok: true; buf: Buffer } | { ok: false; message: string }> {
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, message: 'Ingen fil bifogad.' };
  if (file.size === 0) return { ok: false, message: 'Filen är tom.' };
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: `Filen är större än ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
  }
  if (file.type && !ALLOWED_MIMES.has(file.type)) {
    return { ok: false, message: `Filtyp "${file.type}" stöds inte. Förväntar .xlsx (OOXML).` };
  }
  const buf = Buffer.from(await file.arrayBuffer());
  if (!isZipMagic(buf)) {
    return { ok: false, message: 'Filen ser inte ut som en .xlsx (ZIP-magic saknas).' };
  }
  return { ok: true, buf };
}

// ── Ark-hjälpare ───────────────────────────────────────────────────
function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function extractHeaders(rows: Row[]): SheetHeader[] {
  if (rows.length === 0) return [];
  const header = rows[0];
  const cols = Object.keys(header).filter((c) => header[c] && header[c].trim());
  cols.sort((a, b) => colIndex(a) - colIndex(b));
  return cols.map((c) => ({ column: c, label: header[c].trim() }));
}

function dataRows(rows: Row[]): Row[] {
  return rows.slice(1).filter((r) => Object.values(r).some((v) => v && v.trim()));
}

// ── analyze ────────────────────────────────────────────────────────
async function requireAdmin() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin'])) {
    return { ok: false as const, message: 'Endast administratörer får köra importer.' };
  }
  return { ok: true as const, user };
}

export async function analyzeImportAction(formData: FormData): Promise<AnalyzeState> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: 'error', message: auth.message };

  const upload = await readUploadedFile(formData);
  if (!upload.ok) return { status: 'error', message: upload.message };

  let sheetsMap: Map<string, Row[]>;
  try {
    sheetsMap = parseXlsx(upload.buf).sheets;
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Kunde inte läsa XLSX-filen.'
    };
  }

  const sheets: AnalyzedSheet[] = [];
  for (const [name, rows] of sheetsMap) {
    const headers = extractHeaders(rows);
    if (headers.length === 0) continue;
    const data = dataRows(rows);
    const sample = data.slice(0, 5).map((r) => headers.map((h) => (r[h.column] ?? '').trim()));
    sheets.push({ sheet: name, headers, rowCount: data.length, sample });
  }

  if (sheets.length === 0) {
    return { status: 'error', message: 'Inga ark med rubriker hittades i filen.' };
  }

  const collections = await listImportableCollections();
  if (collections.length === 0) {
    return {
      status: 'error',
      message: 'Kunde inte läsa databasschemat (superuser-credentials saknas?).'
    };
  }

  return { status: 'ok', sheets, collections };
}

// ── Relation-uppslag (cachat per körning) ──────────────────────────
const RELATION_KEY_FIELDS = ['name', 'title', 'org_nr', 'email', 'kpi_name'];

async function resolveRelation(
  pb: PocketBase,
  target: ImportCollection,
  tenant: string,
  raw: string,
  cache: Map<string, string | null>
): Promise<string | null> {
  const value = raw.trim();
  if (!value) return null;
  const key = `${target.name}::${value}`;
  if (cache.has(key)) return cache.get(key)!;

  // PB-id-format → använd direkt.
  if (/^[a-z0-9]{15}$/.test(value)) {
    cache.set(key, value);
    return value;
  }

  const targetFieldNames = new Set(target.fields.map((f) => f.name));
  const candidates = RELATION_KEY_FIELDS.filter((f) => targetFieldNames.has(f));
  if (candidates.length === 0) {
    cache.set(key, null);
    return null;
  }

  const ors = candidates.map((f) => `${f} = "${esc(value)}"`).join(' || ');
  const filter = target.hasTenant ? `tenant = "${esc(tenant)}" && (${ors})` : `(${ors})`;
  try {
    const rec = await pb.collection(target.name).getFirstListItem<{ id: string }>(filter);
    cache.set(key, rec.id);
    return rec.id;
  } catch {
    cache.set(key, null);
    return null;
  }
}

// ── Filtervärde för upsert ─────────────────────────────────────────
function filterValue(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `"${esc(String(v))}"`;
}

// ── Delad körning (preview = dryRun, commit = skriv) ────────────────
async function runImport(buf: Buffer, config: ImportConfig, dryRun: boolean): Promise<RunState> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: 'error', message: auth.message };
  const user = auth.user;

  let sheetsMap: Map<string, Row[]>;
  try {
    sheetsMap = parseXlsx(buf).sheets;
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Kunde inte läsa XLSX-filen.'
    };
  }

  const su = await getSuperuserPb();
  if (!su.ok) {
    return {
      status: 'error',
      message:
        su.reason === 'missing_credentials'
          ? 'Superuser-credentials saknas på servern.'
          : 'Superuser-autentisering misslyckades.'
    };
  }
  const pb = su.pb;
  const tenant = user.tenant;

  const collections = await listImportableCollections();
  const collByName = new Map(collections.map((c) => [c.name, c]));
  const relCache = new Map<string, string | null>();

  const outcomes: SheetOutcome[] = [];
  const totals = { created: 0, updated: 0, skipped: 0 };

  for (const sheetMap of config.sheets) {
    if (!sheetMap.collection) continue; // ark hoppas över
    const collection = collByName.get(sheetMap.collection);
    if (!collection) {
      // Säkerhet: en kollektion som inte är importerbar (denylist/system).
      outcomes.push({
        sheet: sheetMap.sheet,
        collection: sheetMap.collection,
        totalRows: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        unmappedColumns: [],
        mappedFields: [],
        issues: [`Kollektionen "${sheetMap.collection}" får inte importeras.`]
      });
      continue;
    }

    const fieldByName = new Map(collection.fields.map((f) => [f.name, f]));
    const rows = dataRows(sheetMap.sheet ? (sheetsMap.get(sheetMap.sheet) ?? []) : []);

    // Endast kolumner som mappats till ett FAKTISKT fält i kollektionen.
    const activeColumns = sheetMap.columns.filter(
      (c) => c.field !== null && fieldByName.has(c.field)
    );
    const mappedFields = activeColumns.map((c) => c.field as string);
    const unmappedColumns = sheetMap.columns
      .filter((c) => c.field === null || !fieldByName.has(c.field ?? ''))
      .map((c) => c.label);

    // Upsert-nycklar måste vara mappade fält.
    const upsertKeys = sheetMap.upsertKeys.filter((k) => mappedFields.includes(k));
    const requiredFields = collection.fields.filter((f) => f.required).map((f) => f.name);

    const outcome: SheetOutcome = {
      sheet: sheetMap.sheet,
      collection: collection.name,
      totalRows: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      unmappedColumns,
      mappedFields,
      issues: []
    };
    const addIssue = (msg: string) => {
      if (outcome.issues.length < MAX_ISSUES_PER_SHEET) outcome.issues.push(msg);
    };

    let rowNum = 1; // datarad-nummer (1-baserat, exkl. rubrik)
    for (const row of rows) {
      rowNum++;
      const record: Record<string, unknown> = {};
      const relationsToResolve: { field: ImportField; raw: string }[] = [];

      for (const col of activeColumns) {
        const field = fieldByName.get(col.field as string)!;
        const raw = (row[col.column] ?? '').trim();
        if (raw === '') continue;

        if (field.type === 'relation') {
          relationsToResolve.push({ field, raw });
          continue;
        }
        const res = coerceScalar(field, raw);
        if (res.kind === 'empty') continue;
        if (res.kind === 'error') {
          addIssue(`Rad ${rowNum}, kolumn "${col.label}": ${res.reason} (fältet hoppas över).`);
          continue;
        }
        record[field.name] =
          isTextField(field) && typeof res.value === 'string'
            ? sanitizePersonnummer(res.value)
            : res.value;
      }

      // Resolva relationer (IO).
      for (const { field, raw } of relationsToResolve) {
        const target = field.relationCollection
          ? collByName.get(field.relationCollection)
          : undefined;
        if (!target) {
          // Mål utanför importerbar yta (t.ex. users/tenants) — kan ej kopplas.
          addIssue(
            `Rad ${rowNum}, "${field.name}": relationen kan inte slås upp automatiskt (mål skyddat).`
          );
          continue;
        }
        const id = await resolveRelation(pb, target, tenant, raw, relCache);
        if (id) {
          record[field.name] = (field.maxSelect ?? 1) > 1 ? [id] : id;
        } else {
          addIssue(`Rad ${rowNum}, "${field.name}": hittade ingen matchande post i ${target.name}.`);
        }
      }

      // Tenant stämplas automatiskt.
      if (collection.hasTenant) record.tenant = tenant;

      // Obligatoriska fält måste finnas (tenant räknas ej — stämplas auto).
      const missing = requiredFields.filter((f) => !(f in record));
      if (missing.length > 0) {
        outcome.skipped++;
        totals.skipped++;
        addIssue(`Rad ${rowNum}: saknar obligatoriska fält (${missing.join(', ')}) — hoppas över.`);
        continue;
      }

      // Inget att skriva?
      if (Object.keys(record).filter((k) => k !== 'tenant').length === 0) {
        outcome.skipped++;
        totals.skipped++;
        continue;
      }

      // Upsert-uppslag.
      let existingId: string | null = null;
      if (upsertKeys.length > 0 && upsertKeys.every((k) => k in record)) {
        const parts: string[] = [];
        if (collection.hasTenant) parts.push(`tenant = "${esc(tenant)}"`);
        for (const k of upsertKeys) parts.push(`${k} = ${filterValue(record[k])}`);
        try {
          const found = await pb
            .collection(collection.name)
            .getFirstListItem<{ id: string }>(parts.join(' && '));
          existingId = found.id;
        } catch {
          existingId = null;
        }
      }

      if (dryRun) {
        if (existingId) outcome.updated++;
        else outcome.created++;
        continue;
      }

      try {
        if (existingId) {
          await pb.collection(collection.name).update(existingId, record);
          outcome.updated++;
          totals.updated++;
        } else {
          await pb.collection(collection.name).create(record);
          outcome.created++;
          totals.created++;
        }
      } catch (err) {
        outcome.skipped++;
        totals.skipped++;
        addIssue(
          `Rad ${rowNum}: kunde inte skrivas (${err instanceof Error ? err.message : 'okänt fel'}).`
        );
      }
    }

    if (dryRun) {
      totals.created += outcome.created;
      totals.updated += outcome.updated;
    }
    outcomes.push(outcome);
  }

  if (!dryRun) {
    await recordActivity(pb, {
      tenant,
      kind: 'integration_sync',
      actor: user.id,
      title: 'Generell Excel-import',
      meta: `${totals.created} rader skapade, ${totals.updated} uppdaterade över ${outcomes.length} ark${totals.skipped > 0 ? ` · ${totals.skipped} hoppade över` : ''}`
    });
    revalidatePath('/admin/import-crm');
    revalidatePath('/startups');
    revalidatePath('/aktivitet');
  }

  return { status: 'ok', dryRun, sheets: outcomes, totals };
}

function parseConfig(formData: FormData): ImportConfig | null {
  const raw = formData.get('config');
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as ImportConfig;
    if (!parsed || !Array.isArray(parsed.sheets)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function previewImportAction(formData: FormData): Promise<RunState> {
  const upload = await readUploadedFile(formData);
  if (!upload.ok) return { status: 'error', message: upload.message };
  const config = parseConfig(formData);
  if (!config) return { status: 'error', message: 'Ogiltig mappningskonfiguration.' };
  return runImport(upload.buf, config, true);
}

export async function commitImportAction(formData: FormData): Promise<RunState> {
  const upload = await readUploadedFile(formData);
  if (!upload.ok) return { status: 'error', message: upload.message };
  const config = parseConfig(formData);
  if (!config) return { status: 'error', message: 'Ogiltig mappningskonfiguration.' };
  return runImport(upload.buf, config, false);
}
