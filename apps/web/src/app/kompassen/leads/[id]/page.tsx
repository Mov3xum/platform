import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser, getServerPb } from '@/lib/auth.server';
import { hasRole } from '@/lib/rbac';
import {
  PageHead,
  Card,
  CardHead,
  Chip,
  Icon
} from '@/components/proto';
import { getLead, listLeadSources } from '@/lib/compass/store';
import {
  LEAD_STATUS_LABEL,
  LEAD_STATUS_ORDER,
  type LeadStatus
} from '@/lib/compass/types';
import {
  deleteLeadAction,
  rescoreLeadAction,
  updateLeadNotesAction,
  updateLeadStatusAction
} from '@/lib/actions/compass';

export const dynamic = 'force-dynamic';

export default async function LeadDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) {
    redirect('/kompassen');
  }
  const pb = await getServerPb();
  const [lead, sources] = await Promise.all([
    getLead(pb, user.tenant, id),
    listLeadSources(pb)
  ]);
  if (!lead) notFound();
  const source = sources.find((s) => s.key === lead.source_key);

  return (
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb={`Kompassen / Leads / ${lead.name || 'Anonym'}`}
        title={lead.name || 'Anonym lead'}
        subtitle={
          lead.idea_summary ||
          [lead.organization, lead.email, lead.phone].filter(Boolean).join(' · ') ||
          'Ingen idé-sammanfattning ännu.'
        }
        actions={
          <>
            <Link href="/kompassen/leads" className="mx-btn">
              <Icon name="arrow" size={13} /> Tillbaka
            </Link>
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        {/* Vänster: detaljer */}
        <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
          <Card>
            <CardHead label="Kontakt" />
            <div style={{ padding: 16, display: 'grid', gap: 10 }}>
              <Field label="Namn" value={lead.name} />
              <Field label="E-post" value={lead.email} mono />
              <Field label="Telefon" value={lead.phone} mono />
              <Field label="Organisation" value={lead.organization} />
            </div>
          </Card>

          <Card>
            <CardHead label="Idé" />
            <div style={{ padding: 16, display: 'grid', gap: 10 }}>
              <Field label="Sammanfattning" value={lead.idea_summary} multiline />
              <Field label="Kategori" value={lead.idea_category} />
              {lead.tags && lead.tags.length > 0 && (
                <div>
                  <div className="mx-label">Taggar</div>
                  <div className="mx-flex mx-gap-2 mx-wrap">
                    {lead.tags.map((t) => (
                      <Chip key={t} mono>
                        {t}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHead label="Anteckningar" />
            <form
              action={updateLeadNotesAction}
              style={{ padding: 16, display: 'grid', gap: 10 }}
            >
              <input type="hidden" name="id" value={lead.id} />
              <textarea
                name="notes"
                defaultValue={lead.notes || ''}
                placeholder="Interna anteckningar (inte synliga för leadet)..."
                className="mx-textarea"
                style={{ minHeight: 140 }}
              />
              <div className="mx-flex mx-items-c mx-gap-2" style={{ justifyContent: 'flex-end' }}>
                <span className="mx-mono mx-t-xs mx-muted mx-grow">
                  Lagras AES-256 i vila · konfidentiellt
                </span>
                <button type="submit" className="mx-btn mx-primary">
                  Spara anteckningar
                </button>
              </div>
            </form>
          </Card>
        </div>

        {/* Höger: status, AI-score, källa, åtgärder */}
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <CardHead label="Status" />
            <form action={updateLeadStatusAction} style={{ padding: 16, display: 'grid', gap: 10 }}>
              <input type="hidden" name="id" value={lead.id} />
              <div className="mx-flex mx-items-c mx-gap-2">
                <Chip variant={statusChipVariant(lead.status)} mono>
                  {LEAD_STATUS_LABEL[lead.status]}
                </Chip>
                <span className="mx-mono mx-t-xs mx-muted">nu</span>
              </div>
              <select name="status" defaultValue={lead.status} className="mx-input">
                {LEAD_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {LEAD_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <button type="submit" className="mx-btn mx-primary">
                Uppdatera status
              </button>
              <span className="mx-mono mx-t-xs mx-muted" style={{ textAlign: 'center' }}>
                Manuell · ingen automatisk acceptans
              </span>
            </form>
          </Card>

          <Card>
            <CardHead label="AI-bedömning" />
            <div style={{ padding: 16, display: 'grid', gap: 10 }}>
              {typeof lead.score === 'number' ? (
                <>
                  <div className="mx-disp" style={{ fontSize: 36, fontWeight: 600 }}>
                    {lead.score}
                    <span className="mx-t-13 mx-muted" style={{ fontWeight: 400 }}>
                      {' '}
                      / 100
                    </span>
                  </div>
                  {lead.score_reasoning && (
                    <div className="mx-t-12 mx-muted" style={{ lineHeight: 1.5 }}>
                      {lead.score_reasoning}
                    </div>
                  )}
                </>
              ) : (
                <div className="mx-muted mx-t-13">
                  Ingen bedömning ännu. Kör AI-bedömning för att få en indikativ poäng.
                </div>
              )}
              <form action={rescoreLeadAction}>
                <input type="hidden" name="id" value={lead.id} />
                <button type="submit" className="mx-btn" style={{ width: '100%' }}>
                  <Icon name="sparkle" size={13} />{' '}
                  {typeof lead.score === 'number' ? 'Bedöm igen' : 'Kör AI-bedömning'}
                </button>
              </form>
              <span className="mx-mono mx-t-xs mx-muted" style={{ textAlign: 'center' }}>
                Genererat av AI – verifiera innan delning
              </span>
            </div>
          </Card>

          <Card>
            <CardHead label="Källa" />
            <div style={{ padding: 16, display: 'grid', gap: 6 }}>
              <div className="mx-flex mx-items-c mx-gap-2">
                <Chip variant="cyan" mono>
                  {source?.label || lead.source_key}
                </Chip>
              </div>
              {lead.source_detail && (
                <div className="mx-t-12 mx-muted">{lead.source_detail}</div>
              )}
              <div className="mx-mono mx-t-xs mx-muted" style={{ marginTop: 4 }}>
                Skapad {formatDate(lead.created)}
                {lead.consent_at && ` · samtycke ${formatDate(lead.consent_at)}`}
              </div>
            </div>
          </Card>

          <Card>
            <CardHead label="Farlig zon" />
            <form action={deleteLeadAction} style={{ padding: 16 }}>
              <input type="hidden" name="id" value={lead.id} />
              <button
                type="submit"
                className="mx-btn"
                style={{ width: '100%', color: '#4b2718', borderColor: '#d67e47' }}
              >
                <Icon name="trash" size={13} /> Radera lead permanent
              </button>
              <div className="mx-mono mx-t-xs mx-muted" style={{ marginTop: 8, textAlign: 'center' }}>
                Hård cascade · GDPR Art. 17
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
  multiline = false
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  multiline?: boolean;
}) {
  if (!value) {
    return (
      <div>
        <div className="mx-label">{label}</div>
        <div className="mx-muted mx-t-13">—</div>
      </div>
    );
  }
  return (
    <div>
      <div className="mx-label">{label}</div>
      <div
        className={`mx-t-13${mono ? ' mx-mono' : ''}`}
        style={{ lineHeight: multiline ? 1.5 : 1.3, whiteSpace: multiline ? 'pre-wrap' : 'normal' }}
      >
        {value}
      </div>
    </div>
  );
}

function statusChipVariant(status: LeadStatus): React.ComponentProps<typeof Chip>['variant'] {
  switch (status) {
    case 'new':
      return 'draft';
    case 'contacted':
    case 'meeting-booked':
      return 'review';
    case 'evaluating':
      return 'cyan';
    case 'accepted':
      return 'active';
    case 'declined':
      return 'archive';
    default:
      return 'default';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return '';
  }
}
