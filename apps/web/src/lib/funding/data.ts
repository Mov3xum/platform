import 'server-only';
import type PocketBase from 'pocketbase';
import {
  fundingBurn,
  sumFundingLedger,
  type FundingBurn,
  type FundingLedgerRow,
  type FundingProjectKind,
  type FundingProjectLike,
  type FundingProjectStatus,
  type FundingWorkPackageLike,
  type FundingBasis
} from '@platform/shared';
import { dateOnly, todayKey } from '@/lib/procurements/data';

/**
 * Enda läsvägen för finansieringsprojekt (§ 46.3). Reads via den inkommande
 * klienten (användarens token → RLS § 21, staff/observer); fail-soft mot ett
 * ännu inte migrerat schema. Upparbetning räknas ALLTID ur ansökningarna —
 * ingen kopia av belopp lagras på projektet.
 */

export const FUNDING_PROJECTS = 'funding_projects';
export const FUNDING_WORK_PACKAGES = 'funding_work_packages';

export interface FundingProjectRow extends FundingProjectLike {
  tenant: string;
  diarienummer?: string | null;
  description?: string | null;
  default_stodgivare?: string | null;
  responsible?: string | null;
  created_by?: string | null;
  created?: string;
}

export interface FundingWorkPackageRow extends FundingWorkPackageLike {
  tenant: string;
  description?: string | null;
  sort_order?: number | null;
}

function tenantFilter(pb: PocketBase, tenantId: string, extra?: string, params: Record<string, unknown> = {}) {
  return pb.filter(`tenant = {:tenant}${extra ? ` && (${extra})` : ''}`, { tenant: tenantId, ...params });
}

function normalizeProject(row: FundingProjectRow): FundingProjectRow {
  return {
    ...row,
    kind: (row.kind || 'other') as FundingProjectKind,
    status: (row.status || 'active') as FundingProjectStatus,
    starts_at: dateOnly(row.starts_at),
    ends_at: dateOnly(row.ends_at),
    budget_sek: typeof row.budget_sek === 'number' ? row.budget_sek : null,
    default_state_aid_basis: (row.default_state_aid_basis || null) as FundingBasis | null
  };
}

export async function listFundingProjects(pb: PocketBase, tenantId: string): Promise<FundingProjectRow[]> {
  try {
    const res = await pb.collection(FUNDING_PROJECTS).getFullList<FundingProjectRow>({
      filter: tenantFilter(pb, tenantId),
      sort: 'status,-starts_at,title',
      batch: 200
    });
    return res.map(normalizeProject);
  } catch {
    return [];
  }
}

export async function getFundingProject(pb: PocketBase, tenantId: string, id: string): Promise<FundingProjectRow | null> {
  try {
    const row = await pb.collection(FUNDING_PROJECTS).getOne<FundingProjectRow>(id);
    if (String(row.tenant) !== tenantId) return null;
    return normalizeProject(row);
  } catch {
    return null;
  }
}

export async function listWorkPackages(pb: PocketBase, tenantId: string, projectId?: string): Promise<FundingWorkPackageRow[]> {
  try {
    const res = await pb.collection(FUNDING_WORK_PACKAGES).getFullList<FundingWorkPackageRow>({
      filter: tenantFilter(pb, tenantId, projectId ? 'project = {:p}' : undefined, projectId ? { p: projectId } : {}),
      sort: 'sort_order,code,title',
      batch: 300
    });
    return res.map((r) => ({
      ...r,
      starts_at: dateOnly(r.starts_at),
      ends_at: dateOnly(r.ends_at),
      budget_sek: typeof r.budget_sek === 'number' ? r.budget_sek : null
    }));
  } catch {
    return [];
  }
}

export interface FundingLedgerApplication extends FundingLedgerRow {
  id: string;
  startup: string;
  startup_name?: string | null;
  title?: string | null;
  status: string;
  check_type: string;
  decided_at?: string | null;
  state_aid_basis?: string | null;
}

/** Ansökningar som belastar projekten (beviljade/utbetalda/avslutade), som kassabok. */
export async function listFundingLedger(pb: PocketBase, tenantId: string, projectId?: string): Promise<FundingLedgerApplication[]> {
  try {
    const rows = await pb.collection('support_check_applications').getFullList<Record<string, unknown>>({
      filter: tenantFilter(
        pb,
        tenantId,
        `(status = "approved" || status = "paid" || status = "closed")${projectId ? ' && funding_project = {:p}' : ''}`,
        projectId ? { p: projectId } : {}
      ),
      sort: '-decided_at',
      expand: 'startup',
      fields:
        'id,startup,title,status,check_type,funding_project,funding_work_package,approved_amount_sek,requested_amount_sek,paid_at,paid_amount_sek,decided_at,state_aid_basis,expand.startup.name',
      batch: 500
    });
    return rows.map((r) => {
      const granted = typeof r.approved_amount_sek === 'number' ? r.approved_amount_sek : typeof r.requested_amount_sek === 'number' ? r.requested_amount_sek : 0;
      return {
        id: String(r.id),
        startup: String(r.startup ?? ''),
        startup_name: (r.expand as { startup?: { name?: string } } | undefined)?.startup?.name ?? null,
        title: (r.title as string) ?? null,
        status: String(r.status ?? ''),
        check_type: String(r.check_type ?? ''),
        project: (r.funding_project as string) || null,
        work_package: (r.funding_work_package as string) || null,
        granted_sek: granted,
        paid_at: dateOnly(r.paid_at),
        paid_sek: typeof r.paid_amount_sek === 'number' && r.paid_amount_sek > 0 ? r.paid_amount_sek : null,
        decided_at: dateOnly(r.decided_at),
        state_aid_basis: (r.state_aid_basis as string) || null
      };
    });
  } catch {
    return [];
  }
}

export interface FundingProjectOverview {
  project: FundingProjectRow;
  burn: FundingBurn;
  workPackages: Array<{ wp: FundingWorkPackageRow; burn: FundingBurn; count: number }>;
  applications: number;
}

export function buildProjectOverview(
  project: FundingProjectRow,
  workPackages: readonly FundingWorkPackageRow[],
  ledger: readonly FundingLedgerRow[],
  today = todayKey()
): FundingProjectOverview {
  const totals = sumFundingLedger(ledger, { project: project.id });
  return {
    project,
    burn: fundingBurn({
      budgetSek: project.budget_sek,
      grantedSek: totals.grantedSek,
      paidSek: totals.paidSek,
      startsAt: project.starts_at,
      endsAt: project.ends_at,
      today
    }),
    workPackages: workPackages
      .filter((wp) => wp.project === project.id)
      .map((wp) => {
        const t = sumFundingLedger(ledger, { workPackage: wp.id });
        return {
          wp,
          count: t.count,
          burn: fundingBurn({
            budgetSek: wp.budget_sek,
            grantedSek: t.grantedSek,
            paidSek: t.paidSek,
            startsAt: wp.starts_at ?? project.starts_at,
            endsAt: wp.ends_at ?? project.ends_at,
            today
          })
        };
      }),
    applications: totals.count
  };
}
