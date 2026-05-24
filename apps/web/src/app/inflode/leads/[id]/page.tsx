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
import { getLead, listAssignableStaff, listLeadSources, listModules } from '@/lib/compass/store';
import {
  LEAD_STATUS_LABEL,
  LEAD_STATUS_ORDER,
  type LeadStatus
} from '@/lib/compass/types';
import { type StartupPhase } from '@platform/shared';
import { phaseLabels } from '@/lib/labels';
import {
  convertLeadToStartupAction,
  declineLeadAction,
  deleteLeadAction,
  rescoreLeadAction,
  runAiReviewAction,
  runMarketScanAction,
  updateLeadNotesAction,
  updateLeadStatusAction
} from '@/lib/actions/compass';

const CONVERT_PHASES: StartupPhase[] = [
  'inflode',
  'lead',
  'boost_chamber',
  'incubation',
  'prescale',
  'acceleration'
];

export const dynamic = 'force-dynamic';

export default async function LeadDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  if (!hasRole(user.roles, ['admin', 'incubator_lead', 'coach', 'mentor'])) {
    redirect('/inflode');
  }
  const pb = await getServerPb();
  const [lead, sources, modules, staff] = await Promise.all([
    getLead(pb, user.tenant, id),
    listLeadSources(pb),
    listModules(pb, user.tenant),
    listAssignableStaff(pb, user.tenant)
  ]);
  if (!lead) notFound();
  const source = sources.find((s) => s.key === lead.source_key);
  const landingModule = lead.landing_module
    ? modules.find((m) => m.slug === lead.landing_module)
    : undefined;

  const canConvert = hasRole(user.roles, ['admin', 'incubator_lead', 'coach']);
  const alreadyConverted = !!lead.converted_startup;

  return (
    <div className="mx-view-pad mx-narrow">
      <PageHead
        crumb={`Inflöde / Leads / ${lead.name || 'Anonym'}`}
        title={lead.name || 'Anonym lead'}
        subtitle={
          lead.idea_summary ||
          [lead.organization, lead.email, lead.phone].filter(Boolean).join(' · ') ||
          'Ingen idé-sammanfattning ännu.'
        }
        actions={
          <>
            <Link href="/inflode/leads" className="mx-btn">
              <Icon name="arrow" size={13} /> Tillbaka
            </Link>
            {alreadyConverted ? (
              <Link
                href={`/startups/${lead.converted_startup}`}
                className="mx-btn mx-primary"
              >
                <Icon name="people" size={13} /> Öppna bolaget →
              </Link>
            ) : (
              canConvert && (
                <form action={convertLeadToStartupAction}>
                  <input type="hidden" name="id" value={lead.id} />
                  <button type="submit" className="mx-btn mx-primary">
                    <Icon name="sparkle" size={13} /> Konvertera till bolag
                  </button>
                </form>
              )
            )}
          </>
        }
      />

      {alreadyConverted && (
        <Card style={{ padding: 12, marginBottom: 16, background: 'var(--mx-cyan-tint-2)' }}>
          <div className="mx-flex mx-items-c mx-gap-2 mx-t-13">
            <Icon name="sparkle" size={14} />
            <strong>Detta lead är konverterat till bolag.</strong>
            <span className="mx-muted">
              {lead.converted_at && `Konverterades ${formatDate(lead.converted_at)} ·`}{' '}
              <Link href={`/startups/${lead.converted_startup}`} className="mx-fw-6">
                Öppna bolaget →
              </Link>
            </span>
          </div>
        </Card>
      )}

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

          {/* AI-granskning */}
          <Card>
            <CardHead
              label="AI-granskning av idén"
              right={
                <form action={runAiReviewAction}>
                  <input type="hidden" name="id" value={lead.id} />
                  <button type="submit" className="mx-btn mx-sm">
                    <Icon name="sparkle" size={12} />{' '}
                    {lead.ai_review ? 'Kör om' : 'Kör granskning'}
                  </button>
                </form>
              }
            />
            <div style={{ padding: 16, display: 'grid', gap: 12 }}>
              {!lead.ai_review ? (
                <div className="mx-muted mx-t-13">
                  Ingen AI-granskning körd ännu. Klicka &ldquo;Kör granskning&rdquo; för att
                  få styrkor, risker och konkreta nästa steg som beslutsunderlag.
                </div>
              ) : (
                <>
                  <div className="mx-flex mx-items-c mx-gap-2">
                    <Chip
                      variant={
                        lead.ai_review.recommendation === 'pass'
                          ? 'active'
                          : lead.ai_review.recommendation === 'no'
                            ? 'archive'
                            : 'review'
                      }
                      mono
                    >
                      {lead.ai_review.recommendation === 'pass'
                        ? 'REKOMMENDERAS'
                        : lead.ai_review.recommendation === 'no'
                          ? 'AVRÅDS'
                          : 'KANSKE'}
                    </Chip>
                    <span className="mx-t-13 mx-muted" style={{ lineHeight: 1.5 }}>
                      {lead.ai_review.recommendation_reason}
                    </span>
                  </div>

                  {lead.ai_review.strengths.length > 0 && (
                    <div>
                      <div className="mx-label">Styrkor</div>
                      <ul style={{ paddingLeft: 18, margin: 0 }}>
                        {lead.ai_review.strengths.map((s, i) => (
                          <li key={i} className="mx-t-13" style={{ marginBottom: 4 }}>
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {lead.ai_review.risks.length > 0 && (
                    <div>
                      <div className="mx-label">Risker / frågetecken</div>
                      <ul style={{ paddingLeft: 18, margin: 0 }}>
                        {lead.ai_review.risks.map((r, i) => (
                          <li key={i} className="mx-t-13" style={{ marginBottom: 4 }}>
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {lead.ai_review.next_steps.length > 0 && (
                    <div>
                      <div className="mx-label">Nästa steg</div>
                      <ol style={{ paddingLeft: 18, margin: 0 }}>
                        {lead.ai_review.next_steps.map((n, i) => (
                          <li key={i} className="mx-t-13" style={{ marginBottom: 4 }}>
                            {n}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  <div className="mx-mono mx-t-xs mx-muted">
                    Genererat {formatDate(lead.ai_review.generated_at)} · {lead.ai_review.model} ·
                    Genererat av AI – verifiera innan delning
                  </div>
                </>
              )}
            </div>
          </Card>

          {/* Omvärldsanalys */}
          <Card>
            <CardHead
              label="Omvärldsanalys"
              right={
                <form action={runMarketScanAction}>
                  <input type="hidden" name="id" value={lead.id} />
                  <button type="submit" className="mx-btn mx-sm">
                    <Icon name="graph" size={12} />{' '}
                    {lead.market_scan ? 'Uppdatera' : 'Kör analys'}
                  </button>
                </form>
              }
            />
            <div style={{ padding: 16, display: 'grid', gap: 12 }}>
              {!lead.market_scan ? (
                <div className="mx-muted mx-t-13">
                  Kör en omvärldsanalys för att få en kort sammanfattning av marknad,
                  konkurrenter, trender och regulatoriska hänsyn.
                </div>
              ) : (
                <>
                  {lead.market_scan.market_size && (
                    <Field label="Marknadsstorlek" value={lead.market_scan.market_size} multiline />
                  )}
                  {lead.market_scan.trend && (
                    <Field label="Trend" value={lead.market_scan.trend} multiline />
                  )}
                  {lead.market_scan.competitors.length > 0 && (
                    <div>
                      <div className="mx-label">Konkurrenter</div>
                      <div className="mx-flex mx-gap-2 mx-wrap">
                        {lead.market_scan.competitors.map((c) => (
                          <Chip key={c} mono>
                            {c}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  )}
                  {lead.market_scan.differentiators.length > 0 && (
                    <div>
                      <div className="mx-label">Differentiering</div>
                      <ul style={{ paddingLeft: 18, margin: 0 }}>
                        {lead.market_scan.differentiators.map((d, i) => (
                          <li key={i} className="mx-t-13" style={{ marginBottom: 4 }}>
                            {d}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {lead.market_scan.regulation_notes && (
                    <Field
                      label="Regulering"
                      value={lead.market_scan.regulation_notes}
                      multiline
                    />
                  )}
                  {lead.market_scan.fit_for_movexum && (
                    <Field
                      label="Passform Movexum"
                      value={lead.market_scan.fit_for_movexum}
                      multiline
                    />
                  )}
                  <div className="mx-mono mx-t-xs mx-muted">
                    Genererat {formatDate(lead.market_scan.generated_at)} · {lead.market_scan.model}
                  </div>
                </>
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
              <div
                className="mx-flex mx-items-c mx-gap-2"
                style={{ justifyContent: 'flex-end' }}
              >
                <span className="mx-mono mx-t-xs mx-muted mx-grow">
                  Lagras AES-256 i vila · konfidentiellt · exkluderas från AI
                </span>
                <button type="submit" className="mx-btn mx-primary">
                  Spara anteckningar
                </button>
              </div>
            </form>
          </Card>
        </div>

        {/* Höger: status, score, källa, attribution, åtgärder */}
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <CardHead label="Status" />
            <form
              action={updateLeadStatusAction}
              style={{ padding: 16, display: 'grid', gap: 10 }}
            >
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
              <span
                className="mx-mono mx-t-xs mx-muted"
                style={{ textAlign: 'center' }}
              >
                Manuell · ingen automatisk acceptans
              </span>
            </form>
          </Card>

          <Card>
            <CardHead label="AI-poäng" />
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
                  Ingen poäng ännu. Kör AI-bedömning för indikativ poäng.
                </div>
              )}
              <form action={rescoreLeadAction}>
                <input type="hidden" name="id" value={lead.id} />
                <button type="submit" className="mx-btn" style={{ width: '100%' }}>
                  <Icon name="sparkle" size={13} />{' '}
                  {typeof lead.score === 'number' ? 'Bedöm igen' : 'Kör AI-bedömning'}
                </button>
              </form>
            </div>
          </Card>

          <Card>
            <CardHead label="Källa & attribution" />
            <div style={{ padding: 16, display: 'grid', gap: 8 }}>
              <div className="mx-flex mx-items-c mx-gap-2">
                <Chip variant="cyan" mono>
                  {source?.label || lead.source_key}
                </Chip>
                {landingModule && (
                  <span className="mx-mono mx-t-xs mx-muted">
                    via {landingModule.name}
                  </span>
                )}
              </div>
              {lead.source_detail && (
                <div className="mx-t-12 mx-muted">{lead.source_detail}</div>
              )}
              {lead.utm_campaign && <AttrRow label="Kampanj" value={lead.utm_campaign} />}
              {lead.utm_source && <AttrRow label="UTM source" value={lead.utm_source} />}
              {lead.utm_medium && <AttrRow label="UTM medium" value={lead.utm_medium} />}
              {lead.utm_term && <AttrRow label="UTM term" value={lead.utm_term} />}
              {lead.utm_content && <AttrRow label="UTM content" value={lead.utm_content} />}
              {lead.referrer_url && <AttrRow label="Referrer" value={lead.referrer_url} />}
              <div
                className="mx-mono mx-t-xs mx-muted"
                style={{
                  marginTop: 4,
                  borderTop: '1px solid var(--mx-line-soft)',
                  paddingTop: 8
                }}
              >
                Skapad {formatDate(lead.created)}
                {lead.consent_at && ` · samtycke ${formatDate(lead.consent_at)}`}
              </div>
            </div>
          </Card>

          {!alreadyConverted && canConvert && (
            <Card>
              <CardHead label="Konvertera till inkubatorn" />
              <form
                action={convertLeadToStartupAction}
                style={{ padding: 16, display: 'grid', gap: 10 }}
              >
                <input type="hidden" name="id" value={lead.id} />
                <label className="mx-label">
                  Bolagsnamn
                  <input
                    type="text"
                    name="name"
                    defaultValue={lead.organization || lead.name || ''}
                    className="mx-input"
                    style={{ marginTop: 4 }}
                  />
                </label>
                <label className="mx-label">
                  Startfas
                  <select name="phase" defaultValue="lead" className="mx-input" style={{ marginTop: 4 }}>
                    {CONVERT_PHASES.map((p) => (
                      <option key={p} value={p}>
                        {phaseLabels[p]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mx-label">
                  Coach (valfri)
                  <select name="coach" defaultValue="" className="mx-input" style={{ marginTop: 4 }}>
                    <option value="">— Ingen —</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name || s.email}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="mx-btn mx-primary">
                  <Icon name="sparkle" size={13} /> Skapa bolag av leadet
                </button>
                <div
                  className="mx-mono mx-t-xs mx-muted"
                  style={{ textAlign: 'center' }}
                >
                  Idén och taggarna förs över · status sätts till Accepterad
                </div>
              </form>
            </Card>
          )}

          {!alreadyConverted && canConvert && lead.status !== 'declined' && (
            <Card>
              <CardHead label="Avslå lead" />
              <form action={declineLeadAction} style={{ padding: 16, display: 'grid', gap: 10 }}>
                <input type="hidden" name="id" value={lead.id} />
                <textarea
                  name="reason"
                  placeholder="Motivering (valfri) — sparas i interna anteckningar."
                  className="mx-textarea"
                  style={{ minHeight: 70 }}
                />
                <button
                  type="submit"
                  className="mx-btn"
                  style={{ color: '#4b2718', borderColor: '#d67e47' }}
                >
                  <Icon name="close" size={13} /> Avslå leadet
                </button>
                <div className="mx-mono mx-t-xs mx-muted" style={{ textAlign: 'center' }}>
                  Mänskligt beslut · status sätts till Avböjd
                </div>
              </form>
            </Card>
          )}

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
              <div
                className="mx-mono mx-t-xs mx-muted"
                style={{ marginTop: 8, textAlign: 'center' }}
              >
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
        style={{
          lineHeight: multiline ? 1.5 : 1.3,
          whiteSpace: multiline ? 'pre-wrap' : 'normal'
        }}
      >
        {value}
      </div>
    </div>
  );
}

function AttrRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mx-flex mx-items-c mx-gap-2 mx-t-12">
      <span className="mx-mono mx-t-xs mx-muted mx-t-up" style={{ minWidth: 90 }}>
        {label}
      </span>
      <span className="mx-mono mx-truncate" style={{ flex: 1, minWidth: 0 }}>
        {value}
      </span>
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
