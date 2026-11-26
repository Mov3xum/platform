import 'server-only';
import type PocketBase from 'pocketbase';
import {
  REGISTER_SOURCES,
  buildArchiveInventory,
  disposalDueDate,
  normalizeArchiveDescription,
  runRegisterAudit,
  stockholmDateKey,
  type ArchiveDescription,
  type AuditCheck,
  type DisclosureOutcome,
  type InventoryProcess,
  type RecordDirection,
  type RecordRetention,
  type RegisterVia,
  type SourceCoverage
} from '@platform/shared';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import {
  ARCHIVE_PROFILES,
  ARCHIVE_VERSIONS,
  REGISTER_CASES,
  REGISTER_DISCLOSURES,
  REGISTER_ENTRIES,
  REGISTER_MIGRATION_HINT,
  ensureRecordPlan,
  readRecordTypes,
  type RecordTypeRow
} from '@/lib/core/write/register';
import { SOURCE_FILTERS } from './sources';

/**
 * Läsvägen för diariet (CLAUDE.md § 60). Läser med användarens token (RLS:
 * Movexum-personal + observer i tenanten). Två undantag går via den cachade
 * superusern, båda bakom sidans modulgrind och båda bara RÄKNARE/konfiguration:
 * planens första materialisering och täckningskontrollens antal per källa
 * (en observer eller mentor läser inte alla källor själv).
 */

export interface RegisterEntryView {
  id: string;
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  caseStatus: string;
  caseClosedAt: string;
  designation: string;
  typeKey: string;
  typeLabel: string;
  direction: RecordDirection;
  title: string;
  counterpart: string;
  documentDate: string;
  registeredAt: string;
  sourceCollection: string;
  sourceId: string;
  contentHash: string;
  documentHash: string;
  secrecy: boolean;
  secrecyBasis: string;
  retention: RecordRetention | '';
  retentionMonths: number | null;
  disposalDue: string | null;
  via: RegisterVia;
  registeredByName: string;
  note: string;
  voided: boolean;
  voidReason: string;
}

export interface RegisterCaseView {
  id: string;
  number: string;
  title: string;
  process: string;
  counterpart: string;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string;
  sourceCollection: string;
  sourceId: string;
  startupId: string;
  startupName: string;
}

export interface DisclosureView {
  id: string;
  requestedAt: string;
  summary: string;
  outcome: DisclosureOutcome;
  secrecyBasis: string;
  note: string;
  handledByName: string;
  caseId: string;
  caseNumber: string;
  designation: string;
}

export interface ArchiveVersionView {
  id: string;
  version: number;
  establishedAt: string;
  establishedByName: string;
  note: string;
  contentHash: string;
  typeCount: number;
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

function readError(err: unknown): string {
  return statusOf(err) === 404 ? REGISTER_MIGRATION_HINT : 'Diariet kunde inte läsas.';
}

type Row = Record<string, unknown> & { id: string; expand?: Record<string, Record<string, unknown> | undefined> };
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const userName = (u: Record<string, unknown> | undefined): string => s(u?.display_name) || s(u?.name) || '';

function toEntry(r: Row): RegisterEntryView {
  const c = r.expand?.register_case;
  const retention = (s(r.retention) as RecordRetention | '') || '';
  const months = typeof r.retention_months === 'number' && r.retention_months > 0 ? r.retention_months : null;
  const closedAt = s(c?.closed_at);
  return {
    id: r.id,
    caseId: s(r.register_case),
    caseNumber: s(c?.number),
    caseTitle: s(c?.title),
    caseStatus: s(c?.status),
    caseClosedAt: closedAt,
    designation: s(r.designation),
    typeKey: s(r.type_key),
    typeLabel: s(r.type_label) || s(r.type_key),
    direction: (s(r.direction) as RecordDirection) || 'created',
    title: s(r.title),
    counterpart: s(r.counterpart),
    documentDate: s(r.document_date),
    registeredAt: s(r.registered_at),
    sourceCollection: s(r.source_collection),
    sourceId: s(r.source_id),
    contentHash: s(r.content_hash),
    documentHash: s(r.document_hash),
    secrecy: r.secrecy === true,
    secrecyBasis: s(r.secrecy_basis),
    retention,
    retentionMonths: months,
    disposalDue: disposalDueDate({ retention, retention_months: months }, closedAt || null),
    via: (s(r.via) as RegisterVia) || 'auto',
    registeredByName: userName(r.expand?.registered_by),
    note: s(r.note),
    voided: Boolean(s(r.voided_at)),
    voidReason: s(r.void_reason)
  };
}

function toCase(r: Row): RegisterCaseView {
  return {
    id: r.id,
    number: s(r.number),
    title: s(r.title),
    process: s(r.process),
    counterpart: s(r.counterpart),
    status: s(r.status) === 'closed' ? 'closed' : 'open',
    openedAt: s(r.opened_at) || s(r.created),
    closedAt: s(r.closed_at),
    sourceCollection: s(r.source_collection),
    sourceId: s(r.source_id),
    startupId: s(r.startup),
    startupName: s(r.expand?.startup?.name)
  };
}

export interface RegisterFilter {
  q?: string;
  year?: string;
  type?: string;
  direction?: string;
  secrecy?: boolean;
  page?: number;
}

export const REGISTER_PAGE_SIZE = 50;

export function registerFilterExpr(pb: PocketBase, tenant: string, f: RegisterFilter): string {
  const parts = [pb.filter('tenant = {:t}', { t: tenant })];
  const q = (f.q ?? '').trim().slice(0, 80);
  if (q) parts.push(pb.filter('(title ~ {:q} || designation ~ {:q} || counterpart ~ {:q} || register_case.title ~ {:q})', { q }));
  if (f.year && /^\d{4}$/.test(f.year)) parts.push(pb.filter('designation ~ {:y}', { y: `${f.year}/` }));
  if (f.type && /^[a-z0-9_]{2,40}$/.test(f.type)) parts.push(pb.filter('type_key = {:k}', { k: f.type }));
  if (f.direction === 'incoming' || f.direction === 'outgoing' || f.direction === 'created') parts.push(pb.filter('direction = {:d}', { d: f.direction }));
  if (f.secrecy) parts.push('secrecy = true');
  return parts.join(' && ');
}

export async function listRegisterEntries(
  pb: PocketBase,
  tenant: string,
  filter: RegisterFilter
): Promise<{ items: RegisterEntryView[]; total: number; page: number; pages: number; error: string | null }> {
  const page = Math.max(1, Math.min(filter.page ?? 1, 10_000));
  try {
    const res = await pb.collection(REGISTER_ENTRIES).getList<Row>(page, REGISTER_PAGE_SIZE, {
      filter: registerFilterExpr(pb, tenant, filter),
      sort: '-registered_at,-designation',
      expand: 'register_case,registered_by'
    });
    return { items: res.items.map(toEntry), total: res.totalItems, page, pages: Math.max(1, res.totalPages), error: null };
  } catch (err) {
    return { items: [], total: 0, page, pages: 1, error: readError(err) };
  }
}

export async function loadRegisterCase(
  pb: PocketBase,
  tenant: string,
  caseId: string
): Promise<{ case: RegisterCaseView; entries: RegisterEntryView[]; disclosures: DisclosureView[] } | null> {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(caseId)) return null;
  let row: Row;
  try {
    row = await pb.collection(REGISTER_CASES).getOne<Row>(caseId, { expand: 'startup' });
  } catch {
    return null;
  }
  if (s(row.tenant) !== tenant) return null;
  const [entries, disclosures] = await Promise.all([
    pb
      .collection(REGISTER_ENTRIES)
      .getFullList<Row>({ filter: pb.filter('tenant = {:t} && register_case = {:c}', { t: tenant, c: caseId }), sort: 'seq', expand: 'register_case,registered_by', batch: 200 })
      .catch(() => [] as Row[]),
    listDisclosures(pb, tenant, caseId)
  ]);
  return { case: toCase(row), entries: entries.map(toEntry), disclosures: disclosures.items };
}

export async function listDisclosures(pb: PocketBase, tenant: string, caseId?: string): Promise<{ items: DisclosureView[]; error: string | null }> {
  try {
    const rows = await pb.collection(REGISTER_DISCLOSURES).getFullList<Row>({
      filter: caseId ? pb.filter('tenant = {:t} && register_case = {:c}', { t: tenant, c: caseId }) : pb.filter('tenant = {:t}', { t: tenant }),
      sort: '-requested_at',
      expand: 'register_case,entry,handled_by',
      batch: 200
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        requestedAt: s(r.requested_at),
        summary: s(r.request_summary),
        outcome: (s(r.outcome) as DisclosureOutcome) || 'released',
        secrecyBasis: s(r.secrecy_basis),
        note: s(r.note),
        handledByName: userName(r.expand?.handled_by),
        caseId: s(r.register_case),
        caseNumber: s(r.expand?.register_case?.number),
        designation: s(r.expand?.entry?.designation)
      })),
      error: null
    };
  } catch (err) {
    return { items: [], error: readError(err) };
  }
}

/** Planen. Materialiseras via superusern första gången; annars läses den med användarens token. */
export async function loadRecordPlan(pb: PocketBase, tenant: string): Promise<{ types: RecordTypeRow[]; error: string | null }> {
  try {
    const su = await getSuperuserPb();
    if (su.ok) return { types: await ensureRecordPlan(su.pb, tenant), error: null };
    return { types: await readRecordTypes(pb, tenant), error: null };
  } catch (err) {
    return { types: [], error: readError(err) };
  }
}

interface EntryFact {
  type_key: string;
  registered_at: string;
  secrecy?: boolean;
  secrecy_basis?: string;
  voided_at?: string;
  content_hash?: string;
  retention?: string;
  retention_months?: number;
  expand?: { register_case?: { closed_at?: string } };
}

const FACT_CAP = 20_000;

async function loadEntryFacts(pb: PocketBase, tenant: string): Promise<{ rows: EntryFact[]; complete: boolean }> {
  const rows: EntryFact[] = [];
  for (let page = 1; ; page++) {
    const res = await pb.collection(REGISTER_ENTRIES).getList<EntryFact>(page, 500, {
      filter: pb.filter('tenant = {:t}', { t: tenant }),
      fields: 'type_key,registered_at,secrecy,secrecy_basis,voided_at,content_hash,retention,retention_months,expand.register_case.closed_at',
      expand: 'register_case',
      sort: 'registered_at'
    });
    rows.push(...res.items);
    if (res.items.length === 0 || rows.length >= res.totalItems) return { rows, complete: true };
    if (rows.length >= FACT_CAP) return { rows, complete: false };
  }
}

export interface ArchiveWorkspace {
  inventory: InventoryProcess[];
  inventoryComplete: boolean;
  description: ArchiveDescription;
  descriptionUpdatedAt: string;
  versions: ArchiveVersionView[];
  error: string | null;
}

async function loadProfile(pb: PocketBase, tenant: string): Promise<{ description: ArchiveDescription; updated: string }> {
  try {
    const row = await pb.collection(ARCHIVE_PROFILES).getFirstListItem<Row>(pb.filter('tenant = {:t}', { t: tenant }));
    return { description: normalizeArchiveDescription(row.sections), updated: s(row.updated) };
  } catch (err) {
    if (statusOf(err) === 404) return { description: normalizeArchiveDescription(null), updated: '' };
    throw err;
  }
}

async function loadVersions(pb: PocketBase, tenant: string): Promise<ArchiveVersionView[]> {
  const rows = await pb.collection(ARCHIVE_VERSIONS).getFullList<Row>({
    filter: pb.filter('tenant = {:t}', { t: tenant }),
    sort: '-version',
    fields: 'id,version,established_at,note,content_hash,plan,expand.established_by.display_name,expand.established_by.name',
    expand: 'established_by',
    batch: 100
  });
  return rows.map((r) => ({
    id: r.id,
    version: typeof r.version === 'number' ? r.version : 0,
    establishedAt: s(r.established_at),
    establishedByName: userName(r.expand?.established_by),
    note: s(r.note),
    contentHash: s(r.content_hash),
    typeCount: Array.isArray(r.plan) ? r.plan.length : 0
  }));
}

export async function loadArchiveWorkspace(pb: PocketBase, tenant: string, types: RecordTypeRow[]): Promise<ArchiveWorkspace> {
  try {
    const [facts, profile, versions] = await Promise.all([loadEntryFacts(pb, tenant), loadProfile(pb, tenant), loadVersions(pb, tenant)]);
    return {
      inventory: buildArchiveInventory(
        types.filter((t) => t.active),
        facts.rows.map((e) => ({ type_key: e.type_key, registered_at: e.registered_at, secrecy: e.secrecy === true, voided: Boolean(e.voided_at) }))
      ),
      inventoryComplete: facts.complete,
      description: profile.description,
      descriptionUpdatedAt: profile.updated,
      versions,
      error: null
    };
  } catch (err) {
    return { inventory: [], inventoryComplete: true, description: normalizeArchiveDescription(null), descriptionUpdatedAt: '', versions: [], error: readError(err) };
  }
}

export interface AuditWorkspace {
  checks: AuditCheck[];
  coverage: SourceCoverage[];
  error: string | null;
}

export async function loadRegisterAudit(pb: PocketBase, tenant: string, types: RecordTypeRow[]): Promise<AuditWorkspace> {
  const su = await getSuperuserPb();
  let writable = su.ok;
  const counter = su.ok ? su.pb : pb;
  const count = async (collection: string, filter: string): Promise<number | null> => {
    try {
      return (await counter.collection(collection).getList(1, 1, { filter, fields: 'id' })).totalItems;
    } catch {
      return null;
    }
  };
  try {
    const coverage: SourceCoverage[] = await Promise.all(
      REGISTER_SOURCES.map(async (source) => ({
        source,
        expected: await count(source, counter.filter(SOURCE_FILTERS[source], { t: tenant })),
        registered: await count(REGISTER_CASES, counter.filter('tenant = {:t} && source_collection = {:c}', { t: tenant, c: source }))
      }))
    );
    if (coverage.some((c) => c.registered === null)) writable = false;

    const [facts, profile, versions, disclosures, cases] = await Promise.all([
      loadEntryFacts(pb, tenant),
      loadProfile(pb, tenant),
      loadVersions(pb, tenant),
      count(REGISTER_DISCLOSURES, counter.filter('tenant = {:t}', { t: tenant })),
      pb.collection(REGISTER_CASES).getFullList<{ year: number; seq: number }>({ filter: pb.filter('tenant = {:t}', { t: tenant }), fields: 'year,seq', batch: 500 })
    ]);
    const today = stockholmDateKey(new Date());
    const caseSeqsByYear: Record<string, number[]> = {};
    for (const c of cases) (caseSeqsByYear[String(c.year)] ??= []).push(c.seq);
    const live = facts.rows.filter((e) => !e.voided_at);
    const lastVersionAt = versions[0]?.establishedAt || null;
    const lastChange = [profile.updated, ...types.map((t) => t.updated)].filter(Boolean).sort().pop() ?? '';
    const checks = runRegisterAudit({
      types,
      coverage,
      caseSeqsByYear,
      entries: {
        total: live.length,
        withoutHash: live.filter((e) => !e.content_hash).length,
        secrecyWithoutBasis: live.filter((e) => e.secrecy === true && !e.secrecy_basis).length,
        disposalDue: live.filter((e) => {
          const due = disposalDueDate(
            { retention: (e.retention as RecordRetention) || '', retention_months: e.retention_months && e.retention_months > 0 ? e.retention_months : null },
            e.expand?.register_case?.closed_at || null
          );
          return due !== null && due <= today;
        }).length,
        complete: facts.complete
      },
      disclosures: disclosures ?? 0,
      description: profile.description,
      lastVersionAt,
      changedSinceVersion: Boolean(lastVersionAt && lastChange && Date.parse(lastChange) > Date.parse(lastVersionAt)),
      writable,
      today
    });
    return { checks, coverage, error: null };
  } catch (err) {
    return { checks: [], coverage: [], error: readError(err) };
  }
}
