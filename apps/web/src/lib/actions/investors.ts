'use server';

import { revalidatePath } from 'next/cache';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import type {
  Role,
  Deal,
  DealStage,
  Investor,
  InvestorStage,
  InvestorWarmth
} from '@platform/shared';

const STAFF_ROLES: Role[] = ['admin', 'incubator_lead', 'coach', 'partner'];

const VALID_WARMTH: InvestorWarmth[] = ['hot', 'active', 'tracking', 'later'];
const VALID_INVESTOR_STAGES: InvestorStage[] = [
  'pre_seed',
  'seed',
  'series_a',
  'series_b',
  'growth'
];
const VALID_DEAL_STAGES: DealStage[] = ['intro', 'meeting', 'dd', 'term_sheet', 'close'];

export type InvestorActionState = {
  error?: string;
  investorId?: string;
  dealId?: string;
};

function parseNumber(value: FormDataEntryValue | null): number | undefined {
  if (value === null) return undefined;
  const str = String(value).trim();
  if (!str) return undefined;
  const parsed = Number(str.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseList(value: FormDataEntryValue | null): string[] {
  if (value === null) return [];
  return String(value)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createInvestorAction(
  _prev: InvestorActionState,
  formData: FormData
): Promise<InvestorActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };
  const pb = await getServerPb();

  const name = String(formData.get('name') || '').trim();
  if (!name) return { error: 'Namn är obligatoriskt.' };

  const warmthRaw = String(formData.get('warmth') || 'tracking') as InvestorWarmth;
  const warmth = VALID_WARMTH.includes(warmthRaw) ? warmthRaw : 'tracking';

  const stageFocus = formData
    .getAll('stage_focus')
    .map(String)
    .filter((s): s is InvestorStage => VALID_INVESTOR_STAGES.includes(s as InvestorStage));

  const focus = parseList(formData.get('focus'));
  const website = String(formData.get('website') || '').trim();
  const notes = String(formData.get('notes') || '').trim();
  const ticket_min = parseNumber(formData.get('ticket_min'));
  const ticket_max = parseNumber(formData.get('ticket_max'));

  try {
    const record = await pb.collection(PB_COLLECTIONS.investors).create({
      tenant: user.tenant,
      name,
      focus,
      ticket_min: ticket_min ?? null,
      ticket_max: ticket_max ?? null,
      warmth,
      stage_focus: stageFocus,
      website: website || null,
      notes: notes || null
    });
    revalidatePath('/investerare');
    return { investorId: String(record.id) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte skapa investerare.' };
  }
}

export async function createDealAction(
  _prev: InvestorActionState,
  formData: FormData
): Promise<InvestorActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };
  const pb = await getServerPb();

  const startup = String(formData.get('startup') || '').trim();
  const investor = String(formData.get('investor') || '').trim();
  if (!startup || !investor) return { error: 'Startup och investerare krävs.' };

  const stageRaw = String(formData.get('stage') || 'intro') as DealStage;
  const stage = VALID_DEAL_STAGES.includes(stageRaw) ? stageRaw : 'intro';
  const amount = parseNumber(formData.get('amount'));
  const notes = String(formData.get('notes') || '').trim();

  // Tenant isolation: verify startup + investor both belong to user's tenant
  try {
    const [s, inv] = await Promise.all([
      pb.collection('startups').getOne<{ tenant: string }>(startup, { fields: 'id,tenant' }),
      pb
        .collection(PB_COLLECTIONS.investors)
        .getOne<{ tenant: string }>(investor, { fields: 'id,tenant' })
    ]);
    if (s.tenant !== user.tenant || inv.tenant !== user.tenant) {
      return { error: 'Åtkomst nekad.' };
    }
  } catch {
    return { error: 'Startup eller investerare hittades inte.' };
  }

  try {
    const record = await pb.collection(PB_COLLECTIONS.deals).create({
      tenant: user.tenant,
      startup,
      investor,
      stage,
      amount: amount ?? null,
      notes: notes || null,
      last_activity: new Date().toISOString()
    });
    revalidatePath('/investerare');
    revalidatePath(`/investerare/${investor}`);
    return { dealId: String(record.id) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte skapa deal.' };
  }
}

export async function moveDealStageAction(
  dealId: string,
  nextStage: DealStage
): Promise<InvestorActionState> {
  const user = await requireUser();
  if (!hasRole(user.roles, STAFF_ROLES)) return { error: 'Åtkomst nekad.' };
  if (!VALID_DEAL_STAGES.includes(nextStage)) return { error: 'Ogiltigt steg.' };

  const pb = await getServerPb();
  let deal: Deal;
  try {
    deal = await pb.collection(PB_COLLECTIONS.deals).getOne<Deal>(dealId);
  } catch {
    return { error: 'Deal hittades inte.' };
  }
  if (deal.tenant !== user.tenant) return { error: 'Åtkomst nekad.' };

  try {
    await pb.collection(PB_COLLECTIONS.deals).update(dealId, {
      stage: nextStage,
      last_activity: new Date().toISOString()
    });
    revalidatePath('/investerare');
    revalidatePath(`/investerare/${deal.investor}`);
    return { dealId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Kunde inte flytta deal.' };
  }
}

export async function getInvestorDeals(investorId: string): Promise<Deal[]> {
  const user = await requireUser();
  const pb = await getServerPb();
  try {
    const res = await pb.collection(PB_COLLECTIONS.deals).getList<Deal>(1, 50, {
      filter: `tenant = "${user.tenant}" && investor = "${investorId}"`,
      sort: '-last_activity',
      expand: 'startup,investor'
    });
    return res.items;
  } catch {
    return [];
  }
}

export async function listInvestors(): Promise<Investor[]> {
  const user = await requireUser();
  const pb = await getServerPb();
  try {
    const res = await pb.collection(PB_COLLECTIONS.investors).getList<Investor>(1, 100, {
      filter: `tenant = "${user.tenant}"`,
      sort: '-updated'
    });
    return res.items;
  } catch {
    return [];
  }
}

export async function listDeals(): Promise<Deal[]> {
  const user = await requireUser();
  const pb = await getServerPb();
  try {
    const res = await pb.collection(PB_COLLECTIONS.deals).getList<Deal>(1, 200, {
      filter: `tenant = "${user.tenant}"`,
      sort: '-last_activity',
      expand: 'startup,investor'
    });
    return res.items;
  } catch {
    return [];
  }
}
