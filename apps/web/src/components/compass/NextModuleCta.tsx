'use client';

import type { NextModuleLink } from '@/lib/compass/types';

interface Props {
  next: NextModuleLink;
  /** Kort uppmaning ovanför knappen. */
  prompt?: string;
}

// Kedjad "fortsätt till nästa modul"-CTA (migration 1700000124). Visas efter
// att ett flöde slutförts (quiz/formulär) eller under en chatt. Länkar vidare
// till nästa publika modul på /m/<slug>.
export function NextModuleCta({ next, prompt }: Props) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: 16,
        borderRadius: 12,
        background: 'var(--mx-paper-2)',
        border: '1px solid var(--mx-line-soft)',
        display: 'grid',
        gap: 10,
        textAlign: 'center'
      }}
    >
      <div className="mx-mono mx-t-xs mx-t-up mx-muted mx-fw-6">
        {prompt || 'Nästa steg'}
      </div>
      <div>
        <a href={`/m/${encodeURIComponent(next.slug)}`} className="mx-btn mx-primary mx-lg">
          {next.label} <span aria-hidden>→</span>
        </a>
      </div>
    </div>
  );
}
