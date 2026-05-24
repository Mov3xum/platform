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

export function CompassChat({ initialAssistantMessage, moduleSlug, showAiBadge = true }: Props) {
  const [messages, setMessages] = useState<Msg[]>(() => [
    { role: 'assistant', content: initialAssistantMessage || DEFAULT_GREETING }
  ]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionToken] = useState(() => generateToken());
  const attribution = useMemo(readAttribution, []);
  const logRef = useRef<HTMLDivElement>(null);

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
    setMessages(next);
    setInput('');
    setPending(true);
    setError(null);

    try {
      const res = await fetch('/api/inflode/chat', {
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
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'auto 1fr auto',
        height: '100%',
        minHeight: 480,
        background: 'var(--mx-paper)',
        border: '1px solid var(--mx-line)',
        borderRadius: 'var(--mx-r-lg)',
        boxShadow: 'var(--mx-sh-2)',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--mx-line-soft)',
          display: 'flex',
          alignItems: 'center',
          gap: 10
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            background: '#002c40',
            display: 'grid',
            placeItems: 'center',
            color: 'white',
            fontFamily: 'var(--mx-display)',
            fontWeight: 700,
            fontSize: 13
          }}
        >
          I
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="mx-disp mx-fw-6 mx-t-13">Inflöde</div>
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
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        style={{
          padding: 16,
          overflowY: 'auto',
          display: 'grid',
          gap: 10,
          background: 'var(--mx-paper-2)'
        }}
      >
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role}>
            {m.content}
          </Bubble>
        ))}
        {pending && <Bubble role="assistant"><em className="mx-muted">…skriver</em></Bubble>}
        {error && (
          <div
            className="mx-t-12"
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              background: 'var(--mx-st-danger-bg)',
              color: '#4b2718'
            }}
          >
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={onSubmit}
        style={{
          padding: 12,
          borderTop: '1px solid var(--mx-line-soft)',
          display: 'flex',
          gap: 8
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Skriv ditt svar..."
          className="mx-input"
          disabled={pending}
          aria-label="Ditt meddelande"
        />
        <button
          type="submit"
          className="mx-btn mx-primary"
          disabled={pending || input.trim().length === 0}
        >
          Skicka →
        </button>
      </form>
    </div>
  );
}

function Bubble({ role, children }: { role: 'user' | 'assistant'; children: React.ReactNode }) {
  const isUser = role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start'
      }}
    >
      <div
        style={{
          maxWidth: '78%',
          padding: '10px 14px',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          background: isUser ? '#002c40' : 'var(--mx-paper)',
          color: isUser ? 'white' : 'var(--mx-ink)',
          border: isUser ? 'none' : '1px solid var(--mx-line)',
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
      >
        {children}
      </div>
    </div>
  );
}

function generateToken(): string {
  return `s_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
