import 'server-only';
import type PocketBase from 'pocketbase';

// Whitelist of startup fields allowed in portfolio context (no PII).
// org_nr/intagsdatum/avslutsdatum hålls utanför här — de behövs inte för
// AI-resonemang och respekterar dataminimering (CLAUDE.md § 9.3, § 10.2).
const STARTUP_PORTFOLIO_FIELDS = [
  'name',
  'phase',
  'irl_level',
  'status',
  'next_step',
  'kommun',
  'industri',
  'bolag_status'
] as const;

interface StartupPortfolioEntry {
  name: string;
  phase: string;
  irl_level?: number;
  status: string;
  next_step?: string;
  kommun?: string;
  industri?: string;
  bolag_status?: string;
}

interface FinancialsEntry {
  year: number;
  employees?: number;
  revenue_sek?: number;
  personnel_cost_sek?: number;
  corporate_tax_sek?: number;
}

interface MilestoneEntry {
  title: string;
  category: string;
  status: string;
  target_date?: string;
  achieved_at?: string;
}

interface ActivityEntry {
  title: string;
  type: string;
  status: string;
  due_date?: string;
  description?: string;
}

interface NoteEntry {
  body: string;
  created: string;
}

export interface StartupContext {
  startup: {
    name: string;
    phase: string;
    irl_level?: number;
    status: string;
    next_step?: string;
    description?: string;
    tags?: string;
    kommun?: string;
    industri?: string;
    bolagsform?: string;
    bolag_status?: string;
    intagsdatum?: string;
    avslutsdatum?: string;
  };
  milestones: MilestoneEntry[];
  activities: ActivityEntry[];
  notes: NoteEntry[];
  financials?: FinancialsEntry[];
}

export interface PortfolioContext {
  portfolio: StartupPortfolioEntry[];
  total: number;
}

/**
 * Builds context for a single startup, tenant-scoped.
 * Filters out confidential notes and excludes PII (emails, team members).
 */
export async function buildStartupContext(
  pb: PocketBase,
  startupId: string,
  tenantId: string
): Promise<StartupContext> {
  const [startupRecord, milestonesResult, activitiesResult, notesResult] = await Promise.all([
    pb.collection('startups').getOne(startupId),
    pb.collection('milestones').getList(1, 100, {
      filter: `startup = "${startupId}"`,
      sort: 'target_date'
    }),
    pb.collection('activities').getList(1, 100, {
      filter: `startup = "${startupId}" && due_date >= "${ninetyDaysAgo()}"`,
      sort: '-due_date'
    }),
    pb.collection('notes').getList(1, 100, {
      filter: `startup = "${startupId}" && confidential = false`,
      sort: '-created'
    })
  ]);

  // Verify tenant isolation
  if (startupRecord.tenant !== tenantId) {
    throw new Error('Cross-tenant access denied');
  }

  // Org-nr för enskild firma = personnummer → exkluderas alltid från
  // AI-prompts (CLAUDE.md § 10.2, GDPR art. 5). För aktiebolag är org-nr
  // inte PII men exponeras ändå inte här — agenterna behöver det inte.
  const startup: StartupContext['startup'] = {
    name: startupRecord.name as string,
    phase: startupRecord.phase as string,
    irl_level: startupRecord.irl_level as number | undefined,
    status: startupRecord.status as string,
    next_step: startupRecord.next_step as string | undefined,
    description: stripHtml(startupRecord.description as string | undefined),
    tags: startupRecord.tags as string | undefined,
    kommun: (startupRecord.kommun as string | undefined) || undefined,
    industri: (startupRecord.industri as string | undefined) || undefined,
    bolagsform: (startupRecord.bolagsform as string | undefined) || undefined,
    bolag_status: (startupRecord.bolag_status as string | undefined) || undefined,
    intagsdatum: (startupRecord.intagsdatum as string | undefined) || undefined,
    avslutsdatum: (startupRecord.avslutsdatum as string | undefined) || undefined
  };

  const milestones: MilestoneEntry[] = milestonesResult.items.map((m) => ({
    title: m.title as string,
    category: m.category as string,
    status: m.status as string,
    target_date: m.target_date as string | undefined,
    achieved_at: m.achieved_at as string | undefined
  }));

  const activities: ActivityEntry[] = activitiesResult.items.map((a) => ({
    title: a.title as string,
    type: a.type as string,
    status: a.status as string,
    due_date: a.due_date as string | undefined,
    description: stripHtml(a.description as string | undefined)
  }));

  const notes: NoteEntry[] = notesResult.items.map((n) => ({
    body: stripHtml(n.body as string),
    created: n.created as string
  }));

  const financials = await buildFinancialsContext(pb, startupId, tenantId);

  return { startup, milestones, activities, notes, financials };
}

/**
 * Returns the last N years of annual financials for a startup, sorted
 * oldest → newest. Tenant-scoped. Returns undefined when no rows exist
 * so the AI prompt can omit the section cleanly.
 */
export async function buildFinancialsContext(
  pb: PocketBase,
  startupId: string,
  tenantId: string,
  lastNYears = 5
): Promise<FinancialsEntry[] | undefined> {
  let result;
  try {
    result = await pb.collection('startup_financials').getList(1, lastNYears, {
      filter: `startup = "${startupId}" && tenant = "${tenantId}"`,
      sort: '-year'
    });
  } catch (e) {
    // Collection may not yet exist on older deployments — fail soft.
    return undefined;
  }

  if (!result.items.length) return undefined;

  return result.items
    .map((r) => {
      const entry: FinancialsEntry = { year: r.year as number };
      if (r.employees !== undefined && r.employees !== null) {
        entry.employees = r.employees as number;
      }
      if (r.revenue_sek !== undefined && r.revenue_sek !== null) {
        entry.revenue_sek = r.revenue_sek as number;
      }
      if (r.personnel_cost_sek !== undefined && r.personnel_cost_sek !== null) {
        entry.personnel_cost_sek = r.personnel_cost_sek as number;
      }
      if (r.corporate_tax_sek !== undefined && r.corporate_tax_sek !== null) {
        entry.corporate_tax_sek = r.corporate_tax_sek as number;
      }
      return entry;
    })
    .sort((a, b) => a.year - b.year);
}

/**
 * Builds portfolio context for all active startups in the tenant.
 * Only includes whitelisted fields — no PII, no notes, no agreements.
 */
export async function buildPortfolioContext(
  pb: PocketBase,
  tenantId: string
): Promise<PortfolioContext> {
  const result = await pb.collection('startups').getList(1, 200, {
    filter: `tenant = "${tenantId}" && status = "active"`
  });

  const portfolio: StartupPortfolioEntry[] = result.items.map((s) => {
    const entry: StartupPortfolioEntry = {
      name: s.name as string,
      phase: s.phase as string,
      status: s.status as string
    };
    if (s.irl_level !== undefined && s.irl_level !== null) {
      entry.irl_level = s.irl_level as number;
    }
    if (s.next_step) {
      entry.next_step = s.next_step as string;
    }
    if (s.kommun) entry.kommun = s.kommun as string;
    if (s.industri) entry.industri = s.industri as string;
    if (s.bolag_status) entry.bolag_status = s.bolag_status as string;
    return entry;
  });

  return { portfolio, total: result.totalItems };
}

/**
 * Renders a prompt template by substituting {{path.to.value}} placeholders
 * with values from the context object.
 */
export function renderPromptTemplate(
  template: string,
  ctx: Record<string, unknown>
): string {
  // Strip HTML tags from the template (stored as editor content)
  const plainTemplate = stripHtml(template);

  return plainTemplate.replace(/\{\{([\w.]+)\}\}/g, (_match, path: string) => {
    const value = resolvePath(ctx, path);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  });
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function stripHtml(html: string | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

function ninetyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().slice(0, 10);
}

// Re-export for convenience
export { STARTUP_PORTFOLIO_FIELDS };
