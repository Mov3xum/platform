import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerPb, requireUser } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import { PB_COLLECTIONS } from '@/lib/pocketbase-collections';
import {
  PageHead,
  Card,
  CardHead,
  Chip,
  ProgressBar,
  Icon
} from '@/components/proto';
import type { IncubatorReport } from '@platform/shared';
import { ReportDetail } from './ReportDetail';
import { statusChipVariant, statusLabel } from './report-utils';

export default async function RapporterPage({
  searchParams
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead'])) {
    redirect('/idag');
  }
  const { id: selectedFromQuery } = await searchParams;

  const pb = await getServerPb();
  let reports: IncubatorReport[] = [];
  try {
    const res = await pb.collection(PB_COLLECTIONS.reports).getList<IncubatorReport>(1, 50, {
      filter: pb.filter('tenant = {:tenant}', { tenant: user.tenant }),
      sort: '-updated'
    });
    reports = res.items;
  } catch {
    /* collection may not exist yet — render empty state below */
  }

  const selectedId = selectedFromQuery || reports[0]?.id;
  const selected = reports.find((r) => r.id === selectedId) || reports[0] || null;

  // Tidsbesparing: härled timmar från completion% av draft_ai-rapporter
  const draftAi = reports.filter((r) => r.status === 'draft_ai');
  const totalCompletion = draftAi.reduce((sum, r) => sum + (r.completion || 0), 0);
  const hoursSaved = Math.round((totalCompletion / 100) * 18); // ~18h per full rapport
  const topDraft = draftAi[0];

  return (
    <div className="mx-view-pad mx-wide">
      <PageHead
        crumb="Hemmaplan / Rapportering"
        title="Rapportering"
        subtitle="Vinnova, Tillväxtverket och regionala rapporter — fylls automatiskt från portföljen. Granska, justera, skicka."
        actions={
          <>
            <button type="button" className="mx-btn">
              <Icon name="copy" size={13} /> Mallar
            </button>
            <Link href="/rapporter?new=1" className="mx-btn mx-primary">
              <Icon name="plus" size={13} /> Ny rapport
            </Link>
          </>
        }
      />

      {/* Tidsbesparings-banner — visas bara när det finns faktiska AI-utkast */}
      {hoursSaved > 0 && (
        <Card
          style={{
            padding: 14,
            background: 'var(--mx-brown-tint)',
            borderColor: 'transparent',
            marginBottom: 16
          }}
        >
          <div className="mx-flex mx-items-c mx-gap-3">
            <Icon name="sparkle" size={16} style={{ color: 'var(--mx-brown)' }} />
            <div style={{ flex: 1 }}>
              <div
                className="mx-mono mx-t-xs mx-t-up mx-fw-6"
                style={{ color: 'var(--mx-brown-ink)' }}
              >
                Tidsbesparing
              </div>
              <div className="mx-t-13 mx-fw-6" style={{ color: 'var(--mx-brown-ink)' }}>
                {topDraft
                  ? `Rapportskrivaren har fyllt ${topDraft.completion}% av ${topDraft.recipient_label} automatiskt — sparade ca ${hoursSaved} timmars manuellt arbete.`
                  : `Rapportskrivaren har sparat ca ${hoursSaved} timmars manuellt arbete denna månad.`}
              </div>
            </div>
            <span
              className="mx-disp mx-fw-6"
              style={{ fontSize: 28, color: 'var(--mx-brown-ink)' }}
            >
              −{hoursSaved}h
            </span>
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
        {/* Vänster lista */}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <CardHead
            label="Rapporter"
            right={<span className="mx-mono mx-t-xs mx-muted">{reports.length}</span>}
          />
          {reports.length === 0 ? (
            <div className="mx-muted mx-t-13" style={{ padding: '24px 16px', textAlign: 'center' }}>
              Inga rapporter ännu.
            </div>
          ) : (
            <div>
              {reports.map((r) => {
                const isSel = r.id === selected?.id;
                return (
                  <Link
                    key={r.id}
                    href={`/rapporter/${r.id}`}
                    style={{
                      display: 'block',
                      padding: '12px 16px',
                      borderBottom: '1px solid var(--mx-line-soft)',
                      background: isSel ? 'var(--mx-paper-3)' : 'transparent',
                      borderLeft: isSel ? '3px solid var(--mx-ink)' : '3px solid transparent',
                      textDecoration: 'none',
                      color: 'inherit'
                    }}
                  >
                    <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
                      <span className="mx-mono mx-t-xs mx-muted mx-t-up">{r.recipient_label}</span>
                      <span className="mx-grow" />
                      <Chip variant={statusChipVariant(r.status)} mono>
                        {statusLabel(r.status)}
                      </Chip>
                    </div>
                    <div className="mx-t-13 mx-fw-6 mx-mb-1">{r.title}</div>
                    <div className="mx-flex mx-items-c mx-gap-2">
                      <ProgressBar pct={r.completion || 0} accent={r.accent || 'ink'} />
                      <span className="mx-mono mx-t-xs mx-muted">{r.completion || 0}%</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {/* Höger detalj */}
        {selected ? (
          <ReportDetail report={selected} />
        ) : (
          <Card style={{ padding: 32, textAlign: 'center' }}>
            <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">Inga rapporter</div>
            <div className="mx-t-13 mx-muted mx-mb-3">
              Skapa din första rapport för Vinnova, Tillväxtverket eller regionen.
            </div>
            <Link href="/rapporter?new=1" className="mx-btn mx-primary" style={{ display: 'inline-flex' }}>
              <Icon name="plus" size={13} /> Ny rapport
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}
