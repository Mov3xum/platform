import 'server-only';
import type PocketBase from 'pocketbase';
import type {
  CompassModule,
  CompassQuestion,
  Conversation,
  Lead,
  LeadSource,
  LeadStatus,
  SecurityEventKind
} from './types';

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

  try {
    const res = await pb.collection('compass_leads').getList<Lead>(
      options.page ?? 1,
      options.perPage ?? 25,
      {
        filter: pb.filter(filters.join(' && '), params),
        sort: '-created'
      }
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
    const rec = await pb.collection('compass_leads').getOne<Lead>(id);
    if (rec.tenant !== tenant) return null;
    return rec;
  } catch {
    return null;
  }
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
    return await pb.collection('compass_leads').create<Lead>(payload);
  } catch {
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
    return await pb.collection('compass_leads').update<Lead>(id, patch);
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
  try {
    const all = await pb.collection('compass_leads').getFullList<Pick<Lead, 'status'>>({
      filter: pb.filter('tenant = {:tenant}', { tenant }),
      fields: 'status',
      batch: 500
    });
    for (const row of all) {
      empty[row.status] = (empty[row.status] ?? 0) + 1;
    }
    return empty;
  } catch {
    return empty;
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
    return await pb.collection('compass_conversations').create<Conversation>({
      tenant,
      module_slug: data.moduleSlug,
      session_token: data.sessionToken,
      lead: data.leadId,
      status: 'active'
    });
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
    const leads = await pb.collection('compass_leads').getFullList<Lead>({
      filter: pb.filter(filterParts.join(' && '), params),
      fields:
        'id,status,source_key,utm_source,utm_medium,utm_campaign,landing_module,converted_startup,converted_at,created',
      batch: 1000
    });

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
