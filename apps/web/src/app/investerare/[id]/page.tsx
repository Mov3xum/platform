import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  PageHead,
  Card,
  CardHead,
  Chip,
  Avatar,
  Icon,
  Meta,
  SectionHead
} from '@/components/proto';
import { deleteInvestorFormAction } from '@/lib/actions/investors';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import type { Deal, Investor, InvestorWarmth, DealStage } from '@platform/shared';
import { DEAL_STAGES } from '@platform/shared';

type DealWithExpand = Deal & {
  expand?: {
    startup?: { id: string; name: string };
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

function stageLabel(stage: DealStage): string {
  return DEAL_STAGES.find((s) => s.id === stage)?.label || stage;
}

function formatMkr(amountKr?: number): string {
  if (!amountKr || amountKr <= 0) return '—';
  const mkr = amountKr / 1_000_000;
  return mkr < 10 ? `${mkr.toFixed(1).replace('.', ',')} Mkr` : `${Math.round(mkr)} Mkr`;
}

function formatTicketRange(min?: number, max?: number): string {
  if (!min && !max) return 'Ej angiven';
  const fmt = (v: number) => {
    const mkr = v / 1_000_000;
    if (mkr >= 1) {
      return mkr.toFixed(mkr < 10 ? 1 : 0).replace('.0', '').replace('.', ',');
    }
    return (v / 1000).toFixed(0) + 'k';
  };
  if (min && max) return `${fmt(min)}–${fmt(max)} Mkr`;
  if (min) return `Från ${fmt(min)} Mkr`;
  return `Upp till ${fmt(max!)} Mkr`;
}

export default async function InvestorDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'partner'])) {
    redirect('/idag');
  }
  const pb = await getServerPb();

  let investor: Investor | null = null;
  try {
    investor = await pb.collection(PB_COLLECTIONS.investors).getOne<Investor>(id);
  } catch {
    notFound();
  }
  if (!investor || investor.tenant !== user.tenant) notFound();

  let deals: DealWithExpand[] = [];
  try {
    const res = await pb.collection(PB_COLLECTIONS.deals).getList<DealWithExpand>(1, 50, {
      filter: `tenant = "${user.tenant}" && investor = "${id}"`,
      sort: '-last_activity',
      expand: 'startup'
    });
    deals = res.items;
  } catch {
    /* ignore */
  }

  const active = deals.filter((d) => d.stage !== 'close').length;
  const closed = deals.filter((d) => d.stage === 'close').length;
  const totalKr = deals.reduce((s, d) => s + (d.amount || 0), 0);

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb={`Hemmaplan / Investerarrelationer / ${investor.name}`}
        title={investor.name}
        subtitle={
          investor.stage_focus?.length
            ? `Fas-fokus: ${investor.stage_focus.join(', ')}`
            : 'Investerarprofil'
        }
        actions={
          <>
            <Link href="/investerare" className="mx-btn">
              ← Tillbaka
            </Link>
            {hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'partner']) && (
              <Link href={`/investerare/${investor.id}/edit`} className="mx-btn">
                Redigera
              </Link>
            )}
            <button className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Logga möte
            </button>
            {hasRole(user.roles, ['admin', 'incubator_lead']) && (
              <ConfirmDeleteButton
                action={deleteInvestorFormAction}
                hiddenField={{ name: 'investor_id', value: investor.id }}
                label="Radera"
                variant="ghost"
                description={`Radera "${investor.name}" och alla deals?`}
              />
            )}
          </>
        }
      />

      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 16, marginTop: 12 }}
      >
        {/* ── Profile card ─────────────────────────────────── */}
        <Card style={{ padding: 16 }}>
          <div className="mx-flex mx-items-c mx-gap-3 mx-mb-3">
            <Avatar initial={investor.name.slice(0, 2).toUpperCase()} size="lg" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="mx-disp mx-fw-6 mx-t-15 mx-truncate">{investor.name}</div>
              <Chip variant={WARMTH_VARIANT[investor.warmth]} mono>
                {WARMTH_LABEL[investor.warmth]}
              </Chip>
            </div>
          </div>

          <div
            className="mx-flex mx-col mx-gap-3"
            style={{ marginTop: 12, borderTop: '1px solid var(--mx-line-soft)', paddingTop: 12 }}
          >
            <Meta
              label="Ticket size"
              value={
                <span className="mx-mono mx-fw-6 mx-t-13">
                  {formatTicketRange(investor.ticket_min, investor.ticket_max)}
                </span>
              }
            />
            <Meta
              label="Fokus"
              value={
                <div className="mx-flex mx-gap-2" style={{ flexWrap: 'wrap' }}>
                  {investor.focus && investor.focus.length > 0 ? (
                    investor.focus.map((f) => (
                      <Chip key={f} mono>
                        {f}
                      </Chip>
                    ))
                  ) : (
                    <span className="mx-muted mx-t-12">—</span>
                  )}
                </div>
              }
            />
            <Meta
              label="Faser"
              value={
                <div className="mx-flex mx-gap-2" style={{ flexWrap: 'wrap' }}>
                  {investor.stage_focus && investor.stage_focus.length > 0 ? (
                    investor.stage_focus.map((s) => (
                      <Chip key={s} mono>
                        {s.replace('_', ' ')}
                      </Chip>
                    ))
                  ) : (
                    <span className="mx-muted mx-t-12">—</span>
                  )}
                </div>
              }
            />
            {investor.website && (
              <Meta
                label="Webb"
                value={
                  <a
                    href={investor.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mx-t-12 mx-fw-6"
                  >
                    {investor.website} <Icon name="external" size={10} />
                  </a>
                }
              />
            )}
            {investor.notes && (
              <Meta label="Anteckningar" value={<div className="mx-t-12">{investor.notes}</div>} />
            )}
          </div>
        </Card>

        {/* ── Deals & stats ────────────────────────────────── */}
        <div className="mx-flex mx-col mx-gap-4">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12
            }}
          >
            <Card style={{ padding: 16 }}>
              <div className="mx-mono mx-t-xs mx-muted mx-t-up mx-fw-6">Aktiva deals</div>
              <div
                className="mx-disp"
                style={{ fontSize: 28, fontWeight: 500, marginTop: 4 }}
              >
                {active}
              </div>
            </Card>
            <Card style={{ padding: 16 }}>
              <div className="mx-mono mx-t-xs mx-muted mx-t-up mx-fw-6">Closes</div>
              <div
                className="mx-disp"
                style={{ fontSize: 28, fontWeight: 500, marginTop: 4 }}
              >
                {closed}
              </div>
            </Card>
            <Card style={{ padding: 16 }}>
              <div className="mx-mono mx-t-xs mx-muted mx-t-up mx-fw-6">Pipeline</div>
              <div
                className="mx-disp"
                style={{ fontSize: 28, fontWeight: 500, marginTop: 4 }}
              >
                {formatMkr(totalKr)}
              </div>
            </Card>
          </div>

          <Card style={{ overflow: 'hidden', padding: 0 }}>
            <CardHead label="Deals med detta nätverk" />
            {deals.length === 0 ? (
              <div
                className="mx-muted mx-t-13"
                style={{ padding: 24, textAlign: 'center' }}
              >
                Inga deals loggade. Skapa det första intro:t.
              </div>
            ) : (
              <div>
                {deals.map((d, i) => (
                  <div
                    key={d.id}
                    className="mx-flex mx-items-c mx-gap-3"
                    style={{
                      padding: '12px 16px',
                      borderBottom:
                        i < deals.length - 1 ? '1px solid var(--mx-line-soft)' : 'none'
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mx-t-13 mx-fw-6 mx-truncate">
                        {d.expand?.startup?.name || 'Okänt bolag'}
                      </div>
                      {d.notes && (
                        <div className="mx-mono mx-t-xs mx-muted mx-truncate">{d.notes}</div>
                      )}
                    </div>
                    <Chip mono>{stageLabel(d.stage)}</Chip>
                    <span className="mx-disp mx-fw-6 mx-t-13" style={{ minWidth: 70, textAlign: 'right' }}>
                      {formatMkr(d.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <SectionHead title="Aktivitet" label="senaste 90 dagar" />
      <Card style={{ padding: 24, textAlign: 'center' }}>
        <div className="mx-muted mx-t-13">
          Inga aktivitetsloggar tillgängliga än. Logga möten via &quot;Logga möte&quot;.
        </div>
      </Card>
    </div>
  );
}
