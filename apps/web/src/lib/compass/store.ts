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
  options: { status?: LeadStatus; q?: string; sourceKey?: string; page?: number; perPage?: number } = {}
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
