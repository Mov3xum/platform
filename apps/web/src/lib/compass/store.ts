import 'server-only';
import type PocketBase from 'pocketbase';
import { getSuperuserPb } from '@/lib/integrations/credentials';
import type {
  CompassModule,
  CompassQuestion,
  Conversation,
  Lead,
  LeadSource,
  LeadStatus,
  SecurityEventKind
} from './types';
import { LEAD_STATUS_ORDER } from './types';

/* ────────────────────────────────────────────────────────────────────
   Läs-fallback — PB v0.23.4 rule-eval-bugg (CLAUDE.md § 21.3)
   ────────────────────────────────────────────────────────────────────
   PocketBase v0.23.4 kan TYST neka list/view-regler som matchar mot
   multi-värde-fält (`@request.auth.roles`/`linked_startups`) — även för en
   behörig staff-användare. För compass_leads ger det symptomet "lead skapas
   men syns inte i listan": create-regeln (auth+tenant) släpper igenom, men
   list/view-regeln (staff-roll) evalueras tyst falskt → tom lista.

   Alla läs-callers nedan körs på staff-gejtade sidor (admin/incubator_lead/
   coach/mentor verifieras med `hasRole` innan anropet) och skickar ALLTID med
   den inloggades egen `tenant`. Vi kör därför användartoken FÖRST (RLS-lagret
   bevaras, defense-in-depth) och faller bara tillbaka på en superuser-läsning
   när resultatet är tomt eller anropet fallerar. Tenant-filtret återanvänds
   oförändrat i fallbacken, så tenant-isoleringen består. Samma mönster som
   `writeWithFallback` i lib/actions/compass.ts. */
async function readWithFallback<T>(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<T>,
  isEmpty: (result: T) => boolean
): Promise<T> {
  let primary: T | null = null;
  try {
    primary = await run(pb);
    if (!isEmpty(primary)) return primary;
  } catch {
    // användartoken nekades/fel — försök superuser nedan
  }
  const su = await getSuperuserPb();
  if (su.ok) {
    try {
      const fb = await run(su.pb);
      if (!isEmpty(fb)) return fb;
    } catch {
      // superuser misslyckades också — falla tillbaka på primärresultatet
    }
  }
  if (primary !== null) return primary;
  throw new Error('compass read failed (primary + superuser)');
}

/* ────────────────────────────────────────────────────────────────────
   Skriv-fallback — samma PB v0.23.4 rule-eval-bugg (CLAUDE.md § 21.3)
   ────────────────────────────────────────────────────────────────────
   Spegelbilden av `readWithFallback`. Lead-skrivningar (create/update) går via
   den inloggades auth-token så RLS-lagret bevaras (defense-in-depth). Men
   `compass_leads.createRule` är en roll-/tenant-regel, och PB v0.23.4 kan TYST
   neka den (`?=` mot multi-value `@request.auth.roles`) — även för en behörig
   admin. Symptomet är exakt det rapporterade: "jag interagerar med en modul men
   blir aldrig upplagd som lead" — create:en avvisas tyst och leadet skapas
   aldrig. Modul-/frågeskrivningar hade redan denna fallback (`writeWithFallback`
   i lib/actions/compass.ts); lead-skrivningarna saknade den.

   Vi försöker därför alltid användartoken FÖRST och faller bara tillbaka på en
   superuser-skrivning när den nekas/felar. Tenant stämplas explicit av anroparen
   (aldrig från en request-body), så tenant-isoleringen består även i fallbacken.
   De PUBLIKA flödena skickar redan in en superuser-klient → no-op för dem. */
async function writeWithFallback<T>(
  pb: PocketBase,
  run: (client: PocketBase) => Promise<T>
): Promise<T> {
  try {
    return await run(pb);
  } catch {
    const su = await getSuperuserPb();
    if (su.ok) return run(su.pb);
    throw new Error('compass write failed (primary + superuser unavailable)');
  }
}

/* ────────────────────────────────────────────────────────────────────
   Lead sources — gemensam lookup (ingen tenant)
   ──────────────────────────────────────────────────────────────────── */

export async function listLeadSources(pb: PocketBase): Promise<LeadSource[]> {
  try {
    const res = await pb.collection('compass_lead_sources').getList<LeadSource>(1, 50, {
      sort: 'sort_order'
    });
    return res.items;
  } catch {
    return [];
  }
}

/* ────────────────────────────────────────────────────────────────────
   Leads
   ──────────────────────────────────────────────────────────────────── */

export async function listLeads(
  pb: PocketBase,
  tenant: string,
  options: {
    status?: LeadStatus;
    q?: string;
    sourceKey?: string;
    landingModule?: string;
    page?: number;
    perPage?: number;
  } = {}
): Promise<{ items: Lead[]; totalItems: number; totalPages: number }> {
  const filters: string[] = ['tenant = {:tenant}'];
  const params: Record<string, unknown> = { tenant };
  if (options.status) {
    filters.push('status = {:status}');
    params.status = options.status;
  }
  if (options.sourceKey) {
    filters.push('source_key = {:src}');
    params.src = options.sourceKey;
  }
  if (options.landingModule) {
    filters.push('landing_module = {:lm}');
    params.lm = options.landingModule;
  }
  if (options.q) {
    filters.push(
      '(name ~ {:q} || email ~ {:q} || idea_summary ~ {:q} || organization ~ {:q})'
    );
    params.q = options.q;
  }

  const filter = pb.filter(filters.join(' && '), params);
  try {
    const res = await readWithFallback(
      pb,
      (client) =>
        client.collection('compass_leads').getList<Lead>(options.page ?? 1, options.perPage ?? 25, {
          filter,
          sort: '-created'
        }),
      (r) => r.totalItems === 0
    );
    return { items: res.items, totalItems: res.totalItems, totalPages: res.totalPages };
  } catch {
    return { items: [], totalItems: 0, totalPages: 0 };
  }
}

export async function getLead(
  pb: PocketBase,
  tenant: string,
  id: string
): Promise<Lead | null> {
  try {
    const rec = await readWithFallback(
      pb,
      (client) => client.collection('compass_leads').getOne<Lead>(id),
      // En träff vars tenant inte matchar betraktas som "tom" → tvingar
      // superuser-fallbacken att inte heller returnera fel tenant (den
      // re-verifieras nedan).
      (r) => !r || r.tenant !== tenant
    );
    if (rec.tenant !== tenant) return null;
    return rec;
  } catch {
    return null;
  }
}

/**
 * PII-fri beskrivning av ett PB-fel för serverloggen: status, meddelande och
 * VILKA fält som avvisades (aldrig deras värden). Utan denna logg är ett
 * misslyckat lead-skapande helt osynligt — symptomet "fyllt i flera formulär
 * utan att en lead skapats" gick inte att felsöka.
 */
function describePbError(err: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (err instanceof Error) out.message = err.message;
  if (typeof err === 'object' && err !== null) {
    const e = err as { status?: number; response?: { data?: Record<string, unknown> } };
    if (typeof e.status === 'number') out.status = e.status;
    const data = e.response?.data;
    if (data && typeof data === 'object') out.rejectedFields = Object.keys(data);
  }
  return out;
}

export async function createLead(
  pb: PocketBase,
  tenant: string,
  data: Partial<Lead>
): Promise<Lead | null> {
  try {
    const payload = {
      tenant,
      status: 'new' as LeadStatus,
      source_key: 'ai-chat',
      ...data
    };
    return await writeWithFallback(pb, (client) =>
      client.collection('compass_leads').create<Lead>(payload)
    );
  } catch (err) {
    // Logga ALLTID grundorsaken (PII-fritt) — anroparen avgör om felet ska
    // bubbla upp till besökaren (hård lead-garanti, CLAUDE.md § 23.6).
    console.error('[compass] createLead failed', {
      tenant,
      source_key: data.source_key,
      landing_module: data.landing_module,
      ...describePbError(err)
    });
    return null;
  }
}

export async function updateLead(
  pb: PocketBase,
  tenant: string,
  id: string,
  patch: Partial<Lead>
): Promise<Lead | null> {
  const existing = await getLead(pb, tenant, id);
  if (!existing) return null;
  try {
    return await writeWithFallback(pb, (client) =>
      client.collection('compass_leads').update<Lead>(id, patch)
    );
  } catch {
    return null;
  }
}

export async function countLeadsByStatus(
  pb: PocketBase,
  tenant: string
): Promise<Record<LeadStatus, number>> {
  const empty: Record<LeadStatus, number> = {
    new: 0,
    contacted: 0,
    'meeting-booked': 0,
    evaluating: 0,
    accepted: 0,
    declined: 0
  };
  const filter = pb.filter('tenant = {:tenant}', { tenant });
  try {
    const all = await readWithFallback(
      pb,
      (client) =>
        client.collection('compass_leads').getFullList<Pick<Lead, 'status'>>({
          filter,
          fields: 'status',
          batch: 500
        }),
      (rows) => rows.length === 0
    );
    for (const row of all) {
      empty[row.status] = (empty[row.status] ?? 0) + 1;
    }
    return empty;
  } catch {
    return empty;
  }
}

export interface AssignableStaff {
  id: string;
  name: string;
  email: string;
}

/**
 * Personal som kan tilldelas som coach vid konvertering av en lead. Endast
 * inkubatorroller i samma tenant. PII (e-post) returneras bara för intern
 * staff-UI och loggas aldrig till AI-kontext (CLAUDE.md § 9.3).
 */
export async function listAssignableStaff(
  pb: PocketBase,
  tenant: string
): Promise<AssignableStaff[]> {
  try {
    const res = await pb.collection('users').getFullList<AssignableStaff>({
      filter: pb.filter(
        'tenant = {:tenant} && (roles ~ "admin" || roles ~ "incubator_lead" || roles ~ "coach" || roles ~ "mentor")',
        { tenant }
      ),
      fields: 'id,name,email',
      sort: 'name',
      batch: 200
    });
    return res;
  } catch {
    return [];
  }
}

/* ────────────────────────────────────────────────────────────────────
   Conversations & messages
   ──────────────────────────────────────────────────────────────────── */

export async function createConversation(
  pb: PocketBase,
  tenant: string,
  data: { moduleSlug?: string; sessionToken?: string; leadId?: string }
): Promise<Conversation | null> {
  try {
    return await writeWithFallback(pb, (client) =>
      client.collection('compass_conversations').create<Conversation>({
        tenant,
        module_slug: data.moduleSlug,
        session_token: data.sessionToken,
        lead: data.leadId,
        status: 'active'
      })
    );
  } catch {
    return null;
  }
}

export async function appendMessage(
  pb: PocketBase,
  conversationId: string,
  data: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    tokens_in?: number;
    tokens_out?: number;
    model?: string;
  }
): Promise<void> {
  try {
    await pb.collection('compass_messages').create({
      conversation: conversationId,
      ...data
    });
  } catch {
    // best-effort logging — chatten ska inte fela för att vi inte
    // kunde persistera ett meddelande.
  }
}

export async function listMessages(
  pb: PocketBase,
  conversationId: string
): Promise<{ role: 'user' | 'assistant' | 'system'; content: string }[]> {
  try {
    const res = await pb.collection('compass_messages').getFullList<{
      role: 'user' | 'assistant' | 'system';
      content: string;
    }>({ filter: pb.filter('conversation = {:c}', { c: conversationId }), sort: 'created', batch: 200 });
    return res;
  } catch {
    return [];
  }
}

/* ────────────────────────────────────────────────────────────────────
   Modules + questions
   ──────────────────────────────────────────────────────────────────── */

export async function listModules(
  pb: PocketBase,
  tenant: string,
  options: { onlyActive?: boolean } = {}
): Promise<CompassModule[]> {
  const filters = ['tenant = {:tenant}'];
  const params: Record<string, unknown> = { tenant };
  if (options.onlyActive) {
    filters.push('is_active = true');
  }
  try {
    const res = await pb.collection('compass_modules').getList<CompassModule>(1, 100, {
      filter: pb.filter(filters.join(' && '), params),
      sort: 'sort_order,name'
    });
    return res.items;
  } catch {
    return [];
  }
}

export async function getModuleBySlug(
  pb: PocketBase,
  tenant: string,
  slug: string
): Promise<CompassModule | null> {
  try {
    return await pb.collection('compass_modules').getFirstListItem<CompassModule>(
      pb.filter('tenant = {:tenant} && slug = {:slug}', { tenant, slug })
    );
  } catch {
    return null;
  }
}

export async function listQuestionsForModule(
  pb: PocketBase,
  moduleId: string
): Promise<CompassQuestion[]> {
  try {
    const res = await pb.collection('compass_questions').getFullList<CompassQuestion>({
      filter: pb.filter('module = {:m}', { m: moduleId }),
      sort: 'sort_order',
      batch: 200
    });
    return res;
  } catch {
    return [];
  }
}

/* ────────────────────────────────────────────────────────────────────
   Security events — server-side audit log
   ──────────────────────────────────────────────────────────────────── */

export async function logSecurity(
  pb: PocketBase,
  tenant: string,
  data: {
    actor?: string;
    kind: SecurityEventKind;
    subject?: string;
    meta?: Record<string, unknown>;
    ipHash?: string;
  }
): Promise<void> {
  try {
    await pb.collection('compass_security_events').create({
      tenant,
      actor: data.actor,
      kind: data.kind,
      subject: data.subject,
      meta: data.meta,
      ip_hash: data.ipHash
    });
  } catch {
    // best-effort
  }
}

/* ────────────────────────────────────────────────────────────────────
   Attribution & analytics
   ──────────────────────────────────────────────────────────────────── */

export interface AttributionBreakdown {
  source_key: string;
  total: number;
  accepted: number;
  in_funnel: number;
}

export interface CampaignBreakdown {
  campaign: string;
  source?: string;
  medium?: string;
  total: number;
  accepted: number;
}

export interface ModuleConversion {
  slug: string;
  total: number;
  accepted: number;
  converted: number;
}

/** Snabba analytics — räknar leads per dimension från ett enda batch-hämta. */
export async function getLeadAnalytics(
  pb: PocketBase,
  tenant: string,
  windowDays?: number
): Promise<{
  bySource: AttributionBreakdown[];
  byCampaign: CampaignBreakdown[];
  byModule: ModuleConversion[];
  weekly: { week: string; total: number; accepted: number }[];
  total: number;
  accepted: number;
  converted: number;
}> {
  try {
    const filterParts = ['tenant = {:tenant}'];
    const params: Record<string, unknown> = { tenant };
    if (windowDays && windowDays > 0) {
      const cutoff = new Date(Date.now() - windowDays * 86400_000).toISOString();
      filterParts.push('created >= {:cutoff}');
      params.cutoff = cutoff;
    }
    const analyticsFilter = pb.filter(filterParts.join(' && '), params);
    const leads = await readWithFallback(
      pb,
      (client) =>
        client.collection('compass_leads').getFullList<Lead>({
          filter: analyticsFilter,
          fields:
            'id,status,source_key,utm_source,utm_medium,utm_campaign,landing_module,converted_startup,converted_at,created',
          batch: 1000
        }),
      (rows) => rows.length === 0
    );

    const sourceMap = new Map<string, AttributionBreakdown>();
    const campaignMap = new Map<string, CampaignBreakdown>();
    const moduleMap = new Map<string, ModuleConversion>();
    const weekMap = new Map<string, { week: string; total: number; accepted: number }>();

    let accepted = 0;
    let converted = 0;
    for (const lead of leads) {
      const isAccepted = lead.status === 'accepted';
      const isConverted = !!lead.converted_startup;
      if (isAccepted) accepted++;
      if (isConverted) converted++;

      // By source
      const sourceKey = lead.source_key || 'unknown';
      let s = sourceMap.get(sourceKey);
      if (!s) {
        s = { source_key: sourceKey, total: 0, accepted: 0, in_funnel: 0 };
        sourceMap.set(sourceKey, s);
      }
      s.total++;
      if (isAccepted) s.accepted++;
      if (lead.status !== 'declined' && lead.status !== 'accepted') s.in_funnel++;

      // By campaign
      const campaign = (lead.utm_campaign || '').trim();
      if (campaign) {
        let c = campaignMap.get(campaign);
        if (!c) {
          c = {
            campaign,
            source: lead.utm_source || undefined,
            medium: lead.utm_medium || undefined,
            total: 0,
            accepted: 0
          };
          campaignMap.set(campaign, c);
        }
        c.total++;
        if (isAccepted) c.accepted++;
      }

      // By module
      const slug = (lead.landing_module || '').trim();
      if (slug) {
        let m = moduleMap.get(slug);
        if (!m) {
          m = { slug, total: 0, accepted: 0, converted: 0 };
          moduleMap.set(slug, m);
        }
        m.total++;
        if (isAccepted) m.accepted++;
        if (isConverted) m.converted++;
      }

      // Weekly bucket
      const wkKey = weekKey(lead.created);
      let w = weekMap.get(wkKey);
      if (!w) {
        w = { week: wkKey, total: 0, accepted: 0 };
        weekMap.set(wkKey, w);
      }
      w.total++;
      if (isAccepted) w.accepted++;
    }

    return {
      bySource: [...sourceMap.values()].sort((a, b) => b.total - a.total),
      byCampaign: [...campaignMap.values()].sort((a, b) => b.total - a.total),
      byModule: [...moduleMap.values()].sort((a, b) => b.total - a.total),
      weekly: [...weekMap.values()].sort((a, b) => (a.week > b.week ? 1 : -1)),
      total: leads.length,
      accepted,
      converted
    };
  } catch {
    return {
      bySource: [],
      byCampaign: [],
      byModule: [],
      weekly: [],
      total: 0,
      accepted: 0,
      converted: 0
    };
  }
}

function weekKey(iso: string): string {
  try {
    const d = new Date(iso);
    const yr = d.getUTCFullYear();
    const start = new Date(Date.UTC(yr, 0, 1));
    const week = Math.ceil(((d.getTime() - start.getTime()) / 86400_000 + start.getUTCDay() + 1) / 7);
    return `${yr}-W${String(week).padStart(2, '0')}`;
  } catch {
    return 'okänd';
  }
}

/* ────────────────────────────────────────────────────────────────────
   Dashboard — KPI:er, trend och källfördelning (Startupkompassen)
   ──────────────────────────────────────────────────────────────────── */

export interface DashboardKpis {
  /** Totalt antal leads (all-time) i tenanten. */
  totalLeads: number;
  /** Leads skapade under vald period. */
  leadsThisPeriod: number;
  /** Andel av periodens leads jämfört med föregående lika långa period. */
  leadsDelta: number;
  /** Accepterade / totalt (all-time). */
  conversionRate: number;
  /** Leads i aktiva trattsteg (new/contacted/meeting-booked/evaluating). */
  activePipeline: number;
  /** Genomsnittlig AI-poäng för periodens leads (0 om inga poäng). */
  avgScore: number;
  /** Förändring i snittpoäng mot föregående period. */
  scoreDelta: number;
}

export interface CompassDashboard {
  periodDays: number;
  kpis: DashboardKpis;
  leadsPerDay: { date: string; count: number }[];
  leadsPerSource: { source_key: string; label: string; color: string; count: number }[];
  funnel: { status: LeadStatus; count: number }[];
}

type DashboardLeadRow = Pick<Lead, 'status' | 'score' | 'source_key' | 'created'>;

function emptyDashboard(periodDays: number): CompassDashboard {
  return {
    periodDays,
    kpis: {
      totalLeads: 0,
      leadsThisPeriod: 0,
      leadsDelta: 0,
      conversionRate: 0,
      activePipeline: 0,
      avgScore: 0,
      scoreDelta: 0
    },
    leadsPerDay: [],
    leadsPerSource: [],
    funnel: LEAD_STATUS_ORDER.map((status) => ({ status, count: 0 }))
  };
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Aggregerar dashboard-mätetal för Startupkompassen. Speglar
 * movexum-token-usage:s `dashboard-summary`, men mot PocketBase med
 * tenant-isolering. Hela tratten räknas all-time (funnel/totals), medan
 * trend, källfördelning och delta beräknas från ett enda batch-hämta över
 * de två senaste perioderna.
 */
export async function getCompassDashboard(
  pb: PocketBase,
  tenant: string,
  days: number,
  sources: LeadSource[]
): Promise<CompassDashboard> {
  const periodDays = Math.min(90, Math.max(7, Math.trunc(days) || 30));
  try {
    const now = Date.now();
    const sinceMs = now - periodDays * 86400_000;
    const prevSinceIso = new Date(now - periodDays * 2 * 86400_000).toISOString();

    const windowFilter = pb.filter('tenant = {:tenant} && created >= {:cutoff}', {
      tenant,
      cutoff: prevSinceIso
    });
    const [funnelCounts, windowLeads] = await Promise.all([
      countLeadsByStatus(pb, tenant),
      readWithFallback(
        pb,
        (client) =>
          client.collection('compass_leads').getFullList<DashboardLeadRow>({
            filter: windowFilter,
            fields: 'status,score,source_key,created',
            batch: 1000
          }),
        (rows) => rows.length === 0
      )
    ]);

    const totalLeads = LEAD_STATUS_ORDER.reduce((s, k) => s + (funnelCounts[k] || 0), 0);
    const accepted = funnelCounts.accepted || 0;
    const activePipeline =
      (funnelCounts.new || 0) +
      (funnelCounts.contacted || 0) +
      (funnelCounts['meeting-booked'] || 0) +
      (funnelCounts.evaluating || 0);
    const conversionRate = totalLeads > 0 ? accepted / totalLeads : 0;

    const current = windowLeads.filter((l) => new Date(l.created).getTime() >= sinceMs);
    const prev = windowLeads.filter((l) => new Date(l.created).getTime() < sinceMs);

    const leadsThisPeriod = current.length;
    const leadsDelta = prev.length > 0 ? (leadsThisPeriod - prev.length) / prev.length : 0;

    const avgScore = avg(
      current.map((l) => l.score).filter((s): s is number => typeof s === 'number')
    );
    const prevAvgScore = avg(
      prev.map((l) => l.score).filter((s): s is number => typeof s === 'number')
    );
    const scoreDelta = prevAvgScore > 0 ? (avgScore - prevAvgScore) / prevAvgScore : 0;

    // Leads per dag — fyll alla dagar i perioden (även nolldagar).
    const dayMap = new Map<string, number>();
    for (let i = periodDays - 1; i >= 0; i -= 1) {
      dayMap.set(new Date(now - i * 86400_000).toISOString().slice(0, 10), 0);
    }
    for (const lead of current) {
      const key = lead.created.slice(0, 10);
      if (dayMap.has(key)) dayMap.set(key, (dayMap.get(key) || 0) + 1);
    }
    const leadsPerDay = [...dayMap.entries()].map(([date, count]) => ({ date, count }));

    // Leads per källa under perioden.
    const sourceByKey = new Map(sources.map((s) => [s.key, s]));
    const srcMap = new Map<string, number>();
    for (const lead of current) {
      const key = lead.source_key || 'unknown';
      srcMap.set(key, (srcMap.get(key) || 0) + 1);
    }
    const leadsPerSource = [...srcMap.entries()]
      .map(([source_key, count]) => {
        const src = sourceByKey.get(source_key);
        return {
          source_key,
          label: src?.label || source_key,
          color: src?.color || '#002c40',
          count
        };
      })
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count);

    return {
      periodDays,
      kpis: {
        totalLeads,
        leadsThisPeriod,
        leadsDelta,
        conversionRate,
        activePipeline,
        avgScore: Math.round(avgScore),
        scoreDelta
      },
      leadsPerDay,
      leadsPerSource,
      funnel: LEAD_STATUS_ORDER.map((status) => ({ status, count: funnelCounts[status] || 0 }))
    };
  } catch {
    return emptyDashboard(periodDays);
  }
}

export async function listSecurityEvents(
  pb: PocketBase,
  tenant: string,
  options: { page?: number; perPage?: number; kind?: SecurityEventKind } = {}
) {
  const filters = ['tenant = {:tenant}'];
  const params: Record<string, unknown> = { tenant };
  if (options.kind) {
    filters.push('kind = {:k}');
    params.k = options.kind;
  }
  try {
    return await pb.collection('compass_security_events').getList(
      options.page ?? 1,
      options.perPage ?? 50,
      {
        filter: pb.filter(filters.join(' && '), params),
        sort: '-created',
        expand: 'actor'
      }
    );
  } catch {
    return { items: [], totalItems: 0, totalPages: 0 };
  }
}
