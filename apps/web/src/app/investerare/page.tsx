import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  PageHead,
  Card,
  Chip,
  Avatar,
  Icon,
  SectionHead
} from '@/components/proto';
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

  return (
    <div className="mx-view-pad mx-wide" style={{ padding: '20px 24px 80px' }}>
      <PageHead
        crumb="Hemmaplan / Investerarrelationer"
        title="Investerarrelationer"
        subtitle="Deal flow + investerarkort med fokus, ticket size och historik. Synkat med Sprint X-finansiering."
        actions={
          <>
            <button className="mx-btn">
              <Icon name="filter" size={13} /> Stadium
            </button>
            <button className="mx-btn">
              <Icon name="download" size={13} /> Exportera
            </button>
            <button className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Logga intro
            </button>
          </>
        }
      />

      {/* ── Deal flow ────────────────────────────────────── */}
      <SectionHead
        title="Deal flow"
        label={`${deals.length} aktiva${closeThisMonth ? ` · ${closeThisMonth} close denna månad` : ''} · ${totalMkr} Mkr i pipeline`}
        right={<Chip mono>Dra kort för att flytta steg</Chip>}
      />

      {deals.length === 0 ? (
        <Card style={{ padding: 24, textAlign: 'center' }}>
          <div className="mx-muted mx-t-13">
            Inga deals registrerade ännu. Logga ett intro för att komma igång.
          </div>
        </Card>
      ) : (
        <DealFlowBoard deals={deals} />
      )}

      {/* ── Investerare ──────────────────────────────────── */}
      <SectionHead
        title="Investerare"
        label={`${investors.length} i nätverket`}
      />

      {investors.length === 0 ? (
        <Card style={{ padding: 24, textAlign: 'center' }}>
          <div className="mx-muted mx-t-13">
            Inga investerare i nätverket ännu. Lägg till ditt första kontaktnät.
          </div>
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12
          }}
        >
          {investors.map((inv) => {
            const active = investorDealCount.get(inv.id) || 0;
            return (
              <Card key={inv.id} style={{ padding: 16 }}>
                <div className="mx-flex mx-items-c mx-gap-2 mx-mb-3">
                  <Avatar
                    initial={inv.name.slice(0, 2).toUpperCase()}
                    accent={accentFor(inv.id)}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="mx-disp mx-fw-6 mx-t-13 mx-truncate">{inv.name}</div>
                    <div className="mx-mono mx-t-xs mx-muted">
                      {formatTicketRange(inv.ticket_min, inv.ticket_max)}
                    </div>
                  </div>
                  <Chip variant={WARMTH_VARIANT[inv.warmth]} mono>
                    {WARMTH_LABEL[inv.warmth]}
                  </Chip>
                </div>
                <div
                  className="mx-flex mx-gap-2 mx-mb-3"
                  style={{ flexWrap: 'wrap' }}
                >
                  {(inv.focus || []).slice(0, 5).map((f) => (
                    <Chip key={f} mono>
                      {f}
                    </Chip>
                  ))}
                  {(!inv.focus || inv.focus.length === 0) && (
                    <span className="mx-muted mx-t-xs">Inga fokusområden</span>
                  )}
                </div>
                <div className="mx-flex mx-items-c mx-gap-2 mx-t-12">
                  <span className="mx-muted">Aktiva deals:</span>
                  <span className="mx-fw-6">{active}</span>
                  <span className="mx-grow" />
                  <Link href={`/investerare/${inv.id}`} className="mx-btn mx-sm">
                    Profil →
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
