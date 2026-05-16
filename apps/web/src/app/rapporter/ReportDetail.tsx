import { Card, Chip, Icon, Meta } from '@/components/proto';
import type { IncubatorReport } from '@platform/shared';
import { generateAiDraftAction, sendReportAction } from '@/lib/actions/reports';
import { sectionStateChip, statusChipVariant, statusLabel, relativeTime } from './report-utils';

const RECIPIENT_TO_SEND_LABEL: Record<string, string> = {
  vinnova: 'Skicka till Vinnova',
  tillvaxtverket: 'Skicka till Tillväxtverket',
  region: 'Skicka till regionen',
  kommun: 'Skicka till kommun',
  other: 'Skicka rapport'
};

function previewParagraphs(md: string | undefined): string[] {
  if (!md) return [];
  return md
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function ReportDetail({
  report
}: {
  report: IncubatorReport;
}) {
  const sections = Array.isArray(report.sections_json) ? report.sections_json : [];
  const paragraphs = previewParagraphs(report.preview_md);

  async function regenerate() {
    'use server';
    await generateAiDraftAction(report.id);
  }

  async function send() {
    'use server';
    await sendReportAction(report.id);
  }

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--mx-line-soft)' }}>
        <div className="mx-flex mx-items-c mx-gap-2 mx-mb-2">
          <span className="mx-mono mx-t-xs mx-t-up mx-muted">
            {report.id.toUpperCase()} · {report.recipient_label}
          </span>
          <span className="mx-grow" />
          <Chip variant={statusChipVariant(report.status)} mono dot>
            {statusLabel(report.status)}
          </Chip>
        </div>
        <h2
          className="mx-disp"
          style={{ fontSize: 22, fontWeight: 500, letterSpacing: -0.3, marginBottom: 6 }}
        >
          {report.title}
        </h2>
        <div className="mx-flex mx-items-c mx-gap-4 mx-wrap">
          <Meta
            label="Period"
            value={<span className="mx-mono mx-fw-6">{report.period_label}</span>}
          />
          <Meta
            label="Slutdatum"
            value={
              <span className="mx-mono mx-fw-6">
                {report.due_date ? report.due_date.slice(0, 10) : '—'}
              </span>
            }
          />
          <Meta
            label="Senast uppd"
            value={<span className="mx-t-13 mx-fw-6">{relativeTime(report.updated)}</span>}
          />
          <Meta
            label="Komplett"
            value={
              <span className="mx-disp mx-fw-6 mx-t-15">{report.completion || 0}%</span>
            }
          />
        </div>
      </div>

      {/* Sektioner */}
      <div style={{ padding: 16 }}>
        <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">Sektioner</div>
        {sections.length === 0 ? (
          <div className="mx-muted mx-t-13" style={{ padding: '12px 0' }}>
            Inga sektioner är definierade ännu.
          </div>
        ) : (
          <div className="mx-flex mx-col mx-gap-2">
            {sections.map((s) => {
              const chip = sectionStateChip(s.state);
              const checked = s.state === 'done';
              return (
                <div
                  key={s.id}
                  className="mx-flex mx-items-c mx-gap-3"
                  style={{
                    padding: '10px 12px',
                    background: 'var(--mx-paper-3)',
                    borderRadius: 8
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 50,
                      background: checked ? 'var(--mx-st-active)' : 'var(--mx-line-strong)',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0
                    }}
                  >
                    {checked && <Icon name="check" size={11} style={{ color: 'white' }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mx-t-13 mx-fw-6">{s.name}</div>
                  </div>
                  {s.auto && (
                    <Chip variant="cyan" mono>
                      <Icon name="sparkle" size={10} /> AI
                    </Chip>
                  )}
                  <Chip variant={chip.variant} mono>
                    {chip.label}
                  </Chip>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Förhandsgranskning */}
      <div style={{ padding: 16, borderTop: '1px solid var(--mx-line-soft)' }}>
        <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6 mx-mb-2">
          Förhandsgranskning · Bolagsportfölj
        </div>
        <Card
          style={{
            padding: 16,
            background: 'var(--mx-paper-3)',
            borderColor: 'var(--mx-line-soft)'
          }}
        >
          {paragraphs.length === 0 ? (
            <div className="mx-muted mx-t-13" style={{ fontStyle: 'italic' }}>
              Inget AI-utkast finns ännu. Klicka på &quot;Regenerera&quot; för att låta
              Rapportskrivaren fylla i texten utifrån portföljen.
            </div>
          ) : (
            <div
              className="mx-t-13"
              style={{
                lineHeight: 1.6,
                fontFamily: 'var(--font-heading, var(--mx-display))',
                fontWeight: 400
              }}
            >
              {paragraphs.map((p, i) => (
                <p
                  key={i}
                  style={{
                    marginTop: i === 0 ? 0 : 10,
                    color:
                      p.startsWith('[') && p.endsWith(']')
                        ? 'var(--mx-muted)'
                        : undefined,
                    fontStyle: p.startsWith('[') && p.endsWith(']') ? 'italic' : undefined
                  }}
                >
                  {p}
                </p>
              ))}
            </div>
          )}
        </Card>
        <div className="mx-flex mx-gap-2 mx-mt-3">
          <button type="button" className="mx-btn">
            <Icon name="pencil" size={12} /> Redigera
          </button>
          <form action={regenerate} style={{ display: 'inline' }}>
            <button type="submit" className="mx-btn">
              <Icon name="sparkle" size={12} /> Regenerera
            </button>
          </form>
          <span className="mx-grow" />
          <form action={send} style={{ display: 'inline' }}>
            <button
              type="submit"
              className="mx-btn mx-primary"
              disabled={report.status === 'sent'}
            >
              <Icon name="upload" size={12} />{' '}
              {RECIPIENT_TO_SEND_LABEL[report.recipient] || 'Skicka rapport'}
            </button>
          </form>
        </div>
      </div>
    </Card>
  );
}
