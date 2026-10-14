'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Attribution, NextModuleLink } from '@/lib/compass/types';
import { ChatClosingForm, type ChatClosingConfig, type ChatClosingResult } from './ChatClosingForm';
import { NextModuleCta } from './NextModuleCta';
import { useFlowProgress } from './useFlowProgress';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  initialAssistantMessage?: string;
  moduleSlug?: string;
  /** Visa "AI-genererat"-badge i headern */
  showAiBadge?: boolean;
  /** Chat-endpoint. Default = /api/inflode/chat (inloggad). Publik: /api/public/m/<slug>/chat */
  endpoint?: string;
  /** Assistentens namn: rubrik i chat-headern och i standardhälsningen. */
  title?: string;
  /** Initial i header-avataren (default "M"). */
  avatarInitial?: string;
  /** Max antal användarmeddelanden (0/odefinierat = obegränsat). */
  maxExchanges?: number;
  /** Skickas till publika chat-routen där modulen har en samtyckesgrind. */
  consent?: boolean;
  /**
   * Avslutssteg (§ 23.10): obligatoriska frågor + kontaktfält efter samtalet,
   * sammanfattning som PDF/e-post. Bara publika moduler som sparar lead.
   */
  closing?: ChatClosingConfig;
  /** Kedjad nästa modul — visas efter avslutssteget. */
  nextModule?: NextModuleLink | null;
}

function readAttribution(): Attribution {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const get = (k: string) => params.get(k) || undefined;
  return {
    utm_source: get('utm_source'),
    utm_medium: get('utm_medium'),
    utm_campaign: get('utm_campaign'),
    utm_term: get('utm_term'),
    utm_content: get('utm_content'),
    referrer_url: typeof document !== 'undefined' ? document.referrer || undefined : undefined
  };
}

/**
 * Hälsningen bär assistentens namn (modulens "Assistentens namn", annars
 * modulens namn) — aldrig ett hårdkodat produktnamn. Modulens egen
 * `intro_message` vinner när den är satt.
 */
function defaultGreeting(name: string): string {
  return `Hej! Jag är ${name}. Berätta gärna lite om idén du går och funderar på — vad försöker du lösa, och för vem?`;
}

export function CompassChat({
  initialAssistantMessage,
  moduleSlug,
  showAiBadge = true,
  endpoint = '/api/inflode/chat',
  title = 'Movexums AI-assistent',
  avatarInitial = 'M',
  maxExchanges = 0,
  consent,
  closing,
  nextModule
}: Props) {
  const [messages, setMessages] = useState<Msg[]>(() => [
    { role: 'assistant', content: initialAssistantMessage || defaultGreeting(title) }
  ]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attribution = useMemo(readAttribution, []);
  // Sessionstoken nycklar konversationen (och lead-upserten) på servern;
  // samma hook bokför "avbrutet" om fliken stängs innan avslutssteget.
  const progress = useFlowProgress({
    endpointBase: closing?.apiBase,
    moduleSlug: moduleSlug || '',
    consent,
    attribution
  });
  const sessionToken = progress.sessionToken;
  const [stage, setStage] = useState<'chat' | 'closing' | 'done'>('chat');
  const [closingResult, setClosingResult] = useState<ChatClosingResult | null>(null);
  const [downloading, setDownloading] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const userMsgCount = messages.filter((m) => m.role === 'user').length;
  const reachedLimit = maxExchanges > 0 && userMsgCount >= maxExchanges;

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, pending, stage]);

  // Taket nått och sista svaret har kommit → avslutssteget (med config),
  // annars bara låst inmatning som förut.
  useEffect(() => {
    if (closing && stage === 'chat' && reachedLimit && !pending) setStage('closing');
  }, [closing, stage, reachedLimit, pending]);

  function finishChat(result: ChatClosingResult) {
    progress.markDone();
    setClosingResult(result);
    setStage('done');
  }

  async function downloadSummary() {
    if (!closing || !moduleSlug) return;
    setDownloading(true);
    try {
      const res = await fetch(`${closing.apiBase}/${encodeURIComponent(moduleSlug)}/summary-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken })
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sammanfattning.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError('Kunde inte skapa PDF:en. Försök igen.');
    } finally {
      setDownloading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || pending) return;
    const next: Msg[] = [...messages, { role: 'user', content: trimmed }];
    if (reachedLimit || stage !== 'chat') return;
    progress.markStarted();
    setMessages(next);
    setInput('');
    setPending(true);
    setError(null);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
          moduleSlug,
          sessionToken,
          attribution,
          consent
        })
      });
      if (!res.ok) {
        // Servern skickar vänliga, svenska felmeddelanden (rate limit,
        // Mistral-överbelastning m.m.) — visa dem i stället för rå statuskod.
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Servern svarade ${res.status}`);
      }
      const data = (await res.json()) as { reply?: string };
      if (!data.reply) throw new Error('Ingen replik från servern');
      setMessages((m) => [...m, { role: 'assistant', content: data.reply ?? '' }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Något gick fel');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-chat">
      {/* Header */}
      <div className="mx-chat-head">
        <div className="mx-chat-ava">{avatarInitial}</div>
        <div style={{ minWidth: 0 }}>
          <div className="mx-disp mx-fw-6 mx-t-13">{title}</div>
          <div className="mx-mono mx-t-xs mx-muted mx-t-up">
            Mistral · Le Chat · EU-suveränt
          </div>
        </div>
        <span className="mx-grow" />
        {showAiBadge && (
          <span
            className="mx-chip mx-mono"
            style={{ background: 'var(--mx-cyan-tint-2)', color: '#002c40' }}
          >
            AI-ASSISTENT
          </span>
        )}
      </div>

      {/* Log */}
      <div ref={logRef} className="mx-chat-log" role="log" aria-live="polite">
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} avatarInitial={avatarInitial}>
            {m.content}
          </Bubble>
        ))}
        {pending && (
          <div className="mx-chat-row bot mx-fadein">
            <div className="mx-chat-mini" aria-hidden>
              {avatarInitial}
            </div>
            <div className="mx-bubble bot" aria-label="Assistenten skriver">
              <span className="mx-chat-typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
        {error && <div className="mx-chat-err">{error}</div>}
        {stage === 'closing' && closing && moduleSlug && (
          <div className="mx-chat-card">
            <ChatClosingForm
              config={closing}
              moduleSlug={moduleSlug}
              sessionToken={sessionToken}
              consent={consent}
              attribution={attribution}
              onDone={finishChat}
            />
          </div>
        )}
        {stage === 'done' && closingResult && (
          <div className="mx-chat-card" style={{ display: 'grid', gap: 12 }}>
            <div className="mx-disp mx-fw-6" style={{ fontSize: 18 }}>
              Tack — vi har dina uppgifter.
            </div>
            <p className="mx-muted mx-t-13" style={{ margin: 0, lineHeight: 1.55 }}>
              {closing?.successMessage ||
                'En människa från Movexum tittar på det du berättat och hör av sig om du bett om det.'}
            </p>
            {closingResult.summary && (
              <div className="mx-t-13" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {closingResult.summary}
              </div>
            )}
            <div className="mx-t-xs mx-muted">
              {closingResult.emailed && closingResult.email
                ? `Sammanfattningen är skickad till ${closingResult.email}.`
                : closingResult.emailError
                  ? `Sammanfattningen kunde inte mejlas (${closingResult.emailError}) — ladda ner den i stället.`
                  : null}
            </div>
            <div className="mx-flex mx-items-c mx-gap-2 mx-wrap">
              <button type="button" className="mx-btn mx-primary" onClick={downloadSummary} disabled={downloading}>
                {downloading ? 'Skapar PDF…' : 'Ladda ner sammanfattning (PDF)'}
              </button>
            </div>
            <div className="mx-t-xs mx-muted">Genererat av AI – verifiera innan delning.</div>
            {nextModule && <NextModuleCta next={nextModule} prompt="Klar? Gå vidare till nästa steg." />}
          </div>
        )}
        {stage === 'chat' && !closing && reachedLimit && !pending && (
          <div className="mx-t-xs mx-muted" style={{ textAlign: 'center', padding: '8px 0' }}>
            Samtalet är avslutat — tack för att du delade din idé.
          </div>
        )}
      </div>

      {/* Input */}
      {stage !== 'chat' ? null : (
      <form onSubmit={onSubmit} className="mx-chat-foot">
        {closing && userMsgCount > 0 && !pending && !reachedLimit && (
          <button
            type="button"
            className="mx-btn"
            style={{ flex: 'none', borderRadius: 'var(--mx-r-pill)' }}
            onClick={() => setStage('closing')}
            title="Avsluta samtalet och lämna dina uppgifter"
          >
            Avsluta
          </button>
        )}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={reachedLimit ? 'Samtalet är avslutat' : 'Skriv ditt svar…'}
          className="mx-input"
          disabled={pending || reachedLimit}
          aria-label="Ditt meddelande"
        />
        <button
          type="submit"
          className="mx-btn mx-primary mx-chat-send"
          disabled={pending || reachedLimit || input.trim().length === 0}
        >
          Skicka →
        </button>
      </form>
      )}
    </div>
  );
}

function Bubble({
  role,
  avatarInitial,
  children
}: {
  role: 'user' | 'assistant';
  avatarInitial: string;
  children: React.ReactNode;
}) {
  const isUser = role === 'user';
  return (
    <div className={`mx-chat-row ${isUser ? 'user' : 'bot'} mx-fadein`}>
      {!isUser && (
        <div className="mx-chat-mini" aria-hidden>
          {avatarInitial}
        </div>
      )}
      <div className={`mx-bubble ${isUser ? 'user' : 'bot'}`}>{children}</div>
    </div>
  );
}
