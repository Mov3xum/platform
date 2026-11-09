import Link from 'next/link';
import { Icon } from '@/components/proto';
import type { IconName } from '@/components/proto/Icon';
import { addStarterTemplatesAction } from '@/lib/actions/surveys';
import {
  EVENT_TYPE_LABEL,
  SURVEY_QUESTION_TYPE_LABEL,
  SURVEY_STARTER_TEMPLATES,
  starterTemplateEventTypes,
  starterTemplateRef
} from '@platform/shared';

// Movexums standardmallar (§ 53.3) som galleri under Utvärdering. Ren
// presentation: "Använd" skapar en enkät från mallen, "Lägg till som egen
// mall" kopierar den till tenantens egna mallar så att den kan anpassas.

const LOOK: Record<string, { icon: IconName; tone: string; ink: string }> = {
  frukost: { icon: 'sun', tone: 'var(--movexum-pastell-gul)', ink: 'var(--movexum-morkgul)' },
  workshop: { icon: 'cap', tone: 'var(--movexum-pastell-gron)', ink: 'var(--movexum-morkgron)' },
  pitch: { icon: 'target', tone: 'var(--movexum-pastell-lila)', ink: 'var(--movexum-morklila)' },
  konferens: { icon: 'people', tone: 'var(--movexum-pastell-bla)', ink: 'var(--movexum-djupbla)' },
  hackathon: { icon: 'bolt', tone: 'var(--movexum-pastell-orange)', ink: 'var(--movexum-morkorange)' },
  kort: { icon: 'zap', tone: 'var(--color-canvas-muted)', ink: 'var(--color-foreground-muted)' }
};

export function StarterTemplateGallery({ ownTemplateNames }: { ownTemplateNames: string[] }) {
  const owned = new Set(ownTemplateNames.map((n) => n.trim().toLowerCase()));
  const missing = SURVEY_STARTER_TEMPLATES.filter((t) => !owned.has(t.name.toLowerCase()));

  return (
    <section style={{ marginBottom: 24 }}>
      <div className="mx-flex mx-items-c mx-gap-2" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mx-disp mx-fw-6" style={{ fontSize: 15 }}>
            Movexums standardmallar
          </div>
          <div className="mx-t-12 mx-muted">
            En per typ av aktivitet. Alla har helhetsbetyg och NPS, så resultaten går att jämföra mot målen.
          </div>
        </div>
        {missing.length > 0 && (
          <form action={addStarterTemplatesAction}>
            {missing.map((t) => (
              <input key={t.key} type="hidden" name="starter" value={t.key} />
            ))}
            <button type="submit" className="mx-btn mx-sm">
              <Icon name="copy" size={12} /> Lägg till alla som egna mallar ({missing.length})
            </button>
          </form>
        )}
      </div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {SURVEY_STARTER_TEMPLATES.map((t) => {
          const look = LOOK[t.key] ?? LOOK.kort!;
          const isOwned = owned.has(t.name.toLowerCase());
          return (
            <article
              key={t.key}
              className="mx-card"
              style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ background: look.tone, padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span
                  aria-hidden
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--color-surface)',
                    color: look.ink
                  }}
                >
                  <Icon name={look.icon} size={17} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="mx-disp mx-fw-6 mx-t-13" style={{ color: look.ink }}>
                    {t.name}
                  </div>
                  <div className="mx-mono mx-t-xs" style={{ color: look.ink, opacity: 0.85 }}>
                    {starterTemplateEventTypes(t)
                      .map((e) => EVENT_TYPE_LABEL[e])
                      .join(' · ')}{' '}
                    · {t.questions.length} frågor
                  </div>
                </div>
              </div>
              <div style={{ padding: '12px 16px', display: 'grid', gap: 10, flex: 1 }}>
                <div className="mx-t-12 mx-muted" style={{ lineHeight: 1.45 }}>
                  {t.summary}
                </div>
                <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }} className="mx-t-12">
                  {t.questions.slice(0, 4).map((q) => (
                    <li key={q.id}>
                      {q.prompt}{' '}
                      <span className="mx-mono mx-t-xs mx-muted">({SURVEY_QUESTION_TYPE_LABEL[q.type].toLowerCase()})</span>
                    </li>
                  ))}
                  {t.questions.length > 4 && <li className="mx-muted">+ {t.questions.length - 4} till</li>}
                </ol>
              </div>
              <div className="mx-flex mx-gap-2" style={{ padding: '0 16px 14px', flexWrap: 'wrap' }}>
                <Link
                  href={`/inflode/utvardering/new?${new URLSearchParams({ utgang: starterTemplateRef(t.key) })}`}
                  className="mx-btn mx-sm mx-primary"
                >
                  Använd
                </Link>
                {isOwned ? (
                  <span className="mx-t-12 mx-muted mx-flex mx-items-c mx-gap-2">
                    <Icon name="check" size={12} /> Finns som egen mall
                  </span>
                ) : (
                  <form action={addStarterTemplatesAction}>
                    <input type="hidden" name="starter" value={t.key} />
                    <button type="submit" className="mx-btn mx-sm">
                      <Icon name="copy" size={12} /> Lägg till som egen mall
                    </button>
                  </form>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
