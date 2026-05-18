import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import { Avatar, Chip } from '@/components/proto';
import { PageShell } from '@/components/PageShell';
import { RailSection, RailStat } from '@/components/PageRail';
import { DealFlowBoard } from '@/components/DealFlowBoard';
import type { Deal, Investor, InvestorWarmth } from '@platform/shared';

type DealWithExpand = Deal & {
  expand?: {
    startup?: { id: string; name: string };
    investor?: { id: string; name: string };
  };
};

const WARMTH_LABEL: Record<InvestorWarmth, string> = {
  hot: 'Hett',
  active: 'Aktiv',
  tracking: 'Spårar',
  later: 'Senare'
};

const WARMTH_VARIANT: Record<InvestorWarmth, 'danger' | 'active' | 'draft' | 'archive'> = {
  hot: 'danger',
  active: 'active',
  tracking: 'draft',
  later: 'archive'
};

const ACCENTS = ['ink', 'green', 'purple', 'copper', 'cyan', 'yellow', 'brown'] as const;

function accentFor(id: string): (typeof ACCENTS)[number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

function formatTicketRange(min?: number, max?: number): string {
  if (!min && !max) return 'Ticket okänd';
  const fmt = (v: number) => {
    const mkr = v / 1_000_000;
    if (mkr >= 1) {
      const s = mkr.toFixed(mkr < 10 ? 1 : 0);
      return s.replace('.0', '').replace('.', ',');
    }
    return (v / 1000).toFixed(0) + 'k';
  };
  if (min && max) return `${fmt(min)}–${fmt(max)} Mkr`;
  if (min) return `Från ${fmt(min)} Mkr`;
  return `Upp till ${fmt(max!)} Mkr`;
}

export default async function InvesterarePage() {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'partner'])) {
    redirect('/idag');
  }

  const pb = await getServerPb();
  let investors: Investor[] = [];
  let deals: DealWithExpand[] = [];

  try {
    const res = await pb.collection(PB_COLLECTIONS.investors).getList<Investor>(1, 100, {
      filter: `tenant = "${user.tenant}"`,
      sort: '-updated'
    });
    investors = res.items;
  } catch {
    /* ignore */
  }

  try {
    const res = await pb.collection(PB_COLLECTIONS.deals).getList<DealWithExpand>(1, 200, {
      filter: `tenant = "${user.tenant}"`,
      sort: '-last_activity',
      expand: 'startup,investor'
    });
    deals = res.items;
  } catch {
    /* ignore */
  }

  const totalKr = deals.reduce((s, d) => s + (d.amount || 0), 0);
  const totalMkr = (totalKr / 1_000_000).toFixed(0);
  const closeThisMonth = deals.filter((d) => {
    if (d.stage !== 'close') return false;
    const t = new Date(d.last_activity || d.updated).getTime();
    if (Number.isNaN(t)) return false;
    return Date.now() - t < 31 * 24 * 60 * 60 * 1000;
  }).length;

  const investorDealCount = new Map<string, number>();
  for (const d of deals) {
    if (d.stage !== 'close') {
      investorDealCount.set(d.investor, (investorDealCount.get(d.investor) || 0) + 1);
    }
  }

  const byWarmth = investors.reduce<Record<string, number>>((acc, i) => {
    acc[i.warmth] = (acc[i.warmth] || 0) + 1;
    return acc;
  }, {});

  const rail = (
    <>
      <RailSection label="Pipeline">
        <div className="grid grid-cols-2 gap-2 px-2">
          <RailStat label="Aktiva deals" value={deals.length} />
          <RailStat label="Mkr i pipe" value={totalMkr} />
          <RailStat label="Investerare" value={investors.length} />
          <RailStat label="Close 30 dgr" value={closeThisMonth} />
        </div>
      </RailSection>

      <RailSection label="Värme">
        {(['hot', 'active', 'tracking', 'later'] as InvestorWarmth[]).map((w) => (
          <div
            key={w}
            className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px]"
          >
            <span className="text-foreground">{WARMTH_LABEL[w]}</span>
            <span className="font-mono text-[11px] text-foreground-subtle">
              {byWarmth[w] || 0}
            </span>
          </div>
        ))}
      </RailSection>
    </>
  );

  return (
    <PageShell
      title="Investerarrelationer"
      rightPanel={rail}
      actions={
        hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'partner']) ? (
          <Link
            href="/investerare/new"
            className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground transition hover:bg-brand-hover"
          >
            + Ny investerare
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-8 py-6">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
              Deal flow
            </h2>
            <span className="text-[11px] text-foreground-subtle">
              Dra kort för att flytta steg
            </span>
          </div>
          {deals.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-default p-10 text-center text-[13px] text-foreground-muted">
              Inga deals registrerade ännu. Logga ett intro för att komma igång.
            </div>
          ) : (
            <DealFlowBoard deals={deals} />
          )}
        </section>

        <section>
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
            Investerare
          </h2>
          {investors.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-default p-10 text-center text-[13px] text-foreground-muted">
              Inga investerare i nätverket ännu.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {investors.map((inv) => {
                const active = investorDealCount.get(inv.id) || 0;
                return (
                  <div
                    key={inv.id}
                    className="rounded-2xl border border-default bg-surface p-4"
                  >
                    <div className="mb-3 flex items-center gap-3">
                      <Avatar
                        initial={inv.name.slice(0, 2).toUpperCase()}
                        accent={accentFor(inv.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-semibold text-foreground">
                          {inv.name}
                        </div>
                        <div className="font-mono text-[11px] text-foreground-subtle">
                          {formatTicketRange(inv.ticket_min, inv.ticket_max)}
                        </div>
                      </div>
                      <Chip variant={WARMTH_VARIANT[inv.warmth]} mono>
                        {WARMTH_LABEL[inv.warmth]}
                      </Chip>
                    </div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {(inv.focus || []).slice(0, 5).map((f) => (
                        <Chip key={f} mono>
                          {f}
                        </Chip>
                      ))}
                      {(!inv.focus || inv.focus.length === 0) && (
                        <span className="text-[11px] text-foreground-subtle">
                          Inga fokusområden
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-foreground-muted">
                        Aktiva deals:{' '}
                        <span className="font-semibold text-foreground">{active}</span>
                      </span>
                      <Link
                        href={`/investerare/${inv.id}`}
                        className="text-link hover:underline"
                      >
                        Profil →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
