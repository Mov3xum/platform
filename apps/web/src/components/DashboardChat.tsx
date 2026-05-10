'use client';

import { useRef, useState, useTransition } from 'react';
import { sendChatMessage, type ChatMessage } from '@/lib/actions/chat';

export default function DashboardChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    // Use requestAnimationFrame to scroll after DOM update
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isPending) return;

    const userMessage: ChatMessage = { role: 'user', content: text };
    const nextMessages: ChatMessage[] = [...messages, userMessage];

    setMessages(nextMessages);
    setInput('');
    setError(null);
    scrollToBottom();

    startTransition(async () => {
      const result = await sendChatMessage(nextMessages);
      if (result.error) {
        setError(result.error);
      } else if (result.text) {
        const assistantText = result.text;
        setMessages((prev) => [...prev, { role: 'assistant', content: assistantText }]);
        scrollToBottom();
      }
    });
  }

  return (
    <section className="mt-8 rounded-3xl border border-default bg-surface shadow-sm shadow-movexum-svart/5">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-default px-5 py-4">
        <span className="text-xl" aria-hidden>💬</span>
        <div>
          <h2 className="text-base font-semibold text-foreground">Fråga plattformen</h2>
          <p className="text-xs text-foreground-subtle">AI-assistent med tillgång till din plattformsdata</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex h-72 flex-col gap-3 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-xs text-center text-sm text-foreground-muted">
              Ställ en fråga om portföljbolag, aktiviteter eller status — t.ex. &quot;Vilka bolag är aktiva?&quot; eller &quot;Hur mår portföljen?&quot;
            </p>
          </div>
        )}

        {messages.map((msg, i) =>
          msg.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[75%] rounded-2xl bg-brand px-4 py-2 text-sm text-brand-foreground">
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[75%] rounded-2xl bg-canvas-subtle px-4 py-2 text-sm text-foreground whitespace-pre-wrap">
                {msg.content}
              </div>
            </div>
          )
        )}

        {isPending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-canvas-subtle px-4 py-2 text-sm text-foreground-muted">
              <span className="inline-flex gap-1" aria-label="Laddar svar">
                <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
                <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-2xl bg-movexum-pastell-orange px-4 py-2 text-sm text-movexum-morkorange">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 border-t border-default px-5 py-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Skriv din fråga…"
          disabled={isPending}
          className="flex-1 rounded-xl border border-default bg-canvas px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none focus:ring-2 focus:ring-movexum-pastell-lila disabled:opacity-50 dark:focus:ring-movexum-morklila"
        />
        <button
          type="submit"
          disabled={isPending || !input.trim()}
          className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition hover:bg-brand-hover disabled:opacity-50"
        >
          Skicka
        </button>
      </form>

      {/* GDPR notice */}
      <p className="border-t border-default px-5 py-2 text-xs text-foreground-subtle">
        AI-verktyg drivs av Mistral / Le Chat (Frankrike, EU-suveränt). Konfidentiella anteckningar exkluderas alltid.
      </p>
    </section>
  );
}
