import 'server-only';
import type PocketBase from 'pocketbase';
import { escFilter } from '../../pb-filter';
import type {
  RegistryCompany,
  RegistryFinancialsYear,
  RegistryOwnershipEntry,
  RegistrySource
} from './types';

// ENDA skrivvägen för bolagsregisterdata (CLAUDE.md § 11.8). Alla
// company_registry-handlers (Roaring, Bolagsverket, Allabolag-stubben)
// producerar en `RegistryCompany` och lämnar skrivningen hit, så whitelist,
// idempotens och dataminimering aldrig divergerar mellan leverantörer:
//
//   startups            — bara fälten i RegistryStartupPatch, bara icke-tomma
//                         värden (en källa som saknar ett fält raderar aldrig
//                         det en annan källa eller en människa skrivit).
//   startup_financials  — upsert per (startup, år) via unique-index
//                         (migration 1700000059); race → read-after-write.
//   startup_ownership   — ERSÄTTS per (startup, källa) vid varje synk: gamla
//                         rader från samma källa raderas, nya skrivs. Manuella
//                         rader (source = manual) och andra källors rader rörs
//                         aldrig. Fysiska personer skrivs utan namn/org-nr —
//                         normaliseraren får inte ge dem, men writern strippar
//                         defensivt (defense-in-depth, GDPR § 5).
//
// Anropas med superuser-klienten från handlern; tenant-verifieringen av
// bolaget sker i handlern/factoryn INNAN (§ 10.5 p. 5).

export interface RegistryWriteResult {
  startupUpdated: boolean;
  financialsUpserted: number;
  ownershipWritten: number;
  /** PII-fria fel per delskrivning (loggas, blockerar inte övriga delar). */
  errors: string[];
}

interface FinancialsRow {
  id: string;
}

interface OwnershipRow {
  id: string;
}

function statusOf(err: unknown): number {
  return err && typeof err === 'object' && 'status' in err
    ? Number((err as { status?: unknown }).status) || 0
    : 0;
}

function compactPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    out[k] = v;
  }
  return out;
}

async function upsertFinancialsRow(
  pb: PocketBase,
  tenantId: string,
  startupId: string,
  row: RegistryFinancialsYear,
  source: RegistrySource,
  syncedAt: string
): Promise<void> {
  const filter = `startup = "${escFilter(startupId)}" && year = ${Math.trunc(row.year)}`;
  let existing: FinancialsRow | null = null;
  try {
    existing = await pb
      .collection('startup_financials')
      .getFirstListItem<FinancialsRow>(filter);
  } catch {
    existing = null;
  }

  // Bara kända värden skrivs — en källa utan personalkostnad nollar inte det
  // Excel-importen redan satt.
  const payload: Record<string, unknown> = compactPatch({
    employees: row.employees,
    revenue_sek: row.revenue_sek,
    personnel_cost_sek: row.personnel_cost_sek,
    corporate_tax_sek: row.corporate_tax_sek,
    balance_sheet_sek: row.balance_sheet_sek,
    equity_sek: row.equity_sek,
    net_result_sek: row.net_result_sek
  });
  payload.tenant = tenantId;
  payload.startup = startupId;
  payload.year = Math.trunc(row.year);
  payload.source = source;
  payload.synced_at = syncedAt;

  if (existing) {
    await pb.collection('startup_financials').update(existing.id, payload);
    return;
  }
  try {
    await pb.collection('startup_financials').create(payload);
  } catch (err) {
    // Race: en parallell synk hann skapa raden (unique-index). Läs och uppdatera.
    if (statusOf(err) === 400) {
      const retry = await pb
        .collection('startup_financials')
        .getFirstListItem<FinancialsRow>(filter);
      await pb.collection('startup_financials').update(retry.id, payload);
      return;
    }
    throw err;
  }
}

function ownershipPayload(
  entry: RegistryOwnershipEntry,
  tenantId: string,
  startupId: string,
  source: RegistrySource,
  syncedAt: string
): Record<string, unknown> {
  const isPerson = entry.owner_kind === 'person';
  return compactPatch({
    tenant: tenantId,
    startup: startupId,
    direction: entry.direction,
    owner_kind: entry.owner_kind,
    // Defense-in-depth: fysiska personer lagras ALDRIG med namn eller org-nr.
    name: isPerson ? undefined : entry.name?.slice(0, 200),
    org_nr: isPerson ? undefined : entry.org_nr,
    capital_pct: entry.capital_pct,
    voting_pct: entry.voting_pct,
    pct_min: entry.pct_min,
    pct_max: entry.pct_max,
    control_basis: entry.control_basis?.slice(0, 200),
    indirect: entry.indirect === true ? true : undefined,
    relation: 'unknown',
    source,
    synced_at: syncedAt
  });
}

async function replaceOwnership(
  pb: PocketBase,
  tenantId: string,
  startupId: string,
  entries: RegistryOwnershipEntry[],
  source: RegistrySource,
  syncedAt: string
): Promise<number> {
  const filter = `startup = "${escFilter(startupId)}" && source = "${escFilter(source)}"`;
  const existing = await pb
    .collection('startup_ownership')
    .getFullList<OwnershipRow>({ filter, fields: 'id' });
  for (const row of existing) {
    await pb.collection('startup_ownership').delete(row.id);
  }
  let written = 0;
  for (const entry of entries) {
    await pb
      .collection('startup_ownership')
      .create(ownershipPayload(entry, tenantId, startupId, source, syncedAt));
    written++;
  }
  return written;
}

export async function applyRegistryCompany(
  pb: PocketBase,
  tenantId: string,
  startupId: string,
  company: RegistryCompany,
  source: RegistrySource,
  syncedAt: string
): Promise<RegistryWriteResult> {
  const result: RegistryWriteResult = {
    startupUpdated: false,
    financialsUpserted: 0,
    ownershipWritten: 0,
    errors: []
  };

  const patch = compactPatch({ ...company.startup });
  if (Object.keys(patch).length > 0) {
    try {
      await pb.collection('startups').update(startupId, patch);
      result.startupUpdated = true;
    } catch (err) {
      result.errors.push(`startups: HTTP ${statusOf(err) || 'fel'}`);
    }
  }

  for (const row of company.financials) {
    if (!Number.isInteger(row.year) || row.year < 1980 || row.year > 2100) continue;
    try {
      await upsertFinancialsRow(pb, tenantId, startupId, row, source, syncedAt);
      result.financialsUpserted++;
    } catch (err) {
      result.errors.push(`startup_financials ${row.year}: HTTP ${statusOf(err) || 'fel'}`);
      console.error('[company-registry] financials upsert failed', {
        source,
        startupId,
        year: row.year,
        status: statusOf(err)
      });
    }
  }

  // Ägarbilden ersätts bara när källan faktiskt levererar en (en källa utan
  // ägardata — Bolagsverket — raderar inte Roarings rader).
  if (company.ownership.length > 0) {
    try {
      result.ownershipWritten = await replaceOwnership(
        pb,
        tenantId,
        startupId,
        company.ownership,
        source,
        syncedAt
      );
    } catch (err) {
      const status = statusOf(err);
      result.errors.push(
        status === 404
          ? 'startup_ownership saknas i schemat (kör migration 1700000172)'
          : `startup_ownership: HTTP ${status || 'fel'}`
      );
      console.error('[company-registry] ownership replace failed', {
        source,
        startupId,
        status
      });
    }
  }

  return result;
}
