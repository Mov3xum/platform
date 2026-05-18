'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/proto/Icon';
import { sendStartupChatMessage, type ChatMessage } from '@/lib/actions/chat';
import { MessageBubble, type ChatBubble } from './MessageBubble';

interface Props {
  startupId: string;
  startupName: string;
}

export function ChatTab({ startupId, startupName }: Props) {
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isPending]);

  function nowTime() {
    return new Date().toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }

  function send() {
    const text = draft.trim();
    if (!text || isPending) return;

    const at = nowTime();
    const newUserMsg: ChatBubble = { role: 'user', content: text, at };
    const next = [...messages, newUserMsg];
    setMessages(next);
    setDraft('');
    setError(null);

    const apiMessages: ChatMessage[] = next.map((m) => ({
      role: m.role,
      content: m.content
    }));

    startTransition(async () => {
      const result = await sendStartupChatMessage(apiMessages, startupId);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.text) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: result.text!,
            at: nowTime(),
            model: 'Mistral · EU'
          }
        ]);
      }
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-8 lg:px-10">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="flex items-center justify-between pb-2">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                Konversation
              </div>
              <h2 className="font-heading text-[18px] font-semibold text-foreground">
                Chat med {startupName}
              </h2>
            </div>
          </div>

          {messages.length === 0 && (
            <div className="rounded-2xl border border-dashed border-default p-10 text-center">
              <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-canvas-muted text-foreground-subtle">
                <Icon name="sparkle" size={18} />
              </div>
              <p className="text-[13px] text-foreground-subtle">
                Ställ en fråga om {startupName}. AI:n grundar sig i bolagets anteckningar,
                milstolpar och aktiviteter — inga konfidentiella anteckningar.
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}

          {isPending && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-default bg-canvas-muted text-foreground-muted">
                <Icon name="sparkle" size={14} />
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-default bg-surface px-4 py-3">
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground-subtle"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground-subtle"
                  style={{ animationDelay: '120ms' }}
                />
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground-subtle"
                  style={{ animationDelay: '240ms' }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-movexum-pastell-orange px-4 py-2 text-sm text-movexum-morkorange">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-default bg-canvas px-4 py-4 lg:px-10">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border border-default bg-surface shadow-sm shadow-movexum-svart/5 transition focus-within:border-brand">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              disabled={isPending}
              placeholder={`Fråga något om ${startupName}…`}
              className="w-full resize-none bg-transparent px-4 pb-1.5 pt-3 text-[14px] leading-relaxed text-foreground placeholder:text-foreground-subtle focus:outline-none disabled:opacity-50"
            />
            <div className="flex items-center justify-between px-3 pb-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle hover:bg-canvas-muted"
                  title="Bifoga"
                  disabled
                >
                  <Icon name="paperclip" size={15} />
                </button>
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-foreground-subtle hover:bg-canvas-muted"
                  title="Röst"
                  disabled
                >
                  <Icon name="mic" size={15} />
                </button>
                <div className="ml-2 inline-flex items-center gap-1.5 rounded-md bg-canvas-muted px-2 py-1 font-mono text-[11px] text-foreground-subtle">
                  <Icon name="bot" size={11} /> Mistral · EU
                </div>
              </div>
              <button
                type="button"
                onClick={send}
                disabled={isPending || !draft.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-[12.5px] font-medium text-brand-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Skicka <Icon name="send" size={13} />
              </button>
            </div>
          </div>
          <div className="mt-2 text-center font-mono text-[10.5px] text-foreground-subtle">
            Konfidentiella anteckningar exkluderas alltid. AI-svar — verifiera innan delning.
          </div>
        </div>
      </div>
    </div>
  );
}
