'use client';

import { useState } from 'react';
import { EMAIL_ACCENT_HEX, type EmailAccent, type EmailLayout } from '@platform/shared';

export interface TemplateCardData {
  key: string;
  name: string;
  summary: string;
  category: string;
  needsEvent: boolean;
  accent: EmailAccent;
  layout: EmailLayout;
}

/** Skiss av mallens komposition — kort med accentbalk eller enkelt "personligt" mejl. */
function Sketch({ accent, layout }: { accent: EmailAccent; layout: EmailLayout }) {
  const hex = EMAIL_ACCENT_HEX[accent];
  if (layout === 'plain') {
    return (
      <svg viewBox="0 0 120 80" width="100%" aria-hidden style={{ display: 'block', background: '#fff', borderRadius: 8 }}>
        <rect x="14" y="14" width="60" height="6" rx="2" fill="#121212" />
        <rect x="14" y="28" width="92" height="3" rx="1.5" fill="#9a9a9a" />
        <rect x="14" y="36" width="88" height="3" rx="1.5" fill="#9a9a9a" />
        <rect x="14" y="44" width="70" height="3" rx="1.5" fill="#9a9a9a" />
        <rect x="14" y="58" width="40" height="3" rx="1.5" fill={hex} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 80" width="100%" aria-hidden style={{ display: 'block', background: '#f2f2f2', borderRadius: 8 }}>
      <rect x="18" y="8" width="84" height="66" rx="5" fill="#fff" />
      <rect x="18" y="8" width="84" height="4" rx="2" fill={hex} />
      <rect x="26" y="20" width="22" height="4" rx="1" fill="#121212" />
      <rect x="26" y="30" width="56" height="5" rx="2" fill="#121212" />
      <rect x="26" y="40" width="68" height="3" rx="1.5" fill="#9a9a9a" />
      <rect x="26" y="47" width="60" height="3" rx="1.5" fill="#9a9a9a" />
      <rect x="26" y="58" width="30" height="9" rx="4.5" fill={hex} />
    </svg>
  );
}

export function TemplatePicker({ templates }: { templates: TemplateCardData[] }) {
  const [picked, setPicked] = useState(templates[0]?.key ?? '');
  return (
    <div>
      <input type="hidden" name="template" value={picked} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => {
          const on = t.key === picked;
          return (
            <button
              type="button"
              key={t.key}
              onClick={() => setPicked(t.key)}
              aria-pressed={on}
              className="text-left"
              style={{
                border: `2px solid ${on ? 'var(--color-brand)' : 'var(--mx-line-soft)'}`,
                borderRadius: 14,
                padding: 10,
                background: 'var(--color-surface)',
                cursor: 'pointer'
              }}
            >
              <Sketch accent={t.accent} layout={t.layout} />
              <div className="mx-fw-6 mx-t-13" style={{ marginTop: 8 }}>
                {t.name}
              </div>
              <div className="mx-t-xs mx-muted">{t.summary}</div>
              <div className="mx-t-xs mx-muted" style={{ marginTop: 4 }}>
                {t.category}
                {t.needsEvent ? ' · kräver event' : ''}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
