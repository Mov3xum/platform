'use client';

import { useState } from 'react';
import {
  type CompassLocale,
  hasCompassStartPage,
  parseCompassStartPageBlocks
} from '@platform/shared';
import type { CompassQuestion, NextModuleLink } from '@/lib/compass/types';
import type { PublicCompassModule } from '@/lib/compass/public';
import { CompassChat } from './CompassChat';
import { ModuleWizard } from './ModuleWizard';
import { ModuleQuiz } from './ModuleQuiz';
import { NextModuleCta } from './NextModuleCta';
import { CompassLocaleProvider, useCompassLocale } from './locale';

interface Props {
  module: PublicCompassModule;
  questions: CompassQuestion[];
  /** Kedjad nästa modul (migration 1700000124) — visas efter slutfört flöde. */
  nextModule?: NextModuleLink | null;
  /** Enkätens subjekt ur `?om=<id>` (§ 43). */
  subject?: string | null;
  /** Besökarens språk (§ 23.13) — styr gränssnittets texter i alla flöden. */
  locale?: CompassLocale;
}

const PUBLIC_API_BASE = '/api/public/m';

// Publik (oinloggad) körning av en Startupkompass-modul. Visar först
// modulens STARTSIDA (beskrivning + syfte, § 23.11) och/eller en
// samtyckesgrind före all datainsamling (GDPR art. 7) — på EN sida med EN
// knapp när båda finns — och dispatchar sedan till rätt flöde. Skickar
// consent=true till de publika API-routarna.
export function PublicModuleRunner({ locale = 'sv', ...props }: Props) {
  return (
    <CompassLocaleProvider locale={locale}>
      <Runner {...props} />
    </CompassLocaleProvider>
  );
}

function Runner({ module, questions, nextModule, subject }: Omit<Props, 'locale'>) {
  const { t } = useCompassLocale();
  const hasConsentGate = Boolean(module.consent_note);
  const hasStartPage = hasCompassStartPage(module);
  const [started, setStarted] = useState(!hasConsentGate && !hasStartPage);

  if (!started) {
    const startBlocks = hasStartPage ? parseCompassStartPageBlocks(module.start_page_body) : [];
    return (
      <div className="mx-consent mx-startpage">
        <div className="mx-mono mx-t-xs mx-t-up mx-muted">{t.beforeWeStart}</div>
        <h2 className="mx-disp" style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--mx-ink)' }}>
          {hasStartPage ? module.start_page_title?.trim() || t.startPageTitle : t.dataHandling}
        </h2>
        {hasStartPage && (
          <div className="mx-startpage-body">
            {startBlocks.map((block, i) => {
              if (block.kind === 'heading') return <h3 key={i}>{block.text}</h3>;
              if (block.kind === 'list') {
                return (
                  <ul key={i}>
                    {block.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                );
              }
              return <p key={i}>{block.text}</p>;
            })}
          </div>
        )}
        {hasConsentGate && (
          <div className={hasStartPage ? 'mx-startpage-consent' : undefined}>
            {hasStartPage && (
              <div className="mx-mono mx-t-xs mx-t-up mx-muted" style={{ marginBottom: 6 }}>
                {t.dataHandling}
              </div>
            )}
            <p className="mx-t-13 mx-muted" style={{ lineHeight: 1.65, maxWidth: 560, margin: 0 }}>
              {module.consent_note}
            </p>
          </div>
        )}
        <div className="mx-consent-cta">
          <span className="mx-chip mx-mono">{t.flowLabel[module.flow_type]}</span>
          <button type="button" className="mx-btn mx-primary mx-lg" onClick={() => setStarted(true)}>
            {hasConsentGate ? t.startUnderstand : t.start} <span aria-hidden>→</span>
          </button>
        </div>
      </div>
    );
  }

  if (module.flow_type === 'chat') {
    // Chatten har inget hårt "klart"-event → visa en frivillig "fortsätt"-CTA
    // under chatten när modulen är kedjad till en nästa modul.
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="mx-compass-chatbox">
          <CompassChat
            endpoint={`${PUBLIC_API_BASE}/${module.public_slug || module.slug}/chat`}
            moduleSlug={module.public_slug || module.slug}
            initialAssistantMessage={module.intro_message || undefined}
            title={module.chat_persona || module.name}
            avatarInitial={(module.name || 'M').slice(0, 1).toUpperCase()}
            maxExchanges={module.max_exchanges || 0}
            consent
            closing={
              module.collects_lead
                ? {
                    apiBase: PUBLIC_API_BASE,
                    questions,
                    contactSection: module.contact_section,
                    successMessage: module.success_message
                  }
                : undefined
            }
            nextModule={nextModule}
          />
        </div>
        {!module.collects_lead && nextModule && (
          <NextModuleCta next={nextModule} prompt={t.doneContinue} />
        )}
      </div>
    );
  }

  if (module.flow_type === 'quiz') {
    return (
      <ModuleQuiz
        moduleSlug={module.public_slug || module.slug}
        questions={questions}
        apiBase={PUBLIC_API_BASE}
        consent
        contactSection={module.contact_section}
        successMessage={module.success_message}
        nextModule={nextModule}
        subject={subject}
        trackProgress={module.collects_lead}
      />
    );
  }

  return (
    <ModuleWizard
      moduleSlug={module.public_slug || module.slug}
      questions={questions}
      apiBase={PUBLIC_API_BASE}
      consent
      contactSection={module.contact_section}
      successMessage={module.success_message}
      redirectUrl={module.redirect_url}
      nextModule={nextModule}
      subject={subject}
      trackProgress={module.collects_lead}
    />
  );
}
