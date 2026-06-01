'use client';

import { useState } from 'react';
import type { CompassModule, CompassQuestion } from '@/lib/compass/types';
import { CompassChat } from './CompassChat';
import { ModuleWizard } from './ModuleWizard';
import { ModuleQuiz } from './ModuleQuiz';

interface Props {
  module: CompassModule;
  questions: CompassQuestion[];
}

const PUBLIC_API_BASE = '/api/public/m';

// Publik (oinloggad) körning av en Startupkompass-modul. Visar en
// samtyckesgrind före all datainsamling (GDPR art. 7) och dispatchar sedan
// till rätt flöde. Skickar consent=true till de publika API-routarna.
export function PublicModuleRunner({ module, questions }: Props) {
  const hasConsentGate = Boolean(module.consent_note);
  const [consented, setConsented] = useState(!hasConsentGate);

  if (!consented) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <div className="mx-mono mx-t-xs mx-t-up mx-muted">Innan vi börjar</div>
        <div className="mx-disp" style={{ fontSize: 22, fontWeight: 600 }}>
          Så hanterar vi dina uppgifter
        </div>
        <p className="mx-t-13 mx-muted" style={{ lineHeight: 1.6, maxWidth: 560 }}>
          {module.consent_note}
        </p>
        <button
          type="button"
          className="mx-btn mx-primary"
          style={{ justifySelf: 'start' }}
          onClick={() => setConsented(true)}
        >
          Jag förstår, starta →
        </button>
      </div>
    );
  }

  if (module.flow_type === 'chat') {
    return (
      <div style={{ height: '70vh', minHeight: 520 }}>
        <CompassChat
          endpoint={`${PUBLIC_API_BASE}/${module.public_slug || module.slug}/chat`}
          moduleSlug={module.public_slug || module.slug}
          initialAssistantMessage={module.intro_message || undefined}
          title={module.chat_persona || module.name}
          avatarInitial={(module.name || 'M').slice(0, 1).toUpperCase()}
          maxExchanges={module.max_exchanges || 0}
        />
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
        requireEmail={module.require_email}
        requirePhone={module.require_phone}
        requireOrganization={module.require_organization}
        successMessage={module.success_message}
      />
    );
  }

  return (
    <ModuleWizard
      moduleSlug={module.public_slug || module.slug}
      questions={questions}
      apiBase={PUBLIC_API_BASE}
      consent
      successMessage={module.success_message}
      redirectUrl={module.redirect_url}
    />
  );
}
