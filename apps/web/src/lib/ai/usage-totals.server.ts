import 'server-only';
import type PocketBase from 'pocketbase';
import {
  addUsageTotals,
  collectPages,
  isRollupVerified,
  monthKeyStartPb,
  planUsageRange,
  sumRollupRows,
  sumUsageEvents,
  type CollectedPages,
  type UsageRollupRow,
  type UsageTotals
} from './usage-rollup';

/**
 * Läsvägen för AI-förbrukningens totaler i AI-analysen (CLAUDE.md § 9.6 /
 * § 28). Hela kalendermånader läses ur månadsrollupen (`ai_usage_monthly`,
 * en rad per tenant och månad) och verifieras mot PB:s EXAKTA antal events
 * för samma fönster; bara den inledande delmånaden läses som events. Är
 * rollupen inte verifierad (kollektionen saknas, hooken var inte aktiv) läses
 * hela perioden som events — paginerat med tak, och ett kapat resultat bär
 * `complete: false` som UI:t MÅSTE visa som nedre gräns. Ren logik i
 * `usage-rollup.ts` (enhetstestad). Läser med anroparens klient (RLS § 21;
 * miljövyn skickar superuser och `tenant: null` för alla tenants).
 */

export interface UsageEventLite {
  tenant?: string;
  model?: string;
  surface?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_estimate_usd?: number;
  created?: string;
}

const EVENT_FIELDS = 'tenant,model,surface,tokens_in,tokens_out,cost_estimate_usd,created';
/** Tak för paginerade event-läsningar (40 × 500, samma som tidigare). */
export const USAGE_EVENTS_MAX_ROWS = 20_000;

export interface PagedEvents extends CollectedPages<UsageEventLite> {
  /** PB svarade 400 på datumfiltret (created saknas) — fönstrat i JS. */
  degraded: boolean;
}

function scopeExpr(pb: PocketBase, tenant: string | null): string {
  return tenant ? pb.filter('tenant = {:tenant}', { tenant }) : '';
}

function and(...parts: string[]): string {
  return parts.filter(Boolean).map((p) => `(${p})`).join(' && ');
}

/**
 * Läser events i [from, to) (to = null → till nu), paginerat med tak.
 * Fail-soft mot PB v0.23-autodate-buggen (§ 28.5): 400 på `created`-filtret →
 * läs utan datumfilter och fönstra i JS (rader utan tidsstämpel räknas in —
 * hellre synliga än borttappade), flaggat `degraded`.
 */
export async function loadUsageEventsPaged(
  pb: PocketBase,
  opts: { tenant: string | null; from: string; to: string | null; maxRows?: number }
): Promise<PagedEvents> {
  const maxRows = opts.maxRows ?? USAGE_EVENTS_MAX_ROWS;
  const scope = scopeExpr(pb, opts.tenant);
  const window = opts.to
    ? pb.filter('created >= {:from} && created < {:to}', { from: opts.from, to: opts.to })
    : pb.filter('created >= {:from}', { from: opts.from });
  try {
    const res = await collectPages<UsageEventLite>(
      (page, perPage) =>
        pb.collection('ai_usage_events').getList<UsageEventLite>(page, perPage, {
          filter: and(scope, window),
          fields: EVENT_FIELDS,
          sort: '-created'
        }),
      { maxRows }
    );
    return { ...res, degraded: false };
  } catch {
    const res = await collectPages<UsageEventLite>(
      (page, perPage) =>
        pb.collection('ai_usage_events').getList<UsageEventLite>(page, perPage, {
          filter: scope,
          fields: EVENT_FIELDS
        }),
      { maxRows }
    );
    const inWindow = (r: UsageEventLite) =>
      !r.created || (r.created >= opts.from && (!opts.to || r.created < opts.to));
    const items = res.items.filter(inWindow);
    // `total` gäller den ofiltrerade mängden — antalet i fönstret är bara
    // känt när allt lästes.
    return { items, total: res.complete ? items.length : res.total, complete: res.complete, degraded: true };
  }
}

/** PB:s exakta antal events i fönstret (`totalItems`, en rad läses). */
export async function countUsageEvents(
  pb: PocketBase,
  opts: { tenant: string | null; from: string; to?: string | null }
): Promise<number | null> {
  try {
    const window = opts.to
      ? pb.filter('created >= {:from} && created < {:to}', { from: opts.from, to: opts.to })
      : pb.filter('created >= {:from}', { from: opts.from });
    const res = await pb.collection('ai_usage_events').getList(1, 1, {
      filter: and(scopeExpr(pb, opts.tenant), window),
      fields: 'id'
    });
    return res.totalItems;
  } catch {
    return null;
  }
}

export interface PeriodUsageTotals {
  /** Totaler per tenant-id (för `tenant` = en tenant: bara den nyckeln). */
  byTenant: Map<string, UsageTotals>;
  total: UsageTotals;
  /** false = kapad läsning → visa som nedre gräns. */
  complete: boolean;
  /** Var siffrorna kommer ifrån (transparens i UI:t). */
  source: 'rollup' | 'rollup+events' | 'events';
  degraded: boolean;
}

function addInto(map: Map<string, UsageTotals>, key: string, t: UsageTotals): void {
  const prev = map.get(key);
  map.set(key, prev ? addUsageTotals(prev, t) : t);
}

function eventsByTenant(rows: UsageEventLite[]): Map<string, UsageTotals> {
  const groups = new Map<string, UsageEventLite[]>();
  for (const r of rows) {
    const k = r.tenant || '';
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  const out = new Map<string, UsageTotals>();
  for (const [k, list] of groups) out.set(k, sumUsageEvents(list));
  return out;
}

/**
 * Totaler (kostnad, tokens, antal anrop) för perioden `sincePb` → nu.
 * `tenant: null` = alla tenants (kräver superuser-klient).
 */
export async function loadPeriodUsageTotals(
  pb: PocketBase,
  opts: { tenant: string | null; sincePb: string; now?: Date; maxRows?: number }
): Promise<PeriodUsageTotals> {
  const now = opts.now ?? new Date();
  const plan = planUsageRange(opts.sincePb, now);

  if (plan.rollupFromMonth) {
    let rollupRows: UsageRollupRow[] | null = null;
    try {
      const res = await collectPages<UsageRollupRow>(
        (page, perPage) =>
          pb.collection('ai_usage_monthly').getList<UsageRollupRow>(page, perPage, {
            filter: and(
              scopeExpr(pb, opts.tenant),
              pb.filter('month >= {:month}', { month: plan.rollupFromMonth })
            ),
            fields: 'tenant,month,cost_usd,tokens_in,tokens_out,events'
          }),
        { maxRows: 10_000 }
      );
      rollupRows = res.complete ? res.items : null;
    } catch {
      rollupRows = null; // kollektionen saknas (migration 1700000185 ej körd)
    }

    if (rollupRows) {
      const rollupTotal = sumRollupRows(rollupRows);
      const exact = await countUsageEvents(pb, {
        tenant: opts.tenant,
        from: monthKeyStartPb(plan.rollupFromMonth)
      });
      if (isRollupVerified(rollupTotal.events, exact)) {
        const byTenant = new Map<string, UsageTotals>();
        for (const r of rollupRows) addInto(byTenant, r.tenant || '', sumRollupRows([r]));
        let complete = true;
        let degraded = false;
        if (plan.head) {
          const head = await loadUsageEventsPaged(pb, {
            tenant: opts.tenant,
            from: plan.head.from,
            to: plan.head.to,
            maxRows: opts.maxRows
          });
          complete = head.complete;
          degraded = head.degraded;
          for (const [k, t] of eventsByTenant(head.items)) addInto(byTenant, k, t);
        }
        const total = [...byTenant.values()].reduce(addUsageTotals, {
          costUsd: 0,
          tokensIn: 0,
          tokensOut: 0,
          events: 0
        });
        return { byTenant, total, complete, source: plan.head ? 'rollup+events' : 'rollup', degraded };
      }
    }
  }

  const all = await loadUsageEventsPaged(pb, {
    tenant: opts.tenant,
    from: opts.sincePb,
    to: null,
    maxRows: opts.maxRows
  });
  const byTenant = eventsByTenant(all.items);
  const total = sumUsageEvents(all.items);
  return { byTenant, total, complete: all.complete, source: 'events', degraded: all.degraded };
}
