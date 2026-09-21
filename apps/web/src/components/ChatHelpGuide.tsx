'use client';

import { useEffect, useMemo } from 'react';
import type { Role } from '@platform/shared';
import { Icon } from '@/components/proto/Icon';
import { buildChatGuide, CHAT_GUIDE_NOTES } from '@/lib/chat-guide';

/**
 * Hjälp-guiden i chatten (§ 33.3): "Vad kan jag göra här?" — ROLLSPECIFIK
 * (innehållet byggs av `buildChatGuide(roles)` så bara det den inloggades
 * roll faktiskt får göra visas). Varje exempel är klickbart och fyller
 * chattrutan — det SKICKAS inte, användaren läser/justerar och skickar
 * själv (människa-i-loopen). Ren presentation: ingen dataväg, ingen
 * AI-inferens (riskklass n/a).
 */
export default function ChatHelpGuide({
  roles,
  onUseExample,
  onClose
}: {
  roles: Role[];
  onUseExample: (text: string) => void;
  onClose: () => void;
}) {
  const sections = useMemo(() => buildChatGuide(roles), [roles]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-movexum-svart/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Vad kan chatten göra?"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-default bg-surface shadow-xl shadow-movexum-svart/20"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-default px-5 py-4">
          <div>
            <h2 className="font-heading text-[17px] font-semibold text-foreground">
              Vad kan chatten göra?
            </h2>
            <p className="mt-0.5 text-[12.5px] text-foreground-subtle">
              Guiden visar det din roll kan göra. Klicka på ett exempel så hamnar det i
              chattrutan — du läser igenom och skickar själv.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-canvas-muted hover:text-foreground"
            aria-label="Stäng guiden"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-6">
            {sections.map((section) => (
              <section key={section.id}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-canvas-muted text-foreground-subtle">
                    <Icon name={section.icon} size={13} />
                  </span>
                  <h3 className="font-heading text-[13px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
                    {section.title}
                  </h3>
                </div>
                <ul className="flex flex-col gap-3">
                  {section.items.map((item) => (
                    <li key={item.title} className="rounded-xl border border-default bg-canvas-subtle p-3">
                      <p className="text-[13.5px] font-semibold text-foreground">{item.title}</p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-foreground-muted">
                        {item.description}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.examples.map((example) => (
                          <button
                            key={example}
                            type="button"
                            onClick={() => onUseExample(example)}
                            className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5 text-left text-[12px] text-foreground-muted transition hover:border-strong hover:text-foreground"
                            title="Lägg exemplet i chattrutan"
                          >
                            <span className="truncate">”{example}”</span>
                            <Icon
                              name="arrow-up-right"
                              size={11}
                              className="shrink-0 text-foreground-subtle transition group-hover:text-foreground"
                            />
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <section>
              <h3 className="mb-2 font-heading text-[13px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
                Bra att veta
              </h3>
              <ul className="flex flex-col gap-1.5">
                {CHAT_GUIDE_NOTES.map((note) => (
                  <li key={note} className="flex items-start gap-2 text-[12.5px] leading-snug text-foreground-muted">
                    <Icon name="check" size={12} className="mt-0.5 shrink-0 text-foreground-subtle" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <div className="border-t border-default px-5 py-3 text-center text-[11px] text-foreground-subtle">
          AI-verktyg drivs av Mistral / Le Chat (Frankrike, EU-suveränt). Konfidentiella
          anteckningar exkluderas alltid.
        </div>
      </div>
    </div>
  );
}
