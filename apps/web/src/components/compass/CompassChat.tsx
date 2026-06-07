'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Attribution } from '@/lib/compass/types';

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
  /** Rubriknamn i chat-headern (default "Inflöde"). */
  title?: string;
  /** Initial i header-avataren (default "I"). */
  avatarInitial?: string;
  /** Max antal användarmeddelanden (0/odefinierat = obegränsat). */
  maxExchanges?: number;
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

const DEFAULT_GREETING =
  'Hej! Jag är Inflöde, Movexums AI-assistent. Berätta gärna lite om idén du går och funderar på — vad försöker du lösa, och för vem?';

export function CompassChat({
  initialAssistantMessage,
  moduleSlug,
  showAiBadge = true,
  endpoint = '/api/inflode/chat',
  title = 'Inflöde',
  avatarInitial = 'I',
  maxExchanges = 0
}: Props) {
  const [messages, setMessages] = useState<Msg[]>(() => [
    { role: 'assistant', content: initialAssistantMessage || DEFAULT_GREETING }
  ]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionToken] = useState(() => generateToken());
  const attribution = useMemo(readAttribution, []);
  const logRef = useRef<HTMLDivElement>(null);
  const userMsgCount = messages.filter((m) => m.role === 'user').length;
  const reachedLimit = maxExchanges > 0 && userMsgCount >= maxExchanges;

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, pending]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || pending) return;
    const next: Msg[] = [...messages, { role: 'user', content: trimmed }];
    if (reachedLimit) return;
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
          attribution
        })
      });
      if (!res.ok) throw new Error(`Servern svarade ${res.status}`);
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
      </div>

      {/* Input */}
      <form onSubmit={onSubmit} className="mx-chat-foot">
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

function generateToken(): string {
  return `s_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
