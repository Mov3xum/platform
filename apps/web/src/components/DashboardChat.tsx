'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { sendChatMessage, type ChatMessage } from '@/lib/actions/chat';
import { Icon } from '@/components/proto/Icon';

export interface DashboardAgent {
  id: string;
  name: string;
  description?: string;
  category: 'ai_per_startup' | 'ai_system_wide' | string;
  runs?: number;
}

interface Props {
  className?: string;
  agents?: DashboardAgent[];
  greeting?: string;
}

const AGENT_TONES = [
  { swatch: 'bg-movexum-pastell-lila text-movexum-morklila' },
  { swatch: 'bg-movexum-pastell-bla text-movexum-djupbla' },
  { swatch: 'bg-movexum-pastell-gron text-movexum-morkgron' },
  { swatch: 'bg-movexum-pastell-gul text-movexum-morkgul' },
  { swatch: 'bg-movexum-pastell-orange text-movexum-morkorange' }
];

function toneFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AGENT_TONES[h % AGENT_TONES.length];
}

export default function DashboardChat({ className = '', agents = [], greeting }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [includeWebContext, setIncludeWebContext] = useState(false);
  const [activeAgent, setActiveAgent] = useState<DashboardAgent | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isActive = messages.length > 0 || isPending;

  function autoGrow() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  useEffect(() => {
    autoGrow();
  }, [input]);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }

  function submit() {
    const text = input.trim();
    if (!text || isPending) return;

    const userMessage: ChatMessage = { role: 'user', content: text };
    const nextMessages: ChatMessage[] = [...messages, userMessage];

    setMessages(nextMessages);
    setInput('');
    setError(null);
    scrollToBottom();

    const agentId = activeAgent?.id;

    startTransition(async () => {
      const result = await sendChatMessage(nextMessages, { includeWebContext, agentId });
      if (result.error) {
        setError(result.error);
      } else if (result.text) {
        setMessages((prev) => [...prev, { role: 'assistant', content: result.text! }]);
        scrollToBottom();
      }
    });
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function pickAgent(agent: DashboardAgent) {
    setActiveAgent(agent);
    setError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function clearAgent() {
    setActiveAgent(null);
  }

  function resetConversation() {
    setMessages([]);
    setError(null);
    setActiveAgent(null);
    setInput('');
  }

  const inputPill = (
    <div className="rounded-2xl border border-default bg-surface px-4 py-3 shadow-sm shadow-movexum-svart/5 transition focus-within:border-strong focus-within:ring-2 focus-within:ring-movexum-pastell-lila dark:focus-within:ring-movexum-morklila">
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKey}
        placeholder={
          activeAgent
            ? `Fråga ${activeAgent.name}…`
            : 'Fråga om portföljen, ett bolag eller en aktivitet…'
        }
        disabled={isPending}
        rows={1}
        className="block w-full resize-none bg-transparent text-[15px] leading-6 text-foreground placeholder:text-foreground-subtle focus:outline-none disabled:opacity-50"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setIncludeWebContext((v) => !v)}
          aria-pressed={includeWebContext}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] transition ${
            includeWebContext
              ? 'bg-movexum-pastell-bla text-movexum-djupbla'
              : 'border border-default text-foreground-subtle hover:text-foreground'
          }`}
          title="Inkludera publika webbkällor (Wikipedia, EU)"
        >
          <Icon name="globe" size={12} />
          Webbkällor
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={isPending || !input.trim()}
          aria-label="Skicka"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-brand-foreground transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="arrow" size={16} />
        </button>
      </div>
    </div>
  );

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`}>
      {!isActive ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto py-10">
          <div className="mx-auto flex w-full max-w-[720px] flex-col px-6">
            {greeting && (
              <h1 className="font-heading text-[28px] font-semibold tracking-tight text-foreground md:text-[34px]">
                {greeting}
              </h1>
            )}
            <p className="mt-2 text-[14px] text-foreground-subtle">
              Vad kan jag hjälpa dig med idag?
            </p>

            {activeAgent && (
              <div className="mt-5 flex items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full bg-canvas-subtle px-3 py-1 text-[12px] text-foreground-muted">
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full ${toneFor(activeAgent.id).swatch}`}>
                    <Icon name="sparkle" size={9} />
                  </span>
                  Med {activeAgent.name}
                  <button
                    type="button"
                    onClick={clearAgent}
                    className="text-foreground-subtle transition hover:text-foreground"
                    aria-label="Avsluta agentläge"
                  >
                    <Icon name="x" size={11} />
                  </button>
                </span>
              </div>
            )}

            <div className="mt-6">{inputPill}</div>

            {agents.length > 0 && (
              <section className="mt-12">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
                    Assistenter
                  </h2>
                  <a
                    href="/toolbox"
                    className="text-[12px] text-foreground-subtle transition hover:text-foreground"
                  >
                    Alla
                  </a>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {agents.map((a) => {
                    const tone = toneFor(a.id);
                    const selected = activeAgent?.id === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => pickAgent(a)}
                        className={`group flex flex-col gap-2 rounded-2xl border bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:border-strong hover:shadow-sm hover:shadow-movexum-svart/10 ${
                          selected ? 'border-strong shadow-sm shadow-movexum-svart/10' : 'border-default'
                        }`}
                      >
                        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tone.swatch}`}>
                          <Icon name="sparkle" size={14} />
                        </span>
                        <span className="font-heading text-[14.5px] font-semibold leading-tight text-foreground">
                          {a.name}
                        </span>
                        {a.description ? (
                          <span className="line-clamp-2 text-[12.5px] leading-snug text-foreground-muted">
                            {a.description}
                          </span>
                        ) : null}
                        <span className="mt-auto pt-1 text-[11px] text-foreground-subtle">
                          {a.runs ? `${a.runs} körningar` : 'Klicka för att starta'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            <p className="mt-10 text-center text-[11px] text-foreground-subtle">
              AI-verktyg drivs av Mistral / Le Chat (Frankrike, EU-suveränt). Konfidentiella anteckningar exkluderas alltid.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-6">
              <div className="flex items-center justify-between">
                {activeAgent ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-canvas-subtle px-3 py-1 text-[12px] text-foreground-muted">
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full ${toneFor(activeAgent.id).swatch}`}>
                      <Icon name="sparkle" size={9} />
                    </span>
                    Med {activeAgent.name}
                    <button
                      type="button"
                      onClick={clearAgent}
                      className="text-foreground-subtle transition hover:text-foreground"
                      aria-label="Avsluta agentläge"
                    >
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={resetConversation}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] text-foreground-subtle transition hover:text-foreground"
                  title="Börja om"
                >
                  <Icon name="plus" size={12} />
                  Ny konversation
                </button>
              </div>

              {messages.map((msg, i) =>
                msg.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[78%] rounded-2xl rounded-tr-md bg-brand px-4 py-2.5 text-[14.5px] leading-relaxed text-brand-foreground">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[85%] whitespace-pre-wrap text-[14.5px] leading-relaxed text-foreground">
                      {msg.content}
                    </div>
                  </div>
                )
              )}

              {isPending && (
                <div className="flex justify-start">
                  <div className="inline-flex gap-1 text-foreground-subtle" aria-label="Laddar svar">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground-subtle" style={{ animationDelay: '0ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground-subtle" style={{ animationDelay: '150ms' }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-foreground-subtle" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-2xl bg-movexum-pastell-orange px-4 py-2 text-[13px] text-movexum-morkorange">
                  {error}
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>

          <div className="border-t border-default bg-canvas">
            <div className="mx-auto w-full max-w-[720px] px-6 py-4">
              {inputPill}
              <p className="mt-2 text-center text-[11px] text-foreground-subtle">
                AI drivs av Mistral / Le Chat (EU). Konfidentiella anteckningar exkluderas alltid.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
