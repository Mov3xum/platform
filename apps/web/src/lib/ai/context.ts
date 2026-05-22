import 'server-only';
import type PocketBase from 'pocketbase';

// Whitelist av startup-fält som får skickas till AI-prompten. Allt utanför
// listan måste vägras (CLAUDE.md § 9.3, § 10.2).
//
// EXPLICIT SVARTLISTAD — får ALDRIG hamna i AI-kontext:
//   • phone                  (PII)
//   • email                  (PII)
//   • street_address         (PII när enskild firma)
//   • postal_code            (PII när enskild firma)
//   • founder_gender         (GDPR art. 9 särskild kategori)
//   • founder_identifies_as  (GDPR art. 9 särskild kategori)
//   • Personnummer           (lagras inte i schemat)
//   • owner, coaches, e-postadresser, teammedlemmar (PII)
//   • contacts.*             (alla kontaktdetaljer på externa personer)
//
// org_nr exkluderas också (för enskild firma = personnummer; defense-in-depth).
const STARTUP_PORTFOLIO_FIELDS = [
  'name',
  'phase',
  'irl_level',
  'status',
  'next_step',
  'kommun',
  'city',
  'industri',
  'bolag_status',
  'website',
  // Movexum Bolagslista-fält som är säkra för portföljen
  'idea_name',
  'case_type',
  'area',
  'is_deeptech',
  'is_regional',
  'company_registered_at'
] as const;

interface StartupPortfolioEntry {
  name: string;
  phase: string;
  irl_level?: number;
  status: string;
  next_step?: string;
  kommun?: string;
  city?: string;
  industri?: string;
  bolag_status?: string;
  website?: string;
  idea_name?: string;
  case_type?: string;
  area?: string;
  is_deeptech?: boolean;
  is_regional?: boolean;
  company_registered_at?: string;
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

interface PhaseHistoryEntry {
  phase: string;
  entered_at: string;
  exited_at?: string;
  note?: string;
}

interface CapitalRoundEntry {
  type: string;
  source: string;
  amount_sek: number;
  received_at: string;
}

interface IPREntry {
  type: string;
  status: string;
  external_reference?: string;
  filed_at?: string;
  response_at?: string;
}

interface KPIEntry {
  kpi_name: string;
  value_text: string;
  value_numeric?: number;
  unit?: string;
  measured_at: string;
  is_current?: boolean;
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
    city?: string;
    industri?: string;
    bolagsform?: string;
    bolag_status?: string;
    website?: string;
    intagsdatum?: string;
    avslutsdatum?: string;
    // Movexum Bolagslista (1700000061) — AI-säkra fält
    idea_name?: string;
    case_type?: string;
    status_completion_pct?: number;
    company_registered_at?: string;
    contacted_at?: string;
    area?: string;
    inflow_source?: string;
    is_deeptech?: boolean;
    meets_excellence_criteria?: boolean;
    is_regional?: boolean;
    potential_bc_case?: boolean;
    preliminary_exit?: string;
    approved_state_aid_art22?: boolean;
    approved_de_minimis?: boolean;
    sent_to?: string;
    register_notes?: string;
    signed_incubator_agreement?: boolean;
    signed_incubator_agreement_at?: string;
    signed_nda?: boolean;
    signed_nda_at?: string;
    signed_bc_agreement?: boolean;
    signed_bc_agreement_at?: string;
    signed_vinnova_incubation_approval?: boolean;
    signed_vinnova_incubation_approval_at?: string;
    signed_partner_agreement?: boolean;
    signed_partner_agreement_at?: string;
  };
  milestones: MilestoneEntry[];
  activities: ActivityEntry[];
  notes: NoteEntry[];
  financials?: FinancialsEntry[];
  phase_history?: PhaseHistoryEntry[];
  capital_rounds?: CapitalRoundEntry[];
  ipr?: IPREntry[];
  kpis?: KPIEntry[];
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
  //
  // GDPR art. 9-fält (founder_gender, founder_identifies_as) och PII
  // (phone) plockas ALDRIG ut från startupRecord nedan.
  const r = startupRecord as Record<string, unknown>;
  const optStr = (key: string): string | undefined => {
    const v = r[key];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const optNum = (key: string): number | undefined => {
    const v = r[key];
    return typeof v === 'number' ? v : undefined;
  };
  const optBool = (key: string): boolean | undefined => {
    const v = r[key];
    return typeof v === 'boolean' ? v : undefined;
  };

  const startup: StartupContext['startup'] = {
    name: r.name as string,
    phase: r.phase as string,
    irl_level: optNum('irl_level'),
    status: r.status as string,
    next_step: optStr('next_step'),
    description: stripHtml(r.description as string | undefined),
    tags: optStr('tags'),
    kommun: optStr('kommun'),
    city: optStr('city'),
    industri: optStr('industri'),
    bolagsform: optStr('bolagsform'),
    bolag_status: optStr('bolag_status'),
    website: optStr('website'),
    intagsdatum: optStr('intagsdatum'),
    avslutsdatum: optStr('avslutsdatum'),
    idea_name: optStr('idea_name'),
    case_type: optStr('case_type'),
    status_completion_pct: optNum('status_completion_pct'),
    company_registered_at: optStr('company_registered_at'),
    contacted_at: optStr('contacted_at'),
    area: optStr('area'),
    inflow_source: optStr('inflow_source'),
    is_deeptech: optBool('is_deeptech'),
    meets_excellence_criteria: optBool('meets_excellence_criteria'),
    is_regional: optBool('is_regional'),
    potential_bc_case: optBool('potential_bc_case'),
    preliminary_exit: optStr('preliminary_exit'),
    approved_state_aid_art22: optBool('approved_state_aid_art22'),
    approved_de_minimis: optBool('approved_de_minimis'),
    sent_to: optStr('sent_to'),
    register_notes: stripHtml(r.register_notes as string | undefined) || undefined,
    signed_incubator_agreement: optBool('signed_incubator_agreement'),
    signed_incubator_agreement_at: optStr('signed_incubator_agreement_at'),
    signed_nda: optBool('signed_nda'),
    signed_nda_at: optStr('signed_nda_at'),
    signed_bc_agreement: optBool('signed_bc_agreement'),
    signed_bc_agreement_at: optStr('signed_bc_agreement_at'),
    signed_vinnova_incubation_approval: optBool('signed_vinnova_incubation_approval'),
    signed_vinnova_incubation_approval_at: optStr('signed_vinnova_incubation_approval_at'),
    signed_partner_agreement: optBool('signed_partner_agreement'),
    signed_partner_agreement_at: optStr('signed_partner_agreement_at')
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

  const [financials, phase_history, capital_rounds, ipr, kpis] = await Promise.all([
    buildFinancialsContext(pb, startupId, tenantId),
    buildPhaseHistoryContext(pb, startupId, tenantId),
    buildCapitalRoundsContext(pb, startupId, tenantId),
    buildIPRContext(pb, startupId, tenantId),
    buildKPIsContext(pb, startupId, tenantId)
  ]);

  return {
    startup,
    milestones,
    activities,
    notes,
    financials,
    phase_history,
    capital_rounds,
    ipr,
    kpis
  };
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
 * Hämtar senaste 5 fashistorikraderna (yngst först). Tenant-scoped.
 * Fail-soft: returnerar undefined om collectionen ej finns ännu.
 */
export async function buildPhaseHistoryContext(
  pb: PocketBase,
  startupId: string,
  tenantId: string,
  limit = 5
): Promise<PhaseHistoryEntry[] | undefined> {
  let result;
  try {
    result = await pb.collection('startup_phase_history').getList(1, limit, {
      filter: `startup = "${startupId}" && tenant = "${tenantId}"`,
      sort: '-entered_at'
    });
  } catch {
    return undefined;
  }
  if (!result.items.length) return undefined;
  return result.items.map((r) => {
    const entry: PhaseHistoryEntry = {
      phase: r.phase as string,
      entered_at: r.entered_at as string
    };
    if (r.exited_at) entry.exited_at = r.exited_at as string;
    if (r.note) entry.note = r.note as string;
    return entry;
  });
}

/**
 * Hämtar mottagna kapitalrundor (bidrag, equity, lån). Sorterat
 * nyast → äldst. Bolagsdata, ingen PII. Fail-soft.
 */
export async function buildCapitalRoundsContext(
  pb: PocketBase,
  startupId: string,
  tenantId: string,
  limit = 20
): Promise<CapitalRoundEntry[] | undefined> {
  let result;
  try {
    result = await pb.collection('capital_rounds').getList(1, limit, {
      filter: `startup = "${startupId}" && tenant = "${tenantId}"`,
      sort: '-received_at'
    });
  } catch {
    return undefined;
  }
  if (!result.items.length) return undefined;
  return result.items.map((r) => ({
    type: r.type as string,
    source: r.source as string,
    amount_sek: r.amount_sek as number,
    received_at: r.received_at as string
  }));
}

/**
 * IPR-aktivitet (patent, varumärken). Bolagsdata, ingen PII. Notes
 * (kan vara strategiska) inkluderas inte. Fail-soft.
 */
export async function buildIPRContext(
  pb: PocketBase,
  startupId: string,
  tenantId: string,
  limit = 20
): Promise<IPREntry[] | undefined> {
  let result;
  try {
    result = await pb.collection('intellectual_property').getList(1, limit, {
      filter: `startup = "${startupId}" && tenant = "${tenantId}"`,
      sort: '-filed_at'
    });
  } catch {
    return undefined;
  }
  if (!result.items.length) return undefined;
  return result.items.map((r) => {
    const entry: IPREntry = {
      type: r.type as string,
      status: r.status as string
    };
    if (r.external_reference) entry.external_reference = r.external_reference as string;
    if (r.filed_at) entry.filed_at = r.filed_at as string;
    if (r.response_at) entry.response_at = r.response_at as string;
    return entry;
  });
}

/**
 * KPI-tracker (Mätetal). Default returneras endast `is_current=true`
 * rader så agenten ser senaste värdet per nyckeltal. Fail-soft.
 */
export async function buildKPIsContext(
  pb: PocketBase,
  startupId: string,
  tenantId: string,
  limit = 50
): Promise<KPIEntry[] | undefined> {
  let result;
  try {
    result = await pb.collection('startup_kpis').getList(1, limit, {
      filter: `startup = "${startupId}" && tenant = "${tenantId}" && is_current = true`,
      sort: '-measured_at'
    });
  } catch {
    return undefined;
  }
  if (!result.items.length) return undefined;
  return result.items.map((r) => {
    const entry: KPIEntry = {
      kpi_name: r.kpi_name as string,
      value_text: r.value_text as string,
      measured_at: r.measured_at as string
    };
    if (r.value_numeric !== undefined && r.value_numeric !== null) {
      entry.value_numeric = r.value_numeric as number;
    }
    if (r.unit) entry.unit = r.unit as string;
    if (typeof r.is_current === 'boolean') entry.is_current = r.is_current;
    return entry;
  });
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
    if (s.city) entry.city = s.city as string;
    if (s.industri) entry.industri = s.industri as string;
    if (s.bolag_status) entry.bolag_status = s.bolag_status as string;
    if (s.website) entry.website = s.website as string;
    if (s.idea_name) entry.idea_name = s.idea_name as string;
    if (s.case_type) entry.case_type = s.case_type as string;
    if (s.area) entry.area = s.area as string;
    if (typeof s.is_deeptech === 'boolean') entry.is_deeptech = s.is_deeptech;
    if (typeof s.is_regional === 'boolean') entry.is_regional = s.is_regional;
    if (s.company_registered_at) {
      entry.company_registered_at = s.company_registered_at as string;
    }
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
