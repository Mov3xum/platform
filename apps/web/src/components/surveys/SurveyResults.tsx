import type { SurveyQuestionStats, SurveySummary } from '@platform/shared';
import { Card } from '@/components/proto';

// Resultatvy (server-komponent, ren presentation av aggregerad statistik).
// Staplar använder brand-tokens; NPS-detractors renderas i orange (§ 2.3).

function Bar({ label, count, max, total }: { label: string; count: number; max: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 72px', gap: 10, alignItems: 'center' }}>
      <span className="mx-t-12 mx-truncate" title={label}>
        {label}
      </span>
      <div style={{ height: 10, borderRadius: 99, background: 'var(--mx-paper-2)' }}>
        <div
          style={{
            width: `${max > 0 ? (count / max) * 100 : 0}%`,
            height: '100%',
            borderRadius: 99,
            background: 'var(--color-brand)'
          }}
        />
      </div>
      <span className="mx-mono mx-t-xs mx-muted" style={{ textAlign: 'right' }}>
        {count} · {pct}%
      </span>
    </div>
  );
}

function QuestionBlock({ s, index }: { s: SurveyQuestionStats; index: number }) {
  const max = Math.max(0, ...(s.distribution ?? []).map((d) => d.count));
  return (
    <Card style={{ padding: 16 }}>
      <div className="mx-flex mx-items-c mx-gap-2" style={{ marginBottom: 10 }}>
        <span className="mx-mono mx-t-xs mx-muted">{String(index + 1).padStart(2, '0')}</span>
        <span className="mx-disp mx-fw-6 mx-t-13" style={{ flex: 1 }}>
          {s.prompt}
        </span>
        <span className="mx-mono mx-t-xs mx-muted">{s.answered} svar</span>
      </div>

      {s.nps && s.nps.total > 0 && (
        <div className="mx-flex mx-gap-4 mx-wrap" style={{ marginBottom: 12, alignItems: 'baseline' }}>
          <span className="mx-disp" style={{ fontSize: 34, lineHeight: 1 }}>
            {s.nps.score! > 0 ? '+' : ''}
            {s.nps.score}
          </span>
          <span className="mx-t-12 mx-muted">
            NPS · {s.nps.promoters} förespråkare · {s.nps.passives} passiva ·{' '}
            <span style={{ color: 'var(--movexum-morkorange)' }}>{s.nps.detractors} kritiker</span>
          </span>
        </div>
      )}
      {s.average !== undefined && !s.nps && (
        <div className="mx-disp" style={{ fontSize: 28, marginBottom: 10 }}>
          {s.average.toLocaleString('sv-SE')}
          <span className="mx-t-13 mx-muted"> / 5 i snitt</span>
        </div>
      )}

      {s.distribution && (
        <div style={{ display: 'grid', gap: 6 }}>
          {s.distribution.map((d) => (
            <Bar key={d.label} label={d.label} count={d.count} max={max} total={s.answered} />
          ))}
        </div>
      )}

      {s.texts && (
        <div style={{ display: 'grid', gap: 8 }}>
          {s.texts.length === 0 && <span className="mx-muted mx-t-12">Inga svar ännu.</span>}
          {s.texts.map((t, i) => (
            <blockquote
              key={i}
              className="mx-t-13"
              style={{
                margin: 0,
                padding: '8px 12px',
                borderLeft: '3px solid var(--color-brand)',
                background: 'var(--mx-paper-2)',
                whiteSpace: 'pre-wrap'
              }}
            >
              {t}
            </blockquote>
          ))}
        </div>
      )}
    </Card>
  );
}

export function SurveyResults({
  summary,
  total,
  incomplete
}: {
  summary: SurveySummary;
  total: number;
  incomplete: boolean;
}) {
  if (total === 0) {
    return (
      <Card style={{ padding: 32, textAlign: 'center' }}>
        <div className="mx-disp mx-fw-6" style={{ fontSize: 18, marginBottom: 6 }}>
          Inga svar ännu
        </div>
        <div className="mx-muted mx-t-13">Dela länken eller QR-koden så dyker resultaten upp här.</div>
      </Card>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 820 }}>
      <div className="mx-t-13 mx-muted">
        <strong className="mx-ink-soft">{total}</strong> inskick
        {incomplete && ' · visar ett urval (nedre gräns) — för många svar för att räkna alla'}
      </div>
      {summary.questions.map((s, i) => (
        <QuestionBlock key={s.id} s={s} index={i} />
      ))}
    </div>
  );
}
